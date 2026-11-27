import { useIsFocused, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { msg, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WorkingStatusShine } from "../../components/WorkingStatusShine";
import { RelativeTime } from "../../components/RelativeTime";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { useNowMinuteMs } from "../../lib/clock";
import {
  createScrollVisibility,
  useScrollRowVisibility,
  useScrollSectionOffset,
  type ScrollVisibility,
} from "../../lib/scroll-visibility";
import { CAPTAIN_TASK_STATUS_LABELS } from "./captainLabels";
import type { CaptainTaskStatus } from "@t3tools/client-runtime/state/captain-tasks";
import { SymbolView } from "../../components/ui/AppSymbol";
import {
  captainTaskGroups,
  captainTaskSections,
  type CaptainTaskRange,
  type CaptainTaskRow,
} from "./captainTaskList";
import { CaptainOrb } from "./CaptainOrb";
import { DuetCreature } from "./DuetCreature";
import type { DuetTokens } from "./duetTokens";
import { useDuetTokens } from "./useDuetTokens";
import { CaptainTaskRing } from "./CaptainTaskRing";
import {
  CaptainEnvironmentNotices,
  useCaptainFamilies,
  useOpenThreadFromSheet,
} from "./captainSheetSupport";
import { useCaptainsDirectory } from "./useCaptainsDirectory";
import { useDuetShell } from "./useDuetShell";

export type CaptainTasksParams = {
  readonly environmentId?: string;
  readonly captainId?: string;
};

const RANGES = [
  { value: "today", label: msg("Today", { $context: "tab, tasks from the last day" }) },
  { value: "all", label: msg("All", { $context: "tab, every delegated task" }) },
] as const satisfies ReadonlyArray<{ readonly value: CaptainTaskRange; readonly label: string }>;

type TaskRowProps = {
  readonly row: CaptainTaskRow;
  readonly visible: boolean;
  readonly viewport: ScrollVisibility;
  readonly offset: number;
  readonly onOpen: () => void;
};

function TaskRow(props: TaskRowProps) {
  const m = useMessages();
  const status = m(CAPTAIN_TASK_STATUS_LABELS[props.row.status]);
  const visibility = useScrollRowVisibility(
    props.viewport,
    props.offset,
    props.visible && props.row.status === "working",
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.row.thread.title}, ${status}`}
      onPress={props.onOpen}
      onLayout={visibility.onLayout}
      className="flex-row items-start gap-3 rounded-xl px-3 py-2.5 active:bg-subtle"
    >
      <View className="pt-0.5">
        <CaptainTaskRing status={props.row.status} visible={visibility.visible} />
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

function statusColor(status: CaptainTaskStatus, tokens: DuetTokens) {
  switch (status) {
    case "needs-input":
      return tokens.needsInputText;
    case "working":
      return tokens.workingText;
    case "ready":
      return tokens.ready;
    case "failed":
      return tokens.failed;
    default:
      return tokens.meta;
  }
}

function DuetTaskRow(props: TaskRowProps & { readonly first: boolean }) {
  const m = useMessages();
  const tokens = useDuetTokens();
  const status = m(CAPTAIN_TASK_STATUS_LABELS[props.row.status]);
  const visibility = useScrollRowVisibility(
    props.viewport,
    props.offset,
    props.visible && props.row.status === "working",
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.row.thread.title}, ${status}`}
      onPress={props.onOpen}
      onLayout={visibility.onLayout}
      className="min-h-16 flex-row items-start gap-3 py-[11px] pl-4 pr-2.5"
      style={({ pressed }) => ({ backgroundColor: pressed ? tokens.row : undefined })}
    >
      {props.first ? null : (
        <View
          className="absolute right-0 top-0 h-px"
          style={{ left: 44, backgroundColor: tokens.hairline }}
        />
      )}
      <View className="pt-0.5">
        <CaptainTaskRing status={props.row.status} visible={visibility.visible} />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline gap-2">
          <Text
            className="min-w-0 flex-1 font-t3-medium"
            style={{ fontSize: 15, lineHeight: 20, color: tokens.foreground }}
            numberOfLines={1}
          >
            {props.row.thread.title}
          </Text>
          {props.row.updatedAtMs > 0 ? (
            <Text style={{ fontSize: 12, color: tokens.meta }}>
              <RelativeTime timestamp={new Date(props.row.updatedAtMs).toISOString()} />
            </Text>
          ) : null}
        </View>
        {props.row.status === "working" ? (
          <View className="flex-row items-center">
            <WorkingStatusShine
              visible={visibility.visible}
              style={{ fontSize: 13, lineHeight: 18, color: tokens.workingText }}
              numberOfLines={1}
            >
              {status}
            </WorkingStatusShine>
            {props.row.detail ? (
              <Text
                className="min-w-0 flex-1"
                style={{ fontSize: 13, lineHeight: 18, color: tokens.meta }}
                numberOfLines={1}
              >
                {` · ${props.row.detail}`}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={{ fontSize: 13, lineHeight: 18, color: tokens.meta }} numberOfLines={1}>
            <Text style={{ color: statusColor(props.row.status, tokens) }}>{status}</Text>
            {props.row.detail ? ` · ${props.row.detail}` : null}
          </Text>
        )}
      </View>
      <View className="self-center">
        <SymbolView name="chevron.right" size={14} tintColor={tokens.icon} />
      </View>
    </Pressable>
  );
}

function DuetSectionHeading(props: { readonly children: string }) {
  const tokens = useDuetTokens();
  return (
    <Text className="px-4 pb-1 pt-3.5 font-t3-medium" style={{ fontSize: 13, color: tokens.muted }}>
      {props.children}
    </Text>
  );
}

/** Delegated tasks, grouped by Captain, or one Captain's when opened from its conversation. */
export function CaptainTasksSheet({ route }: StaticScreenProps<CaptainTasksParams>) {
  const navigation = useNavigation();
  const visible = useIsFocused();
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const isDuet = useDuetShell();
  const m = useMessages();
  const nowMs = useNowMinuteMs();
  const [range, setRange] = useState<CaptainTaskRange>("today");
  const [viewport] = useState(createScrollVisibility);
  const directory = useCaptainsDirectory();
  const environments = directory.environments.filter(
    ({ environmentId }) =>
      route.params?.environmentId === undefined || environmentId === route.params.environmentId,
  );
  const listed = environments.map(({ environmentId, captains }) => ({
    environmentId,
    captains: captains.filter(
      (captain) => route.params?.captainId === undefined || captain.id === route.params.captainId,
    ),
  }));
  const families = useCaptainFamilies(listed);
  const groups = captainTaskGroups({
    environments: listed,
    shells: directory.shells,
    range,
    nowMs,
    captainId: route.params?.captainId,
  });
  const single = route.params?.captainId !== undefined;
  const fallbackTitle = gt("Duet tasks");
  const title = single
    ? (listed.flatMap(({ captains }) => captains)[0]?.name ?? fallbackTitle)
    : fallbackTitle;
  const openThread = useOpenThreadFromSheet();
  const openTask = (row: CaptainTaskRow) => openThread(row.thread.environmentId, row.thread.id);
  const loading = families === "pending" || environments.some(({ status }) => status === "loading");
  // With no environment loaded, the notices above already say why the list is empty.
  const emptyText = loading
    ? gt("Loading tasks…")
    : environments.length > 0 && environments.every(({ status }) => status === "failed")
      ? null
      : range === "today"
        ? gt("Nothing delegated today.")
        : gt("No delegated tasks yet.");
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader
        title={title}
        subtitle={isDuet && single ? gt("Solo tasks") : undefined}
        onClose={() => navigation.goBack()}
      />
      <ScreenContent>
        <ScrollView
          nestedScrollEnabled
          className="flex-1"
          onScroll={({ nativeEvent }) =>
            viewport.update(nativeEvent.contentOffset.y, nativeEvent.layoutMeasurement.height)
          }
          scrollEventThrottle={16}
          onLayout={(event) => viewport.layout(event.nativeEvent.layout.height, 0)}
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
          <CaptainEnvironmentNotices environments={environments} />
          {families === "failed" ? (
            <Text className="px-3 pb-2 text-xs text-danger-foreground">
              {gt("Some finished tasks could not load.")}
            </Text>
          ) : null}
          {groups.length === 0 ? (
            emptyText === null ? null : (
              <Text className="px-5 py-8 text-center text-sm text-foreground-muted">
                {emptyText}
              </Text>
            )
          ) : (
            groups.map((group) => (
              <CaptainTaskGroup
                key={`${group.environmentId}:${group.captain.id}`}
                group={group}
                single={single}
                isDuet={isDuet}
                visible={visible}
                viewport={viewport}
                environmentLabel={
                  directory.showsEnvironment
                    ? environments.find(
                        ({ environmentId }) => environmentId === group.environmentId,
                      )?.label
                    : undefined
                }
                onOpen={openTask}
              />
            ))
          )}
        </ScrollView>
      </ScreenContent>
    </View>
  );
}

