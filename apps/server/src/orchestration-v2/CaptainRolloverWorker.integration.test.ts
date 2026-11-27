import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  CaptainId,
  EnvironmentId,
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
import type * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as CaptainService from "../captains/CaptainService.ts";
import * as CaptainStore from "../captains/CaptainStore.ts";
import { makeReadCaptainTurnContext } from "../captains/captainTurnContext.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as OrchestratorMcp from "../mcp/OrchestratorMcpService.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import { ClaudeProviderCapabilitiesV2 } from "./Adapters/ClaudeAdapterV2.ts";
import * as CaptainRolloverWorker from "./CaptainRolloverWorker.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import { layerNoTaskFolders } from "./ProviderTurnStartService.testkit.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const projectId = ProjectId.make("rollover-project");
const driver = ProviderDriverKind.make("claude");
const providerInstanceId = ProviderInstanceId.make("claudeAgent");
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

const makeFixture = Effect.fn("CaptainRolloverWorkerTest.makeFixture")(function* (
  observeRunUpdates = false,
) {
  const firstSend = yield* Deferred.make<void>();
  const nextSent = yield* Deferred.make<ThreadManagement.ThreadManagementSendInput>();
  const sends: ThreadManagement.ThreadManagementSendInput[] = [];
  let sendsToFail = 0;
  let missingText: string | undefined;
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
              if (sendsToFail > 0) {
                sendsToFail--;
                yield* Deferred.succeed(firstSend, undefined);
                return yield* new ThreadManagement.ThreadManagementWorktreeRestoreError({
                  threadId: input.threadId,
                  cause: "temporary workspace error",
                });
              }
              if (input.text === missingText) {
                return yield* new ThreadManagement.ThreadManagementThreadNotFoundError({
                  projectId: input.projectId,
                  threadId: input.threadId,
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
  const registry = ProviderAdapterRegistry.layerFromAdaptersEffect(
    ProviderAdapter.ProviderAdapterV2.pipe(
      Effect.map((adapter) => [adapter]),
      Effect.provide(
        Layer.mock(ProviderAdapter.ProviderAdapterV2)({
          instanceId: providerInstanceId,
          driver,
          getCapabilities: () => Effect.succeed(ClaudeProviderCapabilitiesV2),
        }),
      ),
    ),
  );
  const replay = ProviderReplayHarness.layerWithRegistry(
    { name: "captain-rollover-steering" },
    registry,
    { runEffectWorker: false, databaseLayer: Sqlite.layerMemory },
  );
  const persistence: Layer.Layer<
    | EventSink.EventSinkV2
    | ProjectionStore.ProjectionStoreV2
    | ThreadCommandExecutor.ThreadCommandExecutor,
    Error,
    SqlClient.SqlClient
  > = observeRunUpdates
    ? Layer.merge(ProjectionStore.layer, replay)
    : Layer.merge(layerPersistence, ThreadCommandExecutor.layer);
  const base = CaptainService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        CaptainStore.layer,
        testServices,
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/unused",
          ensureScratchProject: Effect.succeed({ projectId }),
        }),
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(ScheduledTaskService.ScheduledTaskService)({
          rebindThreadTasks: () => Effect.void,
          invalidateList: Effect.void,
        }),
      ),
    ),
    Layer.provideMerge(persistence),
    Layer.provideMerge(Sqlite.layerMemory),
  );
  return {
    base,
    replay,
    sends,
    firstSend,
    nextSent,
    failNext: (count = 1) => {
      sendsToFail = count;
    },
    rejectMissing: (text: string) => {
      missingText = text;
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

const providerThreadEvent = (threadId: ThreadId) =>
  ({
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
  }) satisfies OrchestrationV2DomainEvent;

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
        yield* write(providerThreadEvent(threadId));
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
        makeRun(threadId, 4, "queued"),
        makeRun(threadId, 5, "queued"),
      ];
      const prompts = [
        message(failed, "Prompt 0"),
        message(queued[0]!, "Prompt 1"),
        message(queued[1]!, "Prompt 2"),
        message(queued[2]!, "/compact preserve the migration details"),
        {
          ...message(queued[3]!, "Compact the current conversation"),
          idleCompaction: "onReturn" as const,
        },
      ];
      for (const [index, run] of [failed, ...queued].entries()) {
        yield* sink.write({
          events: [
            {
              id: EventId.make(`prompt:${index}`),
              type: "message.updated",
              threadId,
              occurredAt: at(index),
              payload: prompts[index]!,
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
      fixture.rejectMissing("Prompt 2");
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
        ["failed", "cancelled", "cancelled", "cancelled", "cancelled"],
      );

      yield* TestClock.adjust("100 millis");
      yield* Fiber.join(reaction);
      assert.deepEqual(
        fixture.sends.map((entry) => entry.commandId),
        [pending[0]?.commandId, pending[2]?.commandId],
      );
      assert.deepEqual(yield* store.pendingRolloverResends(undefined), []);
    }).pipe(Effect.provide(CaptainRolloverWorker.layer.pipe(Layer.provideMerge(fixture.base))));
  }),
);

