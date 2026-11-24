import type { Captain, CaptainSnapshot, EnvironmentId, ThreadId } from "@t3tools/contracts";

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