type TaskGroupProps = {
  readonly group: ReturnType<typeof captainTaskGroups>[number];
  readonly single: boolean;
  readonly isDuet: boolean;
  readonly visible: boolean;
  readonly viewport: ScrollVisibility;
  readonly environmentLabel: string | undefined;
  readonly onOpen: (row: CaptainTaskRow) => void;
};

function CaptainTaskGroup(props: TaskGroupProps) {
  const { captain, rows } = props.group;
  const layout = useScrollSectionOffset();
  const tokens = useDuetTokens();
  const name = props.environmentLabel
    ? `${captain.name} · ${props.environmentLabel}`
    : captain.name;
  return (
    <View className={props.isDuet ? "-mx-2 pb-3" : "pb-3"} onLayout={layout.onLayout}>
      {props.single ? null : props.isDuet ? (
        <View className="flex-row items-center gap-2 px-4 pb-1 pt-3">
          <DuetCreature captain={captain} size={18} />
          <Text
            className="min-w-0 flex-1 font-t3-medium"
            style={{ fontSize: 13, color: tokens.foreground }}
          >
            {name}
          </Text>
        </View>
      ) : (
        <View className="flex-row items-center gap-2 px-3 pb-1 pt-2">
          <CaptainOrb captain={captain} size={20} />
          <Text className="min-w-0 flex-1 font-t3-medium text-xs text-foreground-muted">
            {name}
          </Text>
        </View>
      )}
      {props.isDuet
        ? captainTaskSections(rows).map((section) => (
            <DuetTaskSection
              key={section.kind}
              section={section}
              offset={layout.offset}
              visible={props.visible}
              viewport={props.viewport}
              onOpen={props.onOpen}
            />
          ))
        : rows.map((row) => (
            <TaskRow
              key={row.thread.id}
              row={row}
              visible={props.visible}
              viewport={props.viewport}
              offset={layout.offset}
              onOpen={() => props.onOpen(row)}
            />
          ))}
    </View>
  );
}

function DuetTaskSection(props: {
  readonly section: ReturnType<typeof captainTaskSections>[number];
  readonly offset: number;
  readonly visible: boolean;
  readonly viewport: ScrollVisibility;
  readonly onOpen: (row: CaptainTaskRow) => void;
}) {
  const gt = useGT();
  const layout = useScrollSectionOffset(props.offset);
  const { section } = props;
  return (
    <View onLayout={layout.onLayout}>
      <DuetSectionHeading>
        {section.kind === "running"
          ? gt("Running · {count}", { count: section.rows.length })
          : gt("Finished · {count}", { count: section.rows.length })}
      </DuetSectionHeading>
      {section.rows.map((row, index) => (
        <DuetTaskRow
          key={row.thread.id}
          row={row}
          first={index === 0}
          visible={props.visible}
          viewport={props.viewport}
          offset={layout.offset}
          onOpen={() => props.onOpen(row)}
        />
      ))}
    </View>
  );
}
