import {
  CommandId,
  MessageId,
  type Captain,
  type CaptainConversationEndReason,
  type CaptainId,
  type CaptainResetInput,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2LinkedSender,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type ProjectId,
  type ScheduledTaskId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

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

export interface CaptainRolloverSendInput {
  readonly projectId: ProjectId;
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: OrchestrationV2ConversationMessage["attachments"];
  readonly mode: "auto";
  readonly createdBy: OrchestrationV2ConversationMessage["createdBy"];
  readonly creationSource: OrchestrationV2ConversationMessage["creationSource"];
  readonly scheduledTaskId?: ScheduledTaskId;
  readonly senderThreadId?: ThreadId;
  readonly linkedSender?: OrchestrationV2LinkedSender;
}

export interface CaptainRolloverDependencies {
  readonly findCaptainByConversation: (
    threadId: ThreadId,
  ) => Effect.Effect<Captain | undefined, Error>;
  readonly getThreadRecords: (
    threadId: ThreadId,
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

const failureText = (failure: OrchestrationV2ProviderFailure) =>
  `${failure.code ?? ""}\n${failure.message}`.toLowerCase();

const isContextOverflowFailure = (failure: OrchestrationV2ProviderFailure) => {
  if (failure.code === "ContextOverflowError") return true;
  const text = failureText(failure);
  return (
    text.includes("context window") ||
    text.includes("context length") ||
    text.includes("maximum context") ||
    text.includes("prompt is too long") ||
    text.includes("prompt too long") ||
    text.includes("prompt exceeds") ||
    text.includes("too many tokens")
  );
};

const isFailedCompactionItem = (item: OrchestrationV2TurnItem) =>
  item.type === "compaction" && item.status === "failed";

const descendingOrdinal = (items: ReadonlyArray<OrchestrationV2TurnItem>) =>
  [...items].sort((left, right) => right.ordinal - left.ordinal);

const immediateTrigger = (
  records: CaptainRolloverThreadRecords,
  runId: OrchestrationV2Run["id"],
) => {
  for (const item of descendingOrdinal(records.turnItems)) {
    if (item.runId !== runId) continue;
    if (item.type === "error" && isContextOverflowFailure(item.failure)) {
      return { reason: "context_overflow" as const, runId: item.runId };
    }
    if (isFailedCompactionItem(item)) {
      return { reason: "compaction_failed" as const, runId: item.runId };
    }
  }
  return null;
};

const thresholdTrigger = (records: CaptainRolloverThreadRecords) => {
  const providerThread = records.providerThreads
    .filter((thread) => thread.appThreadId === records.thread.id && thread.contextUsage != null)
    .sort(
      (left, right) =>
        DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
    )[0];
  const usage = providerThread?.contextUsage;
  const maxTokens = usage?.maxTokens;
  if (
    providerThread === undefined ||
    usage == null ||
    maxTokens === null ||
    maxTokens === undefined ||
    maxTokens <= 0
  )
    return null;
  if (
    usage.compactsAutomatically === true ||
    usage.autoCompactThreshold !== undefined ||
    PROVIDER_NATIVE_AUTOMATIC_COMPACTION_DRIVERS.has(providerThread.driver)
  )
    return null;
  return usage.usedTokens / maxTokens >= CONTEXT_USAGE_ROLLOVER_RATIO
    ? ({ reason: "threshold" as const } as const)
    : null;
};

const hasActiveCrewTasks = (records: CaptainRolloverThreadRecords) =>
  records.subagents.some(
    (subagent) =>
      subagent.origin === "app_owned" &&
      (subagent.status === "idle" ||
        subagent.status === "pending" ||
        subagent.status === "running" ||
        subagent.status === "waiting"),
  );

const userMessageForRun = (
  records: CaptainRolloverThreadRecords,
  runId: OrchestrationV2Run["id"] | null,
) => {
  if (runId === null) return undefined;
  return records.messages.find(
    (message) =>
      message.runId === runId &&
      message.role === "user" &&
      message.notification === undefined &&
      !message.id.startsWith(ROLLOVER_RESEND_PREFIX),
  );
};

const resendInput = (
  captain: Captain,
  records: CaptainRolloverThreadRecords,
  message: OrchestrationV2ConversationMessage,
  sourceRunId: OrchestrationV2Run["id"],
): CaptainRolloverSendInput => {
  const input: CaptainRolloverSendInput = {
    projectId: records.thread.projectId,
    commandId: CommandId.make(`${ROLLOVER_RESEND_PREFIX}${sourceRunId}`),
    threadId: captain.primaryThreadId,
    messageId: MessageId.make(`${ROLLOVER_RESEND_PREFIX}${sourceRunId}`),
    text: message.text,
    attachments: message.attachments,
    mode: "auto",
    createdBy: message.createdBy,
    creationSource: message.creationSource,
  };
  const withScheduled =
    message.scheduledTaskId === undefined
      ? input
      : { ...input, scheduledTaskId: message.scheduledTaskId };
  const withSender =
    message.senderThreadId === undefined
      ? withScheduled
      : { ...withScheduled, senderThreadId: message.senderThreadId };
  return message.linkedSender === undefined
    ? withSender
    : { ...withSender, linkedSender: message.linkedSender };
};

/** Evaluates one terminal Captain turn, rolls over when needed, and replays the failed user input. */
export const handleCaptainTurnEnd = Effect.fn("CaptainRollover.handleTurnEnd")(function* (
  dependencies: CaptainRolloverDependencies,
  input: { readonly threadId: ThreadId; readonly runId: OrchestrationV2Run["id"] },
): Effect.fn.Return<CaptainRolloverResult, Error> {
  const captain = yield* dependencies.findCaptainByConversation(input.threadId);
  if (captain?.primaryThreadId !== input.threadId) return { _tag: "not-captain-primary" };
  const records = yield* dependencies.getThreadRecords(input.threadId);

  const immediate = immediateTrigger(records, input.runId);
  const runIsRolloverResend =
    immediate !== null &&
    records.messages.some(
      (message) =>
        message.runId === immediate.runId &&
        message.role === "user" &&
        message.id.startsWith(ROLLOVER_RESEND_PREFIX),
    );
  let reason: CaptainConversationEndReason;
  let sourceRunId: OrchestrationV2Run["id"] | null = null;
  if (immediate !== null && !runIsRolloverResend) {
    reason = immediate.reason;
    sourceRunId = immediate.runId;
  } else {
    const threshold = thresholdTrigger(records);
    if (threshold === null) return { _tag: "no-trigger" };
    if (hasActiveCrewTasks(records)) return { _tag: "deferred-for-crew" };
    reason = threshold.reason;
  }

  const reset = yield* dependencies.resetConversation({
    captainId: captain.id,
    expectedThreadId: input.threadId,
    reason,
  });

  const failedMessage = sourceRunId === null ? undefined : userMessageForRun(records, sourceRunId);
  const resend =
    failedMessage !== undefined &&
    sourceRunId !== null &&
    failedMessage.text.trim().toLowerCase() !== "/compact"
      ? ({ message: failedMessage, runId: sourceRunId } as const)
      : undefined;
  if (resend !== undefined) {
    yield* dependencies.sendToThread(resendInput(reset, records, resend.message, resend.runId));
  }
  return { _tag: "rolled-over", captainId: reset.id, reason, resent: resend !== undefined };
});
