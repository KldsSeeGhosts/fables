import {
  isOrchestrationV2WorkActive,
  type Captain,
  type CaptainDocumentName,
  type CaptainId,
  type CaptainSnapshot,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ScheduledTask,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { scopeThreadRef } from "../environment/scoped.ts";
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

type CaptainEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly captains: ReadonlyArray<Pick<Captain, "id" | "primaryThreadId" | "archivedAt">>;
};

export interface CaptainInboxItem {
  readonly kind: "approval" | "input" | "subagent-request";
  readonly environmentId: EnvironmentId;
  readonly captainId: CaptainId;
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
  readonly isChild: boolean;
  readonly updatedAt: string;
}

function* captainAttentionThreads(
  environments: ReadonlyArray<CaptainEnvironment>,
  shells: ReadonlyArray<EnvironmentThreadShell>,
) {
  const primaryThreads = new Map<string, CaptainId>();
  for (const { environmentId, captains } of environments) {
    for (const captain of captains) {
      if (captain.archivedAt === null) {
        primaryThreads.set(
          threadKey({ environmentId, threadId: captain.primaryThreadId }),
          captain.id,
        );
      }
    }
  }

  for (const thread of shells) {
    if (
      thread.deletedAt !== null ||
      !(thread.hasPendingApprovals || thread.hasPendingUserInput || thread.pendingSubagentRequest)
    )
      continue;

    const { environmentId, id, lineage } = thread;
    const threadRef = scopeThreadRef(environmentId, id);
    const primaryKey = threadKey(threadRef);
    const primaryCaptain = primaryThreads.get(primaryKey);
    if (primaryCaptain !== undefined) {
      yield {
        captainId: primaryCaptain,
        captainKey: primaryKey,
        thread,
        threadRef,
        isChild: false,
      };
    } else if (
      thread.archivedAt === null &&
      lineage.relationshipToParent === "subagent" &&
      lineage.parentThreadId !== null
    ) {
      const captainKey = threadKey({ environmentId, threadId: lineage.parentThreadId });
      const captainId = primaryThreads.get(captainKey);
      if (captainId !== undefined) {
        yield { captainId, captainKey, thread, threadRef, isChild: true };
      }
    }
  }
}

export function captainInboxItems(
  environments: ReadonlyArray<CaptainEnvironment>,
  shells: ReadonlyArray<EnvironmentThreadShell>,
): CaptainInboxItem[] {
  const items: CaptainInboxItem[] = [];
  for (const { captainId, thread, threadRef, isChild } of captainAttentionThreads(
    environments,
    shells,
  )) {
    const { environmentId, title, updatedAt } = thread;
    const item = { environmentId, captainId, threadRef, title, isChild, updatedAt };
    if (thread.hasPendingApprovals) items.push({ ...item, kind: "approval" });
    if (thread.hasPendingUserInput) items.push({ ...item, kind: "input" });
    if (thread.pendingSubagentRequest != null) items.push({ ...item, kind: "subagent-request" });
  }
  return items.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title),
  );
}

/** Count each Captain with pending attention once, even across several conversations. */
export function captainAttentionTotal(
  environments: ReadonlyArray<CaptainEnvironment>,
  shells: ReadonlyArray<EnvironmentThreadShell>,
): number {
  const captains = new Set<string>();
  for (const { captainKey } of captainAttentionThreads(environments, shells)) {
    captains.add(captainKey);
  }
  return captains.size;
}

export function captainScheduledTasks(
  tasks: ReadonlyArray<ScheduledTask>,
  captain: Pick<Captain, "primaryThreadId" | "earlierThreadIds">,
): ScheduledTask[] {
  const threads = new Set([captain.primaryThreadId, ...captain.earlierThreadIds]);
  return tasks.filter((task) => task.threadId !== null && threads.has(task.threadId));
}

export function captainDocument(
  snapshot: CaptainSnapshot | null | undefined,
  captainId: CaptainId,
  name: CaptainDocumentName,
) {
  return snapshot?.documents.find(
    (document) => document.captainId === captainId && document.name === name,
  );
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
    readonly captains: ReadonlyArray<Pick<Captain, "primaryThreadId" | "earlierThreadIds">>;
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
