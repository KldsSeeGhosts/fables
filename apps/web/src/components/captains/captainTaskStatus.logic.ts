import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { isOrchestrationV2WorkActive, type OrchestrationV2Subagent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** One status vocabulary for a Captain's task, shared by the Tasks drawer, its header and chat. */
export type CaptainTaskStatus =
  | "needs-input"
  | "working"
  | "ready"
  | "failed"
  | "stopped"
  | "scheduled"
  | "done"
  | "unknown";

type TaskThread = Pick<
  EnvironmentThreadShell,
  | "hasPendingUserInput"
  | "hasPendingApprovals"
  | "pendingSubagentRequest"
  | "runtime"
  | "latestRun"
  | "settledAt"
>;

/** A task the client has no shell for is unknown, never ready or done. */
export function captainThreadTaskStatus(thread: TaskThread | null | undefined): CaptainTaskStatus {
  if (!thread) return "unknown";
  if (thread.hasPendingUserInput || thread.hasPendingApprovals || thread.pendingSubagentRequest) {
    return "needs-input";
  }
  if (threadRuntimeIsActive(thread.runtime)) return "working";
  if (thread.settledAt !== null) return "done";
  switch (thread.latestRun?.status) {
    case "completed":
      return "ready";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
    case "rolled_back":
      return "stopped";
    default:
      return "done";
  }
}

/** Status of a linked task whose child thread lives on another environment. */
export function captainSubagentTaskStatus(
  task: Pick<OrchestrationV2Subagent, "status">,
): CaptainTaskStatus {
  if (task.status === "waiting") return "needs-input";
  if (isOrchestrationV2WorkActive(task.status)) return "working";
  switch (task.status) {
    case "completed":
      return "ready";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "stopped";
    default:
      return "done";
  }
}

/**
 * Status of a local task. The child's shell is live, so its requests and runs win; a settled shell
 * is done; otherwise the parent's record of the delegation decides.
 */
export function captainLocalTaskStatus(
  thread: TaskThread | null | undefined,
  subagent: Pick<OrchestrationV2Subagent, "status"> | null | undefined,
): CaptainTaskStatus {
  const live = captainThreadTaskStatus(thread);
  if (live === "needs-input" || live === "working") return live;
  if (thread?.settledAt != null) return "done";
  if (subagent) return captainSubagentTaskStatus(subagent);
  return live;
}

/** Task results are markdown, but a one-line detail renders as plain text. */
const plainLine = (line: string) =>
  line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`+)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, "$1$2")
    .trim();

const firstLine = (text: string | null | undefined) =>
  text
    ?.split("\n")
    .map(plainLine)
    .find((line) => line !== "" && !/^(?:[-*_=]{3,}|`{3,}.*)$/.test(line)) ?? null;

/** The muted detail after the status word: progress while working, a result when finished, else the branch. */
export function captainTaskDetail(input: {
  readonly status: CaptainTaskStatus;
  readonly thread?: Pick<EnvironmentThreadShell, "branch" | "runtime"> | null | undefined;
  readonly subagent?: Pick<OrchestrationV2Subagent, "progress" | "result"> | null | undefined;
}): string | null {
  if (input.status === "working") {
    return firstLine(input.subagent?.progress) ?? input.thread?.branch ?? null;
  }
  if (
    input.status === "ready" ||
    input.status === "failed" ||
    input.status === "stopped" ||
    input.status === "done"
  ) {
    return (
      firstLine(input.subagent?.result) ??
      firstLine(input.thread?.runtime?.lastError) ??
      input.thread?.branch ??
      null
    );
  }
  return input.thread?.branch ?? null;
}

/** The time a task age describes: work started, outcomes finished, and requests last changed. */
export function captainTaskActivityMs(input: {
  readonly status: CaptainTaskStatus;
  readonly thread?: Pick<EnvironmentThreadShell, "createdAt" | "updatedAt" | "settledAt"> | null;
  readonly subagent?:
    | Pick<OrchestrationV2Subagent, "startedAt" | "completedAt" | "updatedAt">
    | null
    | undefined;
}): number {
  if (input.status === "done" && input.thread?.settledAt != null) {
    return Date.parse(input.thread.settledAt);
  }
  const { subagent } = input;
  if (subagent) {
    if (input.status === "working" && subagent.startedAt !== null) {
      return DateTime.toEpochMillis(subagent.startedAt);
    }
    if (
      (input.status === "ready" ||
        input.status === "failed" ||
        input.status === "stopped" ||
        input.status === "done") &&
      subagent.completedAt !== null
    ) {
      return DateTime.toEpochMillis(subagent.completedAt);
    }
    return DateTime.toEpochMillis(subagent.updatedAt);
  }
  return Date.parse(input.thread?.updatedAt ?? input.thread?.createdAt ?? "") || 0;
}

const STATUS_ORDER: Record<CaptainTaskStatus, number> = {
  "needs-input": 0,
  working: 1,
  failed: 2,
  ready: 3,
  unknown: 4,
  stopped: 5,
  scheduled: 6,
  done: 7,
};

/** Recent keeps open work regardless of age and finished work from the last day. */
export const captainTaskIsRecent = (
  status: CaptainTaskStatus,
  updatedAtMs: number,
  cutoffMs: number,
) => status === "needs-input" || status === "working" || updatedAtMs >= cutoffMs;

/** Needs you first, then running work, then outcomes to review; ties keep the newest first. */
export const compareCaptainTasks = (
  a: { readonly status: CaptainTaskStatus; readonly updatedAtMs: number },
  b: { readonly status: CaptainTaskStatus; readonly updatedAtMs: number },
) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.updatedAtMs - a.updatedAtMs;
