/* oxlint-disable t3code/no-styled-raw-controls, shadcn/no-arbitrary-values -- Duet channel rows use exact Anthropic theme geometry and palette colors outside the shared control variants. */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainAttentionTotal,
  captainConversationKeys,
  captainThreadActivity,
} from "@t3tools/client-runtime/state/captains";
import type { Captain, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { CompassIcon, EllipsisIcon, LayersIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { flushSync } from "react-dom";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useTheme } from "../../hooks/useTheme";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { Badge } from "../ui/badge";
import { Button, ContentButton } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton } from "../ui/sidebar";
import { CaptainAvatar } from "./CaptainAvatar";
import { captainChannelViewAtom, type CaptainChannelView } from "./captainBriefTab";
import { CaptainProfileDialogs, useCaptainProfile } from "./CaptainBriefPanel";
import { CaptainEditorDialog } from "./CaptainEditorDialog";
import { useCaptainDestinations, useCaptainEnvironments } from "./captainsDirectory";

/** Thread keys of Captain conversations, which the shelf lists instead of their project. */
export function useCaptainConversationKeys(): ReadonlySet<string> {
  const { supporting, results } = useCaptainEnvironments();
  const joined = captainConversationKeys(
    supporting.map(({ environmentId }, index) => ({
      environmentId,
      captains: AsyncResult.getOrElse(results[index]!, () => null)?.captains ?? [],
    })),
  );
  return joined === "" ? NO_CAPTAIN_CONVERSATIONS : new Set(joined.split("\n"));
}

const NO_CAPTAIN_CONVERSATIONS: ReadonlySet<string> = new Set();

/** The sidebar's entry to the Captains page, with the number of Captains waiting on the user. */
export function CaptainsHubRow({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const gt = useGT();
  const isDuet = useTheme().theme === "ksg-salon";
  const { supporting, results } = useCaptainEnvironments();
  const shells = useThreadShells(supporting.length > 0);
  if (supporting.length === 0) return null;
  const attention = captainAttentionTotal(
    supporting.map(({ environmentId }, index) => ({
      environmentId,
      captains: AsyncResult.getOrElse(results[index]!, () => null)?.captains ?? [],
    })),
    shells,
  );
  const badge =
    attention > 0 ? (
      <Badge
        variant="warning"
        size="sm"
        aria-label={gt(
          "{count, plural, one {{count} Captain needs input} other {{count} Captains need input}}",
          { count: attention },
        )}
      >
        {attention}
      </Badge>
    ) : null;
  if (isDuet) {
    return (
      <button
        type="button"
        data-sidebar-row="nav:captains"
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-label text-[#141413] outline-none select-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:text-[#ececec] dark:hover:bg-white/7",
          active &&
            "bg-[var(--duet-row-active,var(--sidebar-accent))] hover:bg-[var(--duet-row-active,var(--sidebar-accent))]",
        )}
        onClick={onOpen}
      >
        <LayersIcon aria-hidden className="size-4 shrink-0 text-[#d97757]" />
        <span className="min-w-0 flex-1 truncate">
          <T context="the Captains home page">Everything</T>
        </span>
        {badge}
      </button>
    );
  }
  return (
    <SidebarMenuButton
      data-sidebar-row="nav:captains"
      className="mt-1"
      isActive={active}
      aria-current={active ? "page" : undefined}
      onClick={onOpen}
    >
      <CompassIcon />
      <span className="min-w-0 flex-1 truncate">
        <T context="the Captains home page">Everything</T>
      </span>
      {badge}
    </SidebarMenuButton>
  );
}

