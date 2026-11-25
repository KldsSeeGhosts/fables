/* oxlint-disable t3code/no-styled-raw-controls -- The Captains section label doubles as the overview link and matches the Threads label beside it. */
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { ClockIcon, EllipsisIcon, FoldersIcon, ListTodoIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { cn } from "../../lib/utils";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentMachines } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { RelativeTime } from "../RelativeTime";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Button, ContentButton } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import {
  RelativeTimeLabel as SidebarRelativeTimeLabel,
  SidebarStatusLabel,
} from "../sidebar/SidebarThreadRow";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import { CaptainAvatar } from "./CaptainAvatar";
import { captainPaletteOf } from "./captainPalette";
import { CaptainTaskRing } from "./CaptainTaskRing";
import { captainBriefTabAtom, openCaptainTasks, type CaptainDrawerTab } from "./captainBriefTab";
import { CaptainProfileDialogs, useCaptainProfile } from "./CaptainBriefPanel";
import { CaptainEditorDialog } from "./CaptainEditorDialog";
import { useCaptainDestinations, useCaptainEnvironments } from "./captainsDirectory";
import { orderDuets } from "./duetOrder.logic";

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
const DUET_ORDER_STORAGE_KEY = "t3code:sidebar:duet-order";
const DUET_ORDER_SCHEMA = Schema.Array(Schema.String);
const DUET_DRAG_MODIFIERS = [restrictToVerticalAxis, restrictToFirstScrollableAncestor];
const DUET_POINTER_ACTIVATION = { activationConstraint: { distance: 6 } };

const duetRowKey = (environmentId: EnvironmentId, captain: Pick<Captain, "id">) =>
  `${environmentId}:${captain.id}`;

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
 * A Duet channel is a 48px two-line row: creature and name first, then its live work or scope.
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
  const rowKey = duetRowKey(environmentId, captain);
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rowKey,
    disabled: archived,
  });

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
  const attentionThread = waiting
    ? [primary, ...running].find(
        (thread) =>
          thread?.hasPendingApprovals ||
          thread?.hasPendingUserInput ||
          thread?.pendingSubagentRequest != null,
      )
    : undefined;
  const liveThread = attentionThread ?? (busy ? running[0] : undefined);
  const lead = busy && running.length > 0 ? gt("{count} running", { count: running.length }) : null;
  const workingDetail =
    running.length === 1
      ? running[0]!.title
      : running.length > 1
        ? gt("{count} running", { count: running.length })
        : null;
  const waitingDetail =
    attentionThread !== undefined && attentionThread.id !== captain.primaryThreadId
      ? attentionThread.title
      : null;
  const waitingKind = attentionThread?.hasPendingApprovals
    ? "approval"
    : attentionThread?.hasPendingUserInput
      ? "input"
      : "request";
  const role = captain.role.trim();
  const details = (
    archived ? [] : [lead, liveThread?.title, ...(waiting || busy ? [] : [label, scope, role])]
  ).filter((part): part is string => !!part);
  const accessibleLabel =
    details.length === 0
      ? gt("{name}, {status}", { name, status })
      : gt("{name}, {status}, {detail}", { name, status, detail: details.join(", ") });
  const detailText = archived ? null : waiting ? waitingDetail : busy ? workingDetail : scope;
  const trailing = waiting ? (
    <DuetLiveCount
      tone="needs-input"
      count={attention}
      label={gt("{count, plural, one {{count} request} other {{count} requests}}", {
        count: attention,
      })}
    />
  ) : !archived && !busy && primary ? (
    <span className="text-meta text-placeholder tabular-nums">
      <SidebarRelativeTimeLabel timestamp={primary.updatedAt} />
    </span>
  ) : null;

  return (
    <li
      ref={setNodeRef}
      data-duet-channel-card=""
      data-duet-palette={captainPaletteOf(captain.avatar)}
      className={cn(
        "group/captain-row relative flex items-center",
        isDragging && "z-20 rounded-lg bg-sidebar shadow-lg",
      )}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
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
            size="sidebar"
            state={archived ? "archived" : waiting ? "waiting" : busy ? "working" : "idle"}
          />
          <span className="grid min-w-0 flex-1 content-center gap-0.5">
            <span className="flex h-[18px] min-w-0 items-center gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-label",
                  archived && "text-muted-foreground",
                )}
              >
                {name}
              </span>
              {trailing ? (
                <span className="flex shrink-0 transition-opacity duration-120 group-focus-within/captain-row:opacity-0 group-hover/captain-row:opacity-0">
                  {trailing}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "flex h-4 min-w-0 items-center gap-1.5 text-meta leading-4",
                waiting
                  ? "text-(--duet-needs-input-text)"
                  : busy
                    ? "text-(--duet-working-text)"
                    : "text-muted-foreground",
              )}
            >
              {archived ? (
                <span className="shrink-0 text-muted-foreground">{status}</span>
              ) : waiting || busy ? (
                <SidebarStatusLabel
                  environmentId={environmentId}
                  compact
                  kind={waiting ? waitingKind : "working"}
                  label={status}
                  workingStartedAt={null}
                />
              ) : scoped.length === 1 ? (
                <ProjectFavicon project={scoped[0]!} className="size-3.5 shrink-0" />
              ) : (
                <FoldersIcon aria-hidden className="size-3 shrink-0 text-icon-muted" />
              )}
              <span className="min-w-0 flex-1 truncate">{detailText}</span>
              {label !== undefined ? (
                <span className="max-w-20 shrink-0 truncate pl-1 text-caption text-placeholder">
                  {label}
                </span>
              ) : null}
            </span>
          </span>
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
      <div className="absolute end-1.5 top-1/2 shrink-0 -translate-y-1/2 opacity-0 transition-opacity duration-120 group-focus-within/captain-row:opacity-100 group-hover/captain-row:opacity-100">
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
    appAtomRegistry.set(captainBriefTabAtom(threadRef), "brief");
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
        <MenuItem onClick={() => profile.edit("memory")}>
          <T>Memory</T>
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!canUpdate} onClick={() => profile.edit()}>
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

