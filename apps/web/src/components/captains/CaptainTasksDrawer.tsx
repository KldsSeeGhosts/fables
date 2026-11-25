/* oxlint-disable t3code/no-styled-raw-controls, shadcn/no-arbitrary-values, t3code/no-raw-type-classes, t3code/no-dot-separated-text, t3code/no-outset-state-indicators -- Duet drawer tabs and task rows are semantic custom rows with exact channel geometry, not shared button controls. */
import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  captainDelegatedLocalTasks,
  captainForThread,
  captainScheduledTasks,
  type CaptainDelegatedLocalTask,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ScheduledTask,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import {
  CalendarClockIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { requestConfirmDialog } from "../../confirmDialog";
import { useDuetShell } from "../../hooks/useDuetShell";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useLayoutPane } from "../../layout/layoutPaneContext";
import { cn } from "../../lib/utils";
import { newMessageId } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import {
  useProjects,
  useQuietThreadProjection,
  useQuietThreadShell,
  useQuietThreadShells,
} from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment, threadFamilies } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { formatRelativeElapsed } from "../../timestampFormat";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { usePanelTabSlots } from "../PanelTabBreadcrumb";
import { ProjectFavicon } from "../ProjectFavicon";
import { WorkingStatusShine } from "../WorkingStatusShine";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { CaptainMorningBriefControl, captainMorningBriefTask } from "./CaptainDigest";
import { CaptainTaskPreview, type CaptainTaskPreviewProps } from "./CaptainTaskPreview";
import { CaptainTaskRing, useCaptainTaskStatusLabel } from "./CaptainTaskRing";
import {
  captainLocalTaskStatus,
  captainSubagentTaskStatus,
  captainTaskActivityMs,
  captainTaskDetail,
  captainTaskIsRecent,
  compareCaptainTasks,
  type CaptainTaskStatus,
} from "./captainTaskStatus.logic";
import { captainDrawerTabAtom } from "./captainBriefTab";
import { useCaptains } from "./useCaptain";
import { useClientSettings } from "../../hooks/useSettings";
import { DEFAULT_INTERACTION_MODE } from "../../types";

const DAY_MS = 24 * 60 * 60_000;

const statusColor: Record<CaptainTaskStatus, string> = {
  "needs-input": "var(--duet-needs-input-text, #9f7832)",
  working: "var(--duet-working-text, #d97757)",
  ready: "var(--duet-ready, #1e7d2c)",
  failed: "var(--destructive-foreground)",
  stopped: "var(--duet-meta, #838383)",
  scheduled: "var(--duet-meta, #838383)",
  done: "var(--duet-meta, #838383)",
  unknown: "var(--duet-meta, #838383)",
};

function compactElapsed(
  timestampMs: number,
  nowMs: number,
  resolve: ReturnType<typeof useMessages>,
): string {
  return formatRelativeElapsed(Math.max(0, nowMs - timestampMs), resolve).value;
}

interface BaseTaskRow {
  readonly key: string;
  readonly status: CaptainTaskStatus;
  readonly updatedAtMs: number;
  readonly activityAtMs: number;
  readonly title: string | null;
  readonly detail: string | null;
}

interface LocalTaskRow extends BaseTaskRow {
  readonly kind: "local";
  readonly thread: EnvironmentThreadShell | null;
  readonly subagent: OrchestrationV2Subagent | null;
}

interface RemoteTaskRow extends BaseTaskRow {
  readonly kind: "remote";
  readonly task: OrchestrationV2Subagent;
}

type TaskRow = LocalTaskRow | RemoteTaskRow;

function localTaskRow(entry: CaptainDelegatedLocalTask): LocalTaskRow | null {
  const { thread, subagent } = entry;
  if (thread === null && subagent === null) return null;
  const status = captainLocalTaskStatus(thread, subagent);
  const activityAtMs = captainTaskActivityMs({ status, thread, subagent });
  return {
    kind: "local",
    key: thread?.id ?? subagent?.childThreadId ?? subagent?.id ?? "unknown",
    thread,
    subagent,
    status,
    updatedAtMs: activityAtMs,
    activityAtMs,
    title: subagent?.title ?? thread?.title ?? null,
    detail: captainTaskDetail({ status, thread, subagent }),
  };
}

function remoteTaskRow(task: OrchestrationV2Subagent): RemoteTaskRow {
  const status = captainSubagentTaskStatus(task);
  const activityAtMs = captainTaskActivityMs({ status, subagent: task });
  return {
    kind: "remote",
    key: task.id,
    task,
    status,
    updatedAtMs: activityAtMs,
    activityAtMs,
    title: task.title ?? task.remoteChild?.title ?? task.remoteChild?.label ?? null,
    detail: captainTaskDetail({ status, subagent: task }) ?? task.remoteChild?.label ?? null,
  };
}

