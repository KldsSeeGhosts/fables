/* oxlint-disable t3code/no-styled-raw-controls -- The Duet status popover's task rows are bespoke list controls outside shared button variants. */

import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import {
  isOrchestrationV2WorkActive,
  resolveEnvironmentMachineKind,
  type OrchestrationV2PendingBackgroundTask,
  type OrchestrationV2Subagent,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { ChevronRightIcon, ListChecksIcon } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";

import { tickTextContent } from "~/lib/tickTextContent";
import { useRightPanelStore } from "~/rightPanelStore";
import { useEnvironment, usePrimaryEnvironmentId } from "~/state/environments";
import { useQuietThreadProjection, useQuietThreadShell } from "~/state/entities";

import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { StatusDot, type StatusDotTone } from "../ui/status-dot";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveDuetOrbState, type DuetOrbState } from "./duetStatus.logic";

function activeWorkStatus(status: OrchestrationV2Subagent["status"]): StatusDotTone {
  if (status === "waiting") return "warning";
  if (status === "failed" || status === "cancelled" || status === "interrupted") return "danger";
  return isOrchestrationV2WorkActive(status) ? "info" : "neutral";
}

function workTitle(task: OrchestrationV2Subagent): string {
  return task.title ?? task.prompt;
}

function backgroundTaskLabel(task: OrchestrationV2PendingBackgroundTask): string {
  return task.description ?? ("command" in task ? task.command : undefined) ?? task.taskId;
}

function stateCopy(
  state: DuetOrbState,
  activeChildren: number,
  gt: ReturnType<typeof useGT>,
): string {
  switch (state) {
    case "offline":
      return gt("Offline");
    case "waiting":
      return gt("Needs input");
    case "working":
      return activeChildren > 0
        ? gt("{count, plural, one {Working on {count} task} other {Working on {count} tasks}}", {
            count: activeChildren,
          })
        : gt("Working");
    case "idle":
      return gt("Idle");
  }
}

function DuetElapsedTime({ startedAt, active }: { startedAt: string | null; active: boolean }) {
  const gt = useGT();
  return (
    <span
      ref={tickTextContent((nowMs) => {
        if (startedAt === null) return gt("just started");
        const seconds = Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 1000));
        const minutes = Math.floor(seconds / 60);
        if (minutes <= 0) return gt("{seconds}s", { seconds });
        const hours = Math.floor(minutes / 60);
        if (hours <= 0) return gt("{minutes}m", { minutes });
        return gt("{hours}h {minutes}m", { hours, minutes: minutes % 60 });
      }, active)}
      className="tabular-nums text-muted-foreground"
    />
  );
}

function ActiveChildRow({ task, onOpen }: { task: OrchestrationV2Subagent; onOpen: () => void }) {
  const gt = useGT();
  const disabled = task.childThreadId === null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-body hover:bg-accent disabled:cursor-default disabled:opacity-70"
    >
      <StatusDot tone={activeWorkStatus(task.status)} pulse={task.status === "running"} />
      <span className="min-w-0 flex-1 truncate text-foreground">{workTitle(task)}</span>
      <span className="shrink-0 text-muted-foreground text-meta">{task.status}</span>
      {disabled ? null : <ChevronRightIcon aria-hidden className="size-3 text-muted-foreground" />}
      <span className="sr-only">{gt("Open task")}</span>
    </button>
  );
}

export type DuetThreadStatus = ReturnType<typeof useDuetThreadStatus>;

