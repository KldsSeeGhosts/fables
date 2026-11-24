import { useAtomSet } from "@effect/atom-react";
import type { Captain, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Plural, T, useGT, Var } from "gt-react";
import { FolderIcon, HistoryIcon, PanelRightIcon } from "lucide-react";

import { toggleThreadSurfaceTab } from "../../layout/openRules";
import { selectActiveRightPanel, useRightPanelStore } from "../../rightPanelStore";
import { useProjects } from "../../state/entities";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { captainBriefTabAtom } from "./captainBriefTab";
import { CaptainEarlierConversations } from "./CaptainEarlierConversations";
import { CaptainResetButton } from "./CaptainResetButton";

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
  const { environmentId } = threadRef;
  const projects = useProjects();
  const scopeCount = captain.scopedProjectIds.length;
  const scopeName =
    scopeCount === 1
      ? projects.find(
          (project) =>
            project.environmentId === environmentId && project.id === captain.scopedProjectIds[0],
        )?.title
      : undefined;
  const setBriefTab = useAtomSet(captainBriefTabAtom(threadRef));
  const briefOpen = useRightPanelStore(
    (state) => selectActiveRightPanel(state.byThreadKey, threadRef) === "captain-brief",
  );
  const openScope = () => {
    setBriefTab("brief");
    useRightPanelStore.getState().open(threadRef, "captain-brief");
  };

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-0.5">
      <div className="hidden max-w-44 min-w-0 items-center gap-1 sm:flex">
        {captain.role ? (
          <span className="truncate text-meta text-muted-foreground">{captain.role}</span>
        ) : null}
        <Button
          variant="ghost"
          size="xs"
          onClick={openScope}
          aria-label={gt("Edit workspace scope")}
          title={gt("Edit workspace scope")}
        >
          <FolderIcon />
          {scopeName ? (
            <span className="max-w-24 truncate">{scopeName}</span>
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
        </Button>
      </div>
      <CaptainResetButton
        captain={captain}
        environmentId={environmentId}
        compact
        onReset={onOpen}
      />
      <Popover>
        <PopoverTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={captain.earlierThreadIds.length === 0}
            />
          }
          aria-label={gt("Earlier conversations")}
          title={gt("Earlier conversations")}
        >
          <HistoryIcon />
        </PopoverTrigger>
        <PopoverPopup width="sm" align="end" padding="compact">
          <h3 className="mb-1 px-2 text-label">
            <T>Earlier conversations</T>
          </h3>
          <CaptainEarlierConversations
            captain={captain}
            environmentId={environmentId}
            onOpen={onOpen}
          />
        </PopoverPopup>
      </Popover>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={gt("Toggle Captain Brief")}
        title={gt("Toggle Captain Brief")}
        aria-pressed={briefOpen}
        onClick={() =>
          toggleThreadSurfaceTab(threadRef, "captain-brief", () =>
            useRightPanelStore.getState().toggle(threadRef, "captain-brief"),
          )
        }
      >
        <PanelRightIcon />
      </Button>
    </div>
  );
}
