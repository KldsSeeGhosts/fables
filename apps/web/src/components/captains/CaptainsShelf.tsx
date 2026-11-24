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
import { useDuetShell } from "../../hooks/useDuetShell";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { Badge } from "../ui/badge";
import { Button, ContentButton } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton } from "../ui/sidebar";
import { CaptainAvatar } from "./CaptainAvatar";
import { captainBriefTabAtom, openCaptainTasks, type CaptainDrawerTab } from "./captainBriefTab";
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
  const isDuet = useDuetShell();
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
      <div className="relative">
        <ContentButton
          variant="duet-row"
          data-sidebar-row="nav:captains"
          aria-current={active ? "page" : undefined}
          onClick={onOpen}
        >
          <LayersIcon aria-hidden className="size-4 shrink-0 text-(--duet-working)" />
          <span className="min-w-0 flex-1 truncate">
            <T context="the Captains home page">Everything</T>
          </span>
          {badge}
        </ContentButton>
        {/* The channel tree's trunk starts here and crosses the header group's bottom padding. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-full left-4 h-2 w-px bg-(--duet-tree-line)"
        />
      </div>
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

/** Each tree row draws its own branch from the trunk, so a row's fill never paints over it. */
const DUET_TREE_BRANCH_CLASS_NAME =
  "relative flex h-8 items-center ps-6 before:pointer-events-none before:absolute before:top-0 before:left-4 before:h-4.25 before:w-2 before:rounded-bl-md before:border-b before:border-l before:border-(--duet-tree-line)";

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
  const isDuet = useDuetShell();
  const threadRef = scopeThreadRef(environmentId, captain.primaryThreadId);
  const openView = (tab: CaptainDrawerTab) => {
    appAtomRegistry.set(captainBriefTabAtom(threadRef), tab === "docs" ? "docs" : "brief");
    openCaptainTasks(threadRef, tab);
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
        <MenuItem onClick={() => openView("today")}>
          <T>Open Tasks</T>
        </MenuItem>
        <MenuItem onClick={() => openView("docs")}>
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
      <li className={cn("group/captain-row", DUET_TREE_BRANCH_CLASS_NAME)}>
        <ContentButton
          variant="duet-row"
          aria-current={selected ? "page" : undefined}
          aria-label={gt("{name}, {status}", { name: current.name, status })}
          onClick={() => onOpen(threadRef)}
        >
          <CaptainAvatar avatar={current.avatar} state={avatarState} />
          <span className="min-w-0 flex-1 truncate">{current.name}</span>
          <span className="ms-auto flex shrink-0 items-center gap-1 group-focus-within/captain-row:opacity-0 group-hover/captain-row:opacity-0">
            {!archived && attention > 0 ? (
              <>
                <span className="size-1.5 rounded-full bg-(--duet-needs-input-ring)" />
                <span className="text-meta text-(--duet-needs-input-ring) tabular-nums">
                  {attention}
                </span>
              </>
            ) : !archived && working ? (
              <span className="size-1.5 rounded-full bg-(--duet-working)" />
            ) : null}
          </span>
        </ContentButton>
        <div className="absolute end-1 shrink-0 opacity-0 transition-opacity group-focus-within/captain-row:opacity-100 group-hover/captain-row:opacity-100">
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
  const isDuet = useDuetShell();
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
        {rowList.length > 0 || onCreate ? (
          <div className="relative">
            {/* The trunk stops one row short; the last row's branch curves it into its midpoint. */}
            <span
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-8 left-4 w-px bg-(--duet-tree-line)"
            />
            <ul className="flex flex-col">{rowList}</ul>
            {onCreate ? (
              <div className={DUET_TREE_BRANCH_CLASS_NAME}>
                <ContentButton
                  variant="duet-row-quiet"
                  onClick={onCreate}
                  aria-label={gt("New channel")}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <PlusIcon aria-hidden className="size-3.5" />
                  </span>
                  <T>New channel</T>
                </ContentButton>
              </div>
            ) : null}
          </div>
        ) : null}
        <div aria-hidden className="mx-1 my-2 h-px bg-(--duet-hairline)" />
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
