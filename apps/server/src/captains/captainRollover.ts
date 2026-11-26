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

import type { ThreadManagementSendInput } from "../orchestration-v2/ThreadManagementService.ts";

const CONTEXT_USAGE_ROLLOVER_RATIO = 0.85;
const ROLLOVER_RESEND_PREFIX = "captain-rollover:";

// These providers compact in the provider runtime without a user-visible threshold decision.
// Claude is intentionally absent: its usage row carries autoCompactThreshold only when enabled.
const PROVIDER_NATIVE_AUTOMATIC_COMPACTION_DRIVERS = new Set(["codex", "opencode", "cursor", "pi"]);

export interface CaptainRolloverThreadRecords {
  readonly thread: Pick<OrchestrationV2ThreadProjection["thread"], "id" | "projectId">;
  readonly messages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly providerThreads: OrchestrationV2ThreadProjection["providerThreads"];
  readonly subagents: OrchestrationV2ThreadProjection["subagents"];
}

export type CaptainRolloverSendInput = ThreadManagementSendInput;

type RolloverRun = Pick<
  OrchestrationV2Run,
  "id" | "status" | "providerThreadId" | "userMessageId" | "modelSelection" | "outputSchema"
>;

export interface CaptainRolloverDependencies {
  readonly findCaptainPrimary: (threadId: ThreadId) => Effect.Effect<Captain | undefined, Error>;
  readonly getThreadRecords: (
    threadId: ThreadId,
    run: RolloverRun,
  ) => Effect.Effect<CaptainRolloverThreadRecords, Error>;
  readonly resetConversation: (input: CaptainResetInput) => Effect.Effect<Captain, Error>;
  readonly sendToThread: (input: CaptainRolloverSendInput) => Effect.Effect<unknown, Error>;
}

export type CaptainRolloverResult =
  | { readonly _tag: "not-captain-primary" }
  | { readonly _tag: "no-trigger" }
  | { readonly _tag: "deferred-for-crew" }
  | {
      readonly _tag: "rolled-over";
      readonly captainId: CaptainId;
      readonly reason: CaptainConversationEndReason;
      readonly resent: boolean;
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
]);
const CONTEXT_OVERFLOW_MESSAGE =
  /\b(?:maximum context (?:length|window|size)|context (?:window|length) (?:limit )?(?:exceed(?:ed|s)?|full|overflow)|(?:exceeds?|exceeded) (?:the )?(?:(?:model(?:'s)?|maximum) )?context (?:window|length)|prompt (?:is )?too long|too many (?:input )?tokens)\b/i;
const COMPACTION_FAILURE_MESSAGE =
  /\b(?:(?:context )?compaction (?:has )?failed|failed to compact (?:the )?(?:context|conversation))\b/i;

const failureReason = (failure: OrchestrationV2ProviderFailure) => {
  const code = failure.code?.toLowerCase() ?? "";
  if (code === "compaction_failed" || COMPACTION_FAILURE_MESSAGE.test(failure.message)) {
    return "compaction_failed" as const;
  }
  if (
    failure.class === "provider_error" &&
    (CONTEXT_OVERFLOW_CODES.has(code) || CONTEXT_OVERFLOW_MESSAGE.test(failure.message))
  ) {
    return "context_overflow" as const;
  }
  return null;
};

const immediateTrigger = (
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  runId: OrchestrationV2Run["id"],
) => {
  let reason: CaptainConversationEndReason | null = null;
  for (const item of items) {
    if (item.runId !== runId || item.status !== "failed") continue;
    if (item.type === "compaction") return "compaction_failed";
    if (item.type === "error") {
      const failure = failureReason(item.failure);
      if (failure === "compaction_failed") return failure;
      reason ??= failure;
    }
  }
  return reason;
};

const reachedThreshold = (
  providerThread: OrchestrationV2ThreadProjection["providerThreads"][number] | undefined,
) => {
  const usage = providerThread?.contextUsage;
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
    usage.compactsAutomatically === true ||
    usage.autoCompactThreshold !== undefined ||
    PROVIDER_NATIVE_AUTOMATIC_COMPACTION_DRIVERS.has(providerThread.driver)
  )
    return false;
  return usage.usedTokens / maxTokens >= CONTEXT_USAGE_ROLLOVER_RATIO;
};

export const hasActiveCaptainCrew = (subagents: CaptainRolloverThreadRecords["subagents"]) =>
  subagents.some(
    (subagent) =>
      subagent.origin === "app_owned" &&
      (subagent.status === "idle" ||
        subagent.status === "pending" ||
        subagent.status === "running" ||
        subagent.status === "waiting"),
  );

const resendInput = (
  captain: Captain,
  projectId: ThreadManagementSendInput["projectId"],
  message: OrchestrationV2ConversationMessage,
  run: RolloverRun,
): CaptainRolloverSendInput => ({
  projectId,
  commandId: CommandId.make(`${ROLLOVER_RESEND_PREFIX}${run.id}`),
  threadId: captain.primaryThreadId,
  messageId: MessageId.make(`${ROLLOVER_RESEND_PREFIX}${run.id}`),
  text: message.text,
  attachments: message.attachments,
  mode: "queue",
  modelSelection: run.modelSelection,
  createdBy: message.createdBy,
  creationSource: message.creationSource,
  ...(run.outputSchema === undefined ? {} : { outputSchema: run.outputSchema }),
  ...(message.scheduledTaskId === undefined ? {} : { scheduledTaskId: message.scheduledTaskId }),
  ...(message.senderThreadId === undefined ? {} : { senderThreadId: message.senderThreadId }),
  ...(message.linkedSender === undefined ? {} : { linkedSender: message.linkedSender }),
});

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
    const providerThread = records.providerThreads.find(
      (thread) => thread.id === run.providerThreadId,
    );
    if (!reachedThreshold(providerThread)) return { _tag: "no-trigger" };
    if (hasActiveCaptainCrew(records.subagents)) return { _tag: "deferred-for-crew" };
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
            message.text.trim().toLowerCase() !== "/compact",
        );
  const reset = yield* dependencies.resetConversation({
    captainId: captain.id,
    expectedThreadId: threadId,
    reason,
  });
  if (failedMessage !== undefined) {
    yield* dependencies.sendToThread(
      resendInput(reset, records.thread.projectId, failedMessage, run),
    );
  }
  return { _tag: "rolled-over", captainId: reset.id, reason, resent: failedMessage !== undefined };
});
