import { captainInboxItems, captainThreadActivity } from "@t3tools/client-runtime/state/captains";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import { useHomeRouteVisible } from "../home/home-route-visibility";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { CaptainOrb } from "./CaptainOrb";
import { orderCaptainHomeRows } from "./captainHomeOrder";
import { captainShells, captainShellsByConversation } from "./captainShellIndex";
import { DuetHomeSection } from "./DuetHomeSection";
import { useCaptainsDirectory } from "./useCaptainsDirectory";
import { useDuetShell } from "./useDuetShell";

/** Captains above the thread list: who is working, who waits on you, and the way to each. */
export function CaptainsHomeSection(props: {
  readonly hidden: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly selectedThreadKey: string | null;
}) {
  const gt = useGT();
  const isDuet = useDuetShell();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const visible = useHomeRouteVisible();
  const { environments, shells, showsEnvironment } = useCaptainsDirectory({
    visible: visible && !props.hidden,
    environmentId: props.environmentId,
  });
  if (props.hidden || environments.every(({ captains }) => captains.length === 0)) return null;
  const byConversation = captainShellsByConversation(shells);
  const rows = orderCaptainHomeRows(
    environments.flatMap((environment) =>
      environment.captains.map((captain) => {
        const own = captainShells(byConversation, environment.environmentId, captain);
        return {
          environment,
          captain,
          own,
          activity: captainThreadActivity(environment.environmentId, captain, own),
        };
      }),
    ),
  );
  const waiting = captainInboxItems(
    environments,
    rows.flatMap(({ own }) => own),
  ).length;
  if (isDuet) {
    return (
      <DuetHomeSection
        rows={rows}
        waiting={waiting}
        showsEnvironment={showsEnvironment}
        projects={props.projects}
        selectedThreadKey={props.selectedThreadKey}
      />
    );
  }
  return (
    <View className="gap-1 px-2 pb-3 pt-2">
      <View className="flex-row items-center gap-2 px-2 pb-1">
        <Text className="min-w-0 flex-1 font-t3-medium text-xs text-foreground-muted">
          {gt("Captains")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            waiting > 0 ? gt("Inbox, {count} waiting", { count: waiting }) : gt("Inbox")
          }
          hitSlop={6}
          onPress={() => navigation.navigate("CaptainsInbox")}
          className={cn(
            "flex-row items-center gap-1 rounded-full px-2.5 py-1",
            waiting > 0 ? "bg-warning/20" : "bg-subtle",
          )}
        >
          <SymbolView
            name="bell.badge"
            size={12}
            tintColorClassName={waiting > 0 ? "accent-warning-foreground" : "accent-icon-muted"}
          />
          <Text
            className={cn(
              "font-t3-medium text-xs",
              waiting > 0 ? "text-warning-foreground" : "text-foreground-muted",
            )}
          >
            {waiting > 0 ? String(waiting) : gt("Inbox")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Captain tasks")}
          hitSlop={6}
          onPress={() => navigation.navigate("CaptainTasks", {})}
          className="flex-row items-center gap-1 rounded-full bg-subtle px-2.5 py-1"
        >
          <SymbolView name="list.number" size={12} tintColorClassName="accent-icon-muted" />
          <Text className="font-t3-medium text-xs text-foreground-muted">
            {gt("Tasks", { $context: "noun, a Captain's delegated tasks" })}
          </Text>
        </Pressable>
      </View>
      {rows.map(({ environment, captain, activity }) => {
        const state =
          activity.attention > 0
            ? gt(
                "{count, plural, one {{count} request waits on you} other {{count} requests wait on you}}",
                { count: activity.attention },
              )
            : activity.children.length > 0
              ? gt("{count, plural, one {Crew on {count} task} other {Crew on {count} tasks}}", {
                  count: activity.children.length,
                })
              : activity.working
                ? gt("Working", { $context: "Captain state" })
                : captain.role.trim() || null;
        const detail = showsEnvironment
          ? [state, environment.label].filter((part) => part !== null).join(" · ")
          : state;
        return (
          <Pressable
            key={`${environment.environmentId}:${captain.id}`}
            accessibilityRole="button"
            accessibilityLabel={[captain.name, detail].filter(Boolean).join(", ")}
            onPress={() =>
              selectDetail({
                name: "Thread",
                params: {
                  environmentId: String(environment.environmentId),
                  threadId: String(captain.primaryThreadId),
                },
              })
            }
            className="flex-row items-center gap-3 rounded-xl px-2 py-2 active:bg-subtle"
          >
            <CaptainOrb
              captain={captain}
              working={activity.working}
              attention={activity.attention}
            />
            <View className="min-w-0 flex-1">
              <Text className="font-t3-medium text-base text-foreground" numberOfLines={1}>
                {captain.name}
              </Text>
              {detail ? (
                <Text
                  className={cn(
                    "text-xs",
                    activity.attention > 0 ? "text-warning-foreground" : "text-foreground-muted",
                  )}
                  numberOfLines={1}
                >
                  {detail}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
