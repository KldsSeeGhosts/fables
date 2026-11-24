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
import { CompassIcon, EllipsisIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "@tanstack/react-router";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { Badge } from "../ui/badge";
import { Button, ContentButton } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton } from "../ui/sidebar";
import { CaptainAvatar } from "./CaptainAvatar";
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
        <T>Captains</T>
      </span>
      {attention > 0 ? (
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
      ) : null}
    </SidebarMenuButton>
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
  const navigate = useNavigate();
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
        onClick={() => onOpen(scopeThreadRef(environmentId, current.primaryThreadId))}
      >
        <CaptainAvatar
          avatar={current.avatar}
          state={archived ? "archived" : attention > 0 ? "waiting" : working ? "working" : "idle"}
        />
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
        <Menu>
          <MenuTrigger
            render={<Button size="icon-xs" variant="ghost" />}
            aria-label={gt("Actions for {name}", { name: current.name })}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              onClick={() =>
                void navigate({
                  to: "/captains",
                  search: { env: environmentId, captain: current.id, view: "brief" },
                })
              }
            >
              <T>Open in Captains</T>
            </MenuItem>
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
          <T>Crew</T>
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
      {expanded ? (
        <ul className="space-y-0.5">
          {rows.map(({ captain, environmentId, label, attention, working }) => (
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
          ))}
        </ul>
      ) : null}
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
