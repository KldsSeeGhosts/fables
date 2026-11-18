import { msg } from "gt-react";
import { GitForkIcon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useAvailableUpstreamNightly } from "~/state/upstreamNightly";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuItem } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useUpdateEverythingRun } from "./updateEverythingRun";

export function SidebarUpstreamUpdatePill({
  includedVersion,
}: {
  readonly includedVersion?: string | null;
} = {}) {
  const update = useAvailableUpstreamNightly(includedVersion);
  const run = useUpdateEverythingRun();
  const [open, setOpen] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "upstream merge prompt",
      unavailableMessage: msg("Clipboard API is unavailable while copying upstream merge prompt."),
      failureMessage: msg("Failed to copy upstream merge prompt to the clipboard."),
    },
    onError: (error) =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy merge prompt",
          description: error.message,
        }),
      ),
  });

  if (update === null || run !== null) return null;

  const label = `Upstream nightly ${update.latestVersion} available`;

  return (
    <SidebarMenuItem className="ml-auto shrink-0 [&+*]:ml-0">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip disabled={open}>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={label}>
                    <span className="relative grid size-4 place-items-center">
                      <GitForkIcon className="size-4" />
                      <span
                        aria-hidden="true"
                        className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-info ring-2 ring-sidebar-control-surface"
                      />
                    </span>
                  </Button>
                }
              />
            }
          />
          <TooltipPopup side="top">{label}</TooltipPopup>
        </Tooltip>
        <PopoverPopup side="top" align="end" width="sm">
          <div className="flex flex-col gap-2 text-meta">
            <div className="flex items-center justify-between gap-2">
              <span className="text-foreground">Upstream update available</span>
              <Badge size="sm" variant="info">
                Nightly
              </Badge>
            </div>
            <p className="font-mono text-meta text-muted-foreground">
              {update.includedVersion} → {update.latestVersion}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <Button
                render={<a href={update.reviewUrl} target="_blank" rel="noreferrer noopener" />}
                size="xs"
                variant="secondary"
              >
                Review changes
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => copyToClipboard(update.mergePrompt, undefined)}
              >
                {isCopied ? "Copied" : "Copy merge prompt"}
              </Button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
