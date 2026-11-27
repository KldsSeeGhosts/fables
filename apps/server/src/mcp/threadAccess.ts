import type {
  ProjectionRecordField,
  ProjectionRecordFilter,
} from "../orchestration-v2/ProjectionStore.ts";
import {
  CommandId,
  type EnvironmentId,
  isCaptainThreadId,
  isRuntimeModeAbove,
  OrchestratorMcpFailure,
  type ProjectId,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import {
  hasThreadLinks,
  parseThreadLinkHref,
  threadLinkCandidates,
  threadLinkRefs,
} from "@t3tools/shared/threadLinks";
import { hasPendingBackgroundSubagent } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CaptainStore from "../captains/CaptainStore.ts";
import type { OrchestratorV2Error } from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { resolveInteractionMode, resolveRuntimeMode } from "./delegatedTaskModes.ts";
import { fencingLinkOrigin } from "./linkOrigin.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";

const delegatedTaskPrefix = "thread:delegated-task:";

const suggestedThreadId = (threadId: ThreadId) => {
  if (!threadId.startsWith(delegatedTaskPrefix)) return ThreadId.make(`mcp:${threadId}`);
  const rest = threadId.slice(delegatedTaskPrefix.length);
  // encodeURIComponent throws on lone surrogates, which a JSON string can carry.
  if (!rest.isWellFormed()) return null;
  const encoded = encodeURIComponent(rest);
  return encoded === rest ? null : ThreadId.make(`${delegatedTaskPrefix}${encoded}`);
};

// A pasted link (bare, Markdown, or hosted) names its thread; only this environment's can be read here.
const candidateThreadIds = (threadId: ThreadId, environmentId: EnvironmentId) => {
  if (!hasThreadLinks(threadId)) {
    const suggested = suggestedThreadId(threadId);
    return suggested === null ? [] : [suggested];
  }
  const link = parseThreadLinkHref(threadId);
  const refs =
    link === null
      ? threadLinkRefs(threadId, environmentId)
      : threadLinkCandidates(link, environmentId);
  return refs.filter((ref) => ref.environmentId === environmentId).map((ref) => ref.threadId);
};

/**
 * Agents paste bare uuids for `mcp:<uuid>` threads, unencoded delegated-task ids, and thread links.
 * The id is never rewritten, so permission checks keyed on it still hold; the miss
 * only names a live thread the caller could read by its full id. Ids from another
 * machine miss here too. The link hint is static: listing links probes peers.
 */
export const threadNotFound = Effect.fn("OrchestratorMcpService.threadNotFound")(function* (
  threads: Pick<ThreadManagement.ThreadManagementService["Service"], "getThreadShell">,
  scope: McpInvocationContext.McpInvocationScope,
  threadId: ThreadId,
  message: string,
) {
  let suggested: ThreadId | null = null;
  for (const candidate of candidateThreadIds(threadId, scope.environmentId)) {
    const shell = yield* threads.getThreadShell(candidate).pipe(Effect.orElseSucceed(() => null));
    if (shell !== null && shell.deletedAt === null) {
      suggested = candidate;
      break;
    }
  }
  if (suggested !== null && hasThreadLinks(threadId)) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_not_found",
      message: `\`${threadId}\` is a thread link, not a thread id. Pass \`${suggested}\` instead.`,
    });
  }
  const mcpHint = suggested === null ? "" : ` Did you mean \`${suggested}\`?`;
  const caller =
    scope.thread === undefined
      ? null
      : yield* threads.getThreadShell(scope.thread.threadId).pipe(Effect.orElseSucceed(() => null));
  // A peer link's caller would be pointed at this machine's links, and a fenced one may not use them.
  const linksHint =
    scope.linkedEnvironments === false ||
    scope.client?.linked === true ||
    fencingLinkOrigin({ scope, caller: caller ?? undefined }) !== undefined
      ? ""
      : " Thread ids belong to one environment: for a thread on a linked one, find it with `t3_environment_links` and pass its `environmentId` to a tool that takes one.";
  return yield* new OrchestratorMcpFailure({
    code: "thread_not_found",
    message: `${message}${mcpHint}${linksHint}`,
  });
});

export const unavailable = () =>
  new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: "The operation could not be completed.",
  });

