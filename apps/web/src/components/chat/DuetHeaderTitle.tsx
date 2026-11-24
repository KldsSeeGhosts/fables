/* oxlint-disable t3code/no-styled-raw-controls -- The tabless Duet title keeps exact ghost-button geometry outside shared button variants. */
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { Captain, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ChevronDownIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import { ProjectFavicon } from "../ProjectFavicon";
import { CaptainAvatar } from "../captains/CaptainAvatar";
import { CaptainHeaderActions } from "../captains/CaptainHeaderActions";

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
      <span className="min-w-0 truncate text-foreground text-body">{title}</span>
      <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** Tabless Duet title. It keeps tab drag/rename affordances while looking like a simple title. */
export function DuetHeaderTitle({
  captain,
  project,
  threadRef,
  title,
  onOpenCaptain,
  layoutTabId,
  onPointerDown,
  onAuxClick,
  onDoubleClick,
  onClick,
}: {
  captain: Captain | null | undefined;
  project: EnvironmentProject | null;
  threadRef: ScopedThreadRef;
  title: string;
  onOpenCaptain: (threadId: ThreadId) => void;
  layoutTabId: string | null | undefined;
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  onAuxClick: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  onDoubleClick: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  onClick: ((event: ReactMouseEvent<HTMLButtonElement>) => void) | undefined;
}) {
  const button = (
    <TitleButton
      captain={captain}
      project={project}
      title={title}
      layoutTabId={layoutTabId}
      onPointerDown={onPointerDown}
      onAuxClick={onAuxClick}
      onDoubleClick={onDoubleClick}
      onClick={captain ? undefined : onClick}
    />
  );
  if (!captain) return button;
  return (
    <CaptainHeaderActions
      captain={captain}
      threadRef={threadRef}
      onOpen={onOpenCaptain}
      trigger={button}
    />
  );
}
