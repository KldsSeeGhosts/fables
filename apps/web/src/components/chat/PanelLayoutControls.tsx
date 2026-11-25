import "./DuetStatusOrb.css";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isCaptainThreadId,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  EllipsisIcon,
  FileDiffIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  ListChecksIcon,
  ListFilterIcon,
  Maximize2Icon,
  Minimize2Icon,
  MonitorIcon,
  SquarePenIcon,
  TerminalIcon,
} from "lucide-react";
import { memo, useRef, useState, type ReactElement } from "react";

import { useNavigate } from "@tanstack/react-router";

import { useDuetShell } from "../../hooks/useDuetShell";
import { observeResize } from "../../lib/observeResize";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { selectActiveRightPanel, useRightPanelStore } from "../../rightPanelStore";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useQuietThreadShell } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { EnvironmentOption } from "../BranchToolbar.logic";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { CaptainResetDialog } from "../captains/CaptainResetButton";
import { useCaptain } from "../captains/useCaptain";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { PopoverCreateHandle, PopoverTrigger } from "../ui/popover";
import { useMobileSidebarSheetMounted } from "../ui/sidebar";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toggleThreadSurfaceTab } from "../../layout/openRules";

export interface DuetHeaderAction {
  readonly label: string;
  readonly onClick?: (() => void) | undefined;
  readonly active?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

export interface DuetMachineControl {
  readonly label: string;
  readonly machine: EnvironmentMachineKind;
  readonly environmentId: EnvironmentId;
  readonly unavailable: boolean;
  readonly environments: ReadonlyArray<EnvironmentOption>;
  readonly locked: boolean;
  readonly onChange?: ((environmentId: EnvironmentId) => void) | undefined;
  readonly autoLabel?: string | null | undefined;
  readonly onAuto?: (() => void) | undefined;
}

export interface DuetHeaderControls {
  readonly onNew?: (() => void) | undefined;
  readonly machine?: DuetMachineControl | null | undefined;
  readonly terminal?: DuetHeaderAction | null | undefined;
  readonly browser?: DuetHeaderAction | null | undefined;
  readonly diff?: DuetHeaderAction | null | undefined;
}

export interface PanelLayoutControlsProps {
  showThreadPanelControl?: boolean;
  threadPanelOpen: boolean;
  threadPanelPresentation: ThreadPanelPresentation;
  threadPanelPopoverHandle?: ReturnType<typeof PopoverCreateHandle>;
  threadPanelShortcutLabel: string | null;
  onToggleThreadPanel: () => void;
  /** Shown instead of the toggle's label when there is no thread to detail. */
  disabledReason?: string | null;
  /** The thread's branch, named on the details pill. */
  branchLabel?: string | null;
  /** How full the context window is, 0 to 100, drawn as a ring on the details pill. */
  contextPercent?: number | null;
  /** The live thread, for Duet's tasks button, Captain scope, and environment prefix. */
  threadRef?: ScopedThreadRef | null | undefined;
  /** Duet header utility buttons, in their fixed order after the details pill. */
  duetControls?: DuetHeaderControls | null | undefined;
}

/** A static ring for the context window; it repaints only when usage changes. */
function ContextRing({ percent }: { percent: number }) {
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5 shrink-0 -rotate-90">
      <circle cx="7" cy="7" r={radius} fill="none" strokeWidth="2" className="stroke-border" />
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        className={clamped >= 85 ? "stroke-warning" : "stroke-primary"}
      />
    </svg>
  );
}

function DuetIconButton({
  action,
  icon,
  className,
}: {
  action: DuetHeaderAction;
  icon: ReactElement;
  className?: string;
}) {
  const button = (
    <button
      type="button"
      aria-label={action.label}
      aria-pressed={action.active}
      disabled={action.disabled}
      onClick={action.onClick}
      data-duet-header-icon
      className={`shrink-0 ${className ?? ""}`}
    >
      {icon}
    </button>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>{button}</TooltipTrigger>
      <TooltipPopup side="bottom">{action.label}</TooltipPopup>
    </Tooltip>
  );
}

