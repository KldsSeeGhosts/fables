import type { Captain, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Plural, T, useGT, Var } from "gt-react";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  FolderIcon,
  PanelRightIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { toggleThreadSurfaceTab } from "../../layout/openRules";
import { selectActiveRightPanel, useRightPanelStore } from "../../rightPanelStore";
import { useProjects } from "../../state/entities";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { CaptainProfileDialogs, useCaptainProfile } from "./CaptainBriefPanel";
import { CaptainEarlierConversations } from "./CaptainEarlierConversations";
import { CaptainResetDialog } from "./CaptainResetButton";

export function CaptainHeaderActions({
  captain,
  threadRef,
  onOpen,
}: {
  captain: Captain;
  threadRef: ScopedThreadRef;
  onOpen: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const { environmentId } = threadRef;
  const projects = useProjects();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const profile = useCaptainProfile({
    captain,
    environmentId,
    onDelete: () => {
      setOpen(false);
      void navigate({ to: "/captains" });
    },
  });
  const { current, archived, pending, canUpdate } = profile;
  const scopeCount = current.scopedProjectIds.length;
  const scopeName =
    scopeCount === 1
      ? projects.find(
          (project) =>
            project.environmentId === environmentId && project.id === current.scopedProjectIds[0],
        )?.title
      : undefined;
  const briefOpen = useRightPanelStore(
    (state) => selectActiveRightPanel(state.byThreadKey, threadRef) === "captain-brief",
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button variant="ghost" size="xs" />}
          aria-label={gt("Captain details and actions")}
          title={gt("Captain details and actions")}
        >
          <FolderIcon />
          {scopeName ? (
            <span className="max-w-28 truncate">{scopeName}</span>
          ) : scopeCount > 0 ? (
            <T>
              <Plural
                n={scopeCount}
                one={
                  <>
                    <Var>{scopeCount}</Var> project
                  </>
                }
                other={
                  <>
                    <Var>{scopeCount}</Var> projects
                  </>
                }
              />
            </T>
          ) : (
            <T>No scope</T>
          )}
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverPopup width="sm" align="end" padding="compact">
          <div className="space-y-2">
            <div className="border-b border-border px-2 pb-2">
              <p className="truncate text-label">{current.name}</p>
              {current.role ? (
                <p className="line-clamp-2 text-meta text-muted-foreground">{current.role}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                aria-pressed={briefOpen}
                onClick={() => {
                  setOpen(false);
                  toggleThreadSurfaceTab(threadRef, "captain-brief", () =>
                    useRightPanelStore.getState().toggle(threadRef, "captain-brief"),
                  );
                }}
              >
                <PanelRightIcon />
                {briefOpen ? <T>Hide Captain Brief</T> : <T>Show Captain Brief</T>}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                disabled={!canUpdate}
                onClick={() => {
                  setOpen(false);
                  profile.edit();
                }}
              >
                <PencilIcon />
                <T>Edit Captain</T>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                disabled={archived}
                onClick={() => {
                  setOpen(false);
                  setResetting(true);
                }}
              >
                <RotateCcwIcon />
                <T>Reset conversation</T>
              </Button>
            </div>

            {current.earlierThreadIds.length > 0 ? (
              <div className="border-t border-border pt-2">
                <h3 className="mb-1 px-2 text-caption text-muted-foreground">
                  <T>Earlier conversations</T>
                </h3>
                <CaptainEarlierConversations
                  captain={current}
                  environmentId={environmentId}
                  onOpen={(threadId) => {
                    setOpen(false);
                    onOpen(threadId);
                  }}
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-0.5 border-t border-border pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                disabled={pending || !profile.canArchive}
                onClick={() => void profile.changeArchive()}
              >
                {archived ? <T>Restore Captain</T> : <T>Archive Captain</T>}
              </Button>
              {profile.canDelete ? (
                <Button
                  variant="destructive-outline"
                  size="sm"
                  className="justify-start"
                  disabled={pending}
                  onClick={() => {
                    setOpen(false);
                    profile.requestDelete();
                  }}
                >
                  <Trash2Icon />
                  <T>Delete Captain</T>
                </Button>
              ) : null}
            </div>
          </div>
        </PopoverPopup>
      </Popover>
      <CaptainProfileDialogs profile={profile} />
      {resetting ? (
        <CaptainResetDialog
          captain={current}
          environmentId={environmentId}
          onClose={() => setResetting(false)}
          onReset={(threadId) => {
            setResetting(false);
            onOpen(threadId);
          }}
        />
      ) : null}
    </>
  );
}
