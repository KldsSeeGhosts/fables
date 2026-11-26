import { assert, it } from "@effect/vitest";
import {
  CaptainId,
  MessageId,
  ProviderThreadId,
  ProviderInstanceId,
  ProjectId,
  RunId,
  ThreadId,
  type Captain,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  handleCaptainTurnEnd,
  rolloverSendInput,
  type CaptainImmediateRollover,
  type CaptainRolloverSendInput,
  type CaptainRolloverThreadRecords,
} from "./captainRollover.ts";
import type { CaptainResetInput } from "@t3tools/contracts";

const projectId = ProjectId.make("project");
const captainId = CaptainId.make("maria");
const firstThreadId = ThreadId.make("captain:maria:0");
const secondThreadId = ThreadId.make("captain:maria:1");
const runId = RunId.make("run:overflow");
const providerThreadId = ProviderThreadId.make("provider-thread");
const run = {
  id: runId,
  status: "failed",
  userMessageId: MessageId.make("message:user"),
  providerThreadId,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
} as const;

const captainAt = (threadId: ThreadId, earlierThreadIds: ReadonlyArray<ThreadId> = []) =>
  ({
    id: captainId,
    primaryThreadId: threadId,
    earlierThreadIds,
    earlierThreadEndReasons: [],
  }) as unknown as Captain;

const userMessage = (overrides?: Partial<OrchestrationV2ConversationMessage>) =>
  ({
    id: MessageId.make("message:user"),
    threadId: firstThreadId,
    runId,
    role: "user",
    text: "Continue the migration.",
    attachments: [],
    createdBy: "user",
    creationSource: "web",
    ...overrides,
  }) as OrchestrationV2ConversationMessage;

const errorItem = (overrides?: Partial<Extract<OrchestrationV2TurnItem, { type: "error" }>>) =>
  ({
    type: "error",
    ordinal: 10,
    runId,
    status: "failed",
    failure: {
      class: "provider_error",
      code: "ContextOverflowError",
      message: "This model's maximum context length is 100000 tokens.",
      retryable: null,
    },
    ...overrides,
  }) as OrchestrationV2TurnItem;

const compactionItem = (
  overrides?: Partial<Extract<OrchestrationV2TurnItem, { type: "compaction" }>>,
) =>
  ({
    type: "compaction",
    ordinal: 11,
    runId,
    status: "failed",
    title: "Context compaction failed",
    ...overrides,
  }) as OrchestrationV2TurnItem;

const records = (overrides?: Partial<CaptainRolloverThreadRecords>): CaptainRolloverThreadRecords =>
  ({
    messages: [userMessage()],
    turnItems: [errorItem()],
    providerThreads: [],
    providerTurns: [],
    subagents: [],
    ...overrides,
  }) as CaptainRolloverThreadRecords;

const harness = (initialRecords: CaptainRolloverThreadRecords) => {
  let threadRecords = initialRecords;
  let captain = captainAt(firstThreadId);
  const resets: CaptainResetInput[] = [];
  const sends: CaptainRolloverSendInput[] = [];
  const dependencies = {
    findCaptainPrimary: (threadId: ThreadId) =>
      Effect.succeed(
        threadId === captain.primaryThreadId || captain.earlierThreadIds.includes(threadId)
          ? captain
          : undefined,
      ),
    getThreadRecords: () => Effect.sync(() => threadRecords),
    resetConversation: (input: CaptainResetInput, immediate?: CaptainImmediateRollover) =>
      Effect.sync(() => {
        resets.push(input);
        captain = {
          ...captain,
          primaryThreadId: secondThreadId,
          earlierThreadIds: [captain.primaryThreadId, ...captain.earlierThreadIds],
        };
        if (immediate?.failedMessage) {
          sends.push(
            rolloverSendInput(
              secondThreadId,
              projectId,
              immediate.failedMessage,
              immediate.run,
              true,
            ),
          );
        }
        return captain;
      }),
  };
  return {
    dependencies,
    resets,
    sends,
    setRecords: (next: CaptainRolloverThreadRecords) => {
      threadRecords = next;
    },
  };
};

