import { msg, T, useGT, useMessages } from "gt-react-native";
import { useAtomValue } from "@effect/atom-react";
import type { DuetToolCallVisibility, ToolCallVisibility } from "@t3tools/contracts/settings";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { AppText as Text } from "../../../../components/ui/AppText";
import { ListChoiceRow } from "../../../../components/ui/ListChoiceRow";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../../../state/preferences";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { SettingsSection } from "../../components/SettingsSection";

const TOOL_CALL_VISIBILITY_OPTIONS: ReadonlyArray<{
  readonly value: ToolCallVisibility;
  readonly label: string;
}> = [
  { value: "showAll", label: msg("Show all") },
  { value: "hideSuccessful", label: msg("Hide successful") },
  { value: "hideAll", label: msg("Hide all") },
  { value: "zen", label: msg("Zen", { $context: "tool call visibility: only final answers" }) },
];

const DUET_TOOL_CALL_VISIBILITY_OPTIONS: ReadonlyArray<{
  readonly value: DuetToolCallVisibility;
  readonly label: string;
}> = [
  {
    value: "inherit",
    label: msg("Same as other threads", { $context: "tool call visibility setting" }),
  },
  ...TOOL_CALL_VISIBILITY_OPTIONS,
];

export function ToolCallsAppearanceSection() {
  const gt = useGT();
  const m = useMessages();
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const selected = AsyncResult.isSuccess(preferences)
    ? (preferences.value.toolCallVisibility ?? "showAll")
    : null;
  const duetSelected = AsyncResult.isSuccess(preferences)
    ? (preferences.value.duetToolCallVisibility ?? "inherit")
    : null;
  const duetTitle = gt("In Duets", { $context: "tool call visibility setting" });
  const duetDescription = gt(
    "Choose a different tool-call view for a Duet's current and earlier conversations. Solo and other subagent threads keep the main setting.",
  );

  return (
    <View className="gap-3">
      <SettingsSection title={gt("Tool calls in chat")}>
        {TOOL_CALL_VISIBILITY_OPTIONS.map((option, index) => (
          <ListChoiceRow
            key={option.value}
            label={m(option.label)}
            selected={selected === option.value}
            separated={index > 0}
            disabled={selected === null}
            onPress={() => {
              void savePreferences({ toolCallVisibility: option.value });
            }}
          />
        ))}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        <T>
          Hide the commands, edits, and searches agents run. Hide successful keeps failures. Zen
          shows only final answers. Approvals, questions, and errors always show.
        </T>
      </Text>
      <SettingsSection title={duetTitle}>
        {DUET_TOOL_CALL_VISIBILITY_OPTIONS.map((option, index) => (
          <ListChoiceRow
            key={option.value}
            label={m(option.label)}
            selected={duetSelected === option.value}
            separated={index > 0}
            disabled={duetSelected === null}
            onPress={() => {
              void savePreferences({ duetToolCallVisibility: option.value });
            }}
          />
        ))}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">{duetDescription}</Text>
    </View>
  );
}