function DuetMachineMenuItems({ machine }: { machine: DuetMachineControl }) {
  const gt = useGT();
  return machine.environments.length > 0 ? (
    <MenuRadioGroup
      value={machine.autoLabel ? "auto" : machine.environmentId}
      onValueChange={(value) =>
        value === "auto" ? machine.onAuto?.() : machine.onChange?.(value as EnvironmentId)
      }
    >
      {machine.onAuto ? (
        <MenuRadioItem value="auto" disabled={machine.locked} closeOnClick>
          <span className="min-w-0 truncate">{machine.autoLabel ?? gt("Auto balance")}</span>
        </MenuRadioItem>
      ) : null}
      {machine.environments.map((environment) => (
        <MenuRadioItem
          key={environment.environmentId}
          value={environment.environmentId}
          disabled={
            machine.locked ||
            (!machine.onChange && environment.environmentId !== machine.environmentId)
          }
          closeOnClick
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <EnvironmentMachineIcon kind={environment.machine} className="size-3" />
            <span className="min-w-0 truncate">{environment.label}</span>
          </span>
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  ) : (
    <div className="px-2 py-1.5 text-muted-foreground text-body">{machine.label}</div>
  );
}

function DuetMachineButton({ machine }: { machine: DuetMachineControl }) {
  const gt = useGT();
  const trigger = (
    <button
      type="button"
      aria-label={gt("Choose machine")}
      data-duet-header-icon
      className="shrink-0"
    >
      <MonitorIcon aria-hidden className="size-4" strokeWidth={1.75} />
    </button>
  );
  return (
    <Menu>
      <MenuTrigger render={trigger} aria-label={gt("Choose machine")} />
      <MenuPopup align="end" width="wide">
        <MenuGroup>
          <MenuGroupLabel>
            <T>Run on</T>
          </MenuGroupLabel>
          <DuetMachineMenuItems machine={machine} />
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function DuetOverflowMenu({
  captain,
  machine,
  terminal,
  browser,
  diff,
  foldUtilityControls,
}: {
  captain: boolean;
  machine?: DuetMachineControl | null | undefined;
  terminal?: DuetHeaderAction | null | undefined;
  browser?: DuetHeaderAction | null | undefined;
  diff?: DuetHeaderAction | null | undefined;
  foldUtilityControls: boolean;
}) {
  const gt = useGT();
  const entries = [
    terminal
      ? {
          key: "terminal",
          action: terminal,
          icon: <TerminalIcon className="size-3.5" strokeWidth={1.75} />,
        }
      : null,
    browser
      ? {
          key: "browser",
          action: browser,
          icon: <GlobeIcon className="size-3.5" strokeWidth={1.75} />,
        }
      : null,
    diff
      ? {
          key: "diff",
          action: diff,
          icon: <FileDiffIcon className="size-3.5" strokeWidth={1.75} />,
        }
      : null,
  ].filter((entry) => entry !== null);
  return (
    <Menu>
      <MenuTrigger
        render={
          <button type="button" data-duet-header-icon className="shrink-0">
            <EllipsisIcon aria-hidden className="size-4" strokeWidth={1.75} />
          </button>
        }
        aria-label={gt("More header actions")}
      />
      <MenuPopup align="end" width="wide">
        {captain ? (
          <MenuGroup>
            {entries.map((entry) => (
              <MenuItem
                key={entry.key}
                disabled={entry.action.disabled}
                selected={entry.action.active === true}
                closeOnClick
                onClick={entry.action.onClick}
              >
                {entry.icon}
                {entry.action.label}
              </MenuItem>
            ))}
          </MenuGroup>
        ) : (
          <>
            {machine ? (
              <MenuSub>
                <MenuSubTrigger>
                  <MonitorIcon className="size-3.5" strokeWidth={1.75} />
                  <T>Run on</T>
                </MenuSubTrigger>
                <MenuSubPopup>
                  <MenuGroup>
                    <MenuGroupLabel>
                      <T>Run on</T>
                    </MenuGroupLabel>
                    <DuetMachineMenuItems machine={machine} />
                  </MenuGroup>
                </MenuSubPopup>
              </MenuSub>
            ) : null}
            {foldUtilityControls
              ? entries.map((entry) => (
                  <MenuItem
                    key={entry.key}
                    disabled={entry.action.disabled}
                    selected={entry.action.active === true}
                    closeOnClick
                    onClick={entry.action.onClick}
                  >
                    {entry.icon}
                    {entry.action.label}
                  </MenuItem>
                ))
              : null}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  showThreadPanelControl = true,
  threadPanelOpen,
  threadPanelPresentation,
  threadPanelPopoverHandle,
  threadPanelShortcutLabel,
  onToggleThreadPanel,
  disabledReason = null,
  branchLabel = null,
  contextPercent = null,
  threadRef = null,
  duetControls = null,
}: PanelLayoutControlsProps) {
  const gt = useGT();
  const duet = useDuetShell();
  const mobileSidebarSheetMounted = useMobileSidebarSheetMounted();
  const captain = useCaptain(duet ? threadRef : null);
  const [captainResetOpen, setCaptainResetOpen] = useState(false);
  const navigate = useNavigate();
  const projects = useProjects();
  const shell = useQuietThreadShell(duet ? threadRef : null);
  const environment = useEnvironment(threadRef?.environmentId ?? null);
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const captainScopedProjects = captain
    ? projects.filter(
        (project) =>
          project.environmentId === threadRef?.environmentId &&
          captain.scopedProjectIds.includes(project.id),
      )
    : [];
  const captainScopeLabel = captain
    ? captainScopedProjects.length === 1
      ? (captainScopedProjects[0]?.title ?? null)
      : captainScopedProjects.length > 1
        ? gt("{count} projects", { count: captainScopedProjects.length })
        : gt("No scope")
    : null;
  const parentThreadId = shell?.lineage.parentThreadId ?? null;
  const captainChannel = threadRef !== null && isCaptainThreadId(threadRef.threadId);
  const captainTasksRef =
    threadRef === null
      ? null
      : captainChannel
        ? threadRef
        : parentThreadId !== null && isCaptainThreadId(parentThreadId)
          ? scopeThreadRef(threadRef.environmentId, parentThreadId)
          : null;
  const tasksActive = useRightPanelStore(
    (state) => selectActiveRightPanel(state.byThreadKey, captainTasksRef) === "captain-brief",
  );
  const [compactDuetHeader, setCompactDuetHeader] = useState(false);
  const stopMeasuringRef = useRef<(() => void) | null>(null);
  const [rootRef] = useState(() => (node: HTMLDivElement | null) => {
    stopMeasuringRef.current?.();
    stopMeasuringRef.current = null;
    if (!node) {
      setCompactDuetHeader(false);
      return;
    }
    const header = node.closest<HTMLElement>("[data-chat-header]");
    if (!header) return;
    const update = () => setCompactDuetHeader(header.getBoundingClientRect().width < 720);
    update();
    stopMeasuringRef.current = observeResize(header, update);
  });
  const foldDuetUtilityControls = duet && !captainChannel && compactDuetHeader;
  if (mobileSidebarSheetMounted) return null;
  const toggleTasks = () => {
    if (captainTasksRef === null) return;
    toggleThreadSurfaceTab(captainTasksRef, "captain-brief", () =>
      useRightPanelStore.getState().toggle(captainTasksRef, "captain-brief"),
    );
  };

  const remoteEnvironment =
    duet && environment !== null && environment.environmentId !== primaryEnvironmentId
      ? environment
      : null;
  const pillBranchLabel = captain ? captainScopeLabel : branchLabel;
  const showsPill = pillBranchLabel !== null || contextPercent !== null;
  const threadPanelToggle = showsPill ? (
    <Button
      className="relative max-w-56 shrink-0 self-center [-webkit-app-region:no-drag]"
      aria-expanded={threadPanelOpen}
      onClick={threadPanelPresentation === "popover" ? undefined : onToggleThreadPanel}
      disabled={disabledReason !== null}
      aria-label={gt("Toggle thread details panel")}
      data-thread-details-pill
      variant="pill"
      size="sm-pill"
    >
      {remoteEnvironment ? (
        <>
          <EnvironmentMachineIcon
            kind={duetControls?.machine?.machine ?? "server"}
            className="size-3 shrink-0 text-muted-foreground"
          />
          <span className="max-w-20 truncate text-meta text-muted-foreground">
            {remoteEnvironment.label}
          </span>
        </>
      ) : null}
      {captain ? (
        <>
          {remoteEnvironment ? (
            <span aria-hidden className="text-muted-foreground">
              /
            </span>
          ) : null}
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 max-w-40 truncate text-meta">{pillBranchLabel}</span>
        </>
      ) : pillBranchLabel !== null ? (
        <>
          {remoteEnvironment ? (
            <span aria-hidden className="text-muted-foreground">
              /
            </span>
          ) : null}
          <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 max-w-40 truncate text-meta">{pillBranchLabel}</span>
        </>
      ) : (
        <ListFilterIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      {contextPercent !== null ? <ContextRing percent={contextPercent} /> : null}
    </Button>
  ) : (
    <Button
      className="relative shrink-0 [-webkit-app-region:no-drag]"
      aria-expanded={threadPanelOpen}
      onClick={threadPanelPresentation === "popover" ? undefined : onToggleThreadPanel}
      disabled={disabledReason !== null}
      aria-label={gt("Toggle thread details panel")}
      variant="ghost"
      size="icon-sm"
    >
      <ListFilterIcon className="size-3.5" />
    </Button>
  );
  const threadPanelControl = (
    <Tooltip>
      <TooltipTrigger render={<span className="me-2 flex shrink-0" data-thread-panel-toggle />}>
        {threadPanelPresentation === "popover" ? (
          <PopoverTrigger handle={threadPanelPopoverHandle} render={threadPanelToggle} />
        ) : (
          threadPanelToggle
        )}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {disabledReason ??
          (threadPanelShortcutLabel
            ? gt("Toggle thread details ({shortcut})", { shortcut: threadPanelShortcutLabel })
            : gt("Toggle thread details"))}
      </TooltipPopup>
    </Tooltip>
  );

  const newAction: DuetHeaderAction | null = captain
    ? {
        label: gt("New conversation"),
        onClick: () => setCaptainResetOpen(true),
      }
    : duetControls?.onNew
      ? {
          label: gt("New side chat"),
          onClick: duetControls.onNew,
        }
      : null;

  return (
    <div
      ref={rootRef}
      className="flex h-full shrink-0 items-center gap-0 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      {/* The workspace menu (pen ZVAPz) is the pane's only top-right control. */}
      {showThreadPanelControl ? threadPanelControl : null}
      {duet && duetControls ? (
        <>
          {captainChannel ? (
            <>
              {captainTasksRef !== null ? (
                <DuetIconButton
                  action={{
                    label: gt("Tasks"),
                    onClick: toggleTasks,
                    active: tasksActive,
                  }}
                  icon={<ListChecksIcon aria-hidden className="size-4" strokeWidth={1.75} />}
                />
              ) : null}
              {newAction ? (
                <DuetIconButton
                  action={newAction}
                  icon={<SquarePenIcon aria-hidden className="size-4" strokeWidth={1.75} />}
                />
              ) : null}
              {duetControls.machine ? <DuetMachineButton machine={duetControls.machine} /> : null}
            </>
          ) : (
            <>
              {newAction ? (
                <DuetIconButton
                  action={newAction}
                  icon={<SquarePenIcon aria-hidden className="size-4" strokeWidth={1.75} />}
                />
              ) : null}
              {duetControls.terminal && !foldDuetUtilityControls ? (
                <DuetIconButton
                  action={duetControls.terminal}

                  icon={<TerminalIcon aria-hidden className="size-4" strokeWidth={1.75} />}
                />
              ) : null}
              {duetControls.browser && !foldDuetUtilityControls ? (
                <DuetIconButton
                  action={duetControls.browser}

                  icon={<GlobeIcon aria-hidden className="size-4" strokeWidth={1.75} />}
                />
              ) : null}
              {duetControls.diff && !foldDuetUtilityControls ? (
                <DuetIconButton
                  action={duetControls.diff}

                  icon={<FileDiffIcon aria-hidden className="size-4" strokeWidth={1.75} />}
                />
              ) : null}
            </>
          )}
          <DuetOverflowMenu
            captain={captainChannel}
            machine={captainChannel ? null : duetControls.machine}
            terminal={duetControls.terminal}
            browser={duetControls.browser}
            diff={duetControls.diff}
            foldUtilityControls={foldDuetUtilityControls}
          />
        </>
      ) : null}
      {captainResetOpen && captain && threadRef ? (
        <CaptainResetDialog
          captain={captain}
          environmentId={threadRef.environmentId}
          onClose={() => setCaptainResetOpen(false)}
          onReset={(threadId) => {
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(scopeThreadRef(threadRef.environmentId, threadId)),
            });
          }}
        />
      ) : null}
    </div>
  );
});

export const RightPanelMaximizeControl = memo(function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const gt = useGT();
  const mobileSidebarSheetMounted = useMobileSidebarSheetMounted();
  if (mobileSidebarSheetMounted) return null;
  const label = maximized ? gt("Restore panel size") : gt("Maximize panel");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={maximized}
            onPressedChange={onToggle}
            aria-label={label}
            variant="ghost"
            size="sm"
          >
            {maximized ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <Maximize2Icon className="size-3.5" />
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
});