function DuetTreeConnector() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute top-[-2px] left-0 h-[calc(100%+4px)] w-[30px] overflow-visible text-[#e5e5e5] dark:text-[#333333]"
      viewBox="0 0 30 32"
      fill="none"
    >
      <path d="M15.5 -6V38" stroke="currentColor" strokeWidth="1" />
      <path d="M15.5 10Q15.5 16 21.5 16H29" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CaptainShelfRow({
  captain,
  environmentId,
  label,
  attention,
  working,
  selected,
  onOpen,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  label?: string;
  attention: number;
  working: boolean;
  selected: boolean;
  onOpen: (threadRef: ScopedThreadRef) => void;
}) {
  const gt = useGT();
  const isDuet = useTheme().theme === "ksg-salon";
  const threadRef = scopeThreadRef(environmentId, captain.primaryThreadId);
  const openView = (view: CaptainChannelView) => {
    appAtomRegistry.set(captainChannelViewAtom(threadRef), view);
    onOpen(threadRef);
  };
  const profile = useCaptainProfile({
    captain,
    environmentId,
    onDelete: () => {},
  });
  const { current, archived, pending, canUpdate } = profile;
  const status = archived
    ? gt("Archived")
    : attention > 0
      ? gt("Needs input")
      : working
        ? gt("Working", { $context: "Captain status" })
        : gt("Ready");
  const avatarState = archived
    ? "archived"
    : attention > 0
      ? "waiting"
      : working
        ? "working"
        : "idle";
  const menu = (
    <Menu>
      <MenuTrigger
        render={<Button size="icon-xs" variant="ghost" />}
        aria-label={gt("Actions for {name}", { name: current.name })}
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => openView("tasks")}>
          <T>Open Tasks</T>
        </MenuItem>
        <MenuItem onClick={() => openView("make")}>
          <T>Open Docs</T>
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!canUpdate} onClick={profile.edit}>
          <T>Edit Captain</T>
        </MenuItem>
        <MenuItem
          disabled={pending || !profile.canArchive}
          onClick={() => void profile.changeArchive()}
        >
          {archived ? <T>Restore Captain</T> : <T>Archive Captain</T>}
        </MenuItem>
        {profile.canDelete ? (
          <>
            <MenuSeparator />
            <MenuItem variant="destructive" disabled={pending} onClick={profile.requestDelete}>
              <T>Delete Captain</T>
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );

  if (isDuet) {
    return (
      <li className="group/captain-row relative flex h-8 items-center">
        <DuetTreeConnector />
        <button
          type="button"
          aria-current={selected ? "page" : undefined}
          aria-label={gt("{name}, {status}", { name: current.name, status })}
          className={cn(
            "relative flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md pr-8 pl-7.5 text-left text-label text-[#141413] outline-none select-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:text-[#ececec] dark:hover:bg-white/7",
            selected &&
              "bg-[var(--duet-row-active,var(--sidebar-accent))] hover:bg-[var(--duet-row-active,var(--sidebar-accent))]",
          )}
          onClick={() => onOpen(threadRef)}
        >
          <CaptainAvatar avatar={current.avatar} state={avatarState} />
          <span className="min-w-0 flex-1 truncate">{current.name}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 group-hover/captain-row:opacity-0 group-focus-within/captain-row:opacity-0">
            {!archived && attention > 0 ? (
              <>
                <span className="size-1.5 rounded-full" style={{ backgroundColor: "#a98546" }} />
                <span className="text-meta tabular-nums" style={{ color: "#a98546" }}>
                  {attention}
                </span>
              </>
            ) : !archived && working ? (
              <span className="size-1.5 rounded-full" style={{ backgroundColor: "#d97757" }} />
            ) : null}
          </span>
        </button>
        <div className="absolute right-1 shrink-0 opacity-0 transition-opacity group-focus-within/captain-row:opacity-100 group-hover/captain-row:opacity-100">
          {menu}
        </div>
        <CaptainProfileDialogs profile={profile} />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group/captain-row relative flex items-center",
        selected && "surface-sidebar-row-selected rounded-row",
      )}
    >
      <ContentButton
        variant="inset-row-multiline"
        aria-current={selected ? "page" : undefined}
        aria-label={gt("{name}, {status}", { name: current.name, status })}
        onClick={() => onOpen(threadRef)}
      >
        <CaptainAvatar avatar={current.avatar} state={avatarState} />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-label">{current.name}</span>
          <span
            className={cn(
              "truncate text-micro",
              !archived && attention > 0
                ? "text-warning-foreground"
                : !archived && working
                  ? "text-info-foreground"
                  : "text-muted-foreground",
            )}
          >
            {status}
          </span>
        </span>
        {label ? (
          <span className="max-w-20 truncate text-micro text-muted-foreground">{label}</span>
        ) : null}
      </ContentButton>
      <div className="shrink-0 opacity-0 transition-opacity group-focus-within/captain-row:opacity-100 group-hover/captain-row:opacity-100">
        {menu}
      </div>
      <CaptainProfileDialogs profile={profile} />
    </li>
  );
}

