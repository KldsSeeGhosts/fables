import { collectCpaAccountGroups, remainingPercent } from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { T, useGT, Var } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";

function Group({
  group,
  now,
}: {
  readonly group: ReturnType<typeof collectCpaAccountGroups>[number];
  readonly now: number;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3 rounded-xl border border-border-subtle p-4">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? gt("Hide accounts") : gt("Show accounts")}
        className="min-h-11 justify-center gap-1"
        onPress={() => setExpanded(!expanded)}
      >
        <Text className="text-base font-t3-medium text-foreground">{group.label}</Text>
        <Text className="text-xs text-foreground-muted">
          <T>
            <Var>{group.source.accounts.length}</Var> CPA accounts
          </T>
          . {expanded ? <T>Hide accounts</T> : <T>Show accounts</T>}
        </Text>
      </Pressable>
      {expanded
        ? group.source.accounts.map((account) => (
            <View key={account.id} className="gap-2 border-t border-border-subtle pt-3">
              <Text selectable className="text-sm font-t3-medium text-foreground">
                {account.label ?? account.email ?? account.id}
              </Text>
              {account.fileName && account.fileName !== account.label ? (
                <Text selectable className="text-xs text-foreground-muted">
                  {account.fileName}
                </Text>
              ) : null}
              <View className="flex-row flex-wrap gap-x-2 gap-y-1">
                <Text className="text-xs text-foreground-muted">
                  {account.providerLabel ?? account.driver}
                </Text>
                {account.plan ? (
                  <Text className="text-xs text-foreground-muted">{account.plan}</Text>
                ) : null}
                {account.disabled ? (
                  <Text className="text-xs text-foreground-muted">
                    <T>Disabled</T>
                  </Text>
                ) : null}
                {account.synthetic ? (
                  <Text className="text-xs text-foreground-muted">
                    <T>Dashboard account</T>
                  </Text>
                ) : null}
              </View>
              {account.usageLimits.windows.map((window) => (
                <View key={window.id} className="flex-row flex-wrap gap-x-2 gap-y-1">
                  <Text className="text-xs tabular-nums text-foreground">
                    {window.estimated ? (
                      <T>
                        <Var>{window.label}</Var> (estimated)
                      </T>
                    ) : (
                      <T>
                        <Var>{window.label}</Var>
                      </T>
                    )}
                  </Text>
                  <Text className="text-xs tabular-nums text-foreground">
                    <T>
                      <Var>{remainingPercent(window)}</Var>% left
                    </T>
                  </Text>
                  {window.resetsAt ? (
                    <Text className="text-xs tabular-nums text-foreground">
                      {formatResetsIn(window, now)}
                    </Text>
                  ) : null}
                </View>
              ))}
              {account.usageLimits.unavailable ? (
                <Text className="text-xs text-foreground-muted">
                  {account.usageLimits.unavailable.message ?? <T>Quota unavailable.</T>}
                </Text>
              ) : null}
              {account.notice ? (
                <Text className="text-xs text-foreground-muted">{account.notice}</Text>
              ) : null}
            </View>
          ))
        : null}
    </View>
  );
}

export function CpaAccounts({
  groups,
  now,
}: {
  readonly groups: ReturnType<typeof collectCpaAccountGroups>;
  readonly now: number;
}) {
  return groups.map((group) => <Group key={group.key} group={group} now={now} />);
}
