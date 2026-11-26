import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { useQuietThreadProjection, useQuietThreadShell, useThreadStatus } from "../state/entities";
import { useEnvironmentShellStatus } from "../state/shell";
import { closeLayoutThread } from "./layoutActions";
import type { LayoutState } from "./layoutModel";

/** Inactive chats may never mount a ChatView, including when restored from disk. */
export function LayoutThreadTabCleanup({ layout }: { layout: LayoutState }) {
  return layout.workspaces.flatMap((workspace) =>
    workspace.columns.flatMap((column) =>
      column.panes.flatMap((pane) =>
        pane.tabs.map(({ id, content }) =>
          content.kind === "chat" && content.target.kind === "server" ? (
            <CheckThreadTab key={id} threadRef={content.target.threadRef} />
          ) : null,
        ),
      ),
    ),
  );
}

function CheckThreadTab({ threadRef }: { threadRef: ScopedThreadRef }) {
  const shell = useQuietThreadShell(threadRef);
  const live = useEnvironmentShellStatus(threadRef.environmentId) === "live";
  const draft = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef) !== null);
  // Older settled threads may be absent from a live shell. Check their own subscription.
  const unlistedRef = live && !shell && !draft ? threadRef : null;
  const status = useThreadStatus(unlistedRef);
  const detail = useQuietThreadProjection(status === "live" ? unlistedRef : null)?.projection
    .thread;
  const stale =
    live &&
    (shell?.archivedAt != null ||
      shell?.deletedAt != null ||
      status === "deleted" ||
      detail?.archivedAt != null ||
      detail?.deletedAt != null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reconcile the persisted layout and pending file drops with authoritative server thread state.
  useEffect(() => {
    if (!stale) return;
    useSidebarPendingFileDropStore.getState().clearPendingFileDropsForThread(threadRef);
    closeLayoutThread(threadRef);
  }, [stale, threadRef]);

  return null;
}