it.effect("rolls an overflow failure over once and resends the failed message once", () =>
  Effect.gen(function* () {
    const h = harness(records());
    const first = yield* handleCaptainTurnEnd(h.dependencies, { threadId: firstThreadId, run });
    assert.equal(first._tag, "rolled-over");
    if (first._tag !== "rolled-over") return;
    assert.equal(first.reason, "context_overflow");
    assert.isTrue(first.resendPending);
    assert.deepStrictEqual(
      h.resets.map((reset) => reset.reason),
      ["context_overflow"],
    );
    assert.lengthOf(h.sends, 1);
    assert.equal(h.sends[0]?.threadId, secondThreadId);
    assert.equal(h.sends[0]?.text, "Continue the migration.");
    assert.equal(h.sends[0]?.messageId, "captain-rollover:run:overflow");

    const second = yield* handleCaptainTurnEnd(h.dependencies, { threadId: firstThreadId, run });
    assert.equal(second._tag, "not-captain-primary");
    assert.lengthOf(h.resets, 1);
    assert.lengthOf(h.sends, 1);
  }),
);

it.effect("recognizes structured overflow codes and failed compaction errors", () =>
  Effect.gen(function* () {
    for (const [code, message, reason] of [
      ["contextWindowExceeded", "Request rejected", "context_overflow"],
      ["blocking_limit", "Request rejected", "context_overflow"],
      ["prompt_too_long", "Request rejected", "context_overflow"],
      ["compaction_failed", "Request rejected", "compaction_failed"],
      [null, "The prompt is too long", "context_overflow"],
      [
        null,
        "The input token count (100001) exceeds the maximum number of tokens allowed.",
        "context_overflow",
      ],
      [null, "Pi compact failed.", "compaction_failed"],
    ] as const) {
      const h = harness(
        records({
          turnItems: [
            errorItem({ failure: { class: "provider_error", code, message, retryable: null } }),
          ],
        }),
      );
      const result = yield* handleCaptainTurnEnd(h.dependencies, { threadId: firstThreadId, run });
      assert.equal(result._tag, "rolled-over");
      assert.equal(h.resets[0]?.reason, reason);
      assert.lengthOf(h.sends, 1);
    }
  }),
);

it.effect("keeps a completed turn with an earlier provider error in the same conversation", () =>
  Effect.gen(function* () {
    const h = harness(records());
    const result = yield* handleCaptainTurnEnd(h.dependencies, {
      threadId: firstThreadId,
      run: { ...run, status: "completed" },
    });
    assert.equal(result._tag, "no-trigger");
    assert.lengthOf(h.resets, 0);
  }),
);

it.effect("rolls a provider compaction failure over without replaying the compaction command", () =>
  Effect.gen(function* () {
    const h = harness(
      records({
        messages: [userMessage({ text: "/compact" })],
        turnItems: [compactionItem()],
      }),
    );
    const result = yield* handleCaptainTurnEnd(h.dependencies, { threadId: firstThreadId, run });
    assert.equal(result._tag, "rolled-over");
    if (result._tag !== "rolled-over") return;
    assert.equal(result.reason, "compaction_failed");
    assert.isFalse(result.resendPending);
    assert.lengthOf(h.resets, 1);
    assert.lengthOf(h.sends, 0);
  }),
);

it.effect("waits for active crew tasks before a threshold rollover", () =>
  Effect.gen(function* () {
    const providerThreads = [
      {
        id: providerThreadId,
        appThreadId: firstThreadId,
        driver: "claude",
        contextUsage: null,
      },
    ] as never;
    const providerTurns = [
      {
        providerThreadId,
        tokenUsage: { usedTokens: 85_000, maxTokens: 100_000, updatedAt: "2026-01-01T00:00:00Z" },
      },
    ] as never;
    const subagent = { origin: "app_owned", status: "running" } as never;
    const h = harness(
      records({ turnItems: [], providerThreads, providerTurns, subagents: [subagent] }),
    );
    const deferred = yield* handleCaptainTurnEnd(h.dependencies, {
      threadId: firstThreadId,
      run: { ...run, status: "completed" },
    });
    assert.equal(deferred._tag, "deferred-for-crew");
    assert.lengthOf(h.resets, 0);

    const finished = records({
      turnItems: [],
      providerThreads,
      providerTurns,
      subagents: [{ origin: "app_owned", status: "completed" } as never],
    });
    h.setRecords(finished);
    const undelivered = yield* handleCaptainTurnEnd(h.dependencies, {
      threadId: firstThreadId,
      run: { ...run, status: "completed" },
    });
    assert.equal(undelivered._tag, "deferred-for-crew");
    h.setRecords({ ...finished, subagents: [] });
    const result = yield* handleCaptainTurnEnd(h.dependencies, {
      threadId: firstThreadId,
      run: { ...run, id: RunId.make("run:crew-finished"), status: "completed" },
    });
    assert.equal(result._tag, "rolled-over");
    if (result._tag !== "rolled-over") return;
    assert.equal(result.reason, "threshold");
    assert.lengthOf(h.resets, 1);
    assert.lengthOf(h.sends, 0);
  }),
);