/**
 * Captains are the sidebar's one channel list: the header opens the Captains overview, and each
 * row opens that Captain's conversation.
 */
export function CaptainShelfList({
  rows,
  activeThread,
  attention: attentionTotal,
  overviewActive = false,
  onOpen,
  onOpenOverview,
  onCreate,
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
  /** Captains waiting on the user, counting their delegated threads; defaults to the rows'. */
  attention?: number | undefined;
  overviewActive?: boolean;
  onOpen: (threadRef: ScopedThreadRef) => void;
  onOpenOverview?: (() => void) | undefined;
  onCreate?: (() => void) | undefined;
}) {
  const gt = useGT();
  const isDuet = useDuetShell();
  const attention =
    attentionTotal ??
    rows.reduce(
      (count, row) => count + Number(row.captain.archivedAt === null && row.attention > 0),
      0,
    );
  const attentionLabel = isDuet
    ? gt("{count, plural, one {{count} Duet needs input} other {{count} Duets need input}}", {
        count: attention,
      })
    : gt("{count, plural, one {{count} Captain needs input} other {{count} Captains need input}}", {
        count: attention,
      });
  const [savedDuetOrder, setSavedDuetOrder] = useLocalStorage(
    DUET_ORDER_STORAGE_KEY,
    [] as Array<string>,
    DUET_ORDER_SCHEMA,
  );
  const sensors = useSensors(useSensor(PointerSensor, DUET_POINTER_ACTIVATION));
  const orderedRows = isDuet
    ? orderDuets(
        rows.map((row) => ({
          key: duetRowKey(row.environmentId, row.captain),
          archived: row.captain.archivedAt !== null,
          row,
        })),
        savedDuetOrder,
      ).map(({ row }) => row)
    : rows;
  const orderedKeys = orderedRows.map((row) => duetRowKey(row.environmentId, row.captain));
  const duetName = (id: UniqueIdentifier | undefined) =>
    orderedRows.find((row) => duetRowKey(row.environmentId, row.captain) === id)?.captain.name ??
    "";
  const duetDragAnnouncements: Announcements = {
    onDragStart: ({ active }) => gt("Picked up {name}.", { name: duetName(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? gt("{name} is over {target}.", { name: duetName(active.id), target: duetName(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? gt("{name} was moved to {target}.", {
            name: duetName(active.id),
            target: duetName(over.id),
          })
        : gt("{name} was dropped.", { name: duetName(active.id) }),
    onDragCancel: ({ active }) => gt("Moving {name} was cancelled.", { name: duetName(active.id) }),
  };
  const handleDuetDragEnd = (event: DragEndEvent) => {
    if (event.over === null || event.active.id === event.over.id) return;
    const activeIndex = orderedKeys.indexOf(String(event.active.id));
    const overIndex = orderedKeys.indexOf(String(event.over.id));
    if (activeIndex === -1 || overIndex === -1) return;
    setSavedDuetOrder(arrayMove(orderedKeys, activeIndex, overIndex));
  };

  const heading = (
    <>
      <span className="truncate">{isDuet ? <T>Duets</T> : <T>Captains</T>}</span>
      {attention > 0 ? (
        <DuetLiveCount tone="needs-input" count={attention} label={attentionLabel} />
      ) : null}
    </>
  );

  const rowsList =
    orderedRows.length > 0 ? (
      <ul className="space-y-px">
        {orderedRows.map(({ captain, environmentId, label, attention, working, ...activity }) => (
          <CaptainShelfRow
            key={duetRowKey(environmentId, captain)}
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
        ))}
      </ul>
    ) : null;

  return (
    <li className="mb-1 list-none">
      <div
        data-sidebar-row="shelf:captains"
        className="group/captains-label mt-1 flex h-7 items-center justify-between gap-1 ps-2 pe-1"
      >
        {onOpenOverview ? (
          <button
            type="button"
            data-captains-overview-link=""
            aria-current={overviewActive ? "page" : undefined}
            onClick={onOpenOverview}
            className="-ms-1 flex h-6 min-w-0 cursor-pointer items-center gap-1.5 rounded-row px-1 text-meta text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:text-sidebar-foreground"
          >
            {heading}
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-sidebar-muted-foreground">
            {heading}
          </span>
        )}
        {onCreate ? (
          <span className="flex items-center opacity-60 focus-within:opacity-100 group-hover/captains-label:opacity-100">
            <SidebarHeaderIconButton
              size="label"
              label={isDuet ? gt("New Duet") : gt("New Captain")}
              onClick={onCreate}
            >
              <PlusIcon />
            </SidebarHeaderIconButton>
          </span>
        ) : null}
      </div>
      {isDuet ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={DUET_DRAG_MODIFIERS}
          onDragEnd={handleDuetDragEnd}
          accessibility={{ announcements: duetDragAnnouncements }}
        >
          <SortableContext items={orderedKeys} strategy={verticalListSortingStrategy}>
            {rowsList}
          </SortableContext>
        </DndContext>
      ) : (
        rowsList
      )}
    </li>
  );
}

export function CaptainsShelf({
  primaryEnvironmentId,
  activeThread,
  overviewActive,
  onOpen,
  onOpenOverview,
}: {
  primaryEnvironmentId: EnvironmentId | null;
  activeThread: ScopedThreadRef | null;
  overviewActive: boolean;
  onOpen: (threadRef: ScopedThreadRef) => void;
  onOpenOverview: () => void;
}) {
  const { supporting, results } = useCaptainEnvironments();
  const { destinations, destination } = useCaptainDestinations(primaryEnvironmentId);
  const shells = useThreadShells(supporting.length > 0);
  const [creating, setCreating] = useState(false);
  if (supporting.length === 0) return null;

  const environments = supporting.map(({ environmentId }, index) => ({
    environmentId,
    captains: AsyncResult.getOrElse(results[index]!, () => null)?.captains ?? [],
  }));
  const rows = supporting
    .flatMap(({ environmentId, label }, index) =>
      environments[index]!.captains.map((captain) => ({
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
        attention={captainAttentionTotal(environments, shells)}
        overviewActive={overviewActive}
        onOpen={onOpen}
        onOpenOverview={onOpenOverview}
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
