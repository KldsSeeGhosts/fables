/* oxlint-disable t3code/no-styled-raw-controls -- Captain menu rows use compact Duet row geometry inside a popover rather than standalone button chrome. */
import { useAtom } from "@effect/atom-react";
import type { Captain, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  FileTextIcon,
  FolderIcon,
  ListChecksIcon,
  PencilIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  Trash2Icon,
} from "lucide-react";
import { useId, useState, type ReactElement, type ReactNode } from "react";

import { toggleThreadSurfaceTab } from "../../layout/openRules";
import { selectActiveRightPanel, useRightPanelStore } from "../../rightPanelStore";
import { useProjects } from "../../state/entities";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { captainBriefTabAtom } from "./captainBriefTab";
import { CaptainProfileDialogs, useCaptainProfile } from "./CaptainBriefPanel";
import { CaptainEarlierConversations } from "./CaptainEarlierConversations";
import { CaptainReportPolicyPicker } from "./CaptainReportPolicyPicker";
import { CaptainResetDialog } from "./CaptainResetButton";

function CaptainMenuRow({
  icon,
  destructive = false,
  disabled = false,
  pressed,
  onClick,
  children,
}: {
  icon: ReactElement;
  destructive?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-body outline-none hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-45 ${
        destructive ? "text-destructive-foreground" : "text-foreground"
      }`}
    >
      <span aria-hidden className="flex size-4 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

/** Captain actions exposed from the Duet title dropdown, with the original header pill as fallback. */
export function CaptainHeaderActions({
  captain,
  threadRef,
  onOpen,
  trigger,
}: {
  captain: Captain;
  threadRef: ScopedThreadRef;
  onOpen: (threadId: ThreadId) => void;
  trigger?: ReactElement;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const { environmentId } = threadRef;
  const projects = useProjects();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const policyLabelId = useId();
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
  const [, setBriefTab] = useAtom(captainBriefTabAtom(threadRef));

  const defaultTrigger = <Button variant="ghost" size="xs" />;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        {trigger ? (
          <PopoverTrigger
            render={trigger}
            aria-label={gt("Duet details and actions")}
            title={gt("Duet details and actions")}
          />
        ) : (
          <PopoverTrigger
            render={defaultTrigger}
            aria-label={gt("Duet details and actions")}
            title={gt("Duet details and actions")}
          >
            <FolderIcon />
            {scopeName ? (
              <span className="max-w-28 truncate">{scopeName}</span>
            ) : scopeCount > 0 ? (
              gt("{count, plural, one {{count} project} other {{count} projects}}", {
                count: scopeCount,
              })
            ) : (
              <T>No scope</T>
            )}
            <ChevronDownIcon className="size-3 text-muted-foreground" />
          </PopoverTrigger>
        )}
        <PopoverPopup
          width="sm"
          align={trigger ? "start" : "end"}
          side="bottom"
          sideOffset={6}
          padding="compact"
        >
          <div className="flex min-w-52 flex-col">
            {/* The Duet header already has its own Tasks button. */}
            {trigger ? null : (
              <CaptainMenuRow
                icon={<ListChecksIcon className="size-4" />}
                pressed={briefOpen}
                onClick={() => {
                  setOpen(false);
                  toggleThreadSurfaceTab(threadRef, "captain-brief", () =>
                    useRightPanelStore.getState().toggle(threadRef, "captain-brief"),
                  );
                }}
              >
                {briefOpen ? <T>Hide tasks</T> : <T>Show tasks</T>}
              </CaptainMenuRow>
            )}
            <CaptainMenuRow
              icon={<FileTextIcon className="size-4" />}
              onClick={() => {
                setBriefTab("docs");
                useRightPanelStore.getState().open(threadRef, "captain-brief");
                setOpen(false);
              }}
            >
              <T>Docs &amp; memory</T>
            </CaptainMenuRow>
            <CaptainMenuRow
              icon={<PencilIcon className="size-4" />}
              disabled={!canUpdate}
              onClick={() => {
                setOpen(false);
                profile.edit();
              }}
            >
              {current.kind === "chorus" ? <T>Edit Chorus</T> : <T>Edit Duet</T>}
            </CaptainMenuRow>
            {current.kind === "duet" ? (
              <>
                <button
                  type="button"
                  aria-expanded={policyOpen}
                  onClick={() => setPolicyOpen((currentOpen) => !currentOpen)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-foreground text-body outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <span
                    aria-hidden
                    className="flex size-4 items-center justify-center text-muted-foreground"
                  >
                    <ScrollTextIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate" id={policyLabelId}>
                    <T>Report policy</T>
                  </span>
                  <ChevronDownIcon
                    aria-hidden
                    className={`size-3.5 text-muted-foreground transition-transform ${policyOpen ? "" : "-rotate-90"}`}
                  />
                </button>
                {policyOpen ? (
                  <div className="px-2 pb-1">
                    <CaptainReportPolicyPicker
                      value={current.reportPolicy}
                      disabled={!canUpdate || pending}
                      labelledBy={policyLabelId}
                      onChange={(reportPolicy) => void profile.save({ reportPolicy })}
                    />
                  </div>
                ) : null}
              </>
            ) : null}

            <div aria-hidden className="my-1 h-px bg-border" />
            <CaptainMenuRow
              icon={<RotateCcwIcon className="size-4" />}
              disabled={archived}
              onClick={() => {
                setOpen(false);
                setResetting(true);
              }}
            >
              <T>Reset conversation</T>
            </CaptainMenuRow>
            <CaptainMenuRow
              icon={
                archived ? (
                  <ArchiveRestoreIcon className="size-4" />
                ) : (
                  <ArchiveIcon className="size-4" />
                )
              }
              disabled={pending || !profile.canArchive}
              onClick={() => void profile.changeArchive()}
            >
              {archived ? <T>Restore Duet</T> : <T>Archive Duet</T>}
            </CaptainMenuRow>
            {profile.canDelete ? (
              <CaptainMenuRow
                destructive
                icon={<Trash2Icon className="size-4" />}
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  profile.requestDelete();
                }}
              >
                <T>Delete Duet</T>
              </CaptainMenuRow>
            ) : null}
          </div>

          {current.earlierThreadIds.length > 0 ? (
            <div className="mt-1 border-t border-border pt-2">
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
