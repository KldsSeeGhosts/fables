/* oxlint-disable t3code/no-styled-raw-controls, shadcn/no-arbitrary-values, t3code/no-raw-type-classes -- The tabless Duet title keeps exact ghost-button geometry and type outside shared button variants. */
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { Captain, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ChevronDownIcon, SquareTerminal, XIcon } from "lucide-react";
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { type LayoutTab, THREAD_TERMINAL_SURFACE_ID } from "../../layout/layoutModel";
import { closeLayoutTabByUser } from "../../layout/layoutActions";
import { beginLayoutContentDrag } from "../../layout/layoutDrag";
import { useLayoutStore } from "../../layout/layoutStore";
import { useLayoutTabLabel } from "../../layout/PaneTabs";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ProjectFavicon } from "../ProjectFavicon";
import { CaptainAvatar } from "../captains/CaptainAvatar";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";

export interface HiddenTerminalChip {
  readonly shortcutLabel: string | null;
  readonly running: boolean;
  readonly onShow: () => void;
}

function TitleButton({
  captain,
  project,
  title,
  onPointerDown,
  onAuxClick,
  onDoubleClick,
  layoutTabId,
  onClick,
}: {
  captain: Captain | null | undefined;
  project: EnvironmentProject | null;
  title: string;
  layoutTabId: string | null | undefined;
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  onAuxClick: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  onDoubleClick: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  onClick: ((event: ReactMouseEvent<HTMLButtonElement>) => void) | undefined;
}) {
  const gt = useGT();
  return (
    <button
      type="button"
      data-layout-pane-tab={layoutTabId ?? undefined}
      aria-label={gt("Thread actions for {title}", { title })}
      onPointerDown={onPointerDown}
      onAuxClick={onAuxClick}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      data-duet-header-title
      className="flex h-7 max-w-72 items-center gap-1.5 px-2 ps-5 text-start outline-none [-webkit-app-region:no-drag] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {captain ? (
        <CaptainAvatar avatar={captain.avatar} size="row" />
      ) : project ? (
        <ProjectFavicon project={project} className="size-4 shrink-0" />
      ) : null}
      <span className="min-w-0 truncate text-foreground text-body" dir={textDirection(title)}>
        {title}
      </span>
    </button>
  );
}

function PaneTabMenuItem({ tab }: { tab: LayoutTab }) {
  const gt = useGT();
  const { icon, title, tooltip } = useLayoutTabLabel(tab);
  return (
    <MenuItem
      closeOnClick
      onClick={() => useLayoutStore.getState().focusTab(tab.id)}
      className="group/duet-pane-tab"
    >
      {icon}
      <MenuItemLabel title={tooltip}>{title}</MenuItemLabel>
      <button
        type="button"
        aria-label={gt("Close {title}", { title })}
        className="ms-auto flex size-5 shrink-0 items-center justify-center rounded-kbd text-muted-foreground opacity-0 transition-opacity hover:surface-ghost-hover hover:text-foreground focus-visible:opacity-100 group-data-highlighted/duet-pane-tab:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          closeLayoutTabByUser(tab.id);
        }}
      >
        <XIcon aria-hidden className="size-3" />
      </button>
    </MenuItem>
  );
}