it.effect("recovers a durable resend after the rollover worker's immediate retries fail", () =>
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

      fixture.failNext(4);
      const recovered = yield* Effect.gen(function* () {
        yield* Deferred.await(fixture.firstSend);
        yield* TestClock.adjust("700 millis");
        assert.deepEqual(fixture.sends, []);
        assert.deepEqual(yield* store.pendingRolloverResends(reset.primaryThreadId), [pending]);
        yield* TestClock.adjust("5 seconds");
        return yield* Deferred.await(fixture.nextSent);
      }).pipe(Effect.provide(CaptainRolloverWorker.layer));
      assert.deepEqual(recovered, pending);
    }).pipe(Effect.provide(fixture.base));
  }),
);

it.effect("removes pending resends for all conversations when deleting a Captain", () =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture();
    yield* Effect.gen(function* () {
      const captains = yield* CaptainService.CaptainService;
      const store = yield* CaptainStore.CaptainStore;
      const persistResend = (
        captain: { id: CaptainId; primaryThreadId: ThreadId },
        text: string,
      ) => {
        const run = makeRun(captain.primaryThreadId, 1, "failed");
        return captains.resetConversation(
          {
            captainId: captain.id,
            expectedThreadId: captain.primaryThreadId,
            reason: "context_overflow",
          },
          { run, failedMessage: message(run, text) },
        );
      };
      const removed = yield* captains.create(newCaptain("remove-resends"));
      const first = yield* persistResend(removed, "From the earlier conversation");
      yield* persistResend(first, "From the current conversation");
      const other = yield* captains.create(newCaptain("keep-resends"));
      yield* persistResend(other, "From the other Captain");
      assert.lengthOf(yield* store.pendingRolloverResends(undefined), 3);

      yield* captains.delete({ captainId: removed.id });
      const pending = yield* store.pendingRolloverResends(undefined);
      assert.deepEqual(
        pending.map((row) => row.text),
        ["From the other Captain"],
      );
    }).pipe(Effect.provide(fixture.base));
  }),
);

