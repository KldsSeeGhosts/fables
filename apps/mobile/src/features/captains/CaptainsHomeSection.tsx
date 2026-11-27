import {
  captainInboxItems,
  captainThreadActivity,
  fleetChorusCaptain,
  fleetChorusStateLabel,
  withoutStoredChoruses,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId, FleetChorusState } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import type { ScrollVisibility } from "../../lib/scroll-visibility";
import { useScrollRowVisibility } from "../../lib/scroll-visibility";
import { cn } from "../../lib/cn";
import { useHomeRouteVisible } from "../home/home-route-visibility";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { CaptainOrb } from "./CaptainOrb";
import { orderCaptainHomeRows } from "./captainHomeOrder";
import { captainShells, captainShellsByConversation } from "./captainShellIndex";
import { duetInboxGroups } from "./captainInbox";
import { DuetHomeSection } from "./DuetHomeSection";
import { useCaptainsDirectory, useFleetChorus } from "./useCaptainsDirectory";
import { useOpenLinkedThreadRead } from "../threads/useOpenLinkedThread";
import { useDuetShell } from "./useDuetShell";

type CaptainHomeRow = {
  readonly environment: { readonly environmentId: EnvironmentId; readonly label: string };
  readonly captain: Captain;
  readonly own: ReadonlyArray<EnvironmentThreadShell>;
  readonly activity: ReturnType<typeof captainThreadActivity>;
  readonly fleetState?: FleetChorusState | undefined;
};

