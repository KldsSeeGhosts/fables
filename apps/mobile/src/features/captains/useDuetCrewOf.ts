import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentThreadShells } from "../../state/threads";
import { useCaptainOfThread } from "./useCaptainsDirectory";
import { useDuetShell } from "./useDuetShell";

const NO_SHELLS_ATOM = Atom.make<ReadonlyArray<EnvironmentThreadShell>>([]).pipe(
  Atom.withLabel("mobile-duet-crew-of:no-shells"),
);

/**
 * In the Duet shell, the Duet whose current conversation delegated this thread, so its header
 * can say whose crew it is. Null for every other thread and in other themes.
 */
export function useDuetCrewOf(
  thread: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null,
) {
  const isDuet = useDuetShell();
  const parent = useAtomValue(
    isDuet && thread !== null ? environmentThreadShells.threadShellsAtom : NO_SHELLS_ATOM,
    (shells) => {
      if (thread === null) return null;
      const shell = shells.find(
        (candidate) =>
          candidate.environmentId === thread.environmentId && candidate.id === thread.threadId,
      );
      return shell?.lineage.relationshipToParent === "subagent"
        ? shell.lineage.parentThreadId
        : null;
    },
  );
  return useCaptainOfThread(
    parent === null ? null : (thread?.environmentId ?? null),
    parent === null ? null : ThreadId.make(parent),
  );
}
