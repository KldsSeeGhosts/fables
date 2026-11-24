import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

const tab = Atom.family((key: string) =>
  Atom.make<string>("brief").pipe(Atom.withLabel(`captain-brief-tab:${key}`)),
);

export const captainBriefTabAtom = (threadRef: ScopedThreadRef) => tab(scopedThreadKey(threadRef));
