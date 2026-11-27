import { useAtomValue } from "@effect/atom-react";
import {
  captainChildIsActive,
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
import { T, useGT } from "gt-react";
import { ArrowUpRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useChildThreadInputs, useProjects, useQuietThreadProjection } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { useLinkedThreadOpener } from "../../state/linkedThreadView";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { CaptainEditorDialog } from "./CaptainEditorDialog";
import { captainCommandError } from "./useCaptain";
import { CaptainTasksDrawer } from "./CaptainTasksDrawer";

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
  const [editing, setEditing] = useState<CaptainProfileSection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Captain | null>(null);
  const current = applied && applied.updatedAt > captain.updatedAt ? applied : captain;
  const archived = current.archivedAt !== null;

  const save = async (changes: {
    name?: Captain["name"];
    avatar?: Captain["avatar"];
    scopedProjectIds?: Captain["scopedProjectIds"];
    reportPolicy?: Captain["reportPolicy"];
  }) => {
    if (!canUpdate || pending) return null;
    setPending(true);
    setError(null);
    const result = await update({ environmentId, input: { captainId: captain.id, ...changes } });
    setPending(false);
    if (result._tag === "Failure") {
      const message = captainCommandError(result, gt("Could not update Duet."));
      setError(message);
      return message;
    }
    setApplied(result.value);
    return null;
  };

  const changeArchive = async () => {
    if (pending || current.kind === "chorus" || !(archived ? canRestore : canArchive)) return;
    setPending(true);
    setError(null);
    const result = await (archived ? restore : archive)({
      environmentId,
      input: { captainId: captain.id },
    });
    setPending(false);
    if (result._tag === "Failure")
      setError(captainCommandError(result, gt("Could not update Duet.")));
    else setApplied(result.value);
  };

  const remove = async () => {
    if (!canDelete || pending || current.kind === "chorus") return;
    setPending(true);
    setError(null);
    const result = await deleteCaptain({ environmentId, input: { captainId: captain.id } });
    setPending(false);
    if (result._tag === "Failure")
      setError(captainCommandError(result, gt("Could not delete Duet.")));
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
    canArchive: current.kind !== "chorus" && (archived ? canRestore : canArchive),
    canDelete: current.kind !== "chorus" && canDelete,
    save,
    changeArchive,
    remove,
    edit: (section: CaptainProfileSection = "profile") => setEditing(section),
    stopEditing: () => setEditing(null),
    apply: (profile: Captain) => {
      setApplied(profile);
      setEditing(null);
    },
    requestDelete: () => {
      setError(null);
      setConfirmDelete(true);
    },
    cancelDelete: () => {
      setError(null);
      setConfirmDelete(false);
    },
    dismissError: () => setError(null),
  };
}

export type CaptainProfile = ReturnType<typeof useCaptainProfile>;

/** The Customize dialog's sections: who the Duet is, and what it keeps between conversations. */
export type CaptainProfileSection = "profile" | "memory";

/** The edit and delete dialogs that `useCaptainProfile` opens. */
export function CaptainProfileDialogs({ profile }: { profile: CaptainProfile }) {
  const environment = useEnvironment(profile.environmentId);
  const { captain, environmentId, error, pending } = profile;
  return (
    <>
      {profile.editing !== null ? (
        <CaptainEditorDialog
          captain={captain}
          initialSection={profile.editing}
          destination={{ id: environmentId, label: environment?.label ?? environmentId }}
          onClose={profile.stopEditing}
          onSave={(_environmentId, saved) => profile.apply(saved)}
        />
      ) : null}
      {error !== null && !profile.confirmDelete && profile.editing === null ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) profile.dismissError();
          }}
        >
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {profile.current.kind === "chorus" ? (
                  <T>Could not update Chorus</T>
                ) : (
                  <T>Could not update Duet</T>
                )}
              </AlertDialogTitle>
              <AlertDialogDescription>{error}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="secondary" onClick={profile.dismissError}>
                <T>Close</T>
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
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
                <T>Delete Duet?</T>
              </AlertDialogTitle>
              <AlertDialogDescription>
                <T>
                  This deletes the Duet, documents and memories. Its conversations and scheduled
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
                <T>Delete Duet</T>
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      ) : null}
    </>
  );
}

export function CaptainBriefPanel({
  threadRef,
  onDelete,
}: {
  threadRef: ScopedThreadRef;
  onDelete: () => void;
}) {
  return <CaptainTasksDrawer threadRef={threadRef} onClose={onDelete} />;
}
