/* oxlint-disable t3code/no-styled-raw-controls, shadcn/no-arbitrary-values, t3code/no-raw-type-classes, t3code/no-dot-separated-text, t3code/no-outset-state-indicators -- Duet drawer tabs and task rows are semantic custom rows with exact channel geometry, not shared button controls. */
import { useAtom } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { captainForThread, captainScheduledTasks } from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type OrchestrationV2Subagent,
  type ProjectId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { T, useGT, useMessages } from "gt-react";
import { CalendarClockIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useLayoutPane } from "../../layout/layoutPaneContext";
import { cn } from "../../lib/utils";
import { newMessageId } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import {
  useChildThreadInputs,
  useProjects,
  useQuietThreadProjection,
  useQuietThreadShell,
} from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { usePanelTabSlots } from "../PanelTabBreadcrumb";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import {
  CaptainDigest,
  CaptainMorningBriefControl,
  captainMorningBriefTask,
} from "./CaptainDigest";
import { CaptainDocuments } from "./CaptainDocuments";
import { CaptainEarlierConversations } from "./CaptainEarlierConversations";
import { CaptainMemories } from "./CaptainMemories";
import { CaptainTaskRing, useCaptainTaskStatusLabel } from "./CaptainTaskRing";
import {
  captainSubagentTaskStatus,
  captainTaskIsRecent,
  captainThreadTaskStatus,
  compareCaptainTasks,
  type CaptainTaskStatus,
} from "./captainTaskStatus.logic";
import { captainDrawerTabAtom } from "./captainBriefTab";
import { useCaptains } from "./useCaptain";
import { useClientSettings } from "../../hooks/useSettings";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { formatRelativeElapsed } from "../../timestampFormat";

const DAY_MS = 24 * 60 * 60_000;

const statusColor: Record<CaptainTaskStatus, string> = {
  "needs-input": "#9f7832",
  working: "#d97757",
  ready: "#1e7d2c",
  failed: "var(--destructive-foreground)",
  stopped: "#838383",
  scheduled: "#838383",
  done: "#838383",
  unknown: "#838383",
};

function compactElapsed(
  isoDate: string,
  nowMs: number,
  resolve: ReturnType<typeof useMessages>,
): string {
  const elapsed = Math.max(0, nowMs - Date.parse(isoDate));
  return formatRelativeElapsed(elapsed, resolve).value;
}

function taskDiffTotals(threadRef: ScopedThreadRef) {
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const shell = useQuietThreadShell(threadRef);
  const runId = shell?.latestRun?.runId ?? null;
  if (!projection || runId === null) return null;
  let additions = 0;
  let deletions = 0;
  let count = 0;
  for (const checkpoint of projection.checkpoints) {
    if (checkpoint.runId !== runId || checkpoint.status !== "ready") continue;
    additions +=
      checkpoint.filesTotal?.additions ??
      checkpoint.files.reduce((sum, file) => sum + file.additions, 0);
    deletions +=
      checkpoint.filesTotal?.deletions ??
      checkpoint.files.reduce((sum, file) => sum + file.deletions, 0);
    count += checkpoint.filesTotal?.count ?? checkpoint.files.length;
  }
  return count === 0 ? null : { count, additions, deletions };
}

