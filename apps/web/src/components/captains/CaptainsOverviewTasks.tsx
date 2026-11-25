import { captainRecentlyFinishedTasks } from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isOrchestrationV2WorkActive,
  type OrchestrationV2Subagent,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import type { ReactNode } from "react";

import { formatRelativeElapsed } from "../../timestampFormat";
import { useLinkedThreadOpener } from "../../state/linkedThreadView";
import { useQuietThreadProjection } from "../../state/entities";
import { Badge } from "../ui/badge";
import { ContentButton } from "../ui/button";
import { CaptainTaskRing, useCaptainTaskStatusLabel } from "./CaptainTaskRing";
import {
  captainSubagentTaskStatus,
  captainTaskActivityMs,
  captainTaskDetail,
  captainThreadTaskStatus,
  type CaptainTaskStatus,
} from "@t3tools/client-runtime/state/captain-tasks";

const elapsedAt = (epochMs: number, nowMs: number, resolve: ReturnType<typeof useMessages>) =>
  formatRelativeElapsed(Math.max(0, nowMs - epochMs), resolve).value;

function OverviewTaskRow({
  status,
  title,
  captainName,
  elapsed,
  detail,
  disabled = false,
  onOpen,
}: {
  readonly status: CaptainTaskStatus;
  readonly title: string;
  readonly captainName: string;
  readonly elapsed: string;
  readonly detail?: string | null;
  readonly disabled?: boolean;
  readonly onOpen: () => void;
}) {
  const statusLabel = useCaptainTaskStatusLabel(status);
  return (
    <li>
      <ContentButton
        variant="inset-row-multiline"
        data-duet-overview-task-row=""
        disabled={disabled}
        className="min-h-11 items-start"
        onClick={onOpen}
      >
        <CaptainTaskRing status={status} className="mt-1 size-4" />
        <span className="sr-only">{statusLabel}</span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-label text-foreground">{title}</span>
            <Badge size="sm" variant="secondary" className="max-w-28">
              <span className="truncate">{captainName}</span>
            </Badge>
            <span className="shrink-0 text-meta tabular-nums text-muted-foreground">{elapsed}</span>
          </span>
          <span className="mt-0.5 flex min-w-0 gap-2 text-meta text-muted-foreground">
            <span data-duet-task-status={status} className="shrink-0 whitespace-nowrap">
              {statusLabel}
            </span>
            {detail ? <span className="min-w-0 truncate">{detail}</span> : null}
          </span>
        </span>
      </ContentButton>
    </li>
  );
}

