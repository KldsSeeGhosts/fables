import { Tabs } from "@base-ui/react/tabs";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainAttentionTotal,
  captainDocument,
  captainInboxItems,
  captainScheduledTasks,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  CaptainReportPolicy,
  type Captain,
  type CaptainId,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { CompassIcon, EllipsisIcon, FolderIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useLayoutPageLocation } from "../../layout/pageNavigation";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { SettingsPaneHeader, SettingsTabNotch } from "../settings/SettingsTabNotch";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarInset } from "../ui/sidebar";
import { StatusDot } from "../ui/status-dot";
import { Text } from "../ui/text";
import { CaptainAvatar } from "./CaptainAvatar";
import {
  CaptainActiveTasks,
  CaptainFinishedTaskRows,
  CaptainProfileDialogs,
  CaptainTaskList,
  useCaptainProfile,
} from "./CaptainBriefPanel";
import { CaptainChannelRail, type CaptainChannelSelection } from "./CaptainChannelRail";
import {
  CaptainDigest,
  CaptainMorningBriefControl,
  captainMorningBriefTask,
} from "./CaptainDigest";
import { CaptainDocuments } from "./CaptainDocuments";
import { CaptainEarlierConversations } from "./CaptainEarlierConversations";
import { CaptainMemories } from "./CaptainMemories";
import { CaptainResetDialog } from "./CaptainResetButton";
import { CaptainScope } from "./CaptainScope";
import { CaptainInboxCard, CaptainSection, CaptainsInbox } from "./CaptainsInbox";
import { captainsSearchFromUrl, type CaptainsSearch } from "./captainsSearch.logic";
import { useCaptainsDirectory } from "./captainsDirectory";
import { useOpenCaptainThread } from "./captainNavigation";
import { useCaptains } from "./useCaptain";

type CaptainView = NonNullable<CaptainsSearch["view"]>;

const TAB_CLASS =
  "border-b-2 border-transparent px-1 py-2 text-body text-muted-foreground data-active:border-primary data-active:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

function CaptainScopeButton({
  captain,
  environmentId,
  disabled,
  onChange,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  disabled: boolean;
  onChange: (projectIds: Captain["scopedProjectIds"]) => void;
}) {
  const gt = useGT();
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const count = captain.scopedProjectIds.length;
  const name =
    count === 1
      ? projects.find((project) => project.id === captain.scopedProjectIds[0])?.title
      : undefined;
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" />}
        aria-label={gt("Edit workspace scope")}
      >
        <FolderIcon aria-hidden />
        {name ??
          (count > 0
            ? gt("{count, plural, one {{count} project} other {{count} projects}}", { count })
            : gt("No scope"))}
      </PopoverTrigger>
      <PopoverPopup width="sm" align="start">
        <CaptainScope
          projects={projects}
          selected={captain.scopedProjectIds}
          disabled={disabled}
          onChange={onChange}
        />
      </PopoverPopup>
    </Popover>
  );
}