/** What a Duet thread is doing now: its orb state, live label and the work behind them. */
export function useDuetThreadStatus(threadRef: ScopedThreadRef) {
  const gt = useGT();
  const messages = useMessages();
  const shell = useQuietThreadShell(threadRef);
  const detail = useQuietThreadProjection(threadRef);
  const environment = useEnvironment(threadRef.environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const projection = detail?.projection ?? null;
  const activeChildren = (projection?.subagents ?? []).filter((task) =>
    isOrchestrationV2WorkActive(task.status),
  );
  const backgroundTasks = shell?.pendingBackgroundTasks ?? [];
  const attention =
    (shell?.hasPendingApprovals === true ? 1 : 0) +
    (shell?.hasPendingUserInput === true ? 1 : 0) +
    (shell?.pendingSubagentRequest !== null && shell?.pendingSubagentRequest !== undefined
      ? 1
      : 0) +
    activeChildren.filter((task) => task.status === "waiting").length;
  const connected = environment === null || environment.connection.phase === "connected";
  const runtimeActive = shell !== null && threadRuntimeIsActive(shell.runtime);
  const state = resolveDuetOrbState({
    connected,
    runtimeActive,
    backgroundTasks: backgroundTasks.length,
    attention,
    activeChildren: activeChildren.length,
  });
  const stateText = stateCopy(state, activeChildren.length, gt);

  const activeTurnItem = (projection?.visibleTurnItems ?? []).findLast((entry) =>
    isOrchestrationV2WorkActive(entry.item.status),
  );
  const activeTurnSummary = activeTurnItem
    ? activeTurnItem.item.type === "dynamic_tool"
      ? activeTurnItem.item.toolName
      : activeTurnItem.item.type === "command_execution"
        ? activeTurnItem.item.input
        : activeTurnItem.item.type === "user_message" ||
            activeTurnItem.item.type === "assistant_message"
          ? null
          : activeTurnItem.item.type.replaceAll("_", " ")
    : null;
  const runtimePhase = shell?.runtime?.status ?? null;
  const phaseSummary =
    runtimeActive && runtimePhase !== null
      ? runtimePhase === "waiting"
        ? gt("Waiting for input")
        : runtimePhase === "preparing"
          ? gt("Preparing")
          : runtimePhase === "starting"
            ? gt("Starting")
            : runtimePhase === "queued"
              ? gt("Queued")
              : gt("Thinking it through")
      : null;
  const activitySummary = activeTurnSummary ?? phaseSummary;
  // The live label under the header hero: the task count while delegating, else what runs now.
  const liveLabel =
    state === "working" && activeChildren.length === 0 ? (activitySummary ?? stateText) : stateText;

  return {
    state,
    stateText,
    liveLabel,
    activitySummary,
    runtimeActive,
    activeStartedAt: shell?.runtime?.activityStartedAt ?? null,
    activeChildren,
    backgroundTasks,
    environment,
    environmentLabel: environment?.label ?? threadRef.environmentId,
    environmentMachineKind: resolveEnvironmentMachineKind(environment?.serverConfig ?? null),
    connectionText: environment
      ? connectionStatusText(environment.connection, messages)
      : gt("Unknown"),
    isRemote: environment !== null && environment.environmentId !== primaryEnvironmentId,
  };
}

/** The live activity popover a Duet hero opens: state, current work, tasks and machine. */
export function DuetStatusPopover({
  threadRef,
  status,
  mark,
  trigger,
}: {
  threadRef: ScopedThreadRef;
  status: DuetThreadStatus;
  /** The creature drawn beside the state, matching the trigger. */
  mark: ReactNode;
  trigger: ReactElement;
}) {
  const gt = useGT();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const {
    stateText,
    activitySummary,
    runtimeActive,
    activeStartedAt,
    activeChildren,
    backgroundTasks,
    environment,
    environmentLabel,
    environmentMachineKind,
    connectionText,
    isRemote,
  } = status;

  const openChild = (childThreadId: ThreadId) => {
    useRightPanelStore.getState().openThread(threadRef, childThreadId);
    setPopoverOpen(false);
  };
  const openTasks = () => {
    useRightPanelStore.getState().open(threadRef, "captain-brief");
    setPopoverOpen(false);
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <Tooltip>
        <TooltipTrigger render={<span className="flex" />}>
          <PopoverTrigger render={trigger} />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{stateText}</TooltipPopup>
      </Tooltip>
      <PopoverPopup width="md" side="bottom" align="center" sideOffset={8} className="w-80">
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-foreground text-label">{stateText}</div>
              {runtimeActive ? (
                <div className="mt-0.5 text-muted-foreground text-meta">
                  <T>Running for</T>{" "}
                  <DuetElapsedTime startedAt={activeStartedAt} active={runtimeActive} />
                </div>
              ) : null}
            </div>
            {mark}
          </div>

          {activitySummary ? (
            <div className="rounded-md bg-muted/60 px-2.5 py-2">
              <div className="text-muted-foreground text-meta">
                <T>Current activity</T>
              </div>
              <div className="mt-0.5 truncate text-foreground text-body">{activitySummary}</div>
            </div>
          ) : null}

          {activeChildren.length > 0 ? (
            <div>
              <div className="mb-1 px-2 text-muted-foreground text-meta">
                <T>Active tasks</T>
              </div>
              <div className="flex flex-col">
                {activeChildren.slice(0, 5).map((task) => (
                  <ActiveChildRow
                    key={task.id}
                    task={task}
                    onOpen={() => {
                      if (task.childThreadId !== null) openChild(task.childThreadId);
                    }}
                  />
                ))}
              </div>
              {activeChildren.length > 5 ? (
                <div className="px-2 pt-1 text-muted-foreground text-meta">
                  {gt("{count} more active", { count: activeChildren.length - 5 })}
                </div>
              ) : null}
            </div>
          ) : null}

          {backgroundTasks.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                const childThreadId = backgroundTasks.flatMap((task) =>
                  task.kind === "subagent" && task.childThreadId !== undefined
                    ? [task.childThreadId]
                    : [],
                )[0];
                if (childThreadId !== undefined) openChild(childThreadId);
                else openTasks();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-accent"
            >
              <StatusDot tone="info" pulse />
              <span className="min-w-0 flex-1 text-foreground text-body">
                {gt(
                  "{count, plural, one {{count} background task} other {{count} background tasks}}",
                  { count: backgroundTasks.length },
                )}
              </span>
              <span className="max-w-28 truncate text-muted-foreground text-meta">
                {backgroundTasks[0] ? backgroundTaskLabel(backgroundTasks[0]) : null}
              </span>
            </button>
          ) : null}

          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={openTasks}>
            <ListChecksIcon aria-hidden />
            <T>Open Tasks</T>
          </Button>

          <div className="flex items-center gap-2 border-border/60 border-t pt-3 text-body">
            <EnvironmentMachineIcon kind={environmentMachineKind} className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-foreground">{environmentLabel}</span>
            <span className="shrink-0 text-muted-foreground text-meta">{connectionText}</span>
          </div>
          {isRemote && environment?.displayUrl ? (
            <div className="-mt-2 truncate px-6 text-muted-foreground text-meta">
              {environment.displayUrl}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
