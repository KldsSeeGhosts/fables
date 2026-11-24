import { useAtom, useAtomValue } from "@effect/atom-react";
import { Tabs } from "@base-ui/react/tabs";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainChildIsActive,
  captainForThread,
  captainRecentlyFinishedTasks,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isOrchestrationV2WorkActive,
  type OrchestrationV2RemoteTaskChild,
  type OrchestrationV2Subagent,
  type Captain,
  type EnvironmentId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ArrowUpRightIcon, PencilIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { followLayoutCompanions } from "../../layout/openRules";
import { useLayoutStore } from "../../layout/layoutStore";
import { useChildThreadInputs, useProjects, useQuietThreadProjection } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { useLinkedThreadOpener } from "../../state/linkedThreadView";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button, ContentButton } from "../ui/button";
import { StatusDot, type StatusDotTone } from "../ui/status-dot";
import { captainBriefTabAtom } from "./captainBriefTab";
import { CaptainDocuments } from "./CaptainDocuments";
import { CaptainEarlierConversations } from "./CaptainEarlierConversations";
import { CaptainEditorDialog } from "./CaptainEditorDialog";
import { CaptainMemories } from "./CaptainMemories";
import { CaptainReportPolicyPicker } from "./CaptainReportPolicyPicker";
import { CaptainResetButton } from "./CaptainResetButton";
import { CaptainScope } from "./CaptainScope";
import { captainCommandError, useCaptains } from "./useCaptain";

const RECENTLY_FINISHED_LIMIT = 5;

export function CaptainTaskRow({
  tone,
  status,
  title,
  badge,
  detail,
  disabled = false,
  onOpen,
}: {
  tone: StatusDotTone;
  status: string;
  title: string;
  badge?: string | undefined;
  detail?: ReactNode;
  disabled?: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <ContentButton
        variant={detail ? "inset-row-multiline" : "inset-row"}
        disabled={disabled}
        onClick={onOpen}
      >
        <StatusDot tone={tone} />
        <span className="sr-only">{status}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{title}</span>
          {detail ? (
            <span className="line-clamp-2 block text-meta text-muted-foreground">{detail}</span>
          ) : null}
        </span>
        {badge ? (
          <Badge size="sm" className="max-w-24">
            <span className="truncate">{badge}</span>
          </Badge>
        ) : null}
        <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0" />
      </ContentButton>
    </li>
  );
}

function RemoteCaptainChild({
  parent,
  child,
  title,
  tone,
  status,
  badge,
  detail,
}: {
  parent: ScopedThreadRef;
  child: OrchestrationV2RemoteTaskChild;
  title: string;
  tone: StatusDotTone;
  status: string;
  badge?: string | undefined;
  detail?: ReactNode;
}) {
  const opener = useLinkedThreadOpener(parent, child, title);
  return (
    <CaptainTaskRow
      tone={tone}
      status={status}
      title={title}
      badge={badge ?? child.label}
      detail={detail}
      disabled={opener === null}
      onOpen={() => opener?.open("primary")}
    />
  );
}

