import "./DuetHeaderChrome.css";

import { type ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import {
  FolderIcon,
  GitBranchIcon,
  ListFilterIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelRightIcon,
} from "lucide-react";
import { memo } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { useProjects } from "../../state/entities";
import { useCaptain } from "../captains/useCaptain";
import { Button } from "../ui/button";
import { PopoverCreateHandle, PopoverTrigger } from "../ui/popover";
import { useMobileSidebarSheetMounted } from "../ui/sidebar";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface RightPanelToggleControl {
  readonly open: boolean;
  readonly shortcutLabel: string | null;
  readonly onToggle: () => void;
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
  /** The live thread, for a Captain's scope on the details pill. */
  threadRef?: ScopedThreadRef | null | undefined;
  /** Duet's right sidebar toggle, after the details pill. */
  rightPanel?: RightPanelToggleControl | null | undefined;
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

/** The classic right sidebar toggle in Duet's header chrome; the sidebar holds every surface. */
function DuetRightPanelToggle({ control }: { control: RightPanelToggleControl }) {
  const gt = useGT();
  const label = gt("Toggle right panel");
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <button
          type="button"
          aria-label={label}
          aria-pressed={control.open}
          onClick={control.onToggle}
          data-duet-header-icon=""
          data-right-panel-toggle=""
          className="shrink-0 [-webkit-app-region:no-drag]"
        >
          <PanelRightIcon aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {control.shortcutLabel
          ? gt("Toggle right panel ({shortcut})", { shortcut: control.shortcutLabel })
          : label}
      </TooltipPopup>
    </Tooltip>
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
  rightPanel = null,
}: PanelLayoutControlsProps) {
  const gt = useGT();
  const duet = useDuetShell();
  const mobileSidebarSheetMounted = useMobileSidebarSheetMounted();
  const captain = useCaptain(duet ? threadRef : null);
  const projects = useProjects();

  if (mobileSidebarSheetMounted) return null;

  const captainScopedProjects = captain
    ? projects.filter(
        (project) =>
          project.environmentId === threadRef?.environmentId &&
          captain.scopedProjectIds.includes(project.id),
      )
    : [];
  const pillBranchLabel = captain
    ? captainScopedProjects.length === 1
      ? (captainScopedProjects[0]?.title ?? null)
      : captainScopedProjects.length > 1
        ? gt("{count} projects", { count: captainScopedProjects.length })
        : gt("No scope")
    : branchLabel;
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
      {pillBranchLabel !== null ? (
        <>
          {captain ? (
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
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
      <TooltipTrigger render={<span className="flex shrink-0" data-thread-panel-toggle />}>
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

  return (
    <div
      className="flex h-full shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      {showThreadPanelControl ? threadPanelControl : null}
      {duet && rightPanel ? <DuetRightPanelToggle control={rightPanel} /> : null}
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