export const dispatchFailure = (
  error: OrchestratorV2Error | ThreadManagement.ThreadManagementProviderInstanceDisabledError,
) =>
  error._tag === "ThreadManagementProviderInstanceDisabledError" ||
  error._tag === "OrchestratorRuntimeModeAboveCeilingError" ||
  error._tag === "OrchestratorProviderSelectionBusyError"
    ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.message })
    : (error._tag === "OrchestratorDispatchError" ||
          error._tag === "OrchestratorCommandRejectedError") &&
        typeof error.cause === "string" &&
        error.cause.length > 0
      ? new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: Array.from(error.cause).slice(0, 1000).join(""),
        })
      : unavailable();

export interface CallerLimits {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export interface Caller {
  readonly scope: McpInvocationContext.McpInvocationScope;
  readonly threads: ThreadManagement.ThreadManagementService["Service"];
  readonly caller: OrchestrationV2ThreadShell | undefined;
  readonly limits: CallerLimits;
}

export const readCaller = Effect.fn("mcp.readCaller")(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (!scope.capabilities.has("orchestration")) {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential cannot control threads.",
    });
  }
  return yield* loadCaller();
});

export const loadCaller = Effect.fn("mcp.loadCaller")(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const threads = yield* ThreadManagement.ThreadManagementService;
  if (scope.thread === undefined) {
    return {
      scope,
      threads,
      caller: undefined,
      limits: McpInvocationContext.clientModeCeiling(scope.client),
    } satisfies Caller;
  }
  const caller = yield* threads
    .getThreadShell(scope.thread.threadId)
    .pipe(Effect.mapError(unavailable));
  if (caller === null || caller.deletedAt !== null) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_not_found",
      message: "The calling thread was not found.",
    });
  }
  return {
    scope,
    threads,
    caller,
    limits: { runtimeMode: caller.runtimeMode, interactionMode: caller.interactionMode },
  } satisfies Caller;
});

export const assertTargetWithinLimits = (
  limits: CallerLimits,
  target: Pick<OrchestrationV2ThreadShell, "id" | "runtimeMode" | "interactionMode">,
) =>
  resolveRuntimeMode(limits.runtimeMode, target.runtimeMode).pipe(
    Effect.andThen(resolveInteractionMode(limits.interactionMode, target.interactionMode)),
    Effect.asVoid,
    Effect.mapError(
      (error) =>
        new OrchestratorMcpFailure({
          code: error.code,
          message: `Thread "${target.id}" runs in ${target.runtimeMode}/${target.interactionMode}, above this caller's ${limits.runtimeMode}/${limits.interactionMode} limit. For linked calls, this limit is also capped by the link's approved access. This call does not create an approval request. Have the user act directly in the target thread through an authorized client.`,
        }),
    ),
  );

/** Background subagents retain credentials until provider exit; archived threads and other instances cannot act. */
export const isLiveCallerShell = (
  shell: Pick<
    OrchestrationV2ThreadShell,
    "archivedAt" | "activeRunId" | "providerInstanceId" | "pendingBackgroundTasks"
  > | null,
  providerInstanceId: ProviderInstanceId | undefined,
) =>
  shell !== null &&
  shell.archivedAt === null &&
  shell.providerInstanceId === providerInstanceId &&
  (shell.activeRunId !== null ||
    hasPendingBackgroundSubagent(shell.pendingBackgroundTasks, providerInstanceId));

/** Thread callers need a live run or its background subagent in an unarchived thread. OAuth clients rely on their session and ceiling. */
export function assertLiveCaller({ caller, scope }: Caller) {
  if (caller === undefined) return Effect.void;
  return isLiveCallerShell(caller, scope.thread?.providerInstanceId)
    ? Effect.void
    : Effect.fail(
        new OrchestratorMcpFailure({
          code: "parent_not_active",
          message: "The calling provider no longer owns an active thread run.",
        }),
      );
}

export const assertFullAccess = (context: Caller, message: string) =>
  context.limits.runtimeMode === "full-access" && context.limits.interactionMode === "default"
    ? Effect.void
    : Effect.fail(new OrchestratorMcpFailure({ code: "capability_denied", message }));

/**
 * For work whose definition picks its own modes: the caller must hold the broadest modes a
 * thread may run in here, full access or an administrator's ceiling below it.
 */
