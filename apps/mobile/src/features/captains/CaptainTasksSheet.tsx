import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { msg, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RelativeTime } from "../../components/RelativeTime";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { useNowMinuteMs } from "../../lib/clock";
import { CAPTAIN_TASK_STATUS_LABELS } from "./captainLabels";
import { captainTaskGroups, type CaptainTaskRange, type CaptainTaskRow } from "./captainTaskList";
import { CaptainOrb } from "./CaptainOrb";
import { CaptainTaskRing } from "./CaptainTaskRing";
import { useCaptainsDirectory } from "./useCaptainsDirectory";

export type CaptainTasksParams = {
  readonly environmentId?: string;
  readonly captainId?: string;
};

const RANGES = [
  { value: "today", label: msg("Today", { $context: "tab, tasks from the last day" }) },
  { value: "all", label: msg("All", { $context: "tab, every delegated task" }) },
] as const satisfies ReadonlyArray<{ readonly value: CaptainTaskRange; readonly label: string }>;

function TaskRow(props: { readonly row: CaptainTaskRow; readonly onOpen: () => void }) {
  const m = useMessages();
  const status = m(CAPTAIN_TASK_STATUS_LABELS[props.row.status]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.row.thread.title}, ${status}`}
      onPress={props.onOpen}
      className="flex-row items-start gap-3 rounded-xl px-3 py-2.5 active:bg-subtle"
    >
      <View className="pt-0.5">
        <CaptainTaskRing status={props.row.status} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="min-w-0 flex-1 font-t3-medium text-sm text-foreground" numberOfLines={1}>
            {props.row.thread.title}
          </Text>
          {props.row.updatedAtMs > 0 ? (
            <Text className="text-xs text-foreground-muted">
              <RelativeTime timestamp={new Date(props.row.updatedAtMs).toISOString()} />
            </Text>
          ) : null}
        </View>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {props.row.detail ? `${status} · ${props.row.detail}` : status}
        </Text>
      </View>
    </Pressable>
  );
}

/** Delegated tasks, grouped by Captain, or one Captain's when opened from its conversation. */
export function CaptainTasksSheet({ route }: StaticScreenProps<CaptainTasksParams>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const m = useMessages();
  const nowMs = useNowMinuteMs();
  const [range, setRange] = useState<CaptainTaskRange>("today");
  const { environments, shells, showsEnvironment } = useCaptainsDirectory();
  const groups = captainTaskGroups({
    environments: environments.filter(
      ({ environmentId }) =>
        route.params?.environmentId === undefined || environmentId === route.params.environmentId,
    ),
    shells,
    range,
    nowMs,
    captainId: route.params?.captainId,
  });
  const single = route.params?.captainId !== undefined;
  const title = single
    ? (environments
        .flatMap(({ captains }) => captains)
        .find((captain) => captain.id === route.params?.captainId)?.name ?? gt("Captain tasks"))
    : gt("Captain tasks");
  // The task replaces this sheet so back returns to the workspace, not to a closed sheet.
  const openTask = (row: CaptainTaskRow) =>
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: String(row.thread.environmentId),
        threadId: String(row.thread.id),
      }),
    );
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={title} onClose={() => navigation.goBack()} />
      <ScreenContent>
        <ScrollView
          nestedScrollEnabled
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="px-2 pt-2"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          <View className="px-2 pb-2">
            <SegmentedControl
              options={RANGES.map((option) => ({ ...option, label: m(option.label) }))}
              selected={range}
              onSelect={setRange}
              role="tab"
              size="compact"
            />
          </View>
          {groups.length === 0 ? (
            <Text className="px-5 py-8 text-center text-sm text-foreground-muted">
              {range === "today" ? gt("Nothing delegated today.") : gt("No delegated tasks yet.")}
            </Text>
          ) : (
            groups.map((group) => (
              <View key={`${group.environmentId}:${group.captain.id}`} className="pb-3">
                {single ? null : (
                  <View className="flex-row items-center gap-2 px-3 pb-1 pt-2">
                    <CaptainOrb captain={group.captain} size={20} />
                    <Text className="min-w-0 flex-1 font-t3-medium text-xs text-foreground-muted">
                      {showsEnvironment
                        ? `${group.captain.name} · ${
                            environments.find(
                              ({ environmentId }) => environmentId === group.environmentId,
                            )?.label ?? ""
                          }`
                        : group.captain.name}
                    </Text>
                  </View>
                )}
                {group.rows.map((row) => (
                  <TaskRow key={row.thread.id} row={row} onOpen={() => openTask(row)} />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </ScreenContent>
    </View>
  );
}
