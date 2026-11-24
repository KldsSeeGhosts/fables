import {
  isOrchestrationV2WorkActive,
  type Captain,
  type CaptainSnapshot,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { threadKey } from "./entities.ts";
import { threadRuntimeIsActive, type EnvironmentThreadShell } from "./models.ts";

export const captainForThread = (snapshot: CaptainSnapshot | null, threadId: ThreadId) =>
  snapshot?.captains.find((captain) => captain.primaryThreadId === threadId);

export const captainChildIsActive = (thread: EnvironmentThreadShell) =>
  threadRuntimeIsActive(thread.runtime) ||
  thread.hasPendingUserInput ||
  thread.hasPendingApprovals ||
  thread.pendingSubagentRequest != null;

export function captainThreadActivity(
  environmentId: EnvironmentId,
  captain: Captain,
  family: ReadonlyArray<EnvironmentThreadShell>,
) {
  const local = family.filter(
    (thread) => thread.environmentId === environmentId && thread.deletedAt === null,
  );
  const primary = local.find((thread) => thread.id === captain.primaryThreadId);
  const children = local.filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.lineage.relationshipToParent === "subagent" &&
      thread.lineage.parentThreadId === captain.primaryThreadId &&
      captainChildIsActive(thread),
  );
  const attention = [primary, ...children].filter(
    (thread) =>
      thread?.hasPendingApprovals ||
      thread?.hasPendingUserInput ||
      thread?.pendingSubagentRequest != null,
  ).length;
  return {
    primary,
    children,
    attention,
    working:
      children.length > 0 ||
      threadRuntimeIsActive(primary?.runtime) ||
      (primary?.pendingBackgroundTasks.length ?? 0) > 0,
  };
}

/** The Captain's delegated tasks that finished most recently, newest first. */
export const captainRecentlyFinishedTasks = (
  subagents: ReadonlyArray<OrchestrationV2Subagent>,
  limit: number,
) =>
  subagents
    .flatMap((task) =>
      task.origin === "app_owned" &&
      task.completedAt !== null &&
      task.status !== "idle" &&
      !isOrchestrationV2WorkActive(task.status)
        ? [{ task, completedAt: DateTime.toEpochMillis(task.completedAt) }]
        : [],
    )
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, limit)
    .map(({ task }) => task);

/**
 * Thread keys of every Captain conversation, current and earlier, joined in one sorted string so
 * callers can memoize on it. The Captains shelf lists these instead of their project.
 */
export const captainConversationKeys = (
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly captains: ReadonlyArray<Captain>;
  }>,
) =>
  environments
    .flatMap(({ environmentId, captains }) =>
      captains.flatMap((captain) =>
        [captain.primaryThreadId, ...captain.earlierThreadIds].map((threadId) =>
          threadKey({ environmentId, threadId }),
        ),
      ),
    )
    .sort()
    .join("\n");