export const assertBroadestAccess = (context: Caller, what: string) => {
  const broadest = context.scope.runtimeModeCeiling ?? "full-access";
  return !isRuntimeModeAbove(broadest, context.limits.runtimeMode) &&
    context.limits.interactionMode === "default"
    ? Effect.void
    : Effect.fail(
        new OrchestratorMcpFailure({
          code: "capability_denied",
          message: `Only a caller with ${broadest}/default access can ${what}, because that work picks its own modes. This caller is limited to ${context.limits.runtimeMode}/${context.limits.interactionMode}.`,
        }),
      );
};

export const resolveProjectId = (context: Caller, projectId: ProjectId | undefined) =>
  projectId !== undefined
    ? Effect.succeed(projectId)
    : context.caller !== undefined
      ? Effect.succeed(context.caller.projectId)
      : Effect.fail(
          new OrchestratorMcpFailure({
            code: "target_required",
            message: "Pass projectId: this MCP client is not running inside a T3 thread.",
          }),
        );

const chorusOwnerThreadId = (scope: McpInvocationContext.McpInvocationScope) =>
  scope.thread?.subagent === true ? undefined : scope.thread?.threadId;

export const privateChorusConversationIds = Effect.fn("mcp.privateChorusConversationIds")(
  function* (scope: McpInvocationContext.McpInvocationScope) {
    const store = yield* Effect.serviceOption(CaptainStore.CaptainStore);
    return Option.isSome(store)
      ? yield* store.value
          .privateChorusConversationIds(chorusOwnerThreadId(scope))
          .pipe(Effect.mapError(unavailable))
      : undefined;
  },
);

type CaptainThreadShape = Pick<OrchestrationV2ThreadShell, "id" | "lineage">;

const captainConversationKey = (thread: CaptainThreadShape): ThreadId | undefined => {
  if (isCaptainThreadId(thread.id)) return thread.id;
  const { parentThreadId, relationshipToParent, rootThreadId } = thread.lineage;
  if (relationshipToParent !== "subagent") return undefined;
  if (parentThreadId !== null && isCaptainThreadId(parentThreadId)) return parentThreadId;
  return isCaptainThreadId(rootThreadId) ? rootThreadId : undefined;
};

const duetWriteDenied = (message: string) =>
  Effect.fail(
    new OrchestratorMcpFailure({
      code: "capability_denied",
      message,
    }),
  );

/** Duet ownership applies to a conversation and the Solos it started. */
export const assertDuetThreadWriteAllowed = Effect.fn("mcp.assertDuetThreadWriteAllowed")(
  function* (input: {
    readonly scope: McpInvocationContext.McpInvocationScope;
    readonly caller: CaptainThreadShape | undefined;
    readonly target: CaptainThreadShape;
    readonly wake?: boolean;
  }) {
    const targetKey = captainConversationKey(input.target);
    if (targetKey === undefined) return;
    const store = yield* Effect.serviceOption(CaptainStore.CaptainStore);
    const targetCaptain = Option.isSome(store)
      ? yield* store.value.findByConversation(targetKey).pipe(Effect.mapError(unavailable))
      : undefined;
    if (
      targetCaptain?.kind === "chorus" &&
      targetKey === input.target.id &&
      (input.wake ||
        input.scope.thread?.threadId !== input.target.id ||
        input.scope.thread.subagent === true)
    ) {
      return yield* duetWriteDenied(
        "Agents cannot message or change the Chorus. The user can act in the Chorus thread directly.",
      );
    }
    const callerKey = input.caller === undefined ? undefined : captainConversationKey(input.caller);
    if (callerKey === targetKey) return;
    const callerCaptain =
      callerKey !== undefined && Option.isSome(store)
        ? yield* store.value.findByConversation(callerKey).pipe(Effect.mapError(unavailable))
        : undefined;
    if (callerCaptain !== undefined && callerCaptain.id === targetCaptain?.id) return;
    if (targetCaptain?.kind === "chorus") {
      return yield* duetWriteDenied(
        "Agents cannot change the Chorus or its Solos. The user can act in the Chorus thread directly.",
      );
    }
    if (callerCaptain?.kind === "chorus" || input.scope.chorus === true) {
      return yield* duetWriteDenied(
        "A Chorus cannot wake or change another Duet's thread. Use duet_send for a routed request.",
      );
    }
    if (callerKey !== undefined || input.scope.client?.linked === true) {
      return yield* duetWriteDenied(
        "A Duet, its Solo, or a linked agent cannot use generic tools to change another Duet's thread.",
      );
    }
  },
);

