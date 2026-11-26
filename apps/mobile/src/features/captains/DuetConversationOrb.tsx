import { useAtomValue } from "@effect/atom-react";
import { captainThreadActivity } from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useGT } from "gt-react-native";
import { View } from "react-native";

import { useContentTopInset } from "../../components/ui/useBarInset";
import { environmentThreadShells } from "../../state/threads";
import { DuetFloatingOrb, type DuetCreatureState } from "./DuetCreature";
import { useCaptainOfThread } from "./useCaptainsDirectory";
import { useDuetShell } from "./useDuetShell";

const NO_SHELLS_ATOM = Atom.make<ReadonlyArray<EnvironmentThreadShell>>([]).pipe(
  Atom.withLabel("mobile-duet-orb:no-shells"),
);

/** The floating orb over a Duet's own conversation in the Duet shell; nothing elsewhere. */
export function DuetConversationOrb(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const isDuet = useDuetShell();
  const captain = useCaptainOfThread(
    isDuet ? props.environmentId : null,
    isDuet ? props.threadId : null,
  );
  const topInset = useContentTopInset();
  // Selected as a short key so streaming shells re-render the orb only when its state changes.
  const key = useAtomValue(
    captain === null ? NO_SHELLS_ATOM : environmentThreadShells.threadShellsAtom,
    (shells) => {
      if (captain === null) return "idle:0";
      const activity = captainThreadActivity(props.environmentId, captain, shells);
      const state: DuetCreatureState =
        activity.attention > 0 ? "waiting" : activity.working ? "working" : "idle";
      return `${state}:${activity.children.length}`;
    },
  );
  if (captain === null) return null;
  const [state, crew] = key.split(":") as [DuetCreatureState, string];
  const count = Number(crew);
  const live =
    state !== "working"
      ? null
      : count > 0
        ? gt("{count, plural, =1 {Working on 1 task} other {Working on {count} tasks}}", { count })
        : gt("Working", { $context: "Captain state" });
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: topInset + 2, left: 0, right: 0, zIndex: 3 }}
    >
      <DuetFloatingOrb captain={captain} state={state} live={live} />
    </View>
  );
}