function OverviewLocalTaskRow({
  thread,
  captainName,
  nowMs,
  onOpen,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly captainName: string;
  readonly nowMs: number;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const messages = useMessages();
  const status = captainThreadTaskStatus(thread);
  return (
    <OverviewTaskRow
      status={status}
      title={thread.title}
      captainName={captainName}
      elapsed={elapsedAt(captainTaskActivityMs({ status, thread }), nowMs, messages)}
      detail={captainTaskDetail({ status, thread })}
      onOpen={() => onOpen(thread.id)}
    />
  );
}

export function OverviewLocalTaskRows({
  threads,
  captainName,
  nowMs,
  onOpen,
}: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly captainName: string;
  readonly nowMs: number;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  return threads.map((thread) => (
    <OverviewLocalTaskRow
      key={thread.id}
      thread={thread}
      captainName={captainName}
      nowMs={nowMs}
      onOpen={onOpen}
    />
  ));
}

function OverviewRemoteSubagentRow({
  parent,
  task,
  captainName,
  nowMs,
}: {
  readonly parent: ScopedThreadRef;
  readonly task: OrchestrationV2Subagent;
  readonly captainName: string;
  readonly nowMs: number;
}) {
  const gt = useGT();
  const messages = useMessages();
  const child = task.remoteChild;
  const title = task.title ?? child?.title ?? child?.label ?? gt("Subagent");
  const opener = useLinkedThreadOpener(parent, child, title);
  if (!child) return null;
  const status = captainSubagentTaskStatus(task);
  return (
    <OverviewTaskRow
      status={status}
      title={title}
      captainName={captainName}
      elapsed={elapsedAt(captainTaskActivityMs({ status, subagent: task }), nowMs, messages)}
      detail={captainTaskDetail({ status, subagent: task }) ?? child.label ?? null}
      disabled={opener === null}
      onOpen={() => opener?.open("primary")}
    />
  );
}

function OverviewFinishedLocalRow({
  task,
  captainName,
  nowMs,
  onOpen,
}: {
  readonly task: OrchestrationV2Subagent;
  readonly captainName: string;
  readonly nowMs: number;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const childThreadId = task.childThreadId;
  const status = captainSubagentTaskStatus(task);
  return (
    <OverviewTaskRow
      status={status}
      title={task.title ?? gt("Subagent")}
      captainName={captainName}
      elapsed={elapsedAt(captainTaskActivityMs({ status, subagent: task }), nowMs, messages)}
      detail={captainTaskDetail({ status, subagent: task })}
      disabled={childThreadId === null}
      onOpen={() => {
        if (childThreadId !== null) onOpen(childThreadId);
      }}
    />
  );
}

const delegatedTasks = (subagents: ReadonlyArray<OrchestrationV2Subagent> | undefined) =>
  (subagents ?? []).filter((task) => task.origin === "app_owned");

/** Running and waiting linked delegated-task counts for one Captain. */
export function useOverviewRemoteTaskCounts(parent: ScopedThreadRef | null) {
  const delegated = delegatedTasks(useQuietThreadProjection(parent)?.projection.subagents);
  let running = 0;
  let waiting = 0;
  for (const task of delegated) {
    if (!task.remoteChild || !isOrchestrationV2WorkActive(task.status)) continue;
    if (task.status === "waiting") waiting += 1;
    else running += 1;
  }
  return { running, waiting };
}

/** Active delegated tasks running in linked environments for one Captain. */
export function OverviewRemoteActiveTaskRows({
  parent,
  captainName,
  nowMs,
}: {
  readonly parent: ScopedThreadRef;
  readonly captainName: string;
  readonly nowMs: number;
}) {
  const delegated = delegatedTasks(useQuietThreadProjection(parent)?.projection.subagents);
  return delegated.flatMap((task) =>
    task.remoteChild && isOrchestrationV2WorkActive(task.status)
      ? [
          <OverviewRemoteSubagentRow
            key={task.id}
            parent={parent}
            task={task}
            captainName={captainName}
            nowMs={nowMs}
          />,
        ]
      : [],
  );
}

/** Recently finished delegated tasks for one Captain, local and linked. */
export function OverviewFinishedTaskRows({
  parent,
  captainName,
  nowMs,
  limit,
  onOpen,
}: {
  readonly parent: ScopedThreadRef;
  readonly captainName: string;
  readonly nowMs: number;
  readonly limit: number;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const delegated = delegatedTasks(useQuietThreadProjection(parent)?.projection.subagents);
  return captainRecentlyFinishedTasks(delegated, limit).map((task) =>
    task.remoteChild ? (
      <OverviewRemoteSubagentRow
        key={task.id}
        parent={parent}
        task={task}
        captainName={captainName}
        nowMs={nowMs}
      />
    ) : (
      <OverviewFinishedLocalRow
        key={task.id}
        task={task}
        captainName={captainName}
        nowMs={nowMs}
        onOpen={onOpen}
      />
    ),
  );
}

/** A list whose quiet empty line appears only when none of its row components render. */
export function OverviewTaskList({
  empty,
  children,
}: {
  readonly empty: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <>
      <ul className="peer flex flex-col gap-1">{children}</ul>
      <p className="hidden text-body text-muted-foreground peer-empty:block">{empty}</p>
    </>
  );
}
