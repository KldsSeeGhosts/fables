import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useRightPanelStore } from "../../rightPanelStore";

const tab = Atom.family((key: string) =>
  Atom.make<string>("brief").pipe(Atom.withLabel(`captain-brief-tab:${key}`)),
);

/** Legacy brief-panel tab mirror, kept while the drawer replaces the old panel surface. */
export const captainBriefTabAtom = (threadRef: ScopedThreadRef) => tab(scopedThreadKey(threadRef));

export type CaptainDrawerTab = "today" | "all" | "scheduled";

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
