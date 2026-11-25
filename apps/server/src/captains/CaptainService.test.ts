import { assert, it } from "@effect/vitest";
import {
  CaptainId,
  CaptainError,
  CaptainMemoryId,
  captainPrimaryThreadId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskError,
  ThreadId,
  type CaptainCreateInput,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import {
  type ThreadLaunchInput,
  ThreadLaunchService,
} from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTasks from "../scheduledTasks/ScheduledTaskService.ts";
import * as CaptainHandoff from "./captainHandoff.ts";
import * as CaptainService from "./CaptainService.ts";
import * as CaptainStore from "./CaptainStore.ts";
import { captainDelegationProject, makeCaptainCanWake } from "./captainDelegation.ts";
import { makeReadCaptainTurnContext } from "./captainTurnContext.ts";

const scratch = ProjectId.make("scratch");
const project = ProjectId.make("project");
const secondProject = ProjectId.make("project-2");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
const input = {
  captainId: CaptainId.make("maria"),
  name: "Maria",
  role: "Coordinator",
  instructions: "Keep the change focused.",
  avatar: { preset: "compass", color: "violet" },
  reportPolicy: "context",
  scopedProjectIds: [],
  modelSelection,
  runtimeMode: "approval-required",
  interactionMode: "default",
} satisfies CaptainCreateInput;

const fixture = ({ scratchUnavailable = false } = {}) => {
  const launches = new Map<ThreadId, ThreadLaunchInput>();
  let failRebind = false;
  let listInvalidations = 0;
  const dependencies = Layer.mergeAll(
    CaptainStore.layer,
    Layer.mock(ThreadLaunchService)({
      launch: (input) =>
        Effect.sync(() => {
          if (input.threadId !== undefined) launches.set(input.threadId, input);
          return { threadId: input.threadId } as never;
        }),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.succeed((launches.get(id) as OrchestrationV2ThreadShell | undefined) ?? null),
    }),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/unused",
      ensureScratchProject: scratchUnavailable
        ? Effect.fail(new ManagedProjectFolders.ScratchUnavailableError({ baseDir: "/home" }))
        : Effect.succeed({ projectId: scratch }),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getById: (id) =>
        Effect.succeed(
          id === project || id === secondProject
            ? Option.some({ id, title: "Workspace" } as never)
            : Option.none(),
        ),
    }),
    Layer.unwrap(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return Layer.mock(ScheduledTasks.ScheduledTaskService)({
          rebindThreadTasks: (from, to) =>
            Effect.gen(function* () {
              yield* sql`UPDATE scheduled_tasks SET thread_id = ${to} WHERE thread_id = ${from}`.pipe(
                Effect.orDie,
              );
              if (failRebind)
                return yield* new ScheduledTaskError({ message: "Failed after updating binding" });
            }),
          invalidateList: Effect.sync(() => {
            listInvalidations++;
          }),
        });
      }),
    ),
  );
  const layer = CaptainService.layer.pipe(
    Layer.provideMerge(dependencies),
    Layer.provideMerge(Sqlite.layerMemory),
  );
  return {
    layer,
    launches,
    failReset: () => {
      failRebind = true;
    },
    allowReset: () => {
      failRebind = false;
    },
    invalidations: () => listInvalidations,
  };
};

