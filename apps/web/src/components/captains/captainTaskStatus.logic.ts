import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { isOrchestrationV2WorkActive, type OrchestrationV2Subagent } from "@t3tools/contracts";

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
