import {
  CaptainId,
  EnvironmentId,
  NodeId,
  ScheduledTaskId,
  ThreadId,
  type Captain,
  type CaptainSnapshot,
  type OrchestrationV2Subagent,
  type ScheduledTask,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";

import {
  captainAttentionTotal,
  captainConversationKeys,
  captainDelegatedLocalTasks,
  captainDocument,
  captainInboxItems,
  captainRecentlyFinishedTasks,
  captainScheduledTasks,
  captainThreadActivity,
} from "./captains.ts";
import { threadKey } from "./entities.ts";
import { scopeThreadShell } from "./models.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const task = (
  id: string,
  status: OrchestrationV2Subagent["status"],
  completedAt: string | null,
  origin: OrchestrationV2Subagent["origin"] = "app_owned",
) =>
  ({
    id: NodeId.make(id),
    origin,
    status,
    completedAt: completedAt === null ? null : DateTime.makeUnsafe(completedAt),
  }) as OrchestrationV2Subagent;

it("lists finished delegated tasks newest first, up to the limit", () => {
  const finished = captainRecentlyFinishedTasks(
    [
      task("old", "completed", "2026-11-24T09:00:00.000Z"),
      task("failed", "failed", "2026-11-24T11:00:00.000Z"),
      task("running", "running", null),
      task("native", "completed", "2026-11-24T12:00:00.000Z", "provider_native"),
      task("cancelled", "cancelled", "2026-11-24T10:00:00.000Z"),
    ],
    2,
  );
  expect(finished.map(({ id }) => id)).toEqual(["failed", "cancelled"]);
});

it("keys every current and earlier Captain conversation by environment", () => {
  const environmentId = EnvironmentId.make("environment");
  const captain = {
    primaryThreadId: ThreadId.make("captain:maria:1"),
    earlierThreadIds: [ThreadId.make("captain:maria:0")],
  };
  expect(captainConversationKeys([])).toBe("");
  expect(captainConversationKeys([{ environmentId, captains: [captain] }]).split("\n")).toEqual([
    threadKey({ environmentId, threadId: ThreadId.make("captain:maria:0") }),
    threadKey({ environmentId, threadId: ThreadId.make("captain:maria:1") }),
  ]);
});

const environmentId = EnvironmentId.make("local");
const remoteId = EnvironmentId.make("remote");
const earlierAt = "2026-11-24T08:00:00.000Z";
const laterAt = "2026-11-24T09:00:00.000Z";
const maria = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:1"),
  earlierThreadIds: [ThreadId.make("captain:maria:0")],
  archivedAt: null,
} satisfies Pick<Captain, "id" | "primaryThreadId" | "earlierThreadIds" | "archivedAt">;

it("collects pending attention from current Captain conversations and active children", () => {
  const archived = {
    id: CaptainId.make("archived"),
    primaryThreadId: ThreadId.make("captain:archived:0"),
    archivedAt: earlierAt,
  };
  const environments = [
    { environmentId, captains: [maria, archived] },
    { environmentId: remoteId, captains: [maria] },
  ];
  const base = scopeThreadShell(environmentId, v2ThreadShell);
  const primary = { ...base, id: maria.primaryThreadId, title: "Maria", updatedAt: earlierAt };
  const child = {
    ...base,
    id: ThreadId.make("child"),
    title: "Plan",
    updatedAt: laterAt,
    lineage: {
      rootThreadId: primary.id,
      parentThreadId: primary.id,
      relationshipToParent: "subagent" as const,
    },
  };
  const shells = [
    { ...primary, hasPendingApprovals: true },
    { ...primary, environmentId: remoteId, pendingSubagentRequest: "approval" as const },
    { ...primary, id: maria.earlierThreadIds[0]!, hasPendingApprovals: true },
    { ...primary, id: archived.primaryThreadId, hasPendingApprovals: true },
    { ...child, hasPendingUserInput: true },
    { ...child, id: ThreadId.make("audit"), title: "Audit", hasPendingApprovals: true },
    { ...child, id: ThreadId.make("idle") },
    { ...child, id: ThreadId.make("archived"), archivedAt: laterAt, hasPendingUserInput: true },
    { ...child, id: ThreadId.make("deleted"), deletedAt: laterAt, hasPendingUserInput: true },
    { ...child, environmentId: EnvironmentId.make("unrelated"), hasPendingUserInput: true },
  ];
  expect(captainInboxItems(environments, shells)).toEqual([
    {
      kind: "approval",
      environmentId,
      captainId: maria.id,
      threadRef: { environmentId, threadId: ThreadId.make("audit") },
      title: "Audit",
      isChild: true,
      updatedAt: laterAt,
    },
    {
      kind: "input",
      environmentId,
      captainId: maria.id,
      threadRef: { environmentId, threadId: child.id },
      title: "Plan",
      isChild: true,
      updatedAt: laterAt,
    },
    {
      kind: "approval",
      environmentId,
      captainId: maria.id,
      threadRef: { environmentId, threadId: primary.id },
      title: "Maria",
      isChild: false,
      updatedAt: earlierAt,
    },
    {
      kind: "subagent-request",
      environmentId: remoteId,
      captainId: maria.id,
      threadRef: { environmentId: remoteId, threadId: primary.id },
      title: "Maria",
      isChild: false,
      updatedAt: earlierAt,
    },
  ]);
  expect(captainAttentionTotal(environments, shells)).toBe(2);
});

