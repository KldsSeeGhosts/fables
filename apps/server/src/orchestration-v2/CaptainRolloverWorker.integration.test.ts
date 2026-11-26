import { assert, it } from "@effect/vitest";
import {
  CaptainId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  TurnItemId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import * as CaptainService from "../captains/CaptainService.ts";
import * as CaptainStore from "../captains/CaptainStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as CaptainRolloverWorker from "./CaptainRolloverWorker.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const projectId = ProjectId.make("rollover-project");
const driver = ProviderDriverKind.make("claude");
const providerInstanceId = ProviderInstanceId.make("claude");
const providerThreadId = ProviderThreadId.make("rollover-session");
const modelSelection = { instanceId: providerInstanceId, model: "claude-test" };
const at = (second: number) => DateTime.makeUnsafe(Date.UTC(2026, 0, 1, 0, 0, second));

const newCaptain = (id: string) => ({
  captainId: CaptainId.make(id),
  name: "Maria",
  role: "Coordinator",
  instructions: "",
  avatar: { preset: "compass", color: "violet" } as const,
  scopedProjectIds: [],
  reportPolicy: "context" as const,
  modelSelection,
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
});

const layerPersistence = EventSink.layer.pipe(
  Layer.provideMerge(EventStore.layerFromOrchestrationEventStore),
  Layer.provideMerge(ProjectionStore.layer),
  Layer.provideMerge(OrchestrationEventStore.layer),
);

const makeFixture = Effect.fn("CaptainRolloverWorkerTest.makeFixture")(function* () {
  const firstSend = yield* Deferred.make<void>();
  const nextSent = yield* Deferred.make<ThreadManagement.ThreadManagementSendInput>();
  const sends: ThreadManagement.ThreadManagementSendInput[] = [];
  let failNext = false;
  const testServices = Layer.unwrap(
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      return Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (id) => projections.getThreadShell(id).pipe(Effect.orDie),
          getThreadRecords: (id, fields, filter) =>
            projections.getThreadRecords(id, fields, filter).pipe(Effect.orDie),
          sendToThread: (input) =>
            Effect.gen(function* () {
              if (failNext) {
                failNext = false;
                yield* Deferred.succeed(firstSend, undefined);
                return yield* new ThreadManagement.ThreadManagementWorktreeRestoreError({
                  threadId: input.threadId,
                  cause: "temporary workspace error",
                });
              }
              sends.push(input);
              yield* Deferred.succeed(nextSent, input);
              return {} as ThreadManagement.ThreadManagementSendResult;
            }),
        }),
        Layer.mock(ThreadLaunch.ThreadLaunchService)({
          launch: ({ threadId, ...input }) =>
            Effect.gen(function* () {
              if (threadId === undefined) return yield* Effect.die("Expected a Captain primary ID");
              yield* sink
                .write({
                  events: [
                    {
                      id: EventId.make(`launch:${threadId}`),
                      type: "thread.created",
                      threadId,
                      occurredAt: at(0),
                      payload: {
                        ...input,
                        id: threadId,
                        providerInstanceId,
                        branch: null,
                        worktreePath: null,
                        activeProviderThreadId: null,
                        lineage: {
                          parentThreadId: null,
                          relationshipToParent: null,
                          rootThreadId: threadId,
                        },
                        forkedFrom: null,
                        createdAt: at(0),
                        updatedAt: at(0),
                        archivedAt: null,
                        settledOverride: null,
                        settledAt: null,
                        lastVisitedAt: null,
                        deletedAt: null,
                      },
                    },
                  ],
                })
                .pipe(Effect.orDie);
              return { threadId } as never;
            }),
        }),
      );
    }),
  );
  const base = CaptainService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        CaptainStore.layer,
        ThreadCommandExecutor.layer,
        testServices,
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          ensureScratchProject: Effect.succeed({ projectId }),
        }),
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(ScheduledTaskService.ScheduledTaskService)({
          rebindThreadTasks: () => Effect.void,
          invalidateList: Effect.void,
        }),
      ),
    ),
    Layer.provideMerge(layerPersistence),
    Layer.provideMerge(Sqlite.layerMemory),
  );
  return {
    base,
    sends,
    firstSend,
    nextSent,
    failNext: () => {
      failNext = true;
    },
  };
});

const makeRun = (
  threadId: ThreadId,
  ordinal: number,
  status: OrchestrationV2Run["status"],
): OrchestrationV2Run => ({
  id: RunId.make(`run:${threadId}:${ordinal}`),
  threadId,
  ordinal,
  providerInstanceId,
  modelSelection,
  providerThreadId,
  userMessageId: MessageId.make(`message:${threadId}:${ordinal}`),
  rootNodeId: null,
  activeAttemptId: null,
  status,
  requestedAt: at(ordinal),
  startedAt: status === "queued" ? null : at(ordinal),
  completedAt: status === "queued" ? null : at(ordinal),
  checkpointId: null,
  contextHandoffId: null,
});

