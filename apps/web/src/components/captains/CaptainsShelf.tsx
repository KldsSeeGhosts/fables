import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainAttentionTotal,
  captainConversationKeys,
  captainThreadActivity,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { T, useGT, Var } from "gt-react";
import {
  ClockIcon,
  CompassIcon,
  EllipsisIcon,
  FoldersIcon,
  ListTodoIcon,
  PlusIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useDuetShell } from "../../hooks/useDuetShell";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { cn } from "../../lib/utils";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentMachines } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { RelativeTime } from "../RelativeTime";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Badge } from "../ui/badge";
import { Button, ContentButton } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import { CaptainAvatar } from "./CaptainAvatar";
import { captainPaletteOf } from "./captainPalette";
import { CaptainTaskRing } from "./CaptainTaskRing";
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

/** A 6px status dot with an optional count, the only live text a Duet sidebar row carries. */
function DuetLiveCount({
  tone,
  count,
  label,
}: {
  tone: "working" | "needs-input";
  count?: number | undefined;
  label: string;
}) {
  return (
    <span
      data-duet-live={tone}
      aria-label={label}
      className={cn(
        "flex shrink-0 items-center gap-1 text-caption tabular-nums",
        tone === "working" ? "text-(--duet-working-text)" : "text-(--duet-needs-input-text)",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "working" ? "bg-(--duet-working)" : "bg-(--duet-needs-input-ring)",
        )}
      />
      {count !== undefined ? <span aria-hidden>{count}</span> : null}
    </span>
  );
}

type CaptainActivity = {
  primary?: EnvironmentThreadShell | undefined;
  children?: ReadonlyArray<EnvironmentThreadShell> | undefined;
};

/**
 * A Duet channel is one line: its mascot tile and name. Live state is drawn on the tile and in a
 * dot at the end; everything else waits in the hover card.
 */