function CaptainChannelView({
  environmentId,
  captain,
  environments,
  shells,
  view,
  onView,
  onOpenThread,
  onDeleted,
}: {
  environmentId: EnvironmentId;
  captain: Captain;
  environments: Parameters<typeof captainInboxItems>[0];
  shells: ReadonlyArray<EnvironmentThreadShell>;
  view: CaptainView;
  onView: (view: CaptainView) => void;
  onOpenThread: (threadId: ThreadId) => void;
  onDeleted: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const details = useCaptains(environmentId, captain.id);
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
    messages,
  );
  const profile = useCaptainProfile({ captain, environmentId, onDelete: onDeleted });
  const [resetting, setResetting] = useState(false);
  const { current, archived, pending, canUpdate } = profile;
  const parent = scopeThreadRef(environmentId, captain.primaryThreadId);
  const thread = shells.find(
    (shell) => shell.environmentId === environmentId && shell.id === captain.primaryThreadId,
  );
  const tasks = tasksQuery.data?.tasks ?? [];
  const scheduled = captainScheduledTasks(tasks, captain);
  const briefControl = (
    <CaptainMorningBriefControl
      captain={current}
      environmentId={environmentId}
      thread={thread}
      task={captainMorningBriefTask(tasks, captain)}
    />
  );
  const needsYou = captainInboxItems(environments, shells).filter(
    (item) => item.environmentId === environmentId && item.captainId === captain.id,
  );
  const summary = captain.role || captain.instructions.trim().split("\n", 1)[0];
  const detailLoading = (
    <Text variant="body" tone="muted" render={<p />}>
      {details.error ?? <T>Loading Captain…</T>}
    </Text>
  );

  return (
    <Tabs.Root
      value={view}
      onValueChange={(next: CaptainView) => onView(next)}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex min-w-0 flex-col gap-4 border-b border-border px-6 pt-6">
        <div className="flex min-w-0 flex-wrap items-start gap-4">
          <CaptainAvatar
            avatar={current.avatar}
            size="large"
            state={archived ? "archived" : "idle"}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <Text variant="display" truncate render={<h2 className="block" />}>
              {current.name}
            </Text>
            {summary ? (
              <Text variant="body" tone="muted" render={<p className="line-clamp-2" />}>
                {summary}
              </Text>
            ) : null}
            <CaptainScopeButton
              captain={current}
              environmentId={environmentId}
              disabled={!canUpdate || pending}
              onChange={(scopedProjectIds) => void profile.save({ scopedProjectIds })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              disabled={archived}
              onClick={() => onOpenThread(captain.primaryThreadId)}
            >
              <MessageSquareIcon aria-hidden />
              {gt("Talk to {name}", { name: current.name })}
            </Button>
            {briefControl}
            <Menu>
              <MenuTrigger
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label={gt("More Captain actions")}
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuGroup>
                  <MenuGroupLabel>
                    <T>When a delegated task finishes</T>
                  </MenuGroupLabel>
                  <MenuRadioGroup
                    value={current.reportPolicy}
                    onValueChange={(next) => {
                      const reportPolicy = CaptainReportPolicy.literals.find(
                        (policy) => policy === next,
                      );
                      if (reportPolicy !== undefined && reportPolicy !== current.reportPolicy)
                        void profile.save({ reportPolicy });
                    }}
                  >
                    <MenuRadioItem value="react" disabled={!canUpdate || pending}>
                      <T>Wake the Captain</T>
                    </MenuRadioItem>
                    <MenuRadioItem value="context" disabled={!canUpdate || pending}>
                      <T>Include on its next turn</T>
                    </MenuRadioItem>
                    <MenuRadioItem value="ignore" disabled={!canUpdate || pending}>
                      <T>Don’t report back</T>
                    </MenuRadioItem>
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuItem disabled={!canUpdate} onClick={profile.edit}>
                  <T>Edit Captain</T>
                </MenuItem>
                <MenuItem disabled={archived} onClick={() => setResetting(true)}>
                  <T>Reset conversation</T>
                </MenuItem>
                <MenuItem
                  disabled={pending || !profile.canArchive}
                  onClick={() => void profile.changeArchive()}
                >
                  {archived ? <T>Restore Captain</T> : <T>Archive Captain</T>}
                </MenuItem>
                {profile.canDelete ? (
                  <MenuItem
                    variant="destructive"
                    disabled={pending}
                    onClick={profile.requestDelete}
                  >
                    <T>Delete Captain</T>
                  </MenuItem>
                ) : null}
              </MenuPopup>
            </Menu>
          </div>
        </div>
        {profile.error !== null && !profile.confirmDelete ? (
          <Text variant="body" tone="destructive" role="alert" render={<p />}>
            {profile.error}
          </Text>
        ) : null}
        <Tabs.List className="flex gap-4">
          <Tabs.Tab value="brief" className={TAB_CLASS}>
            <T>Brief</T>
          </Tabs.Tab>
          <Tabs.Tab value="tasks" className={TAB_CLASS}>
            <T>Tasks</T>
          </Tabs.Tab>
          <Tabs.Tab value="docs" className={TAB_CLASS}>
            <T>Docs</T>
          </Tabs.Tab>
          <Tabs.Tab value="memory" className={TAB_CLASS}>
            <T>Memory</T>
          </Tabs.Tab>
        </Tabs.List>
      </header>
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <Tabs.Panel value={view} className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-6">
          {view === "brief" ? (
            <>
              <CaptainDigest
                document={captainDocument(details.data, captain.id, "DIGEST.md")}
                environmentId={environmentId}
                loading={details.data === null}
                action={briefControl}
              />
              {needsYou.length > 0 ? (
                <CaptainSection title={<T>Needs you</T>}>
                  <div className="flex flex-col gap-2">
                    {needsYou.map((item) => (
                      <CaptainInboxCard
                        key={`${item.kind}:${item.threadRef.threadId}`}
                        item={item}
                        captain={current}
                        onReview={(threadRef) => onOpenThread(threadRef.threadId)}
                      />
                    ))}
                  </div>
                </CaptainSection>
              ) : null}
              <CaptainSection title={<T>In flight</T>}>
                <CaptainActiveTasks parent={parent} onOpen={onOpenThread} />
              </CaptainSection>
            </>
          ) : view === "tasks" ? (
            <>
              <CaptainSection title={<T>Active</T>}>
                <CaptainActiveTasks parent={parent} onOpen={onOpenThread} />
              </CaptainSection>
              <CaptainSection title={<T>Recently finished</T>}>
                <CaptainTaskList empty={<T>No delegated tasks finished recently.</T>}>
                  <CaptainFinishedTaskRows parent={parent} onOpen={onOpenThread} />
                </CaptainTaskList>
              </CaptainSection>
              <CaptainSection title={<T>Scheduled</T>}>
                {scheduled.length === 0 ? (
                  <Text variant="meta" tone="muted" render={<p />}>
                    <T>No scheduled tasks.</T>
                  </Text>
                ) : (
                  <ul className="space-y-1">
                    {scheduled.map((task) => (
                      <li key={task.id} className="flex min-w-0 items-center gap-2 px-2">
                        <StatusDot tone={task.enabled ? "info" : "neutral"} />
                        <Text variant="body" truncate render={<span className="flex-1" />}>
                          {task.title}
                        </Text>
                        <Text variant="meta" tone="muted" truncate>
                          {task.enabled
                            ? scheduleLabel(
                                task.schedule,
                                timestampFormat,
                                undefined,
                                task.nextRunAt,
                                messages,
                              )
                            : gt("Paused")}
                        </Text>
                      </li>
                    ))}
                  </ul>
                )}
              </CaptainSection>
              {captain.earlierThreadIds.length > 0 ? (
                <CaptainSection title={<T>Earlier conversations</T>}>
                  <CaptainEarlierConversations
                    captain={captain}
                    environmentId={environmentId}
                    onOpen={onOpenThread}
                  />
                </CaptainSection>
              ) : null}
            </>
          ) : view === "docs" ? (
            details.data === null ? (
              detailLoading
            ) : (
              <CaptainDocuments
                captain={captain}
                environmentId={environmentId}
                documents={details.data.documents}
                refresh={details.refresh}
              />
            )
          ) : details.data === null ? (
            detailLoading
          ) : (
            <CaptainMemories
              captainId={captain.id}
              environmentId={environmentId}
              memories={details.data.memories}
            />
          )}
        </Tabs.Panel>
      </div>
      <CaptainProfileDialogs profile={profile} />
      {resetting ? (
        <CaptainResetDialog
          captain={captain}
          environmentId={environmentId}
          onReset={onOpenThread}
          onClose={() => setResetting(false)}
        />
      ) : null}
    </Tabs.Root>
  );
}

export function CaptainsWorkspace() {
  const gt = useGT();
  const navigate = useNavigate();
  const location = useLayoutPageLocation();
  const search = captainsSearchFromUrl(location.search);
  const { environments, shells } = useCaptainsDirectory();
  const openThread = useOpenCaptainThread();
  const selectedEnvironment = environments.find(
    (environment) => environment.environmentId === search.env,
  );
  const selected = selectedEnvironment?.captains.find((captain) => captain.id === search.captain);
  const selection: CaptainChannelSelection =
    selectedEnvironment && selected
      ? { environmentId: selectedEnvironment.environmentId, captainId: selected.id }
      : null;
  const view = search.view ?? "brief";
  const go = (next: CaptainsSearch, replace = false) =>
    void navigate({ to: "/captains", search: next, replace });
  const openCaptain = (environmentId: EnvironmentId, captainId: CaptainId) =>
    go({ env: environmentId, captain: captainId, view: "brief" });

  return (
    <SidebarInset
      variant="pane"
      className="h-full min-h-0 overflow-hidden"
      {...workspaceAreaProps("captains", 20)}
    >
      <div className="pane-mobile-chrome flex min-h-0 min-w-0 flex-1 flex-col">
        <SettingsPaneHeader transparent>
          <SettingsTabNotch
            title={gt("Captains")}
            icon={<CompassIcon aria-hidden className="size-3.5 shrink-0 text-foreground" />}
          >
            <h1 className="truncate">
              <T>Captains</T>
            </h1>
          </SettingsTabNotch>
        </SettingsPaneHeader>
        <div className="flex min-h-0 min-w-0 flex-1">
          <CaptainChannelRail
            environments={environments}
            shells={shells}
            attention={captainAttentionTotal(environments, shells)}
            selection={selection}
            onSelect={(next) =>
              next === null ? go({}) : openCaptain(next.environmentId, next.captainId)
            }
          />
          {selectedEnvironment && selected ? (
            <CaptainChannelView
              key={`${selectedEnvironment.environmentId}:${selected.id}`}
              environmentId={selectedEnvironment.environmentId}
              captain={selected}
              environments={environments}
              shells={shells}
              view={view}
              onView={(next) =>
                go(
                  { env: selectedEnvironment.environmentId, captain: selected.id, view: next },
                  true,
                )
              }
              onOpenThread={(threadId) =>
                openThread(scopeThreadRef(selectedEnvironment.environmentId, threadId))
              }
              onDeleted={() => go({})}
            />
          ) : (
            <div className="scrollbar-gutter-both min-h-0 min-w-0 flex-1 overflow-y-auto">
              <CaptainsInbox
                environments={environments}
                shells={shells}
                onOpenThread={openThread}
                onOpenCaptain={openCaptain}
              />
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}
