import { useAtomValue } from "@effect/atom-react";
import { captainThreadActivity } from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useGT } from "gt-react-native";
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useContentTopInset } from "../../components/ui/useBarInset";
import { environmentThreadShells } from "../../state/threads";
import { DUET_FLOATING_ORB_HEIGHT, DuetFloatingOrb, type DuetCreatureState } from "./DuetCreature";
import { useCaptainOfThread } from "./useCaptainsDirectory";
import { useDuetShell } from "./useDuetShell";
import { useDuetTokens } from "./useDuetTokens";

const ORB_TOP_GAP = 2;
/** The band the orb and its live pill take under the bar; the feed starts below it. */
export const DUET_CONVERSATION_ORB_INSET = ORB_TOP_GAP + DUET_FLOATING_ORB_HEIGHT;

const NO_SHELLS_ATOM = Atom.make<ReadonlyArray<EnvironmentThreadShell>>([]).pipe(
  Atom.withLabel("mobile-duet-orb:no-shells"),
);

/** The floating orb over a Duet's own conversation in the Duet shell; nothing elsewhere. */
export function DuetConversationOrb(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const tokens = useDuetTokens();
  const fadeId = `duet-orb-fade-${useId().replace(/[^A-Za-z0-9_-]/g, "-")}`;
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
      style={{
        position: "absolute",
        top: topInset,
        left: 0,
        right: 0,
        height: DUET_CONVERSATION_ORB_INSET,
        paddingTop: ORB_TOP_GAP,
        zIndex: 3,
      }}
    >
      {/* Static fade: text scrolling up dissolves into the surface before it reaches the orb. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={fadeId} x1="0%" x2="0%" y1="0%" y2="100%">
            <Stop offset="0%" stopColor={tokens.background} stopOpacity={1} />
            <Stop offset="55%" stopColor={tokens.background} stopOpacity={1} />
            <Stop offset="100%" stopColor={tokens.background} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${fadeId})`} />
      </Svg>
      <DuetFloatingOrb captain={captain} state={state} live={live} />
    </View>
  );
}