function DuetChannelRow({
  captain,
  environmentId,
  label,
  attention,
  working,
  archived,
  status,
  selected,
  activity,
  menu,
  onOpen,
  children,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  label: string | undefined;
  attention: number;
  working: boolean;
  archived: boolean;
  status: string;
  selected: boolean;
  activity: CaptainActivity;
  menu: ReactNode;
  onOpen: () => void;
  children: ReactNode;
}) {
  const gt = useGT();
  const { name } = captain;
  const projects = useProjects();
  const machines = useEnvironmentMachines();
  const { primary, children: running = [] } = activity;
  const waiting = !archived && attention > 0;
  const busy = !archived && !waiting && working;

  const scoped = projects.filter(
    (project) =>
      project.environmentId === environmentId && captain.scopedProjectIds.includes(project.id),
  );
  const scope =
    captain.scopedProjectIds.length === 0
      ? gt("All workspace")
      : captain.scopedProjectIds.length === 1
        ? (scoped[0]?.title ?? gt("1 project"))
        : gt("{count} projects", { count: captain.scopedProjectIds.length });
  const backgroundTasks = primary?.pendingBackgroundTasks.length ?? 0;
  const liveThread = waiting
    ? [primary, ...running].find(
        (thread) =>
          thread?.hasPendingApprovals ||
          thread?.hasPendingUserInput ||
          thread?.pendingSubagentRequest != null,
      )
    : busy
      ? running[0]
      : undefined;
  const lead = busy && running.length > 0 ? gt("{count} running", { count: running.length }) : null;
  const role = captain.role.trim();
  const details = (
    archived ? [] : [lead, liveThread?.title, ...(waiting || busy ? [] : [label, scope, role])]
  ).filter((part): part is string => !!part);
  const accessibleLabel =
    details.length === 0
      ? gt("{name}, {status}", { name, status })
      : gt("{name}, {status}, {detail}", { name, status, detail: details.join(", ") });

  return (
    <li
      data-duet-channel-card=""
      data-duet-palette={captainPaletteOf(captain.avatar)}
      className="group/captain-row relative flex items-center"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ContentButton
              variant="duet-channel"
              aria-current={selected ? "page" : undefined}
              aria-label={accessibleLabel}
              onClick={onOpen}
            />
          }
        >
          <CaptainAvatar
            avatar={captain.avatar}
            size="channel"
            state={archived ? "archived" : waiting ? "waiting" : busy ? "working" : "idle"}
            attention={waiting}
          />
          <span className={cn("min-w-0 flex-1 truncate", archived && "text-muted-foreground")}>
            {name}
          </span>
          {waiting || (busy && running.length > 0) ? (
            <span className="flex shrink-0 transition-opacity duration-120 group-focus-within/captain-row:opacity-0 group-hover/captain-row:opacity-0">
              {waiting ? (
                <DuetLiveCount
                  tone="needs-input"
                  count={attention > 1 ? attention : undefined}
                  label={gt("{count, plural, one {{count} request} other {{count} requests}}", {
                    count: attention,
                  })}
                />
              ) : (
                <span
                  data-duet-live="working"
                  className="text-caption text-(--duet-working-text) tabular-nums"
                >
                  {running.length}
                </span>
              )}
            </span>
          ) : null}
        </TooltipTrigger>
        <ThreadHoverCardPopup side="right" align="start" sideOffset={8} className="w-64">
          <ThreadHoverCard title={name}>
            <div
              className={cn(
                "flex min-w-0 items-center gap-2",
                waiting
                  ? "text-(--duet-needs-input-text)"
                  : busy
                    ? "text-(--duet-working-text)"
                    : "text-foreground/75",
              )}
            >
              {waiting ? (
                <CaptainTaskRing status="needs-input" className="size-3" />
              ) : busy ? (
                <CaptainTaskRing status="working" className="size-3" />
              ) : null}
              <span className="min-w-0 truncate">{lead ?? status}</span>
            </div>
            {liveThread?.title ? (
              <div className="min-w-0 truncate text-foreground/75">{liveThread.title}</div>
            ) : null}
            {role !== "" ? <div className="min-w-0 line-clamp-2">{role}</div> : null}
            <div className="flex min-w-0 items-center gap-2">
              {scoped.length === 1 ? (
                <ProjectFavicon project={scoped[0]!} className="size-3 shrink-0" />
              ) : (
                <FoldersIcon aria-hidden className="size-3 shrink-0" />
              )}
              <span className="min-w-0 truncate">{scope}</span>
            </div>
            {label !== undefined ? (
              <div className="flex min-w-0 items-center gap-2">
                <EnvironmentMachineIcon
                  aria-hidden
                  kind={machines.get(environmentId) ?? "server"}
                  className="size-3 shrink-0 stroke-muted-foreground"
                />
                <span className="min-w-0 truncate">{label}</span>
              </div>
            ) : null}
            {backgroundTasks > 0 ? (
              <div className="flex min-w-0 items-center gap-2">
                <ListTodoIcon aria-hidden className="size-3 shrink-0" />
                <span className="min-w-0 truncate">
                  {gt(
                    "{count, plural, one {{count} background task} other {{count} background tasks}}",
                    { count: backgroundTasks },
                  )}
                </span>
              </div>
            ) : null}
            {archived && captain.archivedAt !== null ? (
              <div className="flex min-w-0 items-center gap-2">
                <ClockIcon aria-hidden className="size-3 shrink-0" />
                <T>
                  Archived{" "}
                  <Var>
                    <RelativeTime timestamp={captain.archivedAt} />
                  </Var>
                </T>
              </div>
            ) : primary ? (
              <div className="flex min-w-0 items-center gap-2">
                <ClockIcon aria-hidden className="size-3 shrink-0" />
                <T>
                  Active{" "}
                  <Var>
                    <RelativeTime timestamp={primary.updatedAt} />
                  </Var>
                </T>
              </div>
            ) : null}
          </ThreadHoverCard>
        </ThreadHoverCardPopup>
      </Tooltip>
      <div className="absolute end-1.5 shrink-0 opacity-0 transition-opacity duration-120 group-focus-within/captain-row:opacity-100 group-hover/captain-row:opacity-100">
        {menu}
      </div>
      {children}
    </li>
  );
}

function CaptainShelfRow({
  captain,
  environmentId,
  label,
  attention,
  working,
  activity,
  selected,
  onOpen,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  label?: string;
  attention: number;
  working: boolean;
  activity: CaptainActivity;
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
      <DuetChannelRow
        captain={current}
        environmentId={environmentId}
        label={label}
        attention={attention}
        working={working}
        archived={archived}
        status={status}
        selected={selected}
        activity={activity}
        menu={menu}
        onOpen={() => onOpen(threadRef)}
      >
        <CaptainProfileDialogs profile={profile} />
      </DuetChannelRow>
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
  rows: ReadonlyArray<
    {
      environmentId: EnvironmentId;
      label?: string;
      captain: Captain;
      attention: number;
      working: boolean;
    } & CaptainActivity
  >;
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
  const rowList = rows.map(({ captain, environmentId, label, attention, working, ...activity }) => (
    <CaptainShelfRow
      key={`${environmentId}:${captain.id}`}
      captain={captain}
      environmentId={environmentId}
      {...(label !== undefined ? { label } : {})}
      attention={attention}
      working={working}
      activity={activity}
      selected={
        activeThread?.environmentId === environmentId &&
        activeThread.threadId === captain.primaryThreadId
      }
      onOpen={onOpen}
    />
  ));

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
