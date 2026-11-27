import { fleetChorusStateLabel } from "@t3tools/client-runtime/state/captains";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId, FleetChorusState } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { WorkingStatusShine } from "../../components/WorkingStatusShine";
import { useScrollRowVisibility, type ScrollVisibility } from "../../lib/scroll-visibility";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { DUET_WAITING_LABELS, DUET_WAITING_ICONS } from "./captainLabels";
import { CaptainTaskRing } from "./CaptainTaskRing";
import { DuetCreature } from "./DuetCreature";
import { duetRowScope, duetRowTrail, type DuetRowTrail } from "./duetHomeRow";
import type { DuetTokens } from "./duetTokens";
import { useDuetTokens } from "./useDuetTokens";

export interface DuetHomeRow {
  readonly environment: { readonly environmentId: EnvironmentId; readonly label: string };
  readonly captain: Captain;
  readonly activity: Parameters<typeof duetRowTrail>[0]["activity"];
  readonly fleetState?: FleetChorusState | undefined;
}

function Trail(props: {
  readonly trail: DuetRowTrail;
  readonly tokens: DuetTokens;
  readonly visible: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const { trail, tokens } = props;
  if (trail.kind === "idle") {
    return (
      <Text style={{ fontSize: 12, lineHeight: 16, color: tokens.placeholder }}>
        <RelativeTime timestamp={trail.at} />
      </Text>
    );
  }
  if (trail.kind === "working") {
    return (
      <View className="flex-row items-center gap-1">
        <CaptainTaskRing status="working" size={13} visible={props.visible} />
        <WorkingStatusShine
          visible={props.visible}
          className="font-t3-medium"
          style={{ fontSize: 13, lineHeight: 18, color: tokens.workingText }}
        >
          {gt("Working", { $context: "Duet state" })}
        </WorkingStatusShine>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1">
      <SymbolView name={DUET_WAITING_ICONS[trail.on]} size={13} tintColor={tokens.needsInput} />
      <Text
        className="font-t3-medium"
        style={{
          fontSize: 13,
          lineHeight: 18,
          color: tokens.needsInputText,
        }}
      >
        {m(DUET_WAITING_LABELS[trail.on])}
      </Text>
    </View>
  );
}

/** Duets above the threads, as desktop's sidebar draws them: creature, name, status or time. */
export function DuetHomeSection(props: {
  readonly rows: ReadonlyArray<DuetHomeRow>;
  readonly viewport: ScrollVisibility;
  readonly visible: boolean;
  readonly waiting: number;
  readonly showsEnvironment: boolean;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly selectedThreadKey: string | null;
  readonly onOpenFleet: () => void;
}) {
  const gt = useGT();
  const message = useMessages();
  const tokens = useDuetTokens();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const [sectionTop, setSectionTop] = useState(0);
  return (
    <View className="pb-2" onLayout={(event) => setSectionTop(event.nativeEvent.layout.y)}>
      <View className="h-11 flex-row items-center gap-1.5 pl-4 pr-1.5">
        <Text
          className="min-w-0 flex-1 font-t3-medium"
          style={{ fontSize: 13, color: tokens.muted }}
        >
          {gt("Duets")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            props.waiting > 0 ? gt("Inbox, {count} waiting", { count: props.waiting }) : gt("Inbox")
          }
          onPress={() => navigation.navigate("CaptainsInbox")}
          className="h-11 justify-center"
        >
          <View
            className="h-[30px] flex-row items-center gap-1 rounded-full px-[11px]"
            style={{
              borderWidth: 1,
              borderColor: props.waiting > 0 ? tokens.needsInputRing : tokens.hairline,
            }}
          >
            <SymbolView
              name="bell.badge"
              size={13}
              tintColor={props.waiting > 0 ? tokens.needsInputText : tokens.pillForeground}
            />
            <Text
              className="font-t3-medium"
              style={{
                fontSize: 13,
                color: props.waiting > 0 ? tokens.needsInputText : tokens.pillForeground,
              }}
            >
              {props.waiting > 0 ? String(props.waiting) : gt("Inbox")}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Duet tasks")}
          onPress={() => navigation.navigate("CaptainTasks", {})}
          className="h-11 justify-center"
        >
          <View
            className="h-[30px] flex-row items-center gap-1 rounded-full px-[11px]"
            style={{ borderWidth: 1, borderColor: tokens.hairline }}
          >
            <SymbolView name="list.number" size={13} tintColor={tokens.pillForeground} />
            <Text className="font-t3-medium" style={{ fontSize: 13, color: tokens.pillForeground }}>
              {gt("Tasks", { $context: "noun, a Duet's delegated tasks" })}
            </Text>
          </View>
        </Pressable>
      </View>
      {props.rows.map(({ environment, captain, activity, fleetState }) => {
        const trail = duetRowTrail({ captain, activity });
        const scope = duetRowScope(environment.environmentId, captain, props.projects);
        const scopeText =
          fleetState !== undefined
            ? fleetChorusStateLabel(fleetState, message)
            : captain.archivedAt !== null
              ? gt("Archived")
              : scope.kind === "project"
                ? scope.title
                : scope.kind === "projects"
                  ? gt("{count, plural, =1 {1 project} other {{count} projects}}", {
                      count: scope.count,
                    })
                  : gt("All projects");
        const threadKey = scopedThreadKey(environment.environmentId, captain.primaryThreadId);
        const selected = threadKey === props.selectedThreadKey;
        const disabled = fleetState !== undefined && fleetState !== "ready";
        return (
          <DuetChannelRow
            key={`${environment.environmentId}:${captain.id}`}
            viewport={props.viewport}
            sectionTop={sectionTop}
            visible={props.visible}
            captain={captain}
            selected={selected}
            disabled={disabled}
            trail={trail}
            tokens={tokens}
            fleet={fleetState !== undefined}
            scope={scope}
            scopeText={
              props.showsEnvironment && fleetState === undefined
                ? `${scopeText} · ${environment.label}`
                : scopeText
            }
            accessibilityLabel={[captain.name, scopeText].join(", ")}
            onPress={() => {
              if (fleetState !== undefined) {
                props.onOpenFleet();
                return;
              }
              selectDetail({
                name: "Thread",
                params: {
                  environmentId: String(environment.environmentId),
                  threadId: String(captain.primaryThreadId),
                },
              });
            }}
          />
        );
      })}
    </View>
  );
}

function DuetChannelRow(props: {
  readonly viewport: ScrollVisibility;
  readonly sectionTop: number;
  readonly visible: boolean;
  readonly captain: Captain;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly trail: DuetRowTrail;
  readonly tokens: DuetTokens;
  readonly fleet: boolean;
  readonly scope: ReturnType<typeof duetRowScope>;
  readonly scopeText: string;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}) {
  const { captain, disabled, scope, selected, tokens, trail } = props;
  const visibility = useScrollRowVisibility(props.viewport, props.sectionTop, props.visible);
  const visible = visibility.visible && !disabled && captain.archivedAt === null;
  const [glance, setGlance] = useState(0);
  const glanceOnce = () => setGlance((previous) => previous + 1);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      accessibilityLabel={props.accessibilityLabel}
      onLayout={visibility.onLayout}
      onPress={props.onPress}
      onPressIn={glanceOnce}
      onHoverIn={glanceOnce}
      onFocus={glanceOnce}
      className="mx-2 min-h-[60px] flex-row items-center gap-3 rounded-[10px] pl-2 pr-2.5"
      style={({ pressed }) => ({
        backgroundColor: selected || pressed ? tokens.row : undefined,
      })}
    >
      {!props.fleet ? null : (
        <View
          className="absolute bottom-3 left-1 top-3 w-0.5 rounded-full"
          style={{ backgroundColor: tokens.needsInput }}
        />
      )}
      <DuetCreature
        captain={captain}
        size={32}
        state={trail.kind}
        archived={captain.archivedAt !== null}
        visible={visible}
        glance={glance}
      />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="min-w-0 flex-1 font-t3-medium"
            style={{ fontSize: 16, lineHeight: 21, color: tokens.foreground }}
            numberOfLines={1}
          >
            {captain.name}
          </Text>
          <Trail trail={trail} tokens={tokens} visible={visible} />
        </View>
        <View className="mt-px flex-row items-center gap-1.5">
          {scope.kind === "project" ? (
            <View
              className="h-4 w-4 items-center justify-center rounded"
              style={{
                backgroundColor: tokens.bubble,
                borderWidth: 1,
                borderColor: tokens.hairline,
              }}
            >
              <Text
                allowFontScaling={false}
                className="font-t3-bold"
                style={{ fontSize: 7.5, color: tokens.pillForeground }}
              >
                {scope.badge}
              </Text>
            </View>
          ) : captain.kind !== "chorus" ? (
            <SymbolView name="folder" size={13} tintColor={tokens.icon} />
          ) : null}
          <Text
            className="min-w-0 flex-1"
            style={{ fontSize: 13, lineHeight: 18, color: tokens.meta }}
            numberOfLines={1}
          >
            {props.scopeText}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
