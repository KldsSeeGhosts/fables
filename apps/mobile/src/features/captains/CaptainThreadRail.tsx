import { captainThreadActivity } from "@t3tools/client-runtime/state/captains";
import type { Captain, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useThreadShells } from "../../state/entities";
import { CaptainOrb } from "./CaptainOrb";
import { useCaptainOfThread } from "./useCaptainsDirectory";

function RailButton(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly badge?: number;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={4}
      onPress={props.onPress}
      className="size-10 items-center justify-center rounded-full active:bg-subtle"
    >
      <SymbolView name={props.icon} size={18} tintColorClassName="accent-icon" />
      {props.badge !== undefined && props.badge > 0 ? (
        <View className="absolute right-0.5 top-0.5 min-w-4 items-center justify-center rounded-full bg-warning px-1">
          <Text className="font-t3-bold text-3xs text-warning-foreground">{props.badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The right-edge rail on a Captain's conversation: its orb opens the Brief, and Tasks shows
 * what its crew is on. Other threads render nothing.
 */
export function CaptainThreadRail(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly top: number;
}) {
  const captain = useCaptainOfThread(props.environmentId, props.threadId);
  return captain === null ? null : (
    <CaptainRail environmentId={props.environmentId} captain={captain} top={props.top} />
  );
}

// Split out so only a Captain's conversation subscribes to every thread shell.
function CaptainRail(props: {
  readonly environmentId: EnvironmentId;
  readonly captain: Captain;
  readonly top: number;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const shells = useThreadShells();
  const { captain } = props;
  const activity = captainThreadActivity(props.environmentId, captain, shells);
  const params = { environmentId: String(props.environmentId), captainId: String(captain.id) };
  return (
    <View
      pointerEvents="box-none"
      className="absolute right-2 z-20 items-center gap-1 rounded-full border border-border-subtle bg-sheet p-1 shadow-sm shadow-black/10"
      style={{ top: props.top }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("{name} brief", { name: captain.name })}
        onPress={() => navigation.navigate("CaptainBrief", params)}
        className="size-10 items-center justify-center rounded-full active:bg-subtle"
      >
        <CaptainOrb captain={captain} size={32} working={activity.working} />
      </Pressable>
      <RailButton
        icon="list.number"
        label={
          activity.attention > 0
            ? gt("Tasks, {count} waiting on you", { count: activity.attention })
            : gt("Captain tasks")
        }
        badge={activity.attention}
        onPress={() => navigation.navigate("CaptainTasks", params)}
      />
    </View>
  );
}