it.effect.each(["codex", "kiro", "muse"])("lets %s compact automatically", (driver) =>
  Effect.gen(function* () {
    const providerThreads = [
      {
        id: providerThreadId,
        appThreadId: firstThreadId,
        driver,
        contextUsage: { usedTokens: 99_000, maxTokens: 100_000 },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ] as never;
    const h = harness(records({ turnItems: [], providerThreads }));
    const result = yield* handleCaptainTurnEnd(h.dependencies, {
      threadId: firstThreadId,
      run: { ...run, status: "completed" },
    });
    assert.equal(result._tag, "no-trigger");
    assert.lengthOf(h.resets, 0);
  }),
);

it.effect("never rolls a non-Captain thread over", () =>
  Effect.gen(function* () {
    const h = harness(records());
    const result = yield* handleCaptainTurnEnd(h.dependencies, {
      threadId: ThreadId.make("ordinary-thread"),
      run,
    });
    assert.equal(result._tag, "not-captain-primary");
    assert.lengthOf(h.resets, 0);
    assert.lengthOf(h.sends, 0);
  }),
);

it.effect("does not roll over again when the replayed message overflows", () =>
  Effect.gen(function* () {
    const h = harness(
      records({
        messages: [userMessage({ id: MessageId.make("captain-rollover:run:first") })],
      }),
    );
    const result = yield* handleCaptainTurnEnd(h.dependencies, {
      threadId: firstThreadId,
      run: { ...run, userMessageId: MessageId.make("captain-rollover:run:first") },
    });
    assert.equal(result._tag, "no-trigger");
    assert.lengthOf(h.resets, 0);
    assert.lengthOf(h.sends, 0);
  }),
);

it.effect("ignores a compaction failure from an earlier run", () =>
  Effect.gen(function* () {
    const h = harness(records({ turnItems: [compactionItem()] }));
    const result = yield* handleCaptainTurnEnd(h.dependencies, {
      threadId: firstThreadId,
      run: { ...run, id: RunId.make("run:later-clean-turn") },
    });
    assert.equal(result._tag, "no-trigger");
    assert.lengthOf(h.resets, 0);
  }),
);

it.effect(
  "ignores an unrelated failed turn above the threshold and a Claude usage-limited compact",
  () =>
    Effect.gen(function* () {
      const providerThreads = [
        {
          id: providerThreadId,
          driver: "claude",
          contextUsage: null,
        },
      ] as never;
      const providerTurns = [
        {
          providerThreadId,
          tokenUsage: { usedTokens: 95_000, maxTokens: 100_000, updatedAt: "2026-01-01T00:00:00Z" },
        },
      ] as never;
      for (const [text, turnItems] of [
        [
          "Continue the migration.",
          [
            errorItem({
              failure: {
                class: "provider_error",
                code: null,
                message: "Too many input tokens per minute",
                retryable: true,
              },
            }),
          ],
        ],
        [
          "/compact",
          [
            compactionItem(),
            errorItem({
              failure: {
                class: "usage_limit",
                code: "compaction_failed",
                message: "Context compaction failed",
                retryable: null,
              },
            }),
          ],
        ],
      ] as const) {
        const h = harness(
          records({ providerThreads, providerTurns, messages: [userMessage({ text })], turnItems }),
        );
        assert.deepStrictEqual(
          yield* handleCaptainTurnEnd(h.dependencies, { threadId: firstThreadId, run }),
          { _tag: "no-trigger" },
        );
        assert.lengthOf(h.resets, 0);
      }
    }),
);
