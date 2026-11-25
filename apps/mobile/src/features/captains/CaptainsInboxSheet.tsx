import { captainInboxItems, type CaptainInboxItem } from "@t3tools/client-runtime/state/captains";
import { useNavigation } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RelativeTime } from "../../components/RelativeTime";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { CAPTAIN_INBOX_KIND_LABELS } from "./captainLabels";
import { CaptainOrb } from "./CaptainOrb";
import { CaptainEnvironmentNotices, useOpenThreadFromSheet } from "./captainSheetSupport";
import { useCaptainsDirectory } from "./useCaptainsDirectory";

const KIND_ICON = {
  approval: "exclamationmark.shield",
  input: "questionmark.bubble",
  "subagent-request": "arrow.triangle.branch",
} as const satisfies Record<CaptainInboxItem["kind"], string>;

/** Approvals and questions waiting on you from every Captain and its crew; each opens its thread. */
export function CaptainsInboxSheet() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const m = useMessages();
  const { environments, shells } = useCaptainsDirectory();
  const items = captainInboxItems(environments, shells);
  const captainOf = (item: CaptainInboxItem) =>
    environments
      .find(({ environmentId }) => environmentId === item.environmentId)
      ?.captains.find((captain) => captain.id === item.captainId);
  const openThread = useOpenThreadFromSheet();
  const open = (item: CaptainInboxItem) =>
    openThread(item.threadRef.environmentId, item.threadRef.threadId);
  // Nothing waits only once every environment has answered.
  const settled = environments.every(({ status }) => status === "ready");
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("Inbox")} onClose={() => navigation.goBack()} />
      <ScreenContent>
        <ScrollView
          nestedScrollEnabled
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="px-2 pt-2"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          <CaptainEnvironmentNotices environments={environments} />
          {items.length === 0 ? (
            settled ? (
              <Text className="px-5 py-8 text-center text-sm text-foreground-muted">
                {gt("Nothing waits on you.")}
              </Text>
            ) : null
          ) : (
            items.map((item) => {
              const captain = captainOf(item);
              const kind = m(CAPTAIN_INBOX_KIND_LABELS[item.kind]);
              const from = captain
                ? item.isChild
                  ? gt("Crew of {name}", { name: captain.name })
                  : captain.name
                : null;
              return (
                <Pressable
                  key={`${item.kind}:${item.threadRef.environmentId}:${item.threadRef.threadId}`}
                  accessibilityRole="button"
                  accessibilityLabel={[kind, item.title, from].filter(Boolean).join(", ")}
                  accessibilityHint={gt("Opens the thread to answer it")}
                  onPress={() => open(item)}
                  className="mb-2 gap-1.5 rounded-2xl border border-border-subtle bg-grouped-card px-3.5 py-3 active:bg-subtle"
                >
                  <View className="flex-row items-center gap-2">
                    <SymbolView
                      name={KIND_ICON[item.kind]}
                      size={14}
                      tintColorClassName="accent-warning-foreground"
                    />
                    <Text className="min-w-0 flex-1 font-t3-medium text-xs text-warning-foreground">
                      {kind}
                    </Text>
                    <Text className="text-xs text-foreground-muted">
                      <RelativeTime timestamp={item.updatedAt} />
                    </Text>
                  </View>
                  <Text className="font-t3-medium text-base text-foreground" numberOfLines={2}>
                    {item.title}
                  </Text>
                  {captain && from ? (
                    <View className="flex-row items-center gap-2">
                      <CaptainOrb captain={captain} size={18} />
                      <Text className="text-xs text-foreground-muted">{from}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </ScreenContent>
    </View>
  );
}