function DuetPaneTabsMenu({
  before,
  after,
}: {
  before: readonly LayoutTab[];
  after: readonly LayoutTab[];
}) {
  const gt = useGT();
  const tabs = [...before, ...after];
  if (tabs.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={gt("Show tabs in this pane")}
            data-thread-title-chevron
            className="flex size-5 shrink-0 items-center justify-center rounded-badge text-muted-foreground outline-none [-webkit-app-region:no-drag] hover:surface-ghost-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ChevronDownIcon aria-hidden className="size-3" />
          </button>
        }
      />
      <MenuPopup align="start" width="wide">
        <MenuGroup>
          <MenuGroupLabel>
            <T>In this pane</T>
          </MenuGroupLabel>
          {before.map((tab) => (
            <PaneTabMenuItem key={tab.id} tab={tab} />
          ))}
          {after.map((tab) => (
            <PaneTabMenuItem key={tab.id} tab={tab} />
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function HiddenTerminalPill({
  hiddenTerminal,
  environmentId,
  threadId,
}: {
  hiddenTerminal: HiddenTerminalChip;
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-hidden-terminal-chip=""
            className="flex h-[22px] shrink-0 items-center gap-1 rounded-full px-1.5 text-muted-foreground text-[12px] outline-none [-webkit-app-region:no-drag] hover:surface-ghost-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={hiddenTerminal.onShow}
            onPointerDown={(event) =>
              beginLayoutContentDrag(event, {
                kind: "surface",
                threadRef: scopeThreadRef(environmentId, threadId),
                surface: { id: THREAD_TERMINAL_SURFACE_ID, kind: "thread-terminal" },
              })
            }
          />
        }
      >
        <SquareTerminal
          aria-hidden
          className={cn("size-3.5 shrink-0", hiddenTerminal.running && "text-success-foreground")}
        />
        <span className="min-w-0 truncate">
          <T>Terminal</T>
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {hiddenTerminal.shortcutLabel ?? <T>Show terminal</T>}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Tabless Duet title. It keeps tab drag/rename affordances while looking like a simple title. */
export function DuetHeaderTitle({
  captain,
  project,
  title,
  layoutTabId,
  environmentId,
  threadId,
  parentThreadLink,
  hiddenTerminal,
  siblingTabs,
  renamingTitle,
  onOpenThread,
  onPointerDown,
  onAuxClick,
  onDoubleClick,
  onClick,
  onRenameBlur,
  onRenameFocus,
  onRenameKeyDown,
}: {
  captain: Captain | null | undefined;
  project: EnvironmentProject | null;
  title: string;
  layoutTabId: string | null | undefined;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  parentThreadLink: { threadId: ThreadId; title: string } | null;
  hiddenTerminal: HiddenTerminalChip | null | undefined;
  siblingTabs: { before: readonly LayoutTab[]; after: readonly LayoutTab[] };
  renamingTitle: string | null;
  onOpenThread: (threadId: ThreadId) => void;
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  onAuxClick: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  onDoubleClick: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  onClick: ((event: ReactMouseEvent<HTMLButtonElement>) => void) | undefined;
  onRenameBlur: (event: ReactFocusEvent<HTMLInputElement>) => void;
  onRenameFocus: (event: ReactFocusEvent<HTMLInputElement>) => void;
  onRenameKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}) {
  const gt = useGT();
  return (
    <div className="flex min-w-0 items-center gap-1">
      {parentThreadLink ? (
        <button
          type="button"
          className="flex h-6 max-w-44 shrink-0 items-center gap-1 rounded-badge px-1 text-[12.5px] text-muted-foreground outline-none [-webkit-app-region:no-drag] hover:surface-ghost-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onOpenThread(parentThreadLink.threadId)}
          onPointerDown={(event) =>
            beginLayoutContentDrag(event, {
              kind: "thread",
              threadRef: scopeThreadRef(environmentId, parentThreadLink.threadId),
            })
          }
        >
          <span aria-hidden>‹</span>
          <span className="min-w-0 truncate" dir={textDirection(parentThreadLink.title)}>
            {parentThreadLink.title}
          </span>
          <span aria-hidden>/</span>
        </button>
      ) : null}
      {renamingTitle !== null ? (
        <div
          className="flex h-7 max-w-72 items-center gap-1.5 px-2 ps-5 inset-ring inset-ring-ring/50 focus-within:inset-ring-ring"
          data-duet-header-title
        >
          {captain ? (
            <CaptainAvatar avatar={captain.avatar} size="row" />
          ) : project ? (
            <ProjectFavicon project={project} className="size-4 shrink-0" />
          ) : null}
          <input
            autoFocus
            dir="auto"
            aria-label={gt("Thread title")}
            className="min-w-24 max-w-full bg-transparent text-body outline-none [field-sizing:content]"
            defaultValue={renamingTitle}
            onBlur={onRenameBlur}
            onFocus={onRenameFocus}
            onKeyDown={onRenameKeyDown}
          />
        </div>
      ) : (
        <>
          <TitleButton
            captain={captain}
            project={project}
            title={title}
            layoutTabId={layoutTabId}
            onPointerDown={onPointerDown}
            onAuxClick={onAuxClick}
            onDoubleClick={onDoubleClick}
            onClick={onClick}
          />
          <DuetPaneTabsMenu before={siblingTabs.before} after={siblingTabs.after} />
        </>
      )}
      {hiddenTerminal ? (
        <HiddenTerminalPill
          hiddenTerminal={hiddenTerminal}
          environmentId={environmentId}
          threadId={threadId}
        />
      ) : null}
    </div>
  );
}