/** Captains above the thread list: who is working, who waits on you, and the way to each. */
export function CaptainsHomeSection(props: {
  readonly hidden: boolean;
  readonly viewport: ScrollVisibility;
  readonly environmentId: EnvironmentId | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly selectedThreadKey: string | null;
}) {
  const gt = useGT();
  const message = useMessages();
  const isDuet = useDuetShell();
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const visible = useHomeRouteVisible();
  const [sectionTop, setSectionTop] = useState(0);
  const { environments, shells, showsEnvironment } = useCaptainsDirectory({
    visible: visible && !props.hidden,
  });
  const fleet = useFleetChorus();
  const openLinkedThreadRead = useOpenLinkedThreadRead();
  if (props.hidden) return null;
  const byConversation = captainShellsByConversation(shells);
  const storedRows: CaptainHomeRow[] = environments.flatMap((environment) =>
    withoutStoredChoruses(environment.captains)
      .filter(
        () => props.environmentId === null || environment.environmentId === props.environmentId,
      )
      .map((captain) => {
        const own = captainShells(byConversation, environment.environmentId, captain);
        return {
          environment,
          captain,
          own,
          activity: captainThreadActivity(environment.environmentId, captain, own),
        };
      }),
  );
  const homeCaptain =
    fleet?.status.home == null
      ? undefined
      : environments
          .flatMap((environment) =>
            environment.captains.map((captain) => ({
              environment,
              captain,
              own: captainShells(byConversation, environment.environmentId, captain),
            })),
          )
          .find(
            ({ environment, captain }) =>
              environment.environmentId === fleet.status.home?.environmentId &&
              captain.primaryThreadId === fleet.status.home.threadId,
          );
  const homeEnvironmentId = fleet?.status.home?.environmentId ?? fleet?.viaEnvironmentId;
  const fleetRow: CaptainHomeRow | null =
    fleet === null || homeEnvironmentId === undefined
      ? null
      : {
          environment: {
            environmentId: homeEnvironmentId,
            label: fleet.status.home?.label ?? "",
          },
          captain: homeCaptain?.captain ?? fleetChorusCaptain(fleet.status),
          own: homeCaptain?.own ?? [],
          activity:
            homeCaptain === undefined
              ? { primary: undefined, children: [], attention: 0, working: false }
              : captainThreadActivity(
                  homeCaptain.environment.environmentId,
                  homeCaptain.captain,
                  captainShells(
                    byConversation,
                    homeCaptain.environment.environmentId,
                    homeCaptain.captain,
                  ),
                ),
          fleetState: fleet.status.state,
        };
  const rows = orderCaptainHomeRows(fleetRow === null ? storedRows : [fleetRow, ...storedRows]);
  const openFleet = () => {
    const home = fleet?.status.home;
    if (fleet === null || home?.threadId == null || fleet.status.state !== "ready") return;
    if (fleet.viaEnvironmentId === home.environmentId) {
      selectDetail({
        name: "Thread",
        params: {
          environmentId: String(home.environmentId),
          threadId: String(home.threadId),
        },
      });
      return;
    }
    openLinkedThreadRead(
      { environmentId: home.environmentId, threadId: home.threadId },
      { viaEnvironmentId: fleet.viaEnvironmentId, label: home.label },
      "Chorus",
    );
  };
  if (rows.length === 0 && environments.length === 0) return null;
  const openOverview = () => navigation.dispatch(StackActions.push("CaptainsOverview"));
  const overview = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt("Duets overview")}
      onPress={openOverview}
      className="mx-4 min-h-11 flex-row items-center gap-2 rounded-lg active:bg-subtle"
    >
      <SymbolView name="square.grid.2x2" size={14} tintColorClassName="accent-icon-muted" />
      <Text className="font-t3-medium text-sm text-foreground">{gt("Duets overview")}</Text>
      <SymbolView name="chevron.right" size={12} tintColorClassName="accent-icon-muted" />
    </Pressable>
  );
  if (rows.length === 0) return overview;
  const inbox = captainInboxItems(
    environments,
    rows.flatMap(({ own }) => own),
  );
  if (isDuet) {
    return (
      <>
        {overview}
        <DuetHomeSection
          viewport={props.viewport}
          visible={visible}
          rows={rows}
          waiting={duetInboxGroups(inbox).reduce((count, group) => count + group.items.length, 0)}
          showsEnvironment={showsEnvironment}
          projects={props.projects}
          selectedThreadKey={props.selectedThreadKey}
          onOpenFleet={openFleet}
        />
      </>
    );
  }
  const waiting = inbox.length;
  return (
    <View
      className="gap-1 px-2 pb-3 pt-2"
      onLayout={(event) => setSectionTop(event.nativeEvent.layout.y)}
    >
      <View className="flex-row items-center gap-2 px-2 pb-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Duets overview")}
          onPress={openOverview}
          className="min-h-11 min-w-0 flex-1 flex-row items-center gap-1.5"
        >
          <Text className="font-t3-medium text-xs text-foreground-muted">{gt("Duets")}</Text>
          <SymbolView name="chevron.right" size={10} tintColorClassName="accent-icon-muted" />
        </Pressable>
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
          accessibilityLabel={gt("Duet tasks")}
          hitSlop={6}
          onPress={() => navigation.navigate("CaptainTasks", {})}
          className="flex-row items-center gap-1 rounded-full bg-subtle px-2.5 py-1"
        >
          <SymbolView name="list.number" size={12} tintColorClassName="accent-icon-muted" />
          <Text className="font-t3-medium text-xs text-foreground-muted">
            {gt("Tasks", { $context: "noun, a Duet's delegated tasks" })}
          </Text>
        </Pressable>
      </View>
      {rows.map(({ environment, captain, activity, fleetState }) => {
        const state =
          fleetState !== undefined
            ? fleetChorusStateLabel(fleetState, message)
            : captain.archivedAt !== null
              ? gt("Archived")
              : activity.attention > 0
                ? gt(
                    "{count, plural, one {{count} request waits on you} other {{count} requests wait on you}}",
                    { count: activity.attention },
                  )
                : activity.children.length > 0
                  ? gt(
                      "{count, plural, one {Solos on {count} task} other {Solos on {count} tasks}}",
                      {
                        count: activity.children.length,
                      },
                    )
                  : activity.working
                    ? gt("Working", { $context: "Duet state" })
                    : captain.role.trim() || null;
        const detail =
          showsEnvironment && fleetState === undefined
            ? [state, environment.label].filter((part) => part !== null).join(" · ")
            : state;
        const disabled = fleetState !== undefined && fleetState !== "ready";
        return (
          <StandardCaptainRow
            key={`${environment.environmentId}:${captain.id}`}
            viewport={props.viewport}
            sectionTop={sectionTop}
            visible={visible}
            captain={captain}
            completedRunId={
              activity.primary?.latestRun?.status === "completed"
                ? activity.primary.latestRun.runId
                : undefined
            }
            working={activity.working}
            attention={activity.attention}
            detail={detail}
            fleet={fleetState !== undefined}
            disabled={disabled}
            onPress={() => {
              if (fleetState !== undefined) {
                openFleet();
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

function StandardCaptainRow(props: {
  readonly viewport: ScrollVisibility;
  readonly sectionTop: number;
  readonly visible: boolean;
  readonly captain: Captain;
  readonly completedRunId: string | undefined;
  readonly working: boolean;
  readonly attention: number;
  readonly detail: string | null;
  readonly fleet: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { captain, detail, working, attention, disabled } = props;
  const visibility = useScrollRowVisibility(props.viewport, props.sectionTop, props.visible);
  const [glance, setGlance] = useState(0);
  const canGlance =
    visibility.visible && !disabled && !working && attention === 0 && captain.archivedAt === null;
  if (!canGlance && glance !== 0) setGlance(0);
  const glanceOnce = () => {
    if (canGlance) setGlance((previous) => previous + 1);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      accessibilityLabel={[captain.name, detail].filter(Boolean).join(", ")}
      onLayout={visibility.onLayout}
      onPress={props.onPress}
      onPressIn={glanceOnce}
      onHoverIn={glanceOnce}
      onFocus={glanceOnce}
      className={cn(
        "flex-row items-center gap-3 rounded-xl px-2 py-2 active:bg-subtle",
        props.fleet && "border-l-2 border-warning-border pl-1.5",
      )}
    >
      <CaptainOrb
        captain={captain}
        working={working}
        attention={attention}
        motion={{
          visible: visibility.visible && !disabled && captain.archivedAt === null,
          glance,
          completedRunId: props.completedRunId,
        }}
      />
      <View className="min-w-0 flex-1">
        <Text className="font-t3-medium text-base text-foreground" numberOfLines={1}>
          {captain.name}
        </Text>
        {detail ? (
          <Text
            className={cn(
              "text-xs",
              attention > 0 ? "text-warning-foreground" : "text-foreground-muted",
            )}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
