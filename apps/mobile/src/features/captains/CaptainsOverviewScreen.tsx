import { LegendList } from "@legendapp/list/react-native";
import { StackActions, useIsFocused, useNavigation } from "@react-navigation/native";
import {
  captainInboxItems,
  fleetChorusStateLabel,
  type CaptainInboxItem,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useGT, useLocale, useMessages } from "gt-react-native";
import { Pressable, View } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { useUnadjustedBottomInset } from "../../components/ui/useBarInset";
import { useNowMinuteMs } from "../../lib/clock";
import { relativeTime } from "../../lib/time";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useOpenLinkedThreadRead } from "../threads/useOpenLinkedThread";
import { useCaptainCreateDestinations } from "./CaptainCreateSheet";
import {
  CAPTAIN_INBOX_KIND_LABELS,
  DUET_WAITING_ICONS,
  DUET_WAITING_LABELS,
} from "./captainLabels";
import { captainOverviewRows, type CaptainOverviewRow } from "./captainOverview";
import { CaptainOverviewRecap } from "./CaptainOverviewRecap";
import {
  CaptainOverviewTaskRow,
  overviewTaskKey,
  useCaptainOverviewTasks,
  type OverviewTask,
} from "./CaptainOverviewTasks";
import { CaptainEnvironmentNotices } from "./captainSheetSupport";
import { DuetCreature } from "./DuetCreature";
import { duetRowTrail } from "./duetHomeRow";
import { useCaptainsDirectory, useFleetChorus } from "./useCaptainsDirectory";

type OverviewEntry = (
  | { readonly kind: "heading"; readonly title: string; readonly empty?: string | undefined }
  | { readonly kind: "duet" | "recap"; readonly row: CaptainOverviewRow }
  | { readonly kind: "inbox"; readonly item: CaptainInboxItem; readonly name: string | undefined }
  | { readonly kind: "task"; readonly task: OverviewTask }
) & { readonly key: string };

function DuetRow(props: {
  readonly row: CaptainOverviewRow;
  readonly showEnvironment: boolean;
  readonly nowMs: number;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { row, nowMs } = props;
  const { captain, activity, fleetState, environment } = row;
  const trail = duetRowTrail(row);
  const status =
    fleetState !== undefined
      ? fleetChorusStateLabel(fleetState, m)
      : trail.kind === "waiting"
        ? m(DUET_WAITING_LABELS[trail.on])
        : trail.kind === "working"
          ? gt("Working", { $context: "Duet state" })
          : relativeTime(trail.at, nowMs, m);
  const detail = [captain.role, props.showEnvironment ? environment.label : ""]
    .filter(Boolean)
    .join(" · ");
  const disabled = fleetState !== undefined && fleetState !== "ready";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={[captain.name, status, detail].filter(Boolean).join(", ")}
      disabled={disabled}
      onPress={props.onOpen}
      className="my-1 min-h-[68px] flex-row items-center gap-3 rounded-2xl border border-border-subtle bg-grouped-card px-3.5 py-2.5 active:bg-subtle"
    >
      {fleetState === undefined ? null : (
        <View className="absolute bottom-3 left-0 top-3 w-0.5 rounded-full bg-warning-foreground" />
      )}
      <DuetCreature captain={captain} size={35} />
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
          <Text
            className="min-w-0 flex-1 font-t3-medium text-base text-foreground"
            numberOfLines={1}
          >
            {captain.name}
          </Text>
          {fleetState === undefined ? (
            <Text
              className={
                trail.kind === "waiting"
                  ? "text-xs text-warning-foreground"
                  : "text-xs text-foreground-muted"
              }
            >
              {status}
            </Text>
          ) : null}
        </View>
        {fleetState !== undefined || detail !== "" ? (
          <Text className="text-sm text-foreground-muted" numberOfLines={2}>
            {fleetState === undefined ? detail : status}
          </Text>
        ) : null}
        {activity.children[0] === undefined ? null : (
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            {activity.children[0].title}
          </Text>
        )}
      </View>
      {disabled ? null : (
        <SymbolView name="chevron.right" size={13} tintColorClassName="accent-icon-muted" />
      )}
    </Pressable>
  );
}