export function CaptainShelfList({
  rows,
  activeThread,
  onOpen,
  onCreate,
  onReveal,
}: {
  rows: ReadonlyArray<{
    environmentId: EnvironmentId;
    label?: string;
    captain: Captain;
    attention: number;
    working: boolean;
  }>;
  activeThread: ScopedThreadRef | null;
  onOpen: (threadRef: ScopedThreadRef) => void;
  onCreate?: (() => void) | undefined;
  onReveal?: ((header: HTMLElement) => void) | undefined;
}) {
  const gt = useGT();
  const isDuet = useTheme().theme === "ksg-salon";
  const [expanded, setExpanded] = useLocalStorage(
    "t3code:sidebar:captains-expanded",
    true,
    Schema.Boolean,
  );
  const activeCount = rows.filter(({ captain }) => captain.archivedAt === null).length;
  const attention = rows.reduce(
    (count, row) => count + Number(row.captain.archivedAt === null && row.attention > 0),
    0,
  );
  const rowList = rows.map(({ captain, environmentId, label, attention, working }) => (
    <CaptainShelfRow
      key={`${environmentId}:${captain.id}`}
      captain={captain}
      environmentId={environmentId}
      {...(label !== undefined ? { label } : {})}
      attention={attention}
      working={working}
      selected={
        activeThread?.environmentId === environmentId &&
        activeThread.threadId === captain.primaryThreadId
      }
      onOpen={onOpen}
    />
  ));

  if (isDuet) {
    return (
      <li className="list-none">
        <ul className="flex flex-col">{rowList}</ul>
        {onCreate ? (
          <button
            type="button"
            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md pr-2 pl-7.75 text-left text-label outline-none select-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/7"
            style={{ color: "#717075" }}
            onClick={onCreate}
            aria-label={gt("New channel")}
          >
            <PlusIcon aria-hidden className="size-3.5" />
            <T>New channel</T>
          </button>
        ) : null}
        <div
          aria-hidden
          className="mx-3 mt-1 h-px"
          style={{ backgroundColor: "var(--duet-hairline, var(--border))" }}
        />
      </li>
    );
  }

  return (
    <li className="mx-0.5 mb-1 list-none">
      <div className="flex items-center">
        <CollapsibleSectionHeader
          data-sidebar-row="shelf:captains"
          tone="shelf"
          expanded={expanded}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            if (expanded) {
              setExpanded(false);
            } else {
              flushSync(() => setExpanded(true));
              onReveal?.(event.currentTarget);
            }
          }}
          accessory={
            !expanded && attention > 0 ? (
              <SectionHeaderStatus>
                <span
                  aria-label={gt(
                    "{count, plural, one {{count} Captain needs input} other {{count} Captains need input}}",
                    { count: attention },
                  )}
                >
                  {attention}
                </span>
              </SectionHeaderStatus>
            ) : (
              <span className="text-meta tabular-nums">{activeCount}</span>
            )
          }
        >
          <T>Channels</T>
        </CollapsibleSectionHeader>
        {onCreate ? (
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onCreate}
            aria-label={gt("New Captain")}
            title={gt("New Captain")}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      {expanded ? <ul className="space-y-0.5">{rowList}</ul> : null}
    </li>
  );
}

export function CaptainsShelf({
  primaryEnvironmentId,
  activeThread,
  onOpen,
  onReveal,
}: {
  primaryEnvironmentId: EnvironmentId | null;
  activeThread: ScopedThreadRef | null;
  onOpen: (threadRef: ScopedThreadRef) => void;
  onReveal: (header: HTMLElement) => void;
}) {
  const { supporting, results } = useCaptainEnvironments();
  const { destinations, destination } = useCaptainDestinations(primaryEnvironmentId);
  const shells = useThreadShells(supporting.length > 0);
  const [creating, setCreating] = useState(false);
  if (supporting.length === 0) return null;

  const rows = supporting
    .flatMap(({ environmentId, label }, index) =>
      (AsyncResult.getOrElse(results[index]!, () => null)?.captains ?? []).map((captain) => ({
        environmentId,
        ...(supporting.length > 1 ? { label } : {}),
        captain,
        ...captainThreadActivity(environmentId, captain, shells),
      })),
    )
    .toSorted(
      (a, b) => Number(a.captain.archivedAt !== null) - Number(b.captain.archivedAt !== null),
    );

  return (
    <>
      <CaptainShelfList
        rows={rows}
        activeThread={activeThread}
        onOpen={onOpen}
        onReveal={onReveal}
        onCreate={destination ? () => setCreating(true) : undefined}
      />
      {creating && destination ? (
        <CaptainEditorDialog
          destination={destination}
          destinations={destinations}
          onClose={() => setCreating(false)}
          onSave={(environmentId, captain) => {
            setCreating(false);
            onOpen(scopeThreadRef(environmentId, captain.primaryThreadId));
          }}
        />
      ) : null}
    </>
  );
}
