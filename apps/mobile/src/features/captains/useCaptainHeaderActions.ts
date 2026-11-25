import { useAtomValue } from "@effect/atom-react";
import { captainThreadActivity } from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { Atom } from "effect/reactivity";

import type { AppBarAction } from "../../components/ui/AppBar.types";
import { environmentThreadShells } from "../../state/threads";
import { useCaptainOfThread } from "./useCaptainsDirectory";
import { useDuetShell } from "./useDuetShell";

const NO_SHELLS_ATOM = Atom.make<ReadonlyArray<EnvironmentThreadShell>>([]).pipe(
  Atom.withLabel("mobile-captain-header:no-shells"),
);

/**
 * Brief and Tasks for a Captain's conversation, as header actions so neither covers the
 * browser float or the messages. Every other thread gets none.
 */
export function useCaptainHeaderActions(
  thread: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null,
): ReadonlyArray<AppBarAction> {
  const gt = useGT();
  const isDuet = useDuetShell();
  const navigation = useNavigation();
  const captain = useCaptainOfThread(thread?.environmentId ?? null, thread?.threadId ?? null);
  // Selected as a number so shell updates re-render the header only when the count changes.
  const attention = useAtomValue(
    captain === null || thread === null ? NO_SHELLS_ATOM : environmentThreadShells.threadShellsAtom,
    (shells) =>
      captain === null || thread === null
        ? 0
        : captainThreadActivity(thread.environmentId, captain, shells).attention,
  );
  if (captain === null || thread === null) return [];
  const params = { environmentId: String(thread.environmentId), captainId: String(captain.id) };
  return [
    {
      accessibilityLabel: gt("{name} brief", { name: captain.name }),
      icon: "doc.text",
      separateBackground: false,
      onPress: () => navigation.navigate("CaptainBrief", params),
    },
    {
      accessibilityLabel:
        attention > 0
          ? gt("Tasks, {count} waiting on you", { count: attention })
          : isDuet
            ? gt("Duet tasks")
            : gt("Captain tasks"),
      icon: attention > 0 ? "bell.badge" : "list.number",
      separateBackground: false,
      onPress: () => navigation.navigate("CaptainTasks", params),
    },
  ];
}
