/* oxlint-disable shadcn/no-arbitrary-values, t3code/no-raw-type-classes, t3code/no-styled-raw-controls, t3code/no-dot-separated-text -- the V3 Duet drill-down spec fixes exact type sizes and the status/branch separator. */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT, T } from "gt-react";
import { ChevronLeftIcon, EllipsisVerticalIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { isElectron } from "../../env";
import { useLayoutPane } from "../../layout/layoutPaneContext";
import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadShell } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { useCaptainTaskStatusLabel } from "./CaptainTaskRing";
import { captainThreadTaskStatus } from "./captainTaskStatus.logic";

function showTaskInChannel(childThreadId: ThreadId) {
  const selector = `[data-duet-task-header="${CSS.escape(childThreadId)}"]`;
  const headers = [...document.querySelectorAll<HTMLElement>(selector)];
  const header =
    headers.find((entry) => entry.closest("[data-right-panel-surface-content]") === null) ??
    headers[0];
  if (!header) return;
  header.scrollIntoView({ behavior: "smooth", block: "center" });
  header.dataset.duetTaskHighlight = "true";
  window.setTimeout(() => {
    if (header.isConnected) delete header.dataset.duetTaskHighlight;
  }, 1000);
}

/** The Duet drill-down chrome around a Captain child thread opened in the right drawer. */
export function DuetTaskDrawerHeader({
  parentThreadRef,
  childThreadId,
  channelName,
  onBack,
  onClose,
  children,
}: {
  readonly parentThreadRef: ScopedThreadRef;
  readonly childThreadId: ThreadId;
  readonly channelName: string | null;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const { trailingEdge } = useLayoutPane();
  const childRef = scopeThreadRef(parentThreadRef.environmentId, childThreadId);
  const shell = useQuietThreadShell(childRef);
  const statusLabel = useCaptainTaskStatusLabel(captainThreadTaskStatus(shell));
  const title = shell?.title.trim() || gt("Task", { $context: "Captain delegated task" });
  const subtitleParts = [statusLabel, shell?.branch].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  const openFullThread = () => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(childRef),
    });
  };
  return (
    <div className="flex h-full min-h-0 flex-col bg-background dark:bg-[#1f1f1f]">
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 border-b border-(--duet-hairline) px-3",
          isElectron && "drag-region",
          isElectron && trailingEdge && "wco:pr-(--workspace-native-controls-inset)",
        )}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          className="[-webkit-app-region:no-drag]"
          aria-label={gt("Back to tasks")}
          onClick={() => {
            useRightPanelStore.getState().open(parentThreadRef, "captain-brief");
            onBack();
          }}
        >
          <ChevronLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium leading-5 text-foreground">{title}</div>
          <div className="truncate text-[12px] leading-4 text-muted-foreground">
            {subtitleParts.join(" · ")}
          </div>
        </div>
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="[-webkit-app-region:no-drag]"
                aria-label={gt("Thread actions")}
              >
                <EllipsisVerticalIcon />
              </Button>
            }
          />
          <MenuPopup side="bottom" align="end">
            <MenuItem onClick={openFullThread}>
              <T>Open full thread</T>
            </MenuItem>
            <MenuItem onClick={onClose}>
              <T>Close panel</T>
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Button
          variant="ghost"
          size="icon-xs"
          className="[-webkit-app-region:no-drag]"
          aria-label={gt("Close panel")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex h-7 shrink-0 items-center justify-end border-b border-(--duet-hairline) px-3">
        <button
          type="button"
          className="cursor-pointer text-[12px] text-(--duet-link) outline-none hover:underline focus-visible:underline"
          onClick={() => showTaskInChannel(childThreadId)}
        >
          {channelName ? gt("Show in #{channel}", { channel: channelName }) : gt("Show in channel")}
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