it.effect("creates one primary thread, validates scope, and falls back to Scratch", () =>
  Effect.gen(function* () {
    const { layer, launches } = fixture();
    yield* Effect.gen(function* () {
      const service = yield* CaptainService.CaptainService;
      const bad = yield* Effect.flip(
        service.create({ ...input, scopedProjectIds: [ProjectId.make("missing")] }),
      );
      assert.equal(bad.code, "invalid_request");
      assert.equal(launches.size, 0);
      const [created, repeated] = yield* Effect.all(
        [service.create(input), service.create(input)],
        { concurrency: 2 },
      );
      assert.deepStrictEqual(repeated, created);
      assert.equal(launches.size, 1);
      assert.equal(launches.get(created.primaryThreadId)?.projectId, scratch);
      assert.equal(launches.get(created.primaryThreadId)?.creationSource, "web");
      const scoped = yield* service.create({
        ...input,
        captainId: CaptainId.make("scoped"),
        scopedProjectIds: [project, project, secondProject],
      });
      assert.deepStrictEqual(scoped.scopedProjectIds, [project, secondProject]);
      assert.equal(launches.get(scoped.primaryThreadId)?.projectId, project);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("round-trips coordinatorOnly and decodes rows that omit it as false", () =>
  Effect.gen(function* () {
    const { layer } = fixture();
    yield* Effect.gen(function* () {
      const service = yield* CaptainService.CaptainService;
      const store = yield* CaptainStore.CaptainStore;
      const captain = yield* service.create({ ...input, coordinatorOnly: true });
      assert.isTrue(captain.coordinatorOnly);
      assert.isFalse(
        (yield* service.update({ captainId: captain.id, coordinatorOnly: false })).coordinatorOnly,
      );
      assert.isFalse(
        (yield* service.update({ captainId: captain.id, role: "Updated" })).coordinatorOnly,
      );

      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO captains (
          id, name, role, instructions, avatar, primary_thread_id, report_policy, created_at, updated_at
        ) VALUES (
          'legacy', 'Legacy', 'Coordinator', '', '{"preset":"compass","color":"violet"}',
          'captain:legacy:0', 'context', '2026-11-24T12:00:00.000Z', '2026-11-24T12:00:00.000Z'
        )
      `;
      assert.isFalse((yield* store.find(CaptainId.make("legacy")))?.coordinatorOnly);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("asks for a scoped project when the environment has no Scratch", () =>
  Effect.gen(function* () {
    const { layer, launches } = fixture({ scratchUnavailable: true });
    yield* Effect.gen(function* () {
      const service = yield* CaptainService.CaptainService;
      const error = yield* Effect.flip(service.create(input));
      assert.equal(error.code, "invalid_request");
      assert.include(error.message, "workspace scope");
      assert.equal(launches.size, 0);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect(
  "resets the primary thread, rolls back a failed rebinding, and keeps docs and memories",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* Effect.gen(function* () {
        const service = yield* CaptainService.CaptainService;
        const store = yield* CaptainStore.CaptainStore;
        const sql = yield* SqlClient.SqlClient;
        const captain = yield* service.create({
          ...input,
          scopedProjectIds: [project],
          creationSource: "mcp",
        });
        assert.equal(f.launches.get(captain.primaryThreadId)?.creationSource, "mcp");
        const date = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
        INSERT INTO scheduled_tasks (
          task_id, title, prompt, enabled, schedule_json, project_id, thread_id, thread_mode,
          workspace_strategy_json, model_selection_json, runtime_mode, interaction_mode,
          created_by, creation_source, created_at, updated_at, last_run_status, run_count
        ) VALUES ('scheduled', 'Reminder', 'Check work', 0, '{}', ${project}, ${captain.primaryThreadId},
          'continue', '{}', '{}', 'approval-required', 'default', 'user', 'web', ${date}, ${date}, 'idle', 0)
      `;
        const document = yield* service.updateDocument({
          captainId: captain.id,
          name: "NOTES.md",
          content: "Carry this across resets.",
          expectedRevision: 0,
        });
        const memory = yield* service.upsertMemory({
          captainId: captain.id,
          id: CaptainMemoryId.make("memory"),
          text: "Keep it",
          essential: true,
        });
        const canWake = yield* makeCaptainCanWake;
        assert.isFalse(yield* canWake(captain.primaryThreadId));
        yield* service.update({ captainId: captain.id, reportPolicy: "react" });
        const beforeReset = yield* store.find(captain.id);
        assert.isTrue(yield* canWake(captain.primaryThreadId));
        const reset = { captainId: captain.id, expectedThreadId: captain.primaryThreadId };
        f.failReset();
        assert.equal((yield* Effect.flip(service.resetConversation(reset))).code, "unavailable");
        assert.deepStrictEqual(yield* store.find(captain.id), beforeReset);
        assert.notInclude(
          (yield* store.document(captain, "NOTES.md")).content,
          "## Handoff from the previous conversation",
        );
        const binding = sql<{
          thread_id: string;
        }>`SELECT thread_id FROM scheduled_tasks WHERE task_id = 'scheduled'`;
        assert.equal((yield* binding)[0]?.thread_id, captain.primaryThreadId);
        f.allowReset();
        const next = yield* service.resetConversation(reset);
        assert.notEqual(next.primaryThreadId, captain.primaryThreadId);
        assert.isFalse(yield* canWake(captain.primaryThreadId));
        assert.isTrue(yield* canWake(next.primaryThreadId));
        assert.deepStrictEqual(next.earlierThreadIds, [captain.primaryThreadId]);
        assert.equal(f.launches.get(next.primaryThreadId)?.projectId, project);
        assert.equal(f.launches.get(next.primaryThreadId)?.creationSource, "mcp");
        assert.deepStrictEqual(
          f.launches.get(next.primaryThreadId)?.modelSelection,
          modelSelection,
        );
        assert.equal((yield* binding)[0]?.thread_id, next.primaryThreadId);
        assert.deepStrictEqual(yield* service.resetConversation(reset), next);
        assert.equal(f.invalidations(), 1);
        const notes = yield* store.document(next, "NOTES.md");
        assert.isAbove(notes.revision, document.revision);
        assert.include(notes.content, "## Handoff from the previous conversation");
        assert.include(notes.content, "Carry this across resets.");
        assert.include(notes.content, "1 scheduled task moved to the new conversation.");
        assert.equal(
          notes.content.match(/^## Handoff from the previous conversation/gm)?.length,
          1,
        );
        assert.deepStrictEqual(yield* store.listMemories(next.id, { limit: 2 }), [memory]);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect("writes a reset handoff and still resets when the handoff write fails", () =>
  Effect.gen(function* () {
    const f = fixture();
    yield* Effect.gen(function* () {
      const service = yield* CaptainService.CaptainService;
      const store = yield* CaptainStore.CaptainStore;
      const sql = yield* SqlClient.SqlClient;
      const captain = yield* service.create({ ...input, scopedProjectIds: [project] });
      const childThreadId = ThreadId.make("thread:child");
      const at = "2026-11-24T10:00:00.000Z";
      yield* sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, parent_node_id, provider, origin, status,
          child_thread_id, started_at, updated_at, payload_json
        ) VALUES ('task-1', ${captain.primaryThreadId}, 'node', 'codex', 'app_owned', 'running',
          ${childThreadId}, ${at}, ${at}, ${JSON.stringify({
            title: "Review the migration",
            progress: "Checking projection rows\nMore detail",
          })})
      `;
      yield* sql`
        INSERT INTO orchestration_v2_projection_runtime_requests (
          runtime_request_id, thread_id, node_id, kind, status, created_at, payload_json
        ) VALUES ('request-1', ${childThreadId}, 'node', 'command', 'pending', ${at}, '{}')
      `;
      yield* sql`
        INSERT INTO orchestration_v2_projection_turn_items (
          turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json
        ) VALUES ('item-1', ${childThreadId}, 1, 'approval_request', 'pending', ${at},
          ${JSON.stringify({ requestId: "request-1", prompt: "Run the migration test" })})
      `;
      const message = (
        id: string,
        role: "user" | "assistant",
        text: string,
        createdAt: string,
      ) => sql`
        INSERT INTO orchestration_v2_projection_messages (
          message_id, thread_id, role, streaming, created_at, updated_at, payload_json
        ) VALUES (${id}, ${captain.primaryThreadId}, ${role}, 0, ${createdAt}, ${createdAt},
          ${JSON.stringify({ text })})
      `;
      yield* message("user-old", "user", "Earlier request", "2026-11-24T09:00:00.000Z");
      yield* message(
        "user-last",
        "user",
        "Please finish the migration",
        "2026-11-24T09:05:00.000Z",
      );
      yield* message(
        "assistant-last",
        "assistant",
        "I am checking the projection rows",
        "2026-11-24T09:06:00.000Z",
      );

      const next = yield* service.resetConversation({
        captainId: captain.id,
        expectedThreadId: captain.primaryThreadId,
      });
      const notes = yield* store.document(next, "NOTES.md");
      assert.include(notes.content, "### Active delegated tasks");
      assert.include(
        notes.content,
        "- Review the migration (running, follow: thread:child): Checking projection rows",
      );
      assert.include(notes.content, "### Waiting on the user");
      assert.include(
        notes.content,
        "- command approval on thread:child: Run the migration test [request: request-1]",
      );
      assert.include(notes.content, "> Please finish the migration");
      assert.include(notes.content, "> I am checking the projection rows");
      assert.notInclude(notes.content, "Earlier request");

      const again = yield* service.resetConversation({
        captainId: next.id,
        expectedThreadId: next.primaryThreadId,
      });
      const carried = yield* store.document(again, "NOTES.md");
      assert.include(
        carried.content,
        "- Review the migration (running, follow: thread:child): Checking projection rows",
      );
      assert.include(carried.content, "- command approval on thread:child");
      assert.equal(
        carried.content.match(/^## Handoff from the previous conversation/gm)?.length,
        1,
      );

      yield* sql`
        CREATE TRIGGER fail_captain_document_insert BEFORE INSERT ON captain_documents
        BEGIN SELECT RAISE(ABORT, 'Cannot write notes.'); END
      `;
      const blocked = yield* service.create({ ...input, captainId: CaptainId.make("blocked") });
      const reset = yield* service.resetConversation({
        captainId: blocked.id,
        expectedThreadId: blocked.primaryThreadId,
      });
      assert.notEqual(reset.primaryThreadId, blocked.primaryThreadId);
      assert.equal((yield* store.document(reset, "NOTES.md")).content, "");
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect("retries one stale NOTES.md revision when writing a handoff", () =>
  Effect.gen(function* () {
    let reads = 0;
    let writes = 0;
    const captain = {
      id: input.captainId,
      name: input.name,
      role: input.role,
      instructions: input.instructions,
      avatar: input.avatar,
      reportPolicy: input.reportPolicy,
      coordinatorOnly: false,
      scopedProjectIds: input.scopedProjectIds,
      primaryThreadId: captainPrimaryThreadId(input.captainId, 0),
      earlierThreadIds: [],
      createdAt: "2026-11-24T10:00:00.000Z",
      updatedAt: "2026-11-24T10:00:00.000Z",
      archivedAt: null,
    };
    const storeLayer = Layer.mock(CaptainStore.CaptainStore)({
      document: () =>
        Effect.sync(() => {
          reads++;
          return {
            captainId: captain.id,
            name: "NOTES.md" as const,
            content: reads === 1 ? "stale" : "latest",
            revision: reads === 1 ? 0 : 1,
            updatedAt: "2026-11-24T10:00:00.000Z",
          };
        }),
      updateDocument: (update) =>
        Effect.gen(function* () {
          writes++;
          if (writes === 1) {
            return yield* new CaptainError({ code: "conflict", message: "Notes changed." });
          }
          assert.equal(update.expectedRevision, 1);
          assert.include(update.content, "latest");
          return {
            captainId: update.captainId,
            name: update.name,
            content: update.content,
            revision: update.expectedRevision + 1,
            updatedAt: "2026-11-24T10:01:00.000Z",
          };
        }),
    });

    yield* CaptainHandoff.save({
      captain,
      section: "## Handoff from the previous conversation (2026-11-24T10:00:00.000Z)",
    }).pipe(Effect.provide(storeLayer));
    assert.equal(reads, 2);
    assert.equal(writes, 2);
  }),
);

it.effect(
  "streams durable edits and rejects stale document revisions and locked agent writes",
  () =>
    Effect.gen(function* () {
      const { layer } = fixture();
      yield* Effect.gen(function* () {
        const service = yield* CaptainService.CaptainService;
        const store = yield* CaptainStore.CaptainStore;
        const captain = yield* service.create(input);
        const edit = {
          captainId: captain.id,
          name: "AGENTS.md",
          content: "Respect local instructions.",
          expectedRevision: 0,
        } as const;
        const snapshots = yield* service.subscribe({ captainId: captain.id }).pipe(
          Stream.tap((snapshot) =>
            snapshot.documents.find((doc) => doc.name === edit.name)?.revision === 0
              ? service.updateDocument(edit)
              : Effect.void,
          ),
          Stream.take(2),
          Stream.runCollect,
        );
        assert.equal(
          snapshots[1]?.documents.find((doc) => doc.name === edit.name)?.content,
          edit.content,
        );
        assert.equal((yield* Effect.flip(service.updateDocument(edit))).code, "conflict");
        const memory = {
          captainId: captain.id,
          id: CaptainMemoryId.make("locked"),
          text: "Locked",
          essential: true,
        };
        yield* service.upsertMemory(memory);
        assert.equal(
          (yield* Effect.flip(
            store.upsertMemory({ ...memory, text: "Overwrite" }, captain.primaryThreadId),
          )).code,
          "locked",
        );
        assert.equal(
          (yield* Effect.flip(store.deleteMemory(memory, captain.primaryThreadId))).code,
          "locked",
        );
        yield* service.archive({ captainId: captain.id });
        assert.isUndefined(yield* store.byThread(captain.primaryThreadId));
        yield* service.unarchive({ captainId: captain.id });
        assert.equal((yield* store.byThread(captain.primaryThreadId))?.id, captain.id);
        yield* service.delete({ captainId: captain.id });
        assert.deepStrictEqual(yield* store.listMemories(captain.id, { limit: 10 }), []);
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(
          yield* sql`SELECT name FROM captain_documents WHERE captain_id = ${captain.id}`,
          [],
        );
        assert.deepStrictEqual(yield* store.snapshot({}), {
          captains: [],
          documents: [],
          memories: [],
        });
      }).pipe(Effect.provide(layer));
    }),
);

it.effect(
  "adds bounded context for a primary thread and selects only allowed delegation projects",
  () =>
    Effect.gen(function* () {
      const { layer } = fixture();
      yield* Effect.gen(function* () {
        const service = yield* CaptainService.CaptainService;
        const captain = yield* service.create({
          ...input,
          scopedProjectIds: [project],
          instructions: "a".repeat(16_000),
        });
        yield* service.upsertMemory({
          captainId: captain.id,
          id: CaptainMemoryId.make("essential"),
          text: "Always mention this",
          essential: true,
        });
        yield* service.upsertMemory({
          captainId: captain.id,
          id: CaptainMemoryId.make("optional"),
          text: "Keep this optional",
          essential: false,
        });
        yield* service.updateDocument({
          captainId: captain.id,
          name: "NOTES.md",
          content: "Notes are included",
          expectedRevision: 0,
        });
        yield* service.updateDocument({
          captainId: captain.id,
          name: "CREW.md",
          content: "Run the tests before reporting.",
          expectedRevision: 0,
        });
        const readContext = yield* makeReadCaptainTurnContext;
        const read = (id: ThreadId, parentThreadId: ThreadId | null = null) =>
          readContext({
            id,
            lineage: {
              parentThreadId,
              relationshipToParent: parentThreadId === null ? null : "subagent",
            },
          }).pipe(Effect.map(({ text }) => text));
        const context = yield* read(captain.primaryThreadId);
        assert.include(context, "Captain profile: Maria (Coordinator)");
        assert.include(context, "Workspace [project]");
        assert.include(context, "Always mention this");
        assert.include(context, "Notes are included");
        assert.notInclude(context, "Keep this optional");
        assert.notInclude(context, "Run the tests before reporting.");
        assert.notInclude(context, "How you work:");
        assert.isBelow(context.length, 5_000);
        yield* service.update({ captainId: captain.id, coordinatorOnly: true });
        const coordinated = yield* read(captain.primaryThreadId);
        assert.include(coordinated, "How you work:");
        assert.include(coordinated, '`delegate_task` and `isolation: "worktree"`');
        yield* service.update({ captainId: captain.id, coordinatorOnly: false });

        // A provider thread that took the briefing gets a pointer until something in it changes.
        const delivery = { providerThreadId: "provider-thread", usedTokens: 1_000 };
        const primaryThread = {
          id: captain.primaryThreadId,
          lineage: { parentThreadId: null, relationshipToParent: null },
        };
        const first = yield* readContext(primaryThread, delivery);
        assert.include(first.text, "Always mention this");
        yield* first.delivered;
        const second = yield* readContext(primaryThread, delivery);
        assert.notInclude(second.text, "Always mention this");
        assert.include(second.text, "unchanged since they were last given");
        yield* service.updateDocument({
          captainId: captain.id,
          name: "NOTES.md",
          content: "Notes changed.",
          expectedRevision: 1,
        });
        assert.include((yield* readContext(primaryThread, delivery)).text, "Notes changed.");
        yield* service.updateDocument({
          captainId: captain.id,
          name: "NOTES.md",
          content: "Notes are included",
          expectedRevision: 2,
        });

        assert.notInclude(yield* read(captain.primaryThreadId), "Context check");
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO orchestration_v2_projection_provider_turns (
            provider_turn_id, thread_id, provider_thread_id, node_id, ordinal, status, payload_json
          ) VALUES ('turn-1', ${captain.primaryThreadId}, 'provider-thread', 'node', 1, 'completed',
            ${JSON.stringify({
              tokenUsage: {
                usedTokens: 160_000,
                maxTokens: 200_000,
                updatedAt: "2026-11-24T10:00:00.000Z",
              },
            })})
        `;
        assert.include(
          yield* read(captain.primaryThreadId),
          "Context check: this conversation is 80% full.",
        );

        assert.equal(yield* read(ThreadId.make("ordinary")), "");
        const crew = yield* read(ThreadId.make("child"), captain.primaryThreadId);
        assert.include(crew, "keep a progress note in your worktree");
        assert.include(crew, "Run the tests before reporting.");
        assert.notInclude(crew, "Always mention this");
        assert.notInclude(crew, "Notes are included");

        const crewThread = {
          id: ThreadId.make("ledger-child"),
          lineage: {
            parentThreadId: captain.primaryThreadId,
            relationshipToParent: "subagent" as const,
          },
        };
        const crewDelivery = { providerThreadId: "crew-provider-thread", usedTokens: 1_000 };
        const firstCrew = yield* readContext(crewThread, crewDelivery);
        assert.include(firstCrew.text, "keep a progress note in your worktree");
        yield* firstCrew.delivered;
        const secondCrew = yield* readContext(crewThread, crewDelivery);
        assert.notInclude(secondCrew.text, "keep a progress note in your worktree");
        assert.include(secondCrew.text, "crew rules are unchanged");

        const noCustomCrew = yield* service.create({
          ...input,
          captainId: CaptainId.make("plain"),
        });
        assert.include(
          yield* read(ThreadId.make("plain-child"), noCustomCrew.primaryThreadId),
          "done-check from your brief passes",
        );
        assert.equal(yield* read(ThreadId.make("grandchild"), ThreadId.make("child")), "");
        const next = yield* service.resetConversation({
          captainId: captain.id,
          expectedThreadId: captain.primaryThreadId,
        });
        assert.include(
          yield* read(ThreadId.make("pre-reset-child"), captain.primaryThreadId),
          "Run the tests before reporting.",
        );
        yield* service.archive({ captainId: next.id });
        assert.equal(yield* read(ThreadId.make("child"), next.primaryThreadId), "");
        assert.equal(
          yield* captainDelegationProject({ captain, currentProjectId: scratch }),
          project,
        );
        assert.equal(
          (yield* Effect.flip(
            captainDelegationProject({
              captain,
              currentProjectId: scratch,
              requestedProjectId: secondProject,
            }),
          )).code,
          "invalid_request",
        );
      }).pipe(Effect.provide(layer));
    }),
);

it.effect("streams only the changes a subscription shows", () =>
  Effect.gen(function* () {
    const { layer } = fixture();
    yield* Effect.gen(function* () {
      const service = yield* CaptainService.CaptainService;
      const maria = yield* service.create(input);
      const other = yield* service.create({ ...input, captainId: CaptainId.make("other") });
      const note = (captainId: typeof maria.id, content: string) =>
        service.updateDocument({ captainId, name: "NOTES.md", content, expectedRevision: 0 });

      const list = yield* service.subscribe({}).pipe(
        Stream.tap((snapshot) =>
          snapshot.captains.some((captain) => captain.name === "Renamed")
            ? Effect.void
            : note(maria.id, "Not a list change").pipe(
                Effect.andThen(service.update({ captainId: maria.id, name: "Renamed" })),
              ),
        ),
        Stream.take(2),
        Stream.runCollect,
      );
      assert.equal(list[1]?.captains.find(({ id }) => id === maria.id)?.name, "Renamed");

      const detail = yield* service.subscribe({ captainId: other.id }).pipe(
        Stream.tap((snapshot) =>
          snapshot.documents.find(({ name }) => name === "NOTES.md")?.revision === 0
            ? service
                .updateDocument({
                  captainId: maria.id,
                  name: "NOTES.md",
                  content: "Not mine",
                  expectedRevision: 1,
                })
                .pipe(
                  Effect.andThen(service.update({ captainId: maria.id, role: "Someone else" })),
                  Effect.andThen(note(other.id, "Mine")),
                )
            : Effect.void,
        ),
        Stream.take(2),
        Stream.runCollect,
      );
      assert.equal(detail[1]?.documents.find(({ name }) => name === "NOTES.md")?.content, "Mine");
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("surfaces reports from conversations before a reset on the current conversation", () =>
  Effect.gen(function* () {
    const { layer } = fixture();
    yield* Effect.gen(function* () {
      const service = yield* CaptainService.CaptainService;
      const sql = yield* SqlClient.SqlClient;
      const captain = yield* service.create({ ...input, reportPolicy: "react" });
      const next = yield* service.resetConversation({
        captainId: captain.id,
        expectedThreadId: captain.primaryThreadId,
      });
      const readContext = yield* makeReadCaptainTurnContext;
      const read = () =>
        readContext({
          id: next.primaryThreadId,
          lineage: { parentThreadId: null, relationshipToParent: null },
        }).pipe(Effect.map(({ text }) => text));
      yield* sql`
        INSERT INTO orchestration_v2_projection_threads (
          thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
          created_at, updated_at, payload_json
        ) VALUES (${next.primaryThreadId}, ${scratch}, 'Maria', 'codex', 'approval-required',
          'default', '2026-11-24T10:00:00.000Z', '2026-11-24T10:00:00.000Z', '{}')
      `;
      const report = (id: string, threadId: ThreadId, completedAt: string) => sql`
        INSERT INTO orchestration_v2_projection_subagents (
          subagent_id, thread_id, parent_node_id, provider, origin, status,
          completed_at, updated_at, payload_json
        ) VALUES (${id}, ${threadId}, 'node', 'codex', 'app_owned', 'completed',
          ${completedAt}, ${completedAt}, ${JSON.stringify({ title: id, result: `${id} result` })})
      `;
      yield* report("before-reset", captain.primaryThreadId, "2026-11-24T09:00:00.000Z");
      yield* report("after-reset", captain.primaryThreadId, "2026-11-24T11:00:00.000Z");
      yield* report("current", next.primaryThreadId, "2026-11-24T11:00:00.000Z");

      const reacting = yield* read();
      assert.include(reacting, "after-reset result");
      assert.notInclude(reacting, "before-reset result");
      assert.notInclude(reacting, "current result");

      yield* sql`
        INSERT INTO orchestration_v2_projection_runs (
          run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json
        ) VALUES ('run', ${next.primaryThreadId}, 1, 'codex', 'completed',
          '2026-11-24T12:00:00.000Z', '2026-11-24T12:05:00.000Z', '{}')
      `;
      assert.notInclude(yield* read(), "after-reset result");

      yield* service.update({ captainId: captain.id, reportPolicy: "context" });
      const included = yield* read();
      assert.include(included, "before-reset result");
      assert.include(included, "after-reset result");
      assert.include(included, "current result");
    }).pipe(Effect.provide(layer));
  }),
);