it.effect("moves an unread steer with queued follow-ups when the active turn overflows", () =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture(true);
    yield* Effect.gen(function* () {
      const captains = yield* CaptainService.CaptainService;
      const store = yield* CaptainStore.CaptainStore;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const sink = yield* EventSink.EventSinkV2;
      const captain = yield* captains.create(newCaptain("rollover-steer"));
      const threadId = captain.primaryThreadId;
      const failed = makeRun(threadId, 1, "failed");
      const queued = makeRun(threadId, 2, "queued");
      const steer = { ...message(failed, "Unread steer"), id: MessageId.make("unread-steer") };
      const runEvent = (run: OrchestrationV2Run, second: number) =>
        ({
          id: EventId.make(`run:${run.id}:${second}`),
          type: "run.updated",
          threadId,
          occurredAt: at(second),
          payload: run,
        }) satisfies OrchestrationV2DomainEvent;
      const messageEvent = (prompt: OrchestrationV2ConversationMessage, second: number) =>
        ({
          id: EventId.make(`message:${prompt.id}`),
          type: "message.updated",
          threadId,
          occurredAt: at(second),
          payload: prompt,
        }) satisfies OrchestrationV2DomainEvent;
      yield* sink.write({
        events: [
          providerThreadEvent(threadId),
          runEvent({ ...failed, status: "running", completedAt: null }, 1),
          messageEvent(message(failed, "Overflowed prompt"), 1),
          runEvent(queued, 2),
          messageEvent(message(queued, "Queued follow-up"), 2),
          messageEvent(steer, 3),
          {
            id: EventId.make("steer-pending"),
            type: "turn-item.updated",
            threadId,
            occurredAt: at(3),
            payload: {
              ...itemBase(threadId, 3, failed.id),
              type: "user_message",
              status: "pending",
              messageId: steer.id,
              inputIntent: "steer",
              text: steer.text,
              attachments: [],
              createdBy: steer.createdBy,
              creationSource: steer.creationSource,
              startedAt: null,
              completedAt: null,
            },
          },
          {
            id: EventId.make("steer-overflow"),
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
      yield* sink.write({ events: [runEvent(failed, 4)] });
      yield* Deferred.await(fixture.firstSend);

      const reset = yield* store.requireCaptain(captain.id);
      const pending = yield* store.pendingRolloverResends(reset.primaryThreadId);
      assert.deepEqual(
        pending.map((entry) => entry.text),
        ["Overflowed prompt", "Queued follow-up", "Unread steer"],
      );
      const old = yield* projections.getThreadRecords(threadId, ["runs"]);
      assert.deepEqual(
        old.runs.map((run) => run.status),
        ["failed", "cancelled", "cancelled"],
      );
    }).pipe(Effect.provide(CaptainRolloverWorker.layer.pipe(Layer.provideMerge(fixture.base))));
  }),
);

it.effect(
  "routes to the current Duet after rollover and shows each result only on an accepted user turn",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture(true);
      const dependencies = Layer.mergeAll(
        fixture.base,
        ServerSettings.layerTest(),
        Layer.mock(ProviderRegistry.ProviderRegistry)({}),
        Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(RemoteDelegation.RemoteDelegation)({}),
        layerNoTaskFolders,
        NodeCrypto.layer,
      );
      const threads = ThreadManagement.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            fixture.replay,
            ServerSettings.layerTest(),
            CommandReceiptStore.layer,
          ).pipe(Layer.provide(Sqlite.layerMemory)),
        ),
      );
      const mcp = OrchestratorMcp.layer.pipe(
        Layer.provide(threads),
        Layer.provideMerge(dependencies),
      );
      yield* Effect.gen(function* () {
        const captains = yield* CaptainService.CaptainService;
        const store = yield* CaptainStore.CaptainStore;
        const service = yield* OrchestratorMcp.OrchestratorMcpService;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const sink = yield* EventSink.EventSinkV2;
        const source = yield* captains.create({
          ...newCaptain("chorus"),
          name: "Chorus",
          kind: "chorus",
          reportPolicy: "react",
        });
        const duet = yield* captains.create(newCaptain("routed-duet"));
        const destination = yield* captains.resetConversation({
          captainId: duet.id,
          expectedThreadId: duet.primaryThreadId,
        });
        assert.notEqual(destination.primaryThreadId, duet.primaryThreadId);

        const callerRun = makeRun(source.primaryThreadId, 1, "running");
        yield* sink.write({
          events: [
            {
              id: EventId.make("chorus:active-run"),
              type: "run.updated",
              threadId: source.primaryThreadId,
              occurredAt: callerRun.requestedAt,
              payload: callerRun,
            },
          ],
        });
        const scope: McpInvocationContext.McpThreadInvocationScope = {
          environmentId: EnvironmentId.make("local"),
          requestNamespace: "chorus-test",
          thread: {
            threadId: source.primaryThreadId,
            providerSessionId: "chorus-test",
            providerInstanceId,
          },
          client: undefined,
          issuedAt: 0,
          capabilities: new Set(["orchestration"]),
          captain: true,
          chorus: true,
        };
        const request = {
          duetId: duet.id,
          message: "Fix the checkout test",
          clientRequestId: "route",
        };
        const errorCode = (effect: ReturnType<typeof service.sendToDuet>) =>
          effect.pipe(
            Effect.flip,
            Effect.map((error) => error.code),
          );
        assert.equal(
          yield* errorCode(
            service.sendToDuet(
              {
                ...scope,
                thread: { ...scope.thread, threadId: destination.primaryThreadId },
              },
              request,
            ),
          ),
          "capability_denied",
        );
        assert.equal(
          yield* errorCode(
            service.sendToDuet(
              {
                ...scope,
                thread: { ...scope.thread, subagent: true },
              },
              request,
            ),
          ),
          "capability_denied",
        );
        assert.equal(
          yield* errorCode(service.sendToDuet({ ...scope, thread: undefined }, request)),
          "thread_credential_required",
        );
        assert.equal(
          yield* errorCode(
            service.sendToDuet(
              {
                ...scope,
                thread: { ...scope.thread, providerInstanceId: ProviderInstanceId.make("stale") },
              },
              request,
            ),
          ),
          "parent_not_active",
        );
        assert.equal(
          yield* errorCode(
            service.sendToDuet(scope, { ...request, duetId: CaptainId.make("missing") }),
          ),
          "invalid_request",
        );
        assert.equal(
          yield* errorCode(service.sendToDuet(scope, { ...request, duetId: source.id })),
          "invalid_request",
        );
        assert.equal(
          yield* errorCode(
            service.sendToDuet(scope, {
              ...request,
              environmentId: EnvironmentId.make("linked"),
            }),
          ),
          "invalid_request",
        );
        const archived = yield* captains.create(newCaptain("archived-duet"));
        yield* captains.archive({ captainId: archived.id });
        assert.equal(
          yield* errorCode(service.sendToDuet(scope, { ...request, duetId: archived.id })),
          "invalid_request",
        );
        assert.deepEqual(yield* store.listChorusRoutes(source.id), []);

        const sent = yield* service.sendToDuet(scope, request);
        assert.equal(sent.threadId, destination.primaryThreadId);
        const [route] = yield* store.listChorusRoutes(source.id);
        assert.include(route, {
          runId: sent.runId,
          messageId: sent.messageId,
          threadId: sent.threadId,
          result: null,
        });
        const received = yield* projections.getThreadRecords(sent.threadId, ["runs", "messages"]);
        const routedMessage = received.messages.find(({ id }) => id === sent.messageId)!;
        assert.equal(routedMessage.senderThreadId, source.primaryThreadId);
        assert.deepEqual(
          (yield* projections.getThreadRecords(duet.primaryThreadId, ["runs"])).runs,
          [],
        );

        const readContext = yield* makeReadCaptainTurnContext;
        const delivery = { providerThreadId: "chorus-test", usedTokens: null };
        const senderThread = yield* projections.getThread(source.primaryThreadId);
        const userTurn = { createdBy: "user" } as const;
        assert.include(
          (yield* readContext(received.thread, delivery, routedMessage)).text,
          "routed by Chorus",
        );
        assert.notInclude(
          (yield* readContext(received.thread, delivery, userTurn)).text,
          "routed by Chorus",
        );

        const completedRun = {
          ...received.runs.find(({ id }) => id === sent.runId)!,
          status: "completed" as const,
          completedAt: at(3),
        };
        const answer = "The checkout test now passes.\n\nImplementation details.";
        yield* sink.write({
          events: [
            {
              id: EventId.make("routed:assistant-answer"),
              type: "message.updated",
              threadId: sent.threadId,
              occurredAt: at(2),
              payload: {
                ...message(completedRun, answer),
                id: MessageId.make("routed:assistant-answer"),
                role: "assistant",
                createdBy: "agent",
                creationSource: "provider",
                createdAt: at(2),
              },
            },
            {
              id: EventId.make("routed:completed"),
              type: "run.updated",
              threadId: sent.threadId,
              occurredAt: at(3),
              payload: completedRun,
            },
          ],
        });
        assert.deepEqual(
          (yield* projections.getThreadRecords(source.primaryThreadId, ["runs"])).runs.map(
            ({ id }) => id,
          ),
          [callerRun.id],
        );
        const scheduled = yield* readContext(senderThread, delivery, { createdBy: "agent" });
        assert.notInclude(scheduled.text, "Routed since your last turn");
        yield* scheduled.delivered;

        assert.notInclude(
          (yield* readContext(senderThread, delivery, userTurn)).text,
          "Routed since your last turn",
        );
        yield* store.settleChorusRouteRun(sent.threadId, sent.runId);
        const nextTurn = yield* readContext(senderThread, delivery, userTurn);
        assert.include(nextTurn.text, "Routed since your last turn");
        assert.include(nextTurn.text, "The checkout test now passes.");
        assert.notInclude(nextTurn.text, "Implementation details.");
        assert.equal((yield* store.listChorusRoutes(source.id))[0]?.result, null);
        assert.include(
          (yield* readContext(senderThread, delivery, userTurn)).text,
          "The checkout test now passes.",
        );
        yield* nextTurn.delivered;

        assert.equal((yield* service.sendToDuet(scope, request)).runId, sent.runId);
        assert.deepEqual(yield* store.listChorusRoutes(source.id), []);
        assert.notInclude(
          (yield* readContext(senderThread, delivery, userTurn)).text,
          "Routed since your last turn",
        );

        const running = makeRun(sent.threadId, 10, "running");
        const updateRun = (run: OrchestrationV2Run) =>
          sink.write({
            events: [
              {
                id: EventId.make(`routed-rollover:${run.status}`),
                type: "run.updated",
                threadId: sent.threadId,
                occurredAt: at(10),
                payload: run,
              },
            ],
          });
        yield* updateRun(running);
        const queued = yield* service.sendToDuet(scope, {
          ...request,
          mode: "queue",
          clientRequestId: "pending-route",
        });
        assert.equal(queued.status, "queued");
        const settled = { ...running, status: "completed" as const, completedAt: at(11) };
        yield* updateRun(settled);
        const nextAttempt = yield* projections.getThreadRecords(sent.threadId, [
          "runs",
          "messages",
        ]);
        const failedRun = {
          ...nextAttempt.runs.find(({ id }) => id === queued.runId)!,
          status: "failed" as const,
          completedAt: at(12),
        };
        const failedMessage = nextAttempt.messages.find(({ id }) => id === queued.messageId)!;
        yield* updateRun(failedRun);
        const rolled = yield* captains.resetConversation(
          { captainId: destination.id, expectedThreadId: sent.threadId },
          { run: failedRun, failedMessage },
        );
        const [moved] = yield* store.listChorusRoutes(source.id);
        assert.equal(moved?.threadId, rolled.primaryThreadId);
        assert.equal(moved?.messageId, `captain-rollover:${queued.runId}`);
        assert.notInclude(
          (yield* readContext(senderThread, delivery, userTurn)).text,
          "Routed since your last turn",
        );
        const replayed = yield* service.sendToDuet(scope, {
          ...request,
          mode: "queue",
          clientRequestId: "pending-route",
        });
        assert.equal(replayed.messageId, queued.messageId);
        assert.equal(replayed.runId, queued.runId);
        assert.equal(replayed.threadId, queued.threadId);
        assert.deepEqual(yield* store.listChorusRoutes(source.id), [moved]);
      }).pipe(Effect.provide(mcp));
    }),
);