const message = (run: OrchestrationV2Run, text: string): OrchestrationV2ConversationMessage => ({
  id: run.userMessageId,
  threadId: run.threadId,
  runId: run.id,
  nodeId: null,
  role: "user",
  text,
  attachments: [],
  streaming: false,
  createdBy: "user",
  creationSource: "web",
  createdAt: run.requestedAt,
  updatedAt: run.requestedAt,
});

const itemBase = (threadId: ThreadId, second: number, runId: RunId | null) => ({
  id: TurnItemId.make(`item:${threadId}:${second}`),
  threadId,
  runId,
  nodeId: null,
  providerThreadId,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: second,
  title: null,
  startedAt: at(second),
  completedAt: at(second),
  updatedAt: at(second),
});

it.effect(
  "uses persisted compaction, failures and crew settlement at a Captain's turn boundary",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      yield* Effect.gen(function* () {
        const captains = yield* CaptainService.CaptainService;
        const store = yield* CaptainStore.CaptainStore;
        const commands = yield* ThreadCommandExecutor.ThreadCommandExecutor;
        const sink = yield* EventSink.EventSinkV2;
        const captain = yield* captains.create(newCaptain("rollover-boundary"));
        const threadId = captain.primaryThreadId;
        const write = (event: OrchestrationV2DomainEvent) => sink.write({ events: [event] });
        const assertPrimary = (id: ThreadId) =>
          store
            .requireCaptain(captain.id)
            .pipe(
              Effect.tap((state) => Effect.sync(() => assert.equal(state.primaryThreadId, id))),
            );
        const usage = (second: number) =>
          write({
            id: EventId.make(`usage:${second}`),
            type: "provider-turn.updated",
            threadId,
            occurredAt: at(second),
            payload: {
              id: ProviderTurnId.make("rollover-usage"),
              providerThreadId,
              nodeId: NodeId.make("rollover-provider-node"),
              runAttemptId: null,
              nativeTurnRef: null,
              ordinal: 1,
              status: "completed",
              startedAt: at(0),
              completedAt: at(second),
              tokenUsage: {
                usedTokens: 95_000,
                maxTokens: 100_000,
                updatedAt: DateTime.formatIso(at(second)),
              },
            },
          });
        const terminal = (run: OrchestrationV2Run) =>
          write({
            id: EventId.make(`end:${run.id}`),
            type: "run.updated",
            threadId,
            occurredAt: run.requestedAt,
            payload: run,
          }).pipe(Effect.andThen(commands.handleCaptainTurnEnd(threadId, run)));
        yield* write({
          id: EventId.make("rollover-provider-thread"),
          type: "provider-thread.updated",
          threadId,
          occurredAt: at(0),
          payload: {
            id: providerThreadId,
            appThreadId: threadId,
            driver,
            providerInstanceId,
            providerSessionId: null,
            ownerNodeId: null,
            nativeThreadRef: null,
            nativeConversationHeadRef: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            status: "active",
            firstRunOrdinal: 1,
            createdAt: at(0),
            updatedAt: at(0),
          },
        });
        yield* usage(1);
        yield* write({
          id: EventId.make("background-compaction"),
          type: "turn-item.updated",
          threadId,
          occurredAt: at(2),
          payload: {
            ...itemBase(threadId, 2, null),
            type: "compaction",
            driver,
            status: "completed",
          },
        });
        yield* terminal(makeRun(threadId, 3, "completed"));
        yield* assertPrimary(threadId);

        yield* usage(4);
        yield* terminal(makeRun(threadId, 5, "failed"));
        yield* assertPrimary(threadId);

        const limited = makeRun(threadId, 6, "failed");
        yield* sink.write({
          events: [
            {
              id: EventId.make("compact-prompt"),
              type: "message.updated",
              threadId,
              occurredAt: at(6),
              payload: message(limited, "/compact"),
            },
            {
              id: EventId.make("compact-failed"),
              type: "turn-item.updated",
              threadId,
              occurredAt: at(7),
              payload: {
                ...itemBase(threadId, 7, limited.id),
                type: "compaction",
                driver,
                status: "failed",
              },
            },
            {
              id: EventId.make("compact-usage-limit"),
              type: "turn-item.updated",
              threadId,
              occurredAt: at(8),
              payload: {
                ...itemBase(threadId, 8, limited.id),
                type: "error",
                status: "failed",
                failure: {
                  class: "usage_limit",
                  code: "compaction_failed",
                  message: "Context compaction failed.",
                  retryable: null,
                },
              },
            },
          ],
        });
        yield* terminal(limited);
        yield* assertPrimary(threadId);

        const task = (second: number, status: "running" | "completed", delivery?: "delivered") =>
          write({
            id: EventId.make(`crew:${second}`),
            type: "subagent.updated",
            threadId,
            occurredAt: at(second),
            payload: {
              id: NodeId.make("rollover-task"),
              threadId,
              runId: limited.id,
              parentNodeId: NodeId.make("rollover-root"),
              origin: "app_owned",
              createdBy: "agent",
              driver,
              providerInstanceId,
              providerThreadId: null,
              childThreadId: null,
              nativeTaskRef: null,
              prompt: "Check the migration",
              title: null,
              model: null,
              status,
              result: null,
              startedAt: at(9),
              completedAt: status === "completed" ? at(11) : null,
              updatedAt: at(second),
              ...(delivery === undefined
                ? {}
                : { completionDelivery: { state: delivery, observedByRunId: null } }),
            },
          });
        yield* task(9, "running");
        yield* terminal(makeRun(threadId, 10, "completed"));
        yield* assertPrimary(threadId);
        yield* task(11, "completed");
        yield* terminal(makeRun(threadId, 12, "completed"));
        yield* assertPrimary(threadId);
        yield* task(13, "completed", "delivered");
        yield* terminal(makeRun(threadId, 14, "completed"));

        const rolled = yield* store.requireCaptain(captain.id);
        assert.notEqual(rolled.primaryThreadId, threadId);
        assert.deepEqual(rolled.earlierThreadEndReasons, ["threshold"]);
        assert.deepEqual(fixture.sends, []);
      }).pipe(Effect.provide(CaptainRolloverWorker.layer.pipe(Layer.provideMerge(fixture.base))));
    }),
);