it("keeps a pre-reset task's pending request on the Captain after it switches conversations", () => {
  const base = scopeThreadShell(environmentId, v2ThreadShell);
  const earlier = maria.earlierThreadIds[0]!;
  const primary = { ...base, id: maria.primaryThreadId, title: "Maria", updatedAt: earlierAt };
  const oldChild = {
    ...base,
    id: ThreadId.make("old-child"),
    title: "Release check",
    updatedAt: laterAt,
    hasPendingApprovals: true,
    lineage: {
      rootThreadId: earlier,
      parentThreadId: earlier,
      relationshipToParent: "subagent" as const,
    },
  };
  const environments = [{ environmentId, captains: [maria] }];
  const shells = [primary, oldChild];

  expect(captainInboxItems(environments, shells)).toEqual([
    {
      kind: "approval",
      environmentId,
      captainId: maria.id,
      threadRef: { environmentId, threadId: oldChild.id },
      title: "Release check",
      isChild: true,
      updatedAt: laterAt,
    },
  ]);
  expect(captainAttentionTotal(environments, shells)).toBe(1);
  const activity = captainThreadActivity(environmentId, maria, shells);
  expect(activity.children.map((thread) => thread.id)).toEqual([oldChild.id]);
  expect(activity.attention).toBe(1);
});

it("lists shell tasks from every Captain conversation and projection tasks whose shells are not loaded", () => {
  const base = scopeThreadShell(environmentId, v2ThreadShell);
  const currentChild = {
    ...base,
    id: ThreadId.make("current-child"),
    archivedAt: null,
    deletedAt: null,
    lineage: {
      rootThreadId: maria.primaryThreadId,
      parentThreadId: maria.primaryThreadId,
      relationshipToParent: "subagent" as const,
    },
  };
  const earlierChild = {
    ...currentChild,
    id: ThreadId.make("earlier-child"),
    lineage: {
      rootThreadId: maria.earlierThreadIds[0]!,
      parentThreadId: maria.earlierThreadIds[0]!,
      relationshipToParent: "subagent" as const,
    },
  };
  const unrelated = {
    ...currentChild,
    id: ThreadId.make("unrelated"),
    lineage: {
      rootThreadId: v2ThreadShell.id,
      parentThreadId: v2ThreadShell.id,
      relationshipToParent: "subagent" as const,
    },
  };
  const enriched = {
    ...task("enriched", "completed", laterAt),
    threadId: maria.primaryThreadId,
    childThreadId: currentChild.id,
  } as OrchestrationV2Subagent;
  const missingShell = {
    ...task("missing-shell", "running", null),
    threadId: maria.primaryThreadId,
    childThreadId: ThreadId.make("missing-child"),
  } as OrchestrationV2Subagent;
  const rows = captainDelegatedLocalTasks({
    environmentId,
    captain: maria,
    shells: [currentChild, earlierChild, unrelated],
    subagents: [enriched, missingShell],
  });

  expect(rows).toEqual([
    { thread: currentChild, subagent: enriched },
    { thread: earlierChild, subagent: null },
    { thread: null, subagent: missingShell },
  ]);
});

it("keeps tasks targeting both current and earlier Captain conversations", () => {
  const scheduledTask = (id: string, threadId: ThreadId | null): ScheduledTask => ({
    id: ScheduledTaskId.make(id),
    title: id,
    prompt: "Prepare a brief",
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "08:00" },
    projectId: v2ThreadShell.projectId,
    threadId,
    workspaceStrategy: { type: "root" },
    modelSelection: v2ThreadShell.modelSelection,
    runtimeMode: v2ThreadShell.runtimeMode,
    interactionMode: v2ThreadShell.interactionMode,
    createdBy: "user",
    creationSource: "web",
    createdAt: earlierAt,
    updatedAt: earlierAt,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
  });
  const current = scheduledTask("current", maria.primaryThreadId);
  const earlier = scheduledTask("earlier", maria.earlierThreadIds[0]!);
  expect(
    captainScheduledTasks(
      [
        current,
        scheduledTask("elsewhere", v2ThreadShell.id),
        scheduledTask("unbound", null),
        earlier,
      ],
      maria,
    ),
  ).toEqual([current, earlier]);
});

it("finds a named document belonging to the selected Captain", () => {
  const digest = {
    captainId: maria.id,
    name: "DIGEST.md",
    content: "Today's brief",
    revision: 1,
    updatedAt: earlierAt,
  } as const;
  const snapshot: CaptainSnapshot = {
    captains: [],
    documents: [
      { ...digest, captainId: CaptainId.make("other") },
      { ...digest, name: "NOTES.md" },
      digest,
    ],
    memories: [],
  };
  expect(captainDocument(snapshot, maria.id, "DIGEST.md")).toBe(digest);
  expect(captainDocument(snapshot, maria.id, "CREW.md")).toBeUndefined();
  expect(captainDocument(null, maria.id, "DIGEST.md")).toBeUndefined();
});
