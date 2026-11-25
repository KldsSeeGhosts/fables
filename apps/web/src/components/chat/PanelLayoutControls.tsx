import "./DuetHeaderChrome.css";

import { useAtomValue } from "@effect/atom-react";
import { useGT } from "gt-react";
import { ListFilterIcon, Maximize2Icon, Minimize2Icon, PanelRightIcon, XIcon } from "lucide-react";
import { memo } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import { shortcutLabelForCommand } from "../../keybindings";
import { closeLayoutTabByUser } from "../../layout/layoutActions";
import { useLayoutPane } from "../../layout/layoutPaneContext";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { primaryServerKeybindingsAtom } from "../../state/server";
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
  /** Duet's right sidebar toggle, after the details toggle. */
  rightPanel?: RightPanelToggleControl | null | undefined;
}

/** The right sidebar toggle in Duet's header chrome. */
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
          <PanelRightIcon aria-hidden className="size-4" strokeWidth={2.25} />
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

function DuetClosePaneControl({ tabId }: { tabId: string }) {
  const gt = useGT();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "tab.close");
  const label = gt("Close");
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <button
          type="button"
          aria-label={label}
          onClick={() => closeLayoutTabByUser(tabId)}
          data-duet-header-icon=""
          data-layout-tab-close=""
          className="shrink-0 [-webkit-app-region:no-drag]"
        >
          <XIcon aria-hidden className="size-4" strokeWidth={2.25} />
        </button>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {shortcut ? gt("Close ({shortcut})", { shortcut }) : label}
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
  rightPanel = null,
}: PanelLayoutControlsProps) {
  const gt = useGT();
  const duet = useDuetShell();
  const mobileSidebarSheetMounted = useMobileSidebarSheetMounted();
  const { split, tabId: layoutTabId } = useLayoutPane();

  if (mobileSidebarSheetMounted) return null;

  const threadPanelToggle = duet ? (
    <button
      type="button"
      aria-expanded={threadPanelOpen}
      onClick={threadPanelPresentation === "popover" ? undefined : onToggleThreadPanel}
      disabled={disabledReason !== null}
      aria-label={gt("Toggle thread details panel")}
      data-duet-header-icon=""
      className="shrink-0 [-webkit-app-region:no-drag]"
    >
      <ListFilterIcon aria-hidden className="size-4" strokeWidth={2.25} />
    </button>
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
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      {showThreadPanelControl ? threadPanelControl : null}
      {duet && rightPanel ? <DuetRightPanelToggle control={rightPanel} /> : null}
      {duet && split && layoutTabId !== null ? <DuetClosePaneControl tabId={layoutTabId} /> : null}
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
