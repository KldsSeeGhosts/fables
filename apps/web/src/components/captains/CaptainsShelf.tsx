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
import { T, useGT } from "gt-react";
import { CompassIcon, EllipsisIcon, LayersIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useDuetShell } from "../../hooks/useDuetShell";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { cn } from "../../lib/utils";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironmentMachines } from "../../state/environments";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { RelativeTimeLabel, type SidebarProviderEntry } from "../sidebar/SidebarThreadRow";
import { Badge } from "../ui/badge";
import { Button, ContentButton } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton } from "../ui/sidebar";
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
  const isDuet = useDuetShell();
  const { supporting, results } = useCaptainEnvironments();
  const shells = useThreadShells(supporting.length > 0);
  if (supporting.length === 0) return null;
  const environments = supporting.map(({ environmentId }, index) => ({
    environmentId,
    captains: AsyncResult.getOrElse(results[index]!, () => null)?.captains ?? [],
  }));
  const attention = captainAttentionTotal(environments, shells);
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
      // The header group's 8px bottom padding shrinks to the tree's 2px row gap.
      <div className="relative -mb-1.5">
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
          <DuetHubSummary environments={environments} shells={shells} attention={attention} />
        </ContentButton>
        {/* The channel tree's trunk starts here and crosses the header group's bottom padding. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-full left-4 h-0.5 w-px bg-(--duet-tree-line)"
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

/** Live channel counts beside Everything: who is working, who needs input, or how many exist. */
function DuetHubSummary({
  environments,
  shells,
  attention,
}: {
  environments: ReadonlyArray<{ environmentId: EnvironmentId; captains: ReadonlyArray<Captain> }>;
  shells: ReadonlyArray<EnvironmentThreadShell>;
  attention: number;
}) {
  const gt = useGT();
  const active = environments.flatMap(({ environmentId, captains }) =>
    captains
      .filter((captain) => captain.archivedAt === null)
      .map((captain) => captainThreadActivity(environmentId, captain, shells)),
  );
  const working = active.filter((row) => row.working && row.attention === 0).length;
  if (working === 0 && attention === 0) {
    return active.length > 0 ? (
      <span
        data-duet-channel-stat=""
        className="shrink-0 text-caption text-(--duet-meta) tabular-nums"
      >
        {active.length}
      </span>
    ) : null;
  }
  return (
    <span className="ms-auto flex shrink-0 items-center gap-2">
      {working > 0 ? (
        <span
          data-duet-channel-stat=""
          className="flex items-center gap-1 text-caption text-(--duet-working-text) tabular-nums"
          aria-label={gt(
            "{count, plural, one {{count} channel working} other {{count} channels working}}",
            { count: working },
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-(--duet-working)" />
          {working}
        </span>
      ) : null}
      {attention > 0 ? (
        <DuetAttentionPill
          count={attention}
          label={gt(
            "{count, plural, one {{count} Captain needs input} other {{count} Captains need input}}",
            { count: attention },
          )}
        />
      ) : null}
    </span>
  );
}

function DuetAttentionPill({ count, label }: { count: number; label: string }) {
  return (
    <span
      data-duet-attention-pill=""
      aria-label={label}
      className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1.5 text-micro tabular-nums"
    >
      {count}
    </span>
  );
}

/**
 * Each tree row draws its own branch from the trunk, so a row's fill never paints over it. The
 * branch lands on the row's midpoint, which `--duet-tree-row` sets.
 */
const DUET_TREE_BRANCH_CLASS_NAME =
  "relative flex h-(--duet-tree-row) items-center ps-6 before:pointer-events-none before:absolute before:top-0 before:left-4 before:h-[calc(var(--duet-tree-row)/2+1px)] before:w-2 before:rounded-bl-md before:border-b before:border-l before:border-(--duet-tree-line)";
const DUET_TREE_ROW_CLASS_NAME = "[--duet-tree-row:--spacing(8)]";
const DUET_TREE_CHANNEL_CLASS_NAME = "[--duet-tree-row:--spacing(14)]";

const DETAIL_SEPARATOR = " · ";

type ProviderEntriesByEnvironment = ReadonlyMap<string, ReadonlyMap<string, SidebarProviderEntry>>;

type CaptainActivity = {
  primary?: EnvironmentThreadShell | undefined;
  children?: ReadonlyArray<EnvironmentThreadShell> | undefined;
};

function DuetChannelCard({
  captain,
  environmentId,
  label,
  attention,
  working,
  archived,
  status,
  selected,
  activity,
  providerEntries,
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
  providerEntries: ReadonlyMap<string, SidebarProviderEntry> | undefined;
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
  const waitingThread = [primary, ...running].find(
    (thread) =>
      thread?.hasPendingApprovals ||
      thread?.hasPendingUserInput ||
      thread?.pendingSubagentRequest != null,
  );

  const lead = waiting
    ? gt("Needs input")
    : busy
      ? running.length > 0
        ? gt("{count} running", { count: running.length })
        : backgroundTasks > 0
          ? gt("{count, plural, one {{count} background task} other {{count} background tasks}}", {
              count: backgroundTasks,
            })
          : gt("Working", { $context: "Captain status" })
      : null;
  const role = captain.role.trim();
  const rest = archived
    ? []
    : waiting
      ? [waitingThread?.title]
      : busy
        ? [running[0]?.title]
        : [label, scope, role];
  const details = rest.filter((part): part is string => !!part);
  const detail = [lead !== status ? lead : null, ...details]
    .filter((part): part is string => !!part)
    .join(", ");

  const providerInstanceId = primary
    ? (primary.runtime?.providerInstanceId ?? primary.modelSelection.instanceId)
    : null;
  const provider = providerInstanceId ? providerEntries?.get(providerInstanceId) : undefined;
  const slotFade =
    "transition-opacity duration-120 group-focus-within/captain-row:opacity-0 group-hover/captain-row:opacity-0";

  return (
    <li
      data-duet-channel-card=""
      data-duet-palette={captainPaletteOf(captain.avatar)}
      className={cn(
        "group/captain-row",
        DUET_TREE_BRANCH_CLASS_NAME,
        DUET_TREE_CHANNEL_CLASS_NAME,
        selected && "before:border-(--duet-channel-branch-active)",
      )}
    >
      <ContentButton
        variant="duet-channel"
        aria-current={selected ? "page" : undefined}
        aria-label={
          detail === ""
            ? gt("{name}, {status}", { name, status })
            : gt("{name}, {status}, {detail}", { name, status, detail })
        }
        onClick={onOpen}
      >
        <CaptainAvatar
          avatar={captain.avatar}
          size="large"
          state={archived ? "archived" : waiting ? "waiting" : busy ? "working" : "idle"}
          halo={waiting ? "needs-input" : busy ? "working" : undefined}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex h-4.5 min-w-0 items-center gap-2">
            <span
              data-duet-card-title={archived ? "receded" : ""}
              className={cn(
                "min-w-0 flex-1 truncate text-control",
                archived && "text-muted-foreground",
              )}
            >
              {name}
            </span>
            {archived ? null : waiting ? (
              <span className={cn("flex shrink-0", slotFade)}>
                <DuetAttentionPill
                  count={attention}
                  label={gt("{count, plural, one {{count} request} other {{count} requests}}", {
                    count: attention,
                  })}
                />
              </span>
            ) : primary ? (
              <span
                data-duet-channel-stat=""
                className={cn("shrink-0 text-caption text-(--duet-meta) tabular-nums", slotFade)}
              >
                <RelativeTimeLabel timestamp={primary.updatedAt} />
              </span>
            ) : null}
          </span>
          <span
            data-duet-channel-meta=""
            className="flex h-4 min-w-0 items-center gap-1.5 text-meta text-muted-foreground"
          >
            {waiting ? (
              <CaptainTaskRing status="needs-input" className="size-3" />
            ) : busy ? (
              <CaptainTaskRing status="working" className="size-3" />
            ) : archived ? null : label !== undefined ? (
              <EnvironmentMachineIcon
                aria-hidden
                kind={machines.get(environmentId) ?? "server"}
                className="size-3 shrink-0 text-icon-muted"
              />
            ) : scoped.length === 1 ? (
              <ProjectFavicon project={scoped[0]!} className="size-3 shrink-0" />
            ) : null}
            <span className="min-w-0 flex-1 truncate">
              {archived ? (
                <>
                  <T>Archived</T>
                  {captain.archivedAt !== null ? (
                    <>
                      {DETAIL_SEPARATOR}
                      <RelativeTimeLabel timestamp={captain.archivedAt} />
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  {lead !== null ? (
                    <span
                      className={
                        waiting ? "text-(--duet-needs-input-text)" : "text-(--duet-working-text)"
                      }
                    >
                      {lead}
                    </span>
                  ) : null}
                  {details.length > 0
                    ? `${lead !== null ? DETAIL_SEPARATOR : ""}${details.join(DETAIL_SEPARATOR)}`
                    : null}
                </>
              )}
            </span>
            {provider ? (
              <span className={cn("flex shrink-0", slotFade)}>
                <ProviderInstanceIcon
                  driverKind={provider.driverKind}
                  displayName={provider.displayName}
                  accentColor={provider.accentColor}
                  acpRegistryAgentId={provider.acpRegistryAgentId}
                  acpRegistryIconUrl={provider.acpRegistryIconUrl}
                  size="compact"
                  iconClassName="size-3.5 opacity-60"
                />
              </span>
            ) : null}
          </span>
        </span>
      </ContentButton>
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
  providerEntries,
  selected,
  onOpen,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  label?: string;
  attention: number;
  working: boolean;
  activity: CaptainActivity;
  providerEntries: ReadonlyMap<string, SidebarProviderEntry> | undefined;
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
      <DuetChannelCard
        captain={current}
        environmentId={environmentId}
        label={label}
        attention={attention}
        working={working}
        archived={archived}
        status={status}
        selected={selected}
        activity={activity}
        providerEntries={providerEntries}
        menu={menu}
        onOpen={() => onOpen(threadRef)}
      >
        <CaptainProfileDialogs profile={profile} />
      </DuetChannelCard>
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
  providerEntriesByEnvironment,
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
  providerEntriesByEnvironment?: ProviderEntriesByEnvironment | undefined;
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
  const rowList = rows.map(({ captain, environmentId, label, attention, working, ...activity }) => (
    <CaptainShelfRow
      key={`${environmentId}:${captain.id}`}
      captain={captain}
      environmentId={environmentId}
      {...(label !== undefined ? { label } : {})}
      attention={attention}
      working={working}
      activity={activity}
      providerEntries={providerEntriesByEnvironment?.get(environmentId)}
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
              className={cn(
                "pointer-events-none absolute top-0 left-4 w-px bg-(--duet-tree-line)",
                onCreate ? "bottom-8" : "bottom-14",
              )}
            />
            <ul className="flex flex-col gap-1">{rowList}</ul>
            {onCreate ? (
              <div
                className={cn(
                  DUET_TREE_BRANCH_CLASS_NAME,
                  DUET_TREE_ROW_CLASS_NAME,
                  rowList.length > 0 && "mt-1",
                )}
              >
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
  providerEntriesByEnvironment,
}: {
  primaryEnvironmentId: EnvironmentId | null;
  activeThread: ScopedThreadRef | null;
  onOpen: (threadRef: ScopedThreadRef) => void;
  onReveal: (header: HTMLElement) => void;
  providerEntriesByEnvironment?: ProviderEntriesByEnvironment;
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
        providerEntriesByEnvironment={providerEntriesByEnvironment}
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