function InboxRow(props: {
  readonly item: CaptainInboxItem;
  readonly name: string | undefined;
  readonly nowMs: number;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { item, name } = props;
  const kind = m(CAPTAIN_INBOX_KIND_LABELS[item.kind]);
  const from = item.isChild && name !== undefined ? gt("Delegated by {name}", { name }) : name;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[kind, item.title, from].filter(Boolean).join(", ")}
      accessibilityHint={gt("Opens the thread to answer it")}
      onPress={props.onOpen}
      className="my-1.5 min-h-[72px] flex-row items-center gap-3 rounded-2xl border border-warning-border bg-warning/10 px-3.5 py-2.5 active:bg-warning/20"
    >
      <SymbolView
        name={DUET_WAITING_ICONS[item.kind]}
        size={18}
        tintColorClassName="accent-warning-foreground"
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-t3-medium text-xs text-warning-foreground">{kind}</Text>
        <Text className="font-t3-medium text-base text-foreground" numberOfLines={2}>
          {item.title}
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {[from, relativeTime(item.updatedAt, props.nowMs, m)].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={13} tintColorClassName="accent-icon-muted" />
    </Pressable>
  );
}

export function CaptainsOverviewScreen() {
  const gt = useGT();
  const locale = useLocale();
  const navigation = useNavigation();
  const visible = useIsFocused();
  const { environments, shells, showsEnvironment } = useCaptainsDirectory({ visible });
  const fleet = useFleetChorus();
  const canCreate = useCaptainCreateDestinations().length > 0;
  const openLinked = useOpenLinkedThreadRead();
  const nowMs = useNowMinuteMs();
  const bottomInset = useUnadjustedBottomInset();
  const roster = captainOverviewRows(environments, shells, fleet);
  const active = roster.filter(
    (row) => row.hasCaptainRecord && (row.fleetState === undefined || row.fleetState === "ready"),
  );
  const inbox = captainInboxItems(
    active.map(({ environment, captain }) => ({
      environmentId: environment.environmentId,
      captains: [captain],
    })),
    shells,
  );
  const { inFlight, finished } = useCaptainOverviewTasks(active, visible);
  const settled = environments.every((environment) => environment.status === "ready");
  const now = new Date(nowMs);
  const hour = now.getHours();
  const greeting =
    hour < 12 ? gt("Good morning") : hour < 18 ? gt("Good afternoon") : gt("Good evening");
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  const captainKey = (environmentId: EnvironmentId, captainId: string) =>
    JSON.stringify([environmentId, captainId]);
  const names = new Map(
    active.map(({ environment, captain }) => [
      captainKey(environment.environmentId, captain.id),
      captain.name,
    ]),
  );
  const openThread = (environmentId: EnvironmentId, threadId: ThreadId) =>
    navigation.dispatch(StackActions.push("Thread", { environmentId, threadId }));
  const openDuet = (row: CaptainOverviewRow) => {
    if (row.fleetState === undefined) {
      openThread(row.environment.environmentId, row.captain.primaryThreadId);
      return;
    }
    const home = fleet?.status.home;
    if (fleet === null || row.fleetState !== "ready" || home?.threadId == null) return;
    if (fleet.viaEnvironmentId === home.environmentId)
      openThread(home.environmentId, home.threadId);
    else
      openLinked(
        { environmentId: home.environmentId, threadId: home.threadId },
        { viaEnvironmentId: fleet.viaEnvironmentId, label: home.label },
        row.captain.name,
      );
  };

  const entries: OverviewEntry[] = [
    {
      kind: "heading",
      key: "duets",
      title: gt("Duets"),
      empty: roster.length === 0 && settled ? gt("No Duets yet.") : undefined,
    },
    ...roster.map((row) => ({
      kind: "duet" as const,
      key: `duet:${captainKey(row.environment.environmentId, row.captain.id)}`,
      row,
    })),
    {
      kind: "heading",
      key: "inbox",
      title:
        inbox.length === 0
          ? gt("Needs you", { $context: "heading for requests waiting on the user" })
          : gt("Needs you · {count}", { count: inbox.length }),
      empty: inbox.length === 0 && settled ? gt("Nothing is waiting on you.") : undefined,
    },
    ...inbox.map((item) => ({
      kind: "inbox" as const,
      key: `inbox:${item.kind}:${item.environmentId}:${item.threadRef.threadId}`,
      item,
      name: names.get(captainKey(item.environmentId, item.captainId)),
    })),
    {
      kind: "heading",
      key: "in-flight",
      title: gt("In flight", { $context: "heading for delegated work in progress" }),
      empty: inFlight.length === 0 && settled ? gt("No delegated work is running.") : undefined,
    },
    ...inFlight.map((task) => ({
      kind: "task" as const,
      key: `in-flight:${overviewTaskKey(task)}`,
      task,
    })),
    {
      kind: "heading",
      key: "finished",
      title: gt("Recently finished"),
      empty:
        finished.length === 0 && settled ? gt("No delegated tasks finished recently.") : undefined,
    },
    ...finished.map((task) => ({
      kind: "task" as const,
      key: `finished:${overviewTaskKey(task)}`,
      task,
    })),
    {
      kind: "heading",
      key: "recaps",
      title: gt("Recaps", { $context: "heading for Duets' digests" }),
      empty: active.length === 0 && settled ? gt("No recap yet") : undefined,
    },
    ...active.map((row) => ({
      kind: "recap" as const,
      key: `recap:${captainKey(row.environment.environmentId, row.captain.id)}`,
      row,
    })),
  ];

  return (
    <View className="flex-1 bg-screen">
      <AppBar title={gt("Duets")} onBack={() => navigation.goBack()} />
      <ScreenContent surface="screen">
        <LegendList
          className="flex-1 bg-screen"
          data={entries}
          keyExtractor={(entry) => entry.key}
          estimatedItemSize={76}
          renderScrollComponent={NativeScrollView}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            width: "100%",
            maxWidth: 720,
            alignSelf: "center",
            paddingHorizontal: 16,
            paddingBottom: bottomInset + 24,
          }}
          ListHeaderComponent={
            <View className="gap-2 pt-4 pb-1">
              <Text className="font-t3-medium text-sm text-foreground-muted">{date}</Text>
              <Text
                accessibilityRole="header"
                className="font-t3-bold text-[32px] leading-[38px] text-foreground"
              >
                {greeting}
              </Text>
              {canCreate ? (
                <Button
                  label={gt("New Duet")}
                  icon="plus"
                  onPress={() => navigation.navigate("CaptainCreate")}
                />
              ) : null}
              <CaptainEnvironmentNotices environments={environments} />
            </View>
          }
          renderItem={({ item }) => {
            switch (item.kind) {
              case "heading":
                return (
                  <View className="mt-5 gap-1 border-t border-border-subtle pt-3 pb-1">
                    <Text
                      accessibilityRole="header"
                      className="font-t3-bold text-xl text-foreground"
                    >
                      {item.title}
                    </Text>
                    {item.empty === undefined ? null : (
                      <Text className="text-sm text-foreground-muted">{item.empty}</Text>
                    )}
                  </View>
                );
              case "duet":
                return (
                  <DuetRow
                    row={item.row}
                    showEnvironment={showsEnvironment}
                    nowMs={nowMs}
                    onOpen={() => openDuet(item.row)}
                  />
                );
              case "inbox":
                return (
                  <InboxRow
                    item={item.item}
                    name={item.name}
                    nowMs={nowMs}
                    onOpen={() =>
                      openThread(item.item.threadRef.environmentId, item.item.threadRef.threadId)
                    }
                  />
                );
              case "task":
                return <CaptainOverviewTaskRow task={item.task} nowMs={nowMs} />;
              case "recap":
                return <CaptainOverviewRecap row={item.row} onOpen={() => openDuet(item.row)} />;
            }
          }}
        />
      </ScreenContent>
    </View>
  );
}