function FinishedCaptainTask({
  parent,
  task,
  badge,
  onOpen,
}: {
  parent: ScopedThreadRef;
  task: OrchestrationV2Subagent;
  badge?: string | undefined;
  onOpen: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const title = task.title ?? task.remoteChild?.title ?? gt("Subagent");
  const [tone, status]: [StatusDotTone, string] =
    task.status === "completed"
      ? ["success", gt("Completed", { $context: "delegated task status" })]
      : task.status === "failed"
        ? ["danger", gt("Failed", { $context: "delegated task status" })]
        : ["neutral", gt("Stopped", { $context: "delegated task status" })];
  const detail = task.result?.trim().split("\n", 1)[0];
  if (task.remoteChild) {
    return (
      <RemoteCaptainChild
        parent={parent}
        child={task.remoteChild}
        title={title}
        tone={tone}
        status={status}
        badge={badge}
        detail={detail}
      />
    );
  }
  const childThreadId = task.childThreadId;
  return (
    <CaptainTaskRow
      tone={tone}
      status={status}
      title={title}
      badge={badge}
      detail={detail}
      disabled={childThreadId === null}
      onOpen={() => {
        if (childThreadId !== null) onOpen(childThreadId);
      }}
    />
  );
}

const delegatedTasks = (subagents: ReadonlyArray<OrchestrationV2Subagent> | undefined) =>
  (subagents ?? []).filter((task) => task.origin === "app_owned");

/** Rows for a Captain's local delegated threads that are still running or waiting on the user. */
export function CaptainLocalTaskRows({
  threads,
  badge,
  onOpen,
}: {
  threads: ReadonlyArray<EnvironmentThreadShell>;
  badge: (thread: EnvironmentThreadShell) => string | undefined;
  onOpen: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const needsYou = gt("Needs input", { $context: "delegated task status" });
  const working = gt("Working", { $context: "delegated task status" });
  return threads.map((child) => {
    const blocked =
      child.hasPendingApprovals ||
      child.hasPendingUserInput ||
      child.pendingSubagentRequest != null;
    return (
      <CaptainTaskRow
        key={child.id}
        tone={blocked ? "warning" : "info"}
        status={blocked ? needsYou : working}
        title={child.title}
        badge={badge(child)}
        detail={blocked ? needsYou : undefined}
        onOpen={() => onOpen(child.id)}
      />
    );
  });
}

/** Rows for a Captain's delegated tasks running on linked environments. */
export function CaptainRemoteTaskRows({
  parent,
  badge,
}: {
  parent: ScopedThreadRef;
  badge?: string | undefined;
}) {
  const gt = useGT();
  const working = gt("Working", { $context: "delegated task status" });
  const delegated = delegatedTasks(useQuietThreadProjection(parent)?.projection.subagents);
  return delegated.flatMap(({ remoteChild, id, status, title }) =>
    remoteChild && isOrchestrationV2WorkActive(status)
      ? [
          <RemoteCaptainChild
            key={id}
            parent={parent}
            child={remoteChild}
            title={title ?? remoteChild.title ?? gt("Subagent")}
            tone="info"
            status={working}
            badge={badge}
          />,
        ]
      : [],
  );
}

/** Rows for a Captain's most recently finished delegated tasks. */
export function CaptainFinishedTaskRows({
  parent,
  badge,
  limit = RECENTLY_FINISHED_LIMIT,
  onOpen,
}: {
  parent: ScopedThreadRef;
  badge?: string | undefined;
  limit?: number;
  onOpen: (threadId: ThreadId) => void;
}) {
  const delegated = delegatedTasks(useQuietThreadProjection(parent)?.projection.subagents);
  return captainRecentlyFinishedTasks(delegated, limit).map((task) => (
    <FinishedCaptainTask key={task.id} parent={parent} task={task} badge={badge} onOpen={onOpen} />
  ));
}

/**
 * A list that shows `empty` when none of its rows render. Row components return nothing when they
 * have no rows, so the list's own emptiness decides.
 */
export function CaptainTaskList({ empty, children }: { empty: ReactNode; children: ReactNode }) {
  return (
    <>
      <ul className="peer">{children}</ul>
      <p className="hidden text-meta text-muted-foreground peer-empty:block">{empty}</p>
    </>
  );
}

/** Active delegated threads of one Captain, local and remote. */
export function CaptainActiveTasks({
  parent,
  onOpen,
}: {
  parent: ScopedThreadRef;
  onOpen: (threadId: ThreadId) => void;
}) {
  const projects = useProjects();
  const projectTitles = new Map(
    projects
      .filter((project) => project.environmentId === parent.environmentId)
      .map((project) => [project.id, project.title]),
  );
  const children = useChildThreadInputs(parent).filter(
    (thread) =>
      thread.archivedAt === null &&
      thread.lineage.relationshipToParent === "subagent" &&
      captainChildIsActive(thread),
  );
  return (
    <CaptainTaskList empty={<T>No active delegated threads.</T>}>
      <CaptainLocalTaskRows
        threads={children}
        badge={(thread) => projectTitles.get(thread.projectId)}
        onOpen={onOpen}
      />
      <CaptainRemoteTaskRows parent={parent} />
    </CaptainTaskList>
  );
}

/** Edit, archive, restore and delete for one Captain; render `CaptainProfileDialogs` with it. */
export function useCaptainProfile({
  captain,
  environmentId,
  onDelete,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  onDelete: () => void;
}) {
  const gt = useGT();
  const canUpdate = useAtomValue(serverEnvironment.updateCaptain.permissionAtom(environmentId));
  const canArchive = useAtomValue(serverEnvironment.archiveCaptain.permissionAtom(environmentId));
  const canRestore = useAtomValue(serverEnvironment.unarchiveCaptain.permissionAtom(environmentId));
  const canDelete = useAtomValue(serverEnvironment.deleteCaptain.permissionAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.updateCaptain, { reportFailure: false });
  const archive = useAtomCommand(serverEnvironment.archiveCaptain, { reportFailure: false });
  const restore = useAtomCommand(serverEnvironment.unarchiveCaptain, { reportFailure: false });
  const deleteCaptain = useAtomCommand(serverEnvironment.deleteCaptain, { reportFailure: false });
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Captain | null>(null);
  const current = applied && applied.updatedAt > captain.updatedAt ? applied : captain;
  const archived = current.archivedAt !== null;

  const save = async (changes: {
    scopedProjectIds?: Captain["scopedProjectIds"];
    reportPolicy?: Captain["reportPolicy"];
  }) => {
    if (!canUpdate || pending) return;
    setPending(true);
    setError(null);
    const result = await update({ environmentId, input: { captainId: captain.id, ...changes } });
    setPending(false);
    if (result._tag === "Failure")
      setError(captainCommandError(result, gt("Could not update Captain.")));
    else setApplied(result.value);
  };

  const changeArchive = async () => {
    if (pending || !(archived ? canRestore : canArchive)) return;
    setPending(true);
    setError(null);
    const result = await (archived ? restore : archive)({
      environmentId,
      input: { captainId: captain.id },
    });
    setPending(false);
    if (result._tag === "Failure")
      setError(captainCommandError(result, gt("Could not update Captain.")));
    else setApplied(result.value);
  };

  const remove = async () => {
    if (!canDelete || pending) return;
    setPending(true);
    setError(null);
    const result = await deleteCaptain({ environmentId, input: { captainId: captain.id } });
    setPending(false);
    if (result._tag === "Failure")
      setError(captainCommandError(result, gt("Could not delete Captain.")));
    else onDelete();
  };

  return {
    captain,
    environmentId,
    current,
    archived,
    pending,
    error,
    editing,
    confirmDelete,
    canUpdate,
    canArchive: archived ? canRestore : canArchive,
    canDelete,
    save,
    changeArchive,
    remove,
    edit: () => setEditing(true),
    stopEditing: () => setEditing(false),
    apply: (profile: Captain) => {
      setApplied(profile);
      setEditing(false);
    },
    requestDelete: () => {
      setError(null);
      setConfirmDelete(true);
    },
    cancelDelete: () => {
      setError(null);
      setConfirmDelete(false);
    },
  };
}

type CaptainProfile = ReturnType<typeof useCaptainProfile>;

/** The edit and delete dialogs that `useCaptainProfile` opens. */
export function CaptainProfileDialogs({ profile }: { profile: CaptainProfile }) {
  const environment = useEnvironment(profile.environmentId);
  const { captain, environmentId, error, pending } = profile;
  return (
    <>
      {profile.editing ? (
        <CaptainEditorDialog
          captain={captain}
          destination={{ id: environmentId, label: environment?.label ?? environmentId }}
          onClose={profile.stopEditing}
          onSave={(_environmentId, saved) => profile.apply(saved)}
        />
      ) : null}
      {profile.confirmDelete ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) profile.cancelDelete();
          }}
        >
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <T>Delete Captain?</T>
              </AlertDialogTitle>
              <AlertDialogDescription>
                <T>
                  This deletes the Captain, documents and memories. Its conversations and scheduled
                  tasks stay available.
                </T>
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error !== null ? (
              <p role="alert" className="text-body text-destructive-foreground">
                {error}
              </p>
            ) : null}
            <AlertDialogFooter>
              <Button variant="secondary" disabled={pending} onClick={profile.cancelDelete}>
                <T>Cancel</T>
              </Button>
              <Button
                variant="destructive"
                disabled={pending || !profile.canDelete}
                onClick={() => void profile.remove()}
              >
                <T>Delete Captain</T>
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      ) : null}
    </>
  );
}