function visibleTaskRows(rows: ReadonlyArray<TaskRow>, cutoff: number | null) {
  return rows
    .filter(
      ({ status, updatedAtMs }) =>
        cutoff === null || captainTaskIsRecent(status, updatedAtMs, cutoff),
    )
    .sort(compareCaptainTasks);
}

function dayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function ProjectMeta({
  project,
}: {
  readonly project: { title: string } & Parameters<typeof ProjectFavicon>[0]["project"];
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ProjectFavicon project={project} className="size-4" />
      <span className="truncate">{project.title}</span>
    </span>
  );
}

function TaskCardLayout({
  status,
  title,
  elapsed,
  detail,
  preview,
  meta,
  onOpen,
}: {
  readonly status: CaptainTaskStatus;
  readonly title: string;
  readonly elapsed: string;
  readonly detail: string | null;
  readonly preview?: CaptainTaskPreviewProps | undefined;
  readonly meta?: ReactNode;
  readonly onOpen: () => void;
}) {
  const statusLabel = useCaptainTaskStatusLabel(status);
  return (
    <li className="relative">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-col rounded-lg px-1 py-1 text-left outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/[0.045] duet:rounded-md"
        onClick={onOpen}
      >
        <span className="flex min-w-0 items-center gap-2 duet:gap-2.5">
          <CaptainTaskRing status={status} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[18px] text-foreground duet:text-[14px]">
            {title}
          </span>
          <span className="shrink-0 text-[12px] leading-4 text-(--duet-meta)">{elapsed}</span>
        </span>
        <span className="mt-0.5 block truncate pl-5.5 text-[12.5px] leading-4.5 duet:pl-[26px]">
          <span style={{ color: statusColor[status] }}>
            {status === "working" ? (
              <WorkingStatusShine>{statusLabel}</WorkingStatusShine>
            ) : (
              statusLabel
            )}
          </span>
          {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
        </span>
        {preview ? <CaptainTaskPreview {...preview} /> : null}
        {meta ? (
          <span className="relative mt-2 block pl-5.5 duet:pl-[26px]">
            <span
              aria-hidden
              className="absolute top-[-9px] left-[7px] hidden h-4 w-3 rounded-bl-md border-b border-l border-(--duet-hairline) duet:block"
            />
            <span
              aria-hidden
              className="absolute top-[-8px] left-[7px] h-4 w-px bg-[#e5e5e5] dark:bg-[#333] duet:hidden"
            />
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-(--duet-hairline) px-2.5 py-1.5 text-[12px] text-muted-foreground duet:py-2">
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
  row,
  project,
  nowMs,
}: {
  readonly parent: ScopedThreadRef;
  readonly row: LocalTaskRow;
  readonly project: Parameters<typeof ProjectMeta>[0]["project"] | undefined;
  readonly nowMs: number;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { thread } = row;
  const childThreadId = thread?.id ?? row.subagent?.childThreadId ?? null;
  const pullRequest =
    thread?.pullRequests[0] ?? thread?.linkedPullRequest ?? thread?.branchPullRequest ?? null;
  const snapshot = pullRequest && "snapshot" in pullRequest ? pullRequest.snapshot : null;
  const diff =
    snapshot?.additions !== undefined && snapshot.deletions !== undefined
      ? { additions: snapshot.additions, deletions: snapshot.deletions }
      : null;
  const resultPreview =
    row.status === "ready" ||
    row.status === "done" ||
    row.status === "failed" ||
    row.status === "stopped"
      ? row.subagent?.result
      : null;
  if (childThreadId === null) return null;
  return (
    <TaskCardLayout
      status={row.status}
      title={row.title ?? gt("Subagent")}
      elapsed={compactElapsed(row.activityAtMs, nowMs, messages)}
      detail={row.detail}
      preview={
        resultPreview
          ? {
              environmentId: thread?.environmentId ?? parent.environmentId,
              threadId: childThreadId,
              workspaceRoot: thread?.worktreePath,
              result: resultPreview,
            }
          : undefined
      }
      onOpen={() => useRightPanelStore.getState().openThread(parent, childThreadId)}
      meta={
        project || thread?.branch || pullRequest || diff ? (
          <>
            {project ? <ProjectMeta project={project} /> : null}
            {thread?.branch ? <span className="truncate">{thread.branch}</span> : null}
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
  row,
  nowMs,
}: {
  readonly parent: ScopedThreadRef;
  readonly row: RemoteTaskRow;
  readonly nowMs: number;
}) {
  const gt = useGT();
  const messages = useMessages();
  const child = row.task.remoteChild;
  if (!child) return null;
  const title = row.title ?? gt("Subagent");
  return (
    <TaskCardLayout
      status={row.status}
      title={title}
      elapsed={compactElapsed(row.activityAtMs, nowMs, messages)}
      detail={row.detail}
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

function DrawerEmpty({ children }: { readonly children: ReactNode }) {
  return <p className="py-2 text-left text-[13px] text-muted-foreground">{children}</p>;
}

function ScheduledRoutineRow({
  environmentId,
  task,
  timestampFormat,
  archived,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly timestampFormat: Parameters<typeof scheduleLabel>[1];
  readonly archived: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  const canRun = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const canSetEnabled = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const canEdit = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const canDelete = useAtomValue(
    serverEnvironment.deleteScheduledTask.permissionAtom(environmentId),
  );
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const deleteTask = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    reportFailure: false,
  });
  const [pendingAction, setPendingAction] = useState<"run" | "toggle" | "delete" | null>(null);

  const act = async (action: "run" | "toggle" | "delete") => {
    if (pendingAction !== null) return;
    if (action === "delete") {
      const message = `${gt('Delete "{title}"?', { title: task.title })}\n${gt("This cannot be undone.")}`;
      const confirmed =
        (await requestConfirmDialog(message, { variant: "destructive" })) ??
        window.confirm(message);
      if (!confirmed) return;
    }
    setPendingAction(action);
    const result =
      action === "run"
        ? await runNow({ environmentId, input: { id: task.id } })
        : action === "toggle"
          ? await setEnabled({ environmentId, input: { id: task.id, enabled: !task.enabled } })
          : await deleteTask({ environmentId, input: { id: task.id } });
    setPendingAction(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title:
          action === "run"
            ? gt("Could not run the routine.")
            : action === "toggle"
              ? gt("Could not update the routine.")
              : gt("Could not delete the routine."),
        description: String(squashAtomCommandFailure(result)),
      });
    }
  };

  const pending = pendingAction !== null;
  return (
    <li className="flex min-w-0 items-center gap-2 px-1 py-1">
      <CaptainTaskRing status="scheduled" />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{task.title}</span>
      <CalendarClockIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-[12px] text-muted-foreground">
        {task.enabled
          ? scheduleLabel(task.schedule, timestampFormat, undefined, task.nextRunAt, messages)
          : gt("Paused")}
      </span>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={pending}
              aria-label={gt("Actions for {title}", { title: task.title })}
            />
          }
        >
          <MoreHorizontalIcon aria-hidden />
        </MenuTrigger>
        <MenuPopup align="end">
          {task.schedule.type === "webhook" ? null : (
            <MenuItem disabled={!canRun || archived || pending} onClick={() => void act("run")}>
              <PlayIcon aria-hidden />
              <T>Run now</T>
            </MenuItem>
          )}
          <MenuItem disabled={!canSetEnabled || pending} onClick={() => void act("toggle")}>
            {task.enabled ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
            {task.enabled ? <T>Pause</T> : <T>Resume</T>}
          </MenuItem>
          <MenuItem
            disabled={!canEdit || pending}
            onClick={() =>
              void navigate({
                to: "/settings/scheduled-tasks",
                search: { environmentId, taskId: task.id },
              })
            }
          >
            <PencilIcon aria-hidden />
            <T>Edit</T>
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            disabled={!canDelete || pending}
            onClick={() => void act("delete")}
          >
            <Trash2Icon aria-hidden />
            <T>Delete</T>
          </MenuItem>
        </MenuPopup>
      </Menu>
    </li>
  );
}

function TaskRowCard({
  parent,
  row,
  project,
  nowMs,
}: {
  readonly parent: ScopedThreadRef;
  readonly row: TaskRow;
  readonly project: Parameters<typeof ProjectMeta>[0]["project"] | undefined;
  readonly nowMs: number;
}) {
  return row.kind === "local" ? (
    <LocalTaskCard parent={parent} row={row} project={project} nowMs={nowMs} />
  ) : (
    <RemoteTaskCard parent={parent} row={row} nowMs={nowMs} />
  );
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
  const isDuet = useDuetShell();
  const messages = useMessages();
  const navigate = useNavigate();
  const panelTabSlots = usePanelTabSlots();
  const hideDrawerHeader = panelTabSlots?.showPanelTabs === true;
  const addSurfaceButton = hideDrawerHeader ? null : (panelTabSlots?.addSurfaceButton ?? null);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const canCreateRoutine = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(threadRef.environmentId),
  );
  const [tab, setTab] = useAtom(captainDrawerTabAtom(threadRef));
  const captains = useCaptains(threadRef.environmentId);
  const captain = captainForThread(captains.data, threadRef.threadId);

  // Joined so a Captain snapshot refresh with the same conversations keeps the mounts.
  const conversationIds =
    captain === undefined ? "" : [captain.primaryThreadId, ...captain.earlierThreadIds].join("\n");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds each Captain conversation's family rows in shell state while the drawer is open
  useEffect(() => {
    if (conversationIds === "") return;
    const releases = conversationIds
      .split("\n")
      .map((threadId) =>
        threadFamilies.mount(appAtomRegistry, threadRef.environmentId, ThreadId.make(threadId)),
      );
    return () => {
      for (const release of releases) release();
    };
  }, [conversationIds, threadRef.environmentId]);

  const parentShell = useQuietThreadShell(threadRef);
  const shells = useQuietThreadShells();
  const projects = useProjects();
  const projectsById = new Map(
    projects
      .filter((project) => project.environmentId === threadRef.environmentId)
      .map((project) => [project.id, project] as const),
  );
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const delegated = (projection?.subagents ?? []).filter((task) => task.origin === "app_owned");
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
  const [addingTask, setAddingTask] = useState(false);
  const [groupExpansion, setGroupExpansion] = useState<Readonly<Record<string, boolean>>>({});
  if (captain === undefined) {
    return (
      <div className="flex h-full flex-col bg-background dark:bg-[#1f1f1f]">
        {hideDrawerHeader ? null : (
          <DrawerHeader title={gt("Tasks")} onClose={onClose} addSurfaceButton={addSurfaceButton} />
        )}
        <DrawerEmpty>
          {captains.data == null && captains.error === null ? (
            isDuet ? (
              <T>Loading Duet…</T>
            ) : (
              <T>Loading Captain…</T>
            )
          ) : isDuet ? (
            <T>This conversation has no Duet profile.</T>
          ) : (
            <T>This conversation has no Captain profile.</T>
          )}
        </DrawerEmpty>
      </div>
    );
  }

  const cutoff = nowMs - DAY_MS;
  const rows: TaskRow[] = [
    ...captainDelegatedLocalTasks({
      environmentId: threadRef.environmentId,
      captain,
      shells,
      subagents: delegated,
    }).flatMap((entry) => {
      const row = localTaskRow(entry);
      return row === null ? [] : [row];
    }),
    ...delegated.filter((task) => task.remoteChild !== undefined).map(remoteTaskRow),
  ];
  const recent = tab === "today";
  const visibleRows = visibleTaskRows(rows, recent ? cutoff : null);
  const morningBrief = captainMorningBriefTask(tasksQuery.data?.tasks ?? [], captain);
  const scheduled = captainScheduledTasks(tasksQuery.data?.tasks ?? [], captain).filter(
    (task) => task.id !== morningBrief?.id,
  );
  const canAddTask = parentShell !== null && captain.archivedAt === null && !addingTask;
  const addTask = async () => {
    const text = taskText.trim();
    if (text === "" || parentShell === null || !canAddTask) return;
    setAddingTask(true);
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
    setAddingTask(false);
    if (result._tag === "Success") setTaskText("");
    else toastManager.add({ type: "error", title: gt("Could not add the task.") });
  };

  const todayKey = dayKey(nowMs);
  const groups: Array<{ key: string; label: string; rows: TaskRow[] }> = [];
  if (tab === "all") {
    const byDay = new Map<string, TaskRow[]>();
    for (const row of visibleRows) {
      const key = dayKey(row.activityAtMs);
      const existing = byDay.get(key);
      if (existing) existing.push(row);
      else byDay.set(key, [row]);
    }
    for (const [key, groupRows] of byDay) {
      const date = new Date(groupRows[0]?.activityAtMs ?? nowMs);
      const ageDays = Math.floor((startOfDay(nowMs) - startOfDay(rowTime(date))) / DAY_MS);
      const label =
        key === todayKey
          ? gt("Today", { $context: "Captain task group" })
          : ageDays === 1
            ? gt("Yesterday", { $context: "Captain task group" })
            : ageDays < 7
              ? date.toLocaleDateString(undefined, { weekday: "long" })
              : date.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year:
                    date.getFullYear() === new Date(nowMs).getFullYear() ? undefined : "numeric",
                });
      groups.push({ key, label, rows: groupRows });
    }
  }

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
        aria-label={isDuet ? gt("Duet task views") : gt("Captain task views")}
        className={cn(
          "flex h-[26px] shrink-0 items-center gap-0.5 px-4",
          hideDrawerHeader ? "mt-3" : "mt-1",
        )}
      >
        {(["today", "all", "scheduled"] as const).map((entry) => (
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
              ? gt("Today", { $context: "Captain tasks drawer tab" })
              : entry === "all"
                ? gt("All", { $context: "Captain tasks drawer tab" })
                : gt("Scheduled", { $context: "Captain tasks drawer tab" })}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        {tab === "today" ? (
          visibleRows.length === 0 ? (
            <DrawerEmpty>
              <T>No recent tasks.</T>
            </DrawerEmpty>
          ) : (
            <ul className="flex flex-col gap-[18px]">
              {visibleRows.map((row) => (
                <TaskRowCard
                  key={row.key}
                  parent={threadRef}
                  row={row}
                  project={
                    row.kind === "local" && row.thread
                      ? projectsById.get(row.thread.projectId)
                      : undefined
                  }
                  nowMs={nowMs}
                />
              ))}
            </ul>
          )
        ) : null}
        {tab === "all" ? (
          visibleRows.length === 0 ? (
            <DrawerEmpty>
              <T>No delegated tasks yet.</T>
            </DrawerEmpty>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => {
                const expanded = groupExpansion[group.key] ?? group.key === todayKey;
                return (
                  <section key={group.key}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      className="mb-2 flex h-6 cursor-pointer items-center gap-1 rounded-full bg-black/[0.045] px-2 text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:bg-white/[0.055]"
                      onClick={() =>
                        setGroupExpansion((current) => ({
                          ...current,
                          [group.key]: !expanded,
                        }))
                      }
                    >
                      <span>{group.label}</span>
                      <span aria-hidden>·</span>
                      <span>{group.rows.length}</span>
                      <ChevronDownIcon
                        aria-hidden
                        className={cn("size-3 transition-transform", !expanded && "-rotate-90")}
                      />
                    </button>
                    {expanded ? (
                      <ul className="flex flex-col gap-[18px]">
                        {group.rows.map((row) => (
                          <TaskRowCard
                            key={row.key}
                            parent={threadRef}
                            row={row}
                            project={
                              row.kind === "local" && row.thread
                                ? projectsById.get(row.thread.projectId)
                                : undefined
                            }
                            nowMs={nowMs}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )
        ) : null}
        {tab === "scheduled" ? (
          <div className="flex flex-col gap-3">
            {captain.archivedAt !== null ? (
              <DrawerEmpty>
                {isDuet ? (
                  <T>Routines don't run while this Duet is archived.</T>
                ) : (
                  <T>Routines don't run while this Captain is archived.</T>
                )}
              </DrawerEmpty>
            ) : null}
            <CaptainMorningBriefControl
              key={captain.id}
              captain={captain}
              environmentId={threadRef.environmentId}
              thread={parentShell ?? undefined}
              task={morningBrief}
            />
            {scheduled.length === 0 ? (
              <DrawerEmpty>
                <T>No scheduled tasks yet.</T>
              </DrawerEmpty>
            ) : (
              <ul className="flex flex-col gap-3">
                {scheduled.map((task) => (
                  <ScheduledRoutineRow
                    key={task.id}
                    environmentId={threadRef.environmentId}
                    task={task}
                    timestampFormat={timestampFormat}
                    archived={captain.archivedAt !== null}
                  />
                ))}
              </ul>
            )}
            <div className="flex justify-end pt-1">
              <Button
                variant="secondary"
                size="sm"
                disabled={!canCreateRoutine || captain.archivedAt !== null}
                onClick={() =>
                  void navigate({
                    to: "/settings/scheduled-tasks",
                    search: {
                      environmentId: threadRef.environmentId,
                      templateThreadId: captain.primaryThreadId,
                    },
                  })
                }
              >
                <PlusIcon aria-hidden />
                <T>New routine</T>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 p-3">
        <input
          value={taskText}
          disabled={parentShell === null || captain.archivedAt !== null}
          readOnly={addingTask}
          aria-label={gt("Add a task...")}
          placeholder={gt("Add a task...")}
          className="h-9 w-full rounded-full border border-transparent bg-[#f9f9f9] px-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-[#e0e0e0] dark:bg-[#262626] duet:rounded-[10px] duet:bg-black/[0.035] duet:focus:border-transparent duet:focus:ring-1 duet:focus:ring-(--duet-hairline) dark:duet:bg-white/[0.045]"
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

function startOfDay(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function rowTime(date: Date): number {
  return date.getTime();
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
