import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { sideThreadKindOf } from "@t3tools/client-runtime/side-thread";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { resolveLatestMergeBackRun } from "@t3tools/client-runtime/state/thread-workflows";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { CornerUpLeftIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { ComposerHandleContext } from "../../composerHandleContext";
import { useClientSettings } from "../../hooks/useSettings";
import { releaseComposerDraftUploads } from "../../lib/composerDraftUploads";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { readLocalApi } from "../../localApi";
import { hostRightPanel, type ThreadSurface, useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadProjection, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentShellStatus } from "../../state/shell";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import {
  isThreadRouteSnapshotAuthoritative,
  resolveThreadRouteRenderState,
} from "../../threadRoutes";
import { useOpenThreadFamily } from "../ThreadRouteView";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatView from "../ChatView";
import { PanelTabActions, useInPanelTabBar } from "../PanelTabBreadcrumb";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BackgroundThreadContext } from "./backgroundThread";

/**
 * A side chat or a subagent as a tab: the thread's own chat, which decides its bottom, the
 * composer or the read-only bar, as it does on the main screen. The tab names it and closes it,
 * so only a side chat, which has actions of its own, gets a header.
 */
export default function SideThreadPane(props: {
  /** The thread whose panel shows the tab. */
  readonly parentRef: ScopedThreadRef;
  readonly surface: ThreadSurface;
  readonly parentPanel: SideChatParentPanel;
  readonly onClose: () => void;
}) {
  const { parentRef, surface } = props;
  const { threadId } = surface;
  const inPanelTabBar = useInPanelTabBar();
  const gt = useGT();
  const threadRef = scopeThreadRef(parentRef.environmentId, threadId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the parent panel as host in the panel store
  useEffect(
    () => hostRightPanel(scopeThreadRef(parentRef.environmentId, threadId), parentRef),
    [parentRef, threadId],
  );
  const shell = useQuietThreadShell(threadRef);
  const parent = useQuietThreadShell(parentRef);
  const bootstrapComplete = isThreadRouteSnapshotAuthoritative(
    useEnvironmentShellStatus(parentRef.environmentId),
  );
  // The shell can leave an idle subagent out, so its own detail says whether it still exists.
  const unlistedDetail = useEnvironmentThread(
    shell === null ? parentRef.environmentId : null,
    shell === null ? threadId : null,
  );
  useOpenThreadFamily(threadRef, bootstrapComplete && shell === null);
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadExists: shell !== null,
    serverThreadDeleted: shell?.deletedAt != null,
    unlistedThreadDetail: unlistedDetail,
    draftThreadExists: false,
  });
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const thread = shell ?? projection?.thread ?? null;
  // A tab opens for side chats and subagents only, so an unloaded one is still one of them.
  const kind = sideThreadKindOf(thread) ?? "subagent";
  const isSideChat = kind === "side-chat";
  const canOperate = useEnvironmentScope(parentRef.environmentId, AuthOrchestrationOperateScope);
  const mergeBack = useAtomCommand(threadEnvironment.mergeBack, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const [bringingBack, setBringingBack] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mergeRun = projection ? resolveLatestMergeBackRun(projection) : null;
  // A pending merge-back would fail the main thread's queued message, so the server refuses it.
  const bringBackBlockedReason = !canOperate
    ? gt("This connection cannot change threads.")
    : threadRuntimeIsActive(parent?.runtime)
      ? gt("Available when the main thread is idle.")
      : mergeRun === null
        ? gt("Available after a finished reply.")
        : null;

  const bringBack = async () => {
    if (bringBackBlockedReason !== null || mergeRun === null || bringingBack) return;
    setBringingBack(true);
    const result = await mergeBack({
      environmentId: parentRef.environmentId,
      input: { sourceThreadId: threadId, targetThreadId: parentRef.threadId, runId: mergeRun.id },
    });
    setBringingBack(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: gt("Brought back"),
        description: gt("The main thread gets this side chat with your next message there."),
      });
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not bring back the side chat"),
        ...(error instanceof Error ? { description: error.message } : {}),
      });
    }
  };

  const deleteSideChat = async () => {
    if (!canOperate || shell === null || deleting) return;
    if (confirmThreadDelete) {
      const api = readLocalApi();
      if (!api) return;
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(
          [
            gt('Delete side chat "{title}"?', { title: shell.title }),
            gt("This permanently clears its conversation history."),
          ].join("\n"),
          { variant: "destructive" },
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;
    }
    setDeleting(true);
    const result = await deleteThread({
      environmentId: parentRef.environmentId,
      input: { threadId },
    });
    setDeleting(false);
    if (result._tag === "Success") {
      releaseComposerDraftUploads(threadRef);
      useComposerDraftStore.getState().clearDraftThread(threadRef);
      useRightPanelStore.getState().closeSurface(parentRef, surface.id);
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not delete the side chat"),
        ...(error instanceof Error ? { description: error.message } : {}),
      });
    }
  };

  const title =
    thread === null
      ? isSideChat
        ? gt("Side chat")
        : gt("Subagent")
      : isSideChat
        ? thread.title
        : formatSubagentDisplayTitle(thread.title);

  const actions = (
    <div className="flex shrink-0 items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={gt("Bring back")}
              aria-disabled={bringBackBlockedReason !== null || bringingBack || undefined}
              onClick={() => void bringBack()}
            >
              <CornerUpLeftIcon className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          <T>Bring back</T>
          {bringBackBlockedReason ? <span className="block">{bringBackBlockedReason}</span> : null}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<span className="flex shrink-0" />}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={gt("Delete side chat")}
            disabled={!canOperate || shell === null || deleting}
            onClick={() => void deleteSideChat()}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          <T>Delete side chat</T>
        </TooltipPopup>
      </Tooltip>
      {inPanelTabBar ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={gt("Close side chat")}
                onClick={props.onClose}
              >
                <XIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">
            <T>Close side chat</T>
          </TooltipPopup>
        </Tooltip>
      )}
    </div>
  );

  return (
    <div
      data-side-chat-pane={threadId}
      data-testid="side-thread-pane"
      className="flex h-full min-h-0 flex-col"
    >
      {isSideChat ? (
        inPanelTabBar ? (
          <PanelTabActions>{actions}</PanelTabActions>
        ) : (
          <div className="flex h-9 shrink-0 items-center gap-1 pr-1 pl-3">
            <span className="min-w-0 flex-1 truncate text-meta">{title}</span>
            {actions}
          </div>
        )
      ) : null}
      {renderState === "missing" ? (
        <p className="p-3 text-xs text-muted-foreground">
          {isSideChat ? (
            <T>This side chat was deleted.</T>
          ) : (
            <T>This thread is no longer available.</T>
          )}
        </p>
      ) : renderState === "loading" && thread === null ? null : (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={parentRef.environmentId}
              threadId={threadId}
              routeKind="server"
              embedded={props.parentPanel}
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      )}
    </div>
  );
}
