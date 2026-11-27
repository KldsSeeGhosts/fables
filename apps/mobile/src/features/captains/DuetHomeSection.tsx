import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { Pressable, View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { DUET_WAITING_LABELS, DUET_WAITING_ICONS } from "./captainLabels";
import { DuetCreature } from "./DuetCreature";
import { duetRowScope, duetRowTrail, type DuetRowTrail } from "./duetHomeRow";
import type { DuetTokens } from "./duetTokens";
import { useDuetTokens } from "./useDuetTokens";

export interface DuetHomeRow {
  readonly environment: { readonly environmentId: EnvironmentId; readonly label: string };
  readonly captain: Captain;
  readonly activity: Parameters<typeof duetRowTrail>[0]["activity"];
}

function Trail(props: { readonly trail: DuetRowTrail; readonly tokens: DuetTokens }) {
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
  const working = trail.kind === "working";
  return (
    <View className="flex-row items-center gap-1">
      <SymbolView
        name={working ? "circle.dashed" : DUET_WAITING_ICONS[trail.on]}
        size={13}
        tintColor={working ? tokens.working : tokens.needsInput}
      />
      <Text
        className="font-t3-medium"
        style={{
          fontSize: 13,
          lineHeight: 18,
          color: working ? tokens.workingText : tokens.needsInputText,
        }}
      >
        {working ? gt("Working", { $context: "Duet state" }) : m(DUET_WAITING_LABELS[trail.on])}
      </Text>
    </View>
  );
}

/** Duets above the threads, as desktop's sidebar draws them: creature, name, status or time. */
export function DuetHomeSection(props: {
  readonly rows: ReadonlyArray<DuetHomeRow>;
  readonly waiting: number;
  readonly showsEnvironment: boolean;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly selectedThreadKey: string | null;
}) {
  const gt = useGT();
  const tokens = useDuetTokens();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const machineCount = new Set(props.rows.map((row) => row.environment.environmentId)).size;
  const hasActiveChorus = props.rows.some(
    (row) => row.captain.kind === "chorus" && row.captain.archivedAt === null,
  );
  return (
    <View className="pb-2">
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
      {hasActiveChorus ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("New Chorus")}
          onPress={() => navigation.navigate("ChorusNew")}
          className="mx-2 mb-1 min-h-[52px] flex-row items-center gap-3 rounded-[10px] pl-2 pr-2.5"
          style={({ pressed }) => ({ backgroundColor: pressed ? tokens.row : undefined })}
        >
          <View
            className="size-8 items-center justify-center rounded-full border border-dashed"
            style={{ borderColor: tokens.hairline }}
          >
            <SymbolView name="plus" size={15} tintColor={tokens.icon} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-t3-medium" style={{ fontSize: 15, color: tokens.foreground }}>
              {gt("New Chorus")}
            </Text>
            <Text style={{ fontSize: 13, color: tokens.meta }} numberOfLines={1}>
              {gt("One Duet for the whole fleet")}
            </Text>
          </View>
        </Pressable>
      )}
      {props.rows.map(({ environment, captain, activity }) => {
        const trail = duetRowTrail({ captain, activity });
        const scope = duetRowScope(environment.environmentId, captain, props.projects);
        const scopeText =
          captain.kind === "chorus"
            ? gt("All Duets across {count, plural, =1 {1 machine} other {{count} machines}}", {
                count: machineCount,
              })
            : scope.kind === "project"
              ? scope.title
              : scope.kind === "projects"
                ? gt("{count, plural, =1 {1 project} other {{count} projects}}", {
                    count: scope.count,
                  })
                : gt("All projects");
        const threadKey = scopedThreadKey(environment.environmentId, captain.primaryThreadId);
        const selected = threadKey === props.selectedThreadKey;
        return (
          <Pressable
            key={`${environment.environmentId}:${captain.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={[captain.name, scopeText].join(", ")}
            onPress={() => {
              if (captain.kind === "chorus" && captain.archivedAt !== null) {
                navigation.navigate("CaptainBrief", {
                  environmentId: String(environment.environmentId),
                  captainId: String(captain.id),
                });
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
            className="mx-2 min-h-[60px] flex-row items-center gap-3 rounded-[10px] pl-2 pr-2.5"
            style={({ pressed }) => ({
              backgroundColor: selected || pressed ? tokens.row : undefined,
            })}
          >
            <DuetCreature captain={captain} size={32} />
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-2">
                <Text
                  className="min-w-0 flex-1 font-t3-medium"
                  style={{ fontSize: 16, lineHeight: 21, color: tokens.foreground }}
                  numberOfLines={1}
                >
                  {captain.name}
                </Text>
                {captain.kind === "chorus" ? (
                  <View
                    className="rounded-full border px-1.5 py-px"
                    style={{ borderColor: tokens.hairline }}
                  >
                    <Text style={{ fontSize: 10, color: tokens.meta }}>{gt("Chorus")}</Text>
                  </View>
                ) : null}
                <Trail trail={trail} tokens={tokens} />
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
                ) : (
                  <SymbolView name="folder" size={13} tintColor={tokens.icon} />
                )}
                <Text
                  className="min-w-0 flex-1"
                  style={{ fontSize: 13, lineHeight: 18, color: tokens.meta }}
                  numberOfLines={1}
                >
                  {props.showsEnvironment ? `${scopeText} · ${environment.label}` : scopeText}
                </Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
