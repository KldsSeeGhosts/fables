import {
  CommandId,
  MessageId,
  type Captain,
  type CaptainConversationEndReason,
  type CaptainId,
  type CaptainResetInput,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";

import type { ThreadManagementSendInput } from "../orchestration-v2/ThreadManagementService.ts";

const CONTEXT_USAGE_ROLLOVER_RATIO = 0.85;
const ROLLOVER_RESEND_PREFIX = "captain-rollover:";

// These providers compact in the provider runtime without a user-visible threshold decision.
// Claude is intentionally absent: its usage row carries autoCompactThreshold only when enabled.
const PROVIDER_NATIVE_AUTOMATIC_COMPACTION_DRIVERS = new Set([
  "codex",
  "opencode",
  "cursor",
  "pi",
  "muse",
  "kiro",
]);

export interface CaptainRolloverThreadRecords {
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly providerTurns: OrchestrationV2ThreadProjection["providerTurns"];
  readonly providerThreads: OrchestrationV2ThreadProjection["providerThreads"];
  readonly subagents: OrchestrationV2ThreadProjection["subagents"];
  readonly latestCompletedCompactionAt?: string | undefined;
}

export type CaptainRolloverSendInput = ThreadManagementSendInput;

export type RolloverRun = Pick<
  OrchestrationV2Run,
  | "id"
  | "status"
  | "providerThreadId"
  | "userMessageId"
  | "modelSelection"
  | "outputSchema"
  | "freshContext"
>;

export interface CaptainImmediateRollover {
  readonly run: RolloverRun;
  readonly failedMessage?: OrchestrationV2ConversationMessage;
}

export interface CaptainRolloverDependencies {
  readonly findCaptainPrimary: (threadId: ThreadId) => Effect.Effect<Captain | undefined, Error>;
  readonly getThreadRecords: (
    threadId: ThreadId,
    run: RolloverRun,
  ) => Effect.Effect<CaptainRolloverThreadRecords, Error>;
  readonly resetConversation: (
    input: CaptainResetInput,
    immediate?: CaptainImmediateRollover,
  ) => Effect.Effect<Captain, Error>;
}

export type CaptainRolloverResult =
  | { readonly _tag: "not-captain-primary" }
  | { readonly _tag: "no-trigger" }
  | { readonly _tag: "deferred-for-crew" }
  | {
      readonly _tag: "rolled-over";
      readonly captainId: CaptainId;
      readonly primaryThreadId: ThreadId;
      readonly reason: CaptainConversationEndReason;
      readonly resendPending: boolean;
    };

const CONTEXT_OVERFLOW_CODES = new Set([
  "contextoverflowerror",
  "contextoverflow",
  "contextwindowexceeded",
  "contextlengthexceeded",
  "context_length_exceeded",
  "context_window_exceeded",
  "prompt_too_long",
  "rapid_refill_breaker",
  "blocking_limit",
]);
const CONTEXT_OVERFLOW_MESSAGE =
  /\b(?:maximum context (?:length|window|size)|context (?:window|length) (?:limit )?(?:exceed(?:ed|s)?|full|overflow)|(?:exceeds?|exceeded) (?:the )?(?:(?:model(?:'s)?|maximum) )?context (?:window|length)|prompt (?:is )?too long|input token count[^.\n]*exceeds the maximum number of tokens|context refilled too quickly after compaction)\b/i;
const COMPACTION_FAILURE_MESSAGE =
  /\b(?:(?:context )?compact(?:ion)? (?:has )?failed|failed to compact (?:the )?(?:context|conversation))\b/i;

const failureReason = (failure: OrchestrationV2ProviderFailure) => {
  if (failure.class !== "provider_error") return null;
  const code = failure.code?.toLowerCase() ?? "";
  if (code === "compaction_failed" || COMPACTION_FAILURE_MESSAGE.test(failure.message)) {
    return "compaction_failed" as const;
  }
  if (CONTEXT_OVERFLOW_CODES.has(code) || CONTEXT_OVERFLOW_MESSAGE.test(failure.message)) {
    return "context_overflow" as const;
  }
  return null;
};

const immediateTrigger = (
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  runId: OrchestrationV2Run["id"],
) => {
  const failures = items.filter((item) => item.runId === runId && item.status === "failed");
  const error = failures.findLast((item) => item.type === "error");
  if (error !== undefined && error.failure.class !== "provider_error") return null;
  if (failures.some((item) => item.type === "compaction")) return "compaction_failed";
  return error === undefined ? null : failureReason(error.failure);
};

const reachedThreshold = (records: CaptainRolloverThreadRecords, run: RolloverRun) => {
  const providerThread = records.providerThreads.find(
    (thread) => thread.id === run.providerThreadId,
  );
  const live = records.providerTurns.find(
    (turn) => turn.providerThreadId === run.providerThreadId,
  )?.tokenUsage;
  const stored = providerThread?.contextUsage;
  const usage = live ?? stored;
  const maxTokens = usage?.maxTokens;
  if (
    providerThread === undefined ||
    usage == null ||
    maxTokens === null ||
    maxTokens === undefined ||
    maxTokens <= 0
  )
    return false;
  if (
    usage.autoCompactThreshold !== undefined ||
    PROVIDER_NATIVE_AUTOMATIC_COMPACTION_DRIVERS.has(providerThread.driver)
  )
    return false;
  const usageTime = live?.updatedAt ?? DateTime.formatIso(providerThread.updatedAt);
  const resetUsage =
    records.latestCompletedCompactionAt !== undefined &&
    Date.parse(records.latestCompletedCompactionAt) >= Date.parse(usageTime);
  return !resetUsage && usage.usedTokens / maxTokens >= CONTEXT_USAGE_ROLLOVER_RATIO;
};

export const hasUnsettledCaptainCrew = (unsettled: CaptainRolloverThreadRecords["subagents"]) =>
  unsettled.some((subagent) => subagent.origin === "app_owned");

export const isRolloverCompactionMessage = (message: OrchestrationV2ConversationMessage) =>
  message.idleCompaction !== undefined || /^\/compact(?:\s|$)/i.test(message.text.trim());

export const rolloverSendInput = (
  threadId: ThreadId,
  projectId: ThreadManagementSendInput["projectId"],
  message: OrchestrationV2ConversationMessage,
  run: RolloverRun,
  replay: boolean,
) =>
  ({
    projectId,
    commandId: CommandId.make(
      `${replay ? ROLLOVER_RESEND_PREFIX : "captain-rollover-queue:"}${run.id}`,
    ),
    threadId,
    messageId: MessageId.make(
      `${replay ? ROLLOVER_RESEND_PREFIX : "captain-rollover-queue:"}${run.id}`,
    ),
    text: message.text,
    attachments: message.attachments,
    mode: "queue" as const,
    ...(message.context === undefined ? {} : { context: message.context }),
    ...(replay || !message.followsThreadSelection ? { modelSelection: run.modelSelection } : {}),
    ...(run.freshContext === undefined ? {} : { freshContext: run.freshContext }),
    createdBy: message.createdBy,
    creationSource: message.creationSource,
    ...(run.outputSchema === undefined ? {} : { outputSchema: run.outputSchema }),
    ...(message.scheduledTaskId === undefined ? {} : { scheduledTaskId: message.scheduledTaskId }),
    ...(message.senderThreadId === undefined ? {} : { senderThreadId: message.senderThreadId }),
    ...(message.linkedSender === undefined ? {} : { linkedSender: message.linkedSender }),
  }) satisfies CaptainRolloverSendInput;

export const handleCaptainTurnEnd = Effect.fn("CaptainRollover.handleTurnEnd")(function* (
  dependencies: CaptainRolloverDependencies,
  input: { readonly threadId: ThreadId; readonly run: RolloverRun },
): Effect.fn.Return<CaptainRolloverResult, Error> {
  const { threadId, run } = input;
  if (run.status !== "failed" && run.status !== "completed") return { _tag: "no-trigger" };
  if (run.userMessageId.startsWith(ROLLOVER_RESEND_PREFIX)) return { _tag: "no-trigger" };

  const captain = yield* dependencies.findCaptainPrimary(threadId);
  if (captain?.primaryThreadId !== threadId) return { _tag: "not-captain-primary" };
  const records = yield* dependencies.getThreadRecords(threadId, run);
  const immediate = run.status === "failed" ? immediateTrigger(records.turnItems, run.id) : null;
  let reason: CaptainConversationEndReason;
  if (immediate !== null) {
    reason = immediate;
  } else {
    if (run.status !== "completed" || !reachedThreshold(records, run))
      return { _tag: "no-trigger" };
    if (hasUnsettledCaptainCrew(records.subagents)) return { _tag: "deferred-for-crew" };
    reason = "threshold";
  }

  const failedMessage =
    immediate === null
      ? undefined
      : records.messages.find(
          (message) =>
            message.id === run.userMessageId &&
            message.runId === run.id &&
            message.role === "user" &&
            message.notification === undefined &&
            message.delegatedCompletion === undefined &&
            !isRolloverCompactionMessage(message),
        );
  const reset = yield* dependencies.resetConversation(
    { captainId: captain.id, expectedThreadId: threadId, reason },
    immediate === null
      ? undefined
      : { run, ...(failedMessage === undefined ? {} : { failedMessage }) },
  );
  return {
    _tag: "rolled-over",
    captainId: reset.id,
    primaryThreadId: reset.primaryThreadId,
    reason,
    resendPending: failedMessage !== undefined,
  };
});