it.effect("commits the failed prompt and reordered follow-ups before retrying the resend", () =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture();
    yield* Effect.gen(function* () {
      const captains = yield* CaptainService.CaptainService;
      const store = yield* CaptainStore.CaptainStore;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const commands = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const sink = yield* EventSink.EventSinkV2;
      const captain = yield* captains.create(newCaptain("rollover-queue"));
      const threadId = captain.primaryThreadId;
      const failed = makeRun(threadId, 1, "failed");
      const queued = [
        { ...makeRun(threadId, 2, "queued"), queuePosition: 2 },
        { ...makeRun(threadId, 3, "queued"), queuePosition: 1 },
      ];
      for (const [index, run] of [failed, ...queued].entries()) {
        yield* sink.write({
          events: [
            {
              id: EventId.make(`prompt:${index}`),
              type: "message.updated",
              threadId,
              occurredAt: at(index),
              payload: message(run, `Prompt ${index}`),
            },
            {
              id: EventId.make(`run:${index}`),
              type: "run.updated",
              threadId,
              occurredAt: at(index),
              payload: run,
            },
          ],
        });
      }
      yield* sink.write({
        events: [
          {
            id: EventId.make("overflow"),
            type: "turn-item.updated",
            threadId,
            occurredAt: at(4),
            payload: {
              ...itemBase(threadId, 4, failed.id),
              type: "error",
              status: "failed",
              failure: {
                class: "provider_error",
                code: "blocking_limit",
                message: "Blocked",
                retryable: null,
              },
            },
          },
        ],
      });
      fixture.failNext();
      const reaction = yield* commands
        .handleCaptainTurnEnd(threadId, failed)
        .pipe(Effect.forkScoped);
      yield* Deferred.await(fixture.firstSend);
      const reset = yield* store.requireCaptain(captain.id);
      assert.deepEqual(reset.earlierThreadEndReasons, ["context_overflow"]);
      const pending = yield* store.pendingRolloverResends(reset.primaryThreadId);
      assert.deepEqual(
        pending.map((entry) => entry.text),
        ["Prompt 0", "Prompt 2", "Prompt 1"],
      );
      assert.equal(pending[0]?.commandId, `captain-rollover:${failed.id}`);
      const old = yield* projections.getThreadRecords(threadId, ["runs"]);
      assert.deepEqual(
        old.runs.map((run) => run.status),
        ["failed", "cancelled", "cancelled"],
      );

      yield* TestClock.adjust("100 millis");
      yield* Fiber.join(reaction);
      assert.deepEqual(
        fixture.sends.map((entry) => entry.commandId),
        pending.map((entry) => entry.commandId),
      );
      assert.deepEqual(yield* store.pendingRolloverResends(), []);
    }).pipe(Effect.provide(CaptainRolloverWorker.layer.pipe(Layer.provideMerge(fixture.base))));
  }),
);

it.effect("drains a durable resend when the rollover worker starts", () =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture();
    yield* Effect.gen(function* () {
      const captains = yield* CaptainService.CaptainService;
      const store = yield* CaptainStore.CaptainStore;
      const captain = yield* captains.create(newCaptain("rollover-startup"));
      const run = makeRun(captain.primaryThreadId, 1, "failed");
      const reset = yield* captains.resetConversation(
        {
          captainId: captain.id,
          expectedThreadId: captain.primaryThreadId,
          reason: "context_overflow",
        },
        { run, failedMessage: message(run, "Recover this prompt") },
      );
      const [pending] = yield* store.pendingRolloverResends(reset.primaryThreadId);
      assert.equal(pending?.text, "Recover this prompt");
      assert.deepEqual(fixture.sends, []);

      const recovered = yield* Deferred.await(fixture.nextSent).pipe(
        Effect.provide(CaptainRolloverWorker.layer),
      );
      assert.deepEqual(recovered, pending);
    }).pipe(Effect.provide(fixture.base));
  }),
);
