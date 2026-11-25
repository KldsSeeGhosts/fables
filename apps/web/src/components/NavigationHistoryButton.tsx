import { useAtomValue } from "@effect/atom-react";
import { msg, useGT, useMessages } from "gt-react";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";

import { shortcutLabelForCommand } from "../keybindings";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../navigationHistory";
import { cn } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const NAVIGATION_HISTORY_BUTTONS = {
  back: {
    label: msg("Back", { $context: "browser navigation" }),
    command: "navigation.back",
    Icon: ArrowLeftIcon,
  },
  forward: {
    label: msg("Forward", { $context: "browser navigation" }),
    command: "navigation.forward",
    Icon: ArrowRightIcon,
  },
} as const;

// Next to the sidebar toggle on the chrome row (pen fiPPG, iZJUf). On the web
// they share the tab's history with the browser's own buttons, but stop at the
// app's first and last entries, so they never leave the app.
export function NavigationHistoryButton({
  direction,
  onStageBackdrop,
}: {
  direction: HistoryDirection;
  onStageBackdrop: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const canNavigate = useCanNavigateHistory(direction);
  const { label: labelMessage, command, Icon } = NAVIGATION_HISTORY_BUTTONS[direction];
  const label = m(labelMessage);
  const shortcutLabel = shortcutLabelForCommand(keybindings, command);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            // The trigger beside it switches to the media variant over the stage artwork.
            variant={onStageBackdrop ? "media-navigation" : "ghost"}
            size="icon-sm"
            className={cn(onStageBackdrop && "relative top-auto translate-y-0")}
            aria-label={label}
            disabled={!canNavigate}
            onClick={() => navigateHistory(direction)}
          />
        }
      >
        {/* The pen strokes these 16px glyphs at 1.5px: 2.25 on lucide's 24px grid. */}
        <Icon className="size-4 text-sidebar-toggle" strokeWidth={2.25} />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {shortcutLabel ? gt("{label} ({shortcut})", { label, shortcut: shortcutLabel }) : label}
      </TooltipPopup>
    </Tooltip>
  );
}
