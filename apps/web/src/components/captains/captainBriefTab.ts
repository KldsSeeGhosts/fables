import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { isCaptainThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useRightPanelStore } from "../../rightPanelStore";

const tab = Atom.family((key: string) =>
  Atom.make<string>("brief").pipe(Atom.withLabel(`captain-brief-tab:${key}`)),
);

/** Legacy brief-panel tab mirror, kept while the drawer replaces the old panel surface. */
export const captainBriefTabAtom = (threadRef: ScopedThreadRef) => tab(scopedThreadKey(threadRef));

export type CaptainChannelView = "chat" | "tasks" | "make";

// Kept alive: the Captains page and sidebar set a view before the conversation mounts.
const channelView = Atom.family((key: string) =>
  Atom.make<CaptainChannelView>("chat").pipe(
    Atom.keepAlive,
    Atom.withLabel(`captain-channel-view:${key}`),
  ),
);

/** Which Duet view a Captain conversation's pane shows: the chat, its task board, or its deliverables. */
export const captainChannelViewAtom = (threadRef: ScopedThreadRef) =>
  channelView(scopedThreadKey(threadRef));

/** A thread that is not a Captain conversation always shows its chat. */
export function useCaptainChannelView(threadRef: ScopedThreadRef | null): CaptainChannelView {
  const isCaptain = threadRef !== null && isCaptainThreadId(threadRef.threadId);
  const view = useAtomValue(channelView(isCaptain ? scopedThreadKey(threadRef) : ""));
  return isCaptain ? view : "chat";
}

export type CaptainDrawerTab = "today" | "all" | "scheduled" | "docs";

const drawerTab = Atom.family((key: string) =>
  Atom.make<CaptainDrawerTab>("today").pipe(
    Atom.keepAlive,
    Atom.withLabel(`captain-drawer-tab:${key}`),
  ),
);

export const captainDrawerTabAtom = (threadRef: ScopedThreadRef) =>
  drawerTab(scopedThreadKey(threadRef));

/** Opens the Captain's task drawer, optionally on one of its tabs. */
export function openCaptainTasks(threadRef: ScopedThreadRef, tab?: CaptainDrawerTab): void {
  if (tab !== undefined) appAtomRegistry.set(captainDrawerTabAtom(threadRef), tab);
  useRightPanelStore.getState().open(threadRef, "captain-brief");
}