export const assertChorusUsesDelegateTask = Effect.fn("mcp.assertChorusUsesDelegateTask")(
  function* (scope: McpInvocationContext.McpInvocationScope) {
    const threadId = scope.thread?.threadId;
    if (threadId === undefined || !isCaptainThreadId(threadId)) return;
    const store = yield* Effect.serviceOption(CaptainStore.CaptainStore);
    const captain = Option.isSome(store)
      ? yield* store.value.findByConversation(threadId).pipe(Effect.mapError(unavailable))
      : undefined;
    if (captain?.kind === "chorus" || scope.chorus === true) {
      return yield* duetWriteDenied(
        "Chorus starts Solos with delegate_task and routes covered project work with duet_send.",
      );
    }
  },
);

export const assertScheduledThreadWriteAllowed = Effect.fn("mcp.assertScheduledThreadWriteAllowed")(
  function* (
    context: {
      readonly scope: McpInvocationContext.McpInvocationScope;
      readonly caller: CaptainThreadShape | undefined;
      readonly threads: Pick<Caller["threads"], "getThreadShell">;
    },
    threadId: ThreadId | null,
    wake = false,
  ) {
    if (threadId == null) return;
    const callerKey =
      context.caller === undefined ? undefined : captainConversationKey(context.caller);
    const checkRequired =
      isCaptainThreadId(threadId) ||
      callerKey !== undefined ||
      context.scope.client?.linked === true;
    const shell = context.threads.getThreadShell(threadId);
    const target = yield* checkRequired
      ? shell.pipe(Effect.mapError(unavailable))
      : shell.pipe(Effect.orElseSucceed(() => null));
    if (target === null || target.deletedAt !== null) return;
    yield* assertDuetThreadWriteAllowed({ ...context, target, wake });
  },
);

export const assertReadableConversation = Effect.fn("mcp.assertReadableConversation")(function* (
  scope: McpInvocationContext.McpInvocationScope,
  threadId: ThreadId,
) {
  if (!isCaptainThreadId(threadId)) return;
  const store = yield* Effect.serviceOption(CaptainStore.CaptainStore);
  if (Option.isNone(store)) return;
  const captain = yield* store.value
    .findByConversation(threadId)
    .pipe(Effect.mapError(unavailable));
  if (
    captain?.kind === "chorus" &&
    (captain.archivedAt !== null || captain.primaryThreadId !== chorusOwnerThreadId(scope))
  ) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_not_found",
      message: "The thread was not found.",
    });
  }
});

const resolveThreadId = (context: Caller, threadId: ThreadId | undefined) =>
  threadId !== undefined
    ? Effect.succeed(threadId)
    : context.caller !== undefined
      ? Effect.succeed(context.caller.id)
      : Effect.fail(
          new OrchestratorMcpFailure({
            code: "target_required",
            message: "Pass threadId: this MCP client is not running inside a T3 thread.",
          }),
        );

export const readThread = Effect.fn("mcp.readThread")(function* <
  K extends ProjectionRecordField = never,
>(threadId?: ThreadId, fields: ReadonlyArray<K> = [], filter?: ProjectionRecordFilter) {
  const context = yield* readCaller();
  const targetId = yield* resolveThreadId(context, threadId);
  yield* assertReadableConversation(context.scope, targetId);
  const shell = yield* context.threads.getThreadShell(targetId).pipe(Effect.mapError(unavailable));
  if (shell === null || shell.deletedAt !== null) {
    return yield* threadNotFound(
      context.threads,
      context.scope,
      targetId,
      "The thread was not found.",
    );
  }
  const projection = yield* context.threads
    .getProjectThreadRecords({ projectId: shell.projectId, threadId: targetId }, fields, {
      turnItemTypes: ["user_input_request"],
      ...filter,
    })
    .pipe(
      Effect.mapError((error) =>
        error._tag === "ThreadManagementThreadNotFoundError"
          ? new OrchestratorMcpFailure({
              code: "thread_not_found",
              message: "The thread was not found.",
            })
          : unavailable(),
      ),
    );
  return { ...context, projection };
});

export const newCommandId = Effect.fn("mcp.newCommandId")(function* () {
  const random = yield* SecureRandom.SecureRandom;
  return CommandId.make(`mcp:${yield* random.uuidV4()}`);
});