function CaptainBrief({
  captain,
  environmentId,
  onOpen,
  onDelete,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  onOpen: (threadId: ThreadId) => void;
  onDelete: () => void;
}) {
  const gt = useGT();
  const fieldId = useId();
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const parent = scopeThreadRef(environmentId, captain.primaryThreadId);
  const profile = useCaptainProfile({ captain, environmentId, onDelete });
  const { current, archived, pending, error, canUpdate } = profile;

  return (
    <div className="space-y-5">
      <section className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-label">{captain.name}</h3>
          {captain.role ? (
            <p className="break-words text-body text-muted-foreground">{captain.role}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!canUpdate}
          onClick={profile.edit}
          aria-label={gt("Edit Captain")}
          title={gt("Edit Captain")}
        >
          <PencilIcon />
        </Button>
      </section>
      <CaptainScope
        projects={projects}
        selected={current.scopedProjectIds}
        disabled={!canUpdate || pending}
        onChange={(scopedProjectIds) => void profile.save({ scopedProjectIds })}
      />
      <section className="space-y-2">
        <h3 id={`${fieldId}-report-policy`} className="text-label">
          <T>When a delegated task finishes</T>
        </h3>
        <CaptainReportPolicyPicker
          labelledBy={`${fieldId}-report-policy`}
          value={current.reportPolicy}
          disabled={!canUpdate || pending}
          onChange={(reportPolicy) => void profile.save({ reportPolicy })}
        />
      </section>
      <section className="space-y-1">
        <h3 className="text-label">
          <T>Active delegated threads</T>
        </h3>
        <CaptainActiveTasks parent={parent} onOpen={onOpen} />
      </section>
      <section className="space-y-1 has-[ul:empty]:hidden">
        <h3 className="text-label">
          <T>Recently finished</T>
        </h3>
        <ul className="space-y-1">
          <CaptainFinishedTaskRows parent={parent} onOpen={onOpen} />
        </ul>
      </section>
      {captain.earlierThreadIds.length > 0 ? (
        <section className="space-y-1">
          <h3 className="text-label">
            <T>Earlier conversations</T>
          </h3>
          <CaptainEarlierConversations
            captain={captain}
            environmentId={environmentId}
            onOpen={onOpen}
          />
        </section>
      ) : null}
      {error !== null && !profile.confirmDelete ? (
        <p role="alert" className="text-body text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <CaptainResetButton captain={captain} environmentId={environmentId} onReset={onOpen} />
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || !profile.canArchive}
          onClick={() => void profile.changeArchive()}
        >
          {archived ? <T>Restore Captain</T> : <T>Archive Captain</T>}
        </Button>
        {profile.canDelete ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={profile.requestDelete}
          >
            <T>Delete Captain</T>
          </Button>
        ) : null}
      </div>
      <CaptainProfileDialogs profile={profile} />
    </div>
  );
}

export function CaptainBriefPanel({
  threadRef,
  onDelete,
}: {
  threadRef: ScopedThreadRef;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useAtom(captainBriefTabAtom(threadRef));
  const query = useCaptains(threadRef.environmentId);
  const { environmentId, threadId } = threadRef;
  const captain = captainForThread(query.data, threadId);
  const details = useCaptains(captain ? environmentId : null, captain?.id);
  if (captain === undefined) {
    return (
      <p className="p-4 text-body text-muted-foreground">
        {query.isPending ? (
          <T>Loading Captain…</T>
        ) : (
          <T>This conversation has no Captain profile.</T>
        )}
      </p>
    );
  }

  const open = (id: ThreadId) => {
    const target = scopeThreadRef(environmentId, id);
    followLayoutCompanions(() =>
      useLayoutStore.getState().focusChat({ kind: "server", threadRef: target }),
    );
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(target),
    });
  };
  const detailLoading = (
    <p className="text-body text-muted-foreground">{details.error ?? <T>Loading Captain…</T>}</p>
  );
  const tabClass =
    "border-b-2 border-transparent px-2 py-2 text-body text-muted-foreground data-active:border-primary data-active:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <Tabs.Root
      value={tab}
      onValueChange={setTab}
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <Tabs.List className="flex shrink-0 gap-2 border-b border-border px-3">
        <Tabs.Tab value="brief" className={tabClass}>
          <T>Brief</T>
        </Tabs.Tab>
        <Tabs.Tab value="docs" className={tabClass}>
          <T>Docs</T>
        </Tabs.Tab>
        <Tabs.Tab value="memory" className={tabClass}>
          <T>Memory</T>
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="brief" className="min-h-0 flex-1 overflow-y-auto p-4">
        <CaptainBrief
          captain={captain}
          environmentId={environmentId}
          onOpen={open}
          onDelete={onDelete}
        />
      </Tabs.Panel>
      <Tabs.Panel value="docs" keepMounted className="min-h-0 flex-1 overflow-y-auto p-4">
        {details.data === null ? (
          detailLoading
        ) : (
          <CaptainDocuments
            captain={captain}
            environmentId={environmentId}
            documents={details.data.documents}
            refresh={details.refresh}
          />
        )}
      </Tabs.Panel>
      <Tabs.Panel value="memory" keepMounted className="min-h-0 flex-1 overflow-y-auto p-4">
        {details.data === null ? (
          detailLoading
        ) : (
          <CaptainMemories
            captainId={captain.id}
            environmentId={environmentId}
            memories={details.data.memories}
          />
        )}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