function TaskCardLayout({
  status,
  title,
  elapsed,
  detail,
  meta,
  onOpen,
}: {
  readonly status: CaptainTaskStatus;
  readonly title: string;
  readonly elapsed: string;
  readonly detail: string | null;
  readonly meta?: ReactNode;
  readonly onOpen: () => void;
}) {
  const statusLabel = useCaptainTaskStatusLabel(status);
  return (
    <li className="relative">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-col rounded-lg px-1 py-1 text-left outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/[0.045]"
        onClick={onOpen}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CaptainTaskRing status={status} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[18px] text-foreground">
            {title}
          </span>
          <span className="shrink-0 text-[12px] leading-4 text-(--duet-meta)">{elapsed}</span>
        </span>
        <span className="mt-0.5 block pl-5.5 text-[12.5px] leading-4.5">
          <span
            className={status === "needs-input" ? "text-(--duet-needs-input)" : undefined}
            style={status === "needs-input" ? undefined : { color: statusColor[status] }}
          >
            {statusLabel}
          </span>
          {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
        </span>
        {meta ? (
          <span className="relative mt-2 block pl-5.5">
            <span
              aria-hidden
              className="absolute top-[-8px] left-[7px] h-4 w-px bg-[#e5e5e5] dark:bg-[#333]"
            />
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-(--duet-hairline) px-2.5 py-2 text-[12px] text-muted-foreground">
              {meta}
            </span>
          </span>
        ) : null}
      </button>
    </li>
  );
}

function LocalTaskCard({
  parent,
  thread,
  projectTitle,
  nowMs,
}: {
  readonly parent: ScopedThreadRef;
  readonly thread: EnvironmentThreadShell;
  readonly projectTitle: string | undefined;
  readonly nowMs: number;
}) {
  const messages = useMessages();
  const childRef = scopeThreadRef(parent.environmentId, thread.id);
  const diff = taskDiffTotals(childRef);
  const status = captainThreadTaskStatus(thread);
  const pullRequest =
    thread.pullRequests[0] ?? thread.linkedPullRequest ?? thread.branchPullRequest ?? null;
  const detail = thread.runtime?.lastError ?? thread.branch ?? thread.latestRun?.status ?? null;
  return (
    <TaskCardLayout
      status={status}
      title={thread.title}
      elapsed={compactElapsed(thread.updatedAt, nowMs, messages)}
      detail={detail}
      onOpen={() => useRightPanelStore.getState().openThread(parent, thread.id)}
      meta={
        projectTitle || thread.branch || pullRequest || diff ? (
          <>
            {projectTitle ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex size-4 items-center justify-center rounded-sm bg-(--duet-row-active) text-[9px] font-semibold text-foreground">
                  {projectTitle.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{projectTitle}</span>
              </span>
            ) : null}
            {thread.branch ? <span className="truncate">{thread.branch}</span> : null}
            {pullRequest ? (
              <span className="rounded-sm border border-(--duet-hairline) px-1 py-0.5 text-[11px]">
                #{pullRequest.number}
              </span>
            ) : null}
            {diff ? (
              <span className="tabular-nums">
                <span className="text-diff-addition-foreground">+{diff.additions}</span>{" "}
                <span className="text-diff-deletion-foreground">−{diff.deletions}</span>
              </span>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}

function RemoteTaskCard({
  parent,
  task,
  nowMs,
}: {
  readonly parent: ScopedThreadRef;
  readonly task: OrchestrationV2Subagent;
  readonly nowMs: number;
}) {
  const messages = useMessages();
  const child = task.remoteChild;
  if (!child) return null;
  const title = task.title ?? child.title ?? child.label;
  const detail = task.progress ?? task.result?.trim().split("\n", 1)[0] ?? child.label;
  return (
    <TaskCardLayout
      status={captainSubagentTaskStatus(task)}
      title={title}
      elapsed={compactElapsed(
        new Date(DateTime.toEpochMillis(task.updatedAt)).toISOString(),
        nowMs,
        messages,
      )}
      detail={detail}
      onOpen={() =>
        useRightPanelStore.getState().openLinkedThread(parent, {
          viaEnvironmentId: parent.environmentId,
          environmentId: child.environmentId,
          threadId: child.threadId,
          label: child.label,
          title,
        })
      }
    />
  );
}

function sortedCrewThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  recentCutoff: number | null,
) {
  return threads
    .map((thread) => ({
      thread,
      status: captainThreadTaskStatus(thread),
      updatedAtMs: Date.parse(thread.updatedAt),
    }))
    .filter(
      ({ status, updatedAtMs }) =>
        recentCutoff === null || captainTaskIsRecent(status, updatedAtMs, recentCutoff),
    )
    .sort(compareCaptainTasks)
    .map(({ thread }) => thread);
}

/** Tasks delegated before a reset stay with the Captain, listed under their own heading. */
function EarlierConversationTasks({
  parent,
  conversation,
  cutoff,
  projectTitles,
  nowMs,
}: {
  readonly parent: ScopedThreadRef;
  readonly conversation: ScopedThreadRef;
  readonly cutoff: number | null;
  readonly projectTitles: ReadonlyMap<ProjectId, string>;
  readonly nowMs: number;
}) {
  const threads = sortedCrewThreads(
    useChildThreadInputs(conversation).filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.lineage.relationshipToParent === "subagent" &&
        thread.lineage.parentThreadId === conversation.threadId,
    ),
    cutoff,
  );
  if (threads.length === 0) return null;
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[12px] text-(--duet-meta)">
        <T>From an earlier conversation</T>
      </h3>
      <ul className="flex flex-col gap-[18px]">
        {threads.map((thread) => (
          <LocalTaskCard
            key={thread.id}
            parent={parent}
            thread={thread}
            projectTitle={projectTitles.get(thread.projectId)}
            nowMs={nowMs}
          />
        ))}
      </ul>
    </section>
  );
}

function DrawerEmpty({ children }: { readonly children: ReactNode }) {
  return <p className="py-2 text-left text-[13px] text-muted-foreground">{children}</p>;
}

/** The right-side Duet task drawer for one Captain channel. */
export function CaptainTasksDrawer({
  threadRef,
  onClose,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const panelTabSlots = usePanelTabSlots();
  const hideDrawerHeader = panelTabSlots?.showPanelTabs === true;
  const addSurfaceButton = hideDrawerHeader ? null : (panelTabSlots?.addSurfaceButton ?? null);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [tab, setTab] = useAtom(captainDrawerTabAtom(threadRef));
  const captains = useCaptains(threadRef.environmentId);
  const captain = captainForThread(captains.data, threadRef.threadId);
  const details = useCaptains(threadRef.environmentId, captain?.id);
  const parentShell = useQuietThreadShell(threadRef);
  const children = useChildThreadInputs(threadRef).filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.lineage.relationshipToParent === "subagent" &&
      thread.lineage.parentThreadId === threadRef.threadId,
  );
  const projects = useProjects();
  const projectTitles = new Map<ProjectId, string>(
    projects
      .filter((project) => project.environmentId === threadRef.environmentId)
      .map((project) => [project.id, project.title]),
  );
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const delegated = (projection?.subagents ?? []).filter(
    (task) => task.origin === "app_owned" && task.remoteChild !== undefined,
  );
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: threadRef.environmentId, input: {} }),
    messages,
  );
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}Z`);
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const [taskText, setTaskText] = useState("");
  if (captain === undefined) {
    return (
      <div className="flex h-full flex-col bg-background dark:bg-[#1f1f1f]">
        {hideDrawerHeader ? null : (
          <DrawerHeader title={gt("Tasks")} onClose={onClose} addSurfaceButton={addSurfaceButton} />
        )}
        <DrawerEmpty>
          {captains.isPending ? (
            <T>Loading Captain…</T>
          ) : (
            <T>This conversation has no Captain profile.</T>
          )}
        </DrawerEmpty>
      </div>
    );
  }

  const cutoff = nowMs - DAY_MS;
  const recent = tab === "today";
  const visibleChildren = sortedCrewThreads(children, recent ? cutoff : null);
  const visibleRemote = delegated
    .map((task) => ({
      task,
      status: captainSubagentTaskStatus(task),
      updatedAtMs: DateTime.toEpochMillis(task.updatedAt),
    }))
    .filter(
      ({ status, updatedAtMs }) => !recent || captainTaskIsRecent(status, updatedAtMs, cutoff),
    )
    .sort(compareCaptainTasks)
    .map(({ task }) => task);
  const scheduled = captainScheduledTasks(tasksQuery.data?.tasks ?? [], captain);
  const openThread = (threadId: ThreadId) =>
    useRightPanelStore.getState().openThread(threadRef, threadId);
  const addTask = async () => {
    const text = taskText.trim();
    if (text === "" || parentShell === null) return;
    const result = await startThreadTurn({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: parentShell.runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        dispatchMode: "queue",
        createdAt: new Date().toISOString(),
      },
    });
    if (result._tag === "Success") setTaskText("");
    else toastManager.add({ type: "error", title: gt("Could not add the task.") });
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background dark:bg-[#1f1f1f]"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {hideDrawerHeader ? null : (
        <DrawerHeader
          title={gt("Tasks in #{channel}", { channel: captain.name })}
          onClose={onClose}
          addSurfaceButton={addSurfaceButton}
        />
      )}
      <div
        role="tablist"
        aria-label={gt("Captain task views")}
        className={cn(
          "flex h-[26px] shrink-0 items-center gap-0.5 px-4",
          hideDrawerHeader ? "mt-3" : "mt-1",
        )}
      >
        {(["today", "all", "scheduled", "docs"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={cn(
              "h-[26px] cursor-pointer rounded-[6px] px-2 text-[13px] leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === entry
                ? "bg-[#e5e5e5] font-medium text-foreground dark:bg-[#333333]"
                : "text-[#555555] hover:text-foreground dark:text-[#a3a3a3]",
            )}
            onClick={() => setTab(entry)}
          >
            {entry === "today"
              ? gt("Recent", { $context: "Captain tasks drawer tab" })
              : entry === "all"
                ? gt("All", { $context: "Captain tasks drawer tab" })
                : entry === "scheduled"
                  ? gt("Scheduled", { $context: "Captain tasks drawer tab" })
                  : gt("Docs", { $context: "Captain tasks drawer tab" })}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        {tab === "today" || tab === "all" ? (
          visibleChildren.length + visibleRemote.length === 0 &&
          (captain?.earlierThreadIds.length ?? 0) === 0 ? (
            <DrawerEmpty>
              {tab === "today" ? <T>No recent tasks.</T> : <T>No delegated tasks yet.</T>}
            </DrawerEmpty>
          ) : (
            <ul className="flex flex-col gap-[18px]">
              {visibleChildren.map((thread) => (
                <LocalTaskCard
                  key={thread.id}
                  parent={threadRef}
                  thread={thread}
                  projectTitle={projectTitles.get(thread.projectId)}
                  nowMs={nowMs}
                />
              ))}
              {visibleRemote.map((task) => (
                <RemoteTaskCard key={task.id} parent={threadRef} task={task} nowMs={nowMs} />
              ))}
            </ul>
          )
        ) : null}
        {(tab === "today" || tab === "all") && captain
          ? captain.earlierThreadIds.map((threadId) => (
              <EarlierConversationTasks
                key={threadId}
                parent={threadRef}
                conversation={scopeThreadRef(threadRef.environmentId, threadId)}
                cutoff={recent ? cutoff : null}
                projectTitles={projectTitles}
                nowMs={nowMs}
              />
            ))
          : null}
        {tab === "scheduled" ? (
          <div className="flex flex-col gap-4">
            <div className="flex justify-end">
              <CaptainMorningBriefControl
                captain={captain}
                environmentId={threadRef.environmentId}
                thread={parentShell ?? undefined}
                task={captainMorningBriefTask(tasksQuery.data?.tasks ?? [], captain)}
              />
            </div>
            {scheduled.length === 0 ? (
              <DrawerEmpty>
                <T>No scheduled tasks.</T>
              </DrawerEmpty>
            ) : (
              <ul className="flex flex-col gap-3">
                {scheduled.map((task) => (
                  <li key={task.id} className="flex min-w-0 items-center gap-2 px-1 py-1">
                    <CaptainTaskRing status="scheduled" />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                      {task.title}
                    </span>
                    <CalendarClockIcon aria-hidden className="size-3.5 text-muted-foreground" />
                    <span className="text-[12px] text-muted-foreground">
                      {task.enabled
                        ? scheduleLabel(
                            task.schedule,
                            timestampFormat,
                            undefined,
                            task.nextRunAt,
                            messages,
                          )
                        : gt("Paused")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {tab === "docs" ? (
          details.data === null ? (
            <DrawerEmpty>{details.error ?? <T>Loading Captain…</T>}</DrawerEmpty>
          ) : (
            <div className="flex flex-col gap-6 pb-4">
              <CaptainDigest
                document={details.data.documents.find(
                  (document) => document.captainId === captain.id && document.name === "DIGEST.md",
                )}
                environmentId={threadRef.environmentId}
                loading={details.data === null}
              />
              <CaptainDocuments
                captain={captain}
                environmentId={threadRef.environmentId}
                documents={details.data.documents}
                refresh={details.refresh}
              />
              <CaptainMemories
                captainId={captain.id}
                environmentId={threadRef.environmentId}
                memories={details.data.memories}
              />
              <CaptainEarlierConversations
                captain={captain}
                environmentId={threadRef.environmentId}
                onOpen={openThread}
              />
            </div>
          )
        ) : null}
      </div>
      <div className="shrink-0 p-3">
        <input
          value={taskText}
          aria-label={gt("Add a task...")}
          placeholder={gt("Add a task...")}
          className="h-9 w-full rounded-full border border-transparent bg-[#f9f9f9] px-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-[#e0e0e0] dark:bg-[#262626]"
          onChange={(event) => setTaskText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void addTask();
            }
          }}
        />
      </div>
    </div>
  );
}

function DrawerHeader({
  title,
  onClose,
  addSurfaceButton,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly addSurfaceButton?: ReactNode;
}) {
  const gt = useGT();
  const { trailingEdge } = useLayoutPane();
  return (
    <div
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center justify-between gap-2 px-4",
        isElectron && "drag-region",
        isElectron && trailingEdge && "wco:pr-(--workspace-native-controls-inset)",
      )}
    >
      <h2 className="min-w-0 truncate text-[13px] font-medium text-foreground">{title}</h2>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        {addSurfaceButton}
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-7"
          aria-label={gt("Close tasks")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}
