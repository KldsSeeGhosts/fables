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
import { parseThreadKey, threadKey } from "./entities.ts";
import { threadRuntimeIsActive, type EnvironmentThreadShell } from "./models.ts";

export const captainForThread = (snapshot: CaptainSnapshot | null, threadId: ThreadId) =>
  snapshot?.captains.find((captain) => captain.primaryThreadId === threadId);

export const captainForEarlierConversation = (
  snapshot: CaptainSnapshot | null,
  threadId: ThreadId,
) =>
  snapshot?.captains.find(
    (captain) => captain.archivedAt === null && captain.earlierThreadIds.includes(threadId),
  );

type CaptainRouteRollover = {
  readonly key: string | null;
  readonly wasPrimary: boolean;
  readonly following: ScopedThreadRef | null;
  readonly followedFrom?: ThreadId;
};

export const EMPTY_CAPTAIN_ROUTE_ROLLOVER: CaptainRouteRollover = {
  key: null,
  wasPrimary: false,
  following: null,
};

export function trackCaptainRouteRollover(
  previous: CaptainRouteRollover,
  thread: ScopedThreadRef | null,
  isPrimary: boolean,
  replacement: ThreadId | undefined,
): CaptainRouteRollover {
  const key = thread === null ? null : threadKey(thread);
  if (previous.key !== key) {
    return {
      key,
      wasPrimary: isPrimary,
      following: null,
      ...(thread !== null &&
      previous.following !== null &&
      threadKey(previous.following) === key &&
      previous.key !== null
        ? { followedFrom: parseThreadKey(previous.key).threadId }
        : {}),
    };
  }
  if (thread === null) return previous;
  if (isPrimary && !previous.wasPrimary) return { ...previous, wasPrimary: true };
  if (
    !previous.wasPrimary ||
    replacement === undefined ||
    previous.following?.threadId === replacement
  )
    return previous;
  return { ...previous, following: scopeThreadRef(thread.environmentId, replacement) };
}

export const captainChildIsActive = (thread: EnvironmentThreadShell) =>
  threadRuntimeIsActive(thread.runtime) ||
  thread.hasPendingUserInput ||
  thread.hasPendingApprovals ||
  thread.pendingSubagentRequest != null;

export function captainThreadActivity(
  environmentId: EnvironmentId,
  captain: Pick<Captain, "primaryThreadId" | "earlierThreadIds">,
  family: ReadonlyArray<EnvironmentThreadShell>,
) {
  const local = family.filter(
    (thread) => thread.environmentId === environmentId && thread.deletedAt === null,
  );
  const primary = local.find((thread) => thread.id === captain.primaryThreadId);
  // Tasks delegated before a reset still belong to this Captain until they finish.
  const conversations = new Set<ThreadId>([captain.primaryThreadId, ...captain.earlierThreadIds]);
  const children = local.filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.lineage.relationshipToParent === "subagent" &&
      thread.lineage.parentThreadId !== null &&
      conversations.has(thread.lineage.parentThreadId) &&
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
  readonly captains: ReadonlyArray<
    Pick<Captain, "id" | "primaryThreadId" | "archivedAt"> &
      Partial<Pick<Captain, "earlierThreadIds">>
  >;
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
  // Every conversation's crew reports to the Captain's current primary, so a reset never hides a waiting task.
  const crewParents = new Map<string, { captainId: CaptainId; captainKey: string }>();
  for (const { environmentId, captains } of environments) {
    for (const captain of captains) {
      if (captain.archivedAt !== null) continue;
      const captainKey = threadKey({ environmentId, threadId: captain.primaryThreadId });
      primaryThreads.set(captainKey, captain.id);
      for (const threadId of [captain.primaryThreadId, ...(captain.earlierThreadIds ?? [])]) {
        crewParents.set(threadKey({ environmentId, threadId }), {
          captainId: captain.id,
          captainKey,
        });
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
      const parent = crewParents.get(
        threadKey({ environmentId, threadId: lineage.parentThreadId }),
      );
      if (parent !== undefined) {
        yield { ...parent, thread, threadRef, isChild: true };
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

export interface CaptainDelegatedLocalTask {
  readonly thread: EnvironmentThreadShell | null;
  readonly subagent: OrchestrationV2Subagent | null;
}

/**
 * Every local task a Captain delegated, across its current and earlier conversations. Shell rows
 * carry finished tasks the parent projection pages away; projection rows enrich the shells they
 * match and cover children whose family rows have not loaded yet.
 */
export function captainDelegatedLocalTasks(input: {
  readonly environmentId: EnvironmentId;
  readonly captain: Pick<Captain, "primaryThreadId" | "earlierThreadIds">;
  readonly shells: ReadonlyArray<EnvironmentThreadShell>;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent>;
}): CaptainDelegatedLocalTask[] {
  const conversations = new Set<ThreadId>([
    input.captain.primaryThreadId,
    ...input.captain.earlierThreadIds,
  ]);
  const subagents = new Map<ThreadId, OrchestrationV2Subagent>();
  for (const subagent of input.subagents) {
    if (
      subagent.origin === "app_owned" &&
      subagent.childThreadId !== null &&
      conversations.has(subagent.threadId)
    ) {
      subagents.set(subagent.childThreadId, subagent);
    }
  }

  const rows: CaptainDelegatedLocalTask[] = [];
  const seen = new Set<ThreadId>();
  for (const thread of input.shells) {
    const parentThreadId = thread.lineage.parentThreadId;
    if (
      thread.environmentId !== input.environmentId ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.lineage.relationshipToParent !== "subagent" ||
      parentThreadId === null ||
      !conversations.has(parentThreadId)
    ) {
      continue;
    }
    seen.add(thread.id);
    rows.push({ thread, subagent: subagents.get(thread.id) ?? null });
  }
  for (const [childThreadId, subagent] of subagents) {
    if (!seen.has(childThreadId)) rows.push({ thread: null, subagent });
  }
  return rows;
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
