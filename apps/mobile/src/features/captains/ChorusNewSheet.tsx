import { activeChoruses } from "@t3tools/client-runtime/state/captains";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  CaptainId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  clampManagedRuntimeMode,
} from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useGT, T } from "gt-react-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";
import { useCaptainEnvironments } from "./useCaptainsDirectory";

export function ChorusNewSheet() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const { environments } = useEnvironments();
  const captainEnvironments = useCaptainEnvironments();
  const writable = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope);
  const active = activeChoruses(captainEnvironments);
  const destinations = captainEnvironments.flatMap(({ environmentId, label }) =>
    writable.has(environmentId) ? [{ environmentId, label }] : [],
  );
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    destinations[0]?.environmentId ?? null,
  );
  const selectedEnvironmentId =
    destinations.find((destination) => destination.environmentId === environmentId)
      ?.environmentId ??
    destinations[0]?.environmentId ??
    null;
  const config = useEnvironmentServerConfig(selectedEnvironmentId);
  const create = useAtomCommand(serverEnvironment.createCaptain, { reportFailure: false });
  const [name, setName] = useState("Chorus");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [captainId] = useState(() => CaptainId.make(uuidv4()));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (selectedEnvironmentId === null || active.length > 0 || pending || !name.trim()) return;
    const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
    const modelSelection = scheduledTaskDefaultModel(config, null);
    if (modelSelection === null) {
      setError(gt("Configure a model on this machine before creating a Chorus."));
      return;
    }
    setPending(true);
    setError(null);
    const result = await create({
      environmentId: selectedEnvironmentId,
      input: {
        captainId,
        kind: "chorus",
        name: name.trim(),
        role: role.trim(),
        instructions,
        avatar: { preset: "circle", color: "orange" },
        scopedProjectIds: [],
        reportPolicy: "react",
        coordinatorOnly: true,
        modelSelection,
        runtimeMode:
          clampManagedRuntimeMode(config?.managedPolicy, settings.defaultRuntimeMode) ??
          settings.defaultRuntimeMode,
        interactionMode: "default",
        creationSource: "mobile",
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : gt("Could not create Chorus."));
      return;
    }
    if (result.value.kind !== "chorus") {
      setError(gt("This machine created a Duet. Update it before creating a Chorus."));
      return;
    }
    if (navigation.isFocused()) navigation.goBack();
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("New Chorus")} onClose={() => navigation.goBack()} />
      <ScreenContent>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="gap-4 px-4 py-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          <Text className="text-sm text-foreground-muted">
            <T>
              A Chorus reads every Duet in the fleet and routes project work to the Duet that owns
              it. It never keeps project state.
            </T>
          </Text>
          {active.length > 0 ? (
            <View className="rounded-2xl border border-warning bg-warning/10 p-3">
              <Text className="text-sm text-warning-foreground">
                {gt("An active Chorus already exists on {machine}.", {
                  machine: active[0]!.environmentLabel ?? gt("a linked machine"),
                })}
              </Text>
            </View>
          ) : null}
          <View className="rounded-2xl border border-border-subtle p-3">
            <Text className="text-sm text-foreground-muted">
              <T>
                Fables checks reachable linked machines before creating a Chorus. Fleet results can
                be incomplete while a machine is offline or running an older version.
              </T>
            </Text>
          </View>
          <View className="gap-2">
            <Text className="font-t3-medium text-xs text-foreground-muted">{gt("Machine")}</Text>
            {destinations.length === 0 ? (
              <Text className="text-sm text-foreground-muted">
                {gt("No connected machine can create Duets.")}
              </Text>
            ) : (
              destinations.map(({ environmentId: id, label }) => (
                <ListChoiceRow
                  key={id}
                  label={label}
                  selected={id === selectedEnvironmentId}
                  separated={id !== destinations[0]!.environmentId}
                  disabled={pending}
                  onPress={() => setEnvironmentId(id)}
                />
              ))
            )}
          </View>
          <View className="gap-2">
            <Text className="font-t3-medium text-xs text-foreground-muted">{gt("Name")}</Text>
            <AppTextInput
              accessibilityLabel={gt("Name")}
              value={name}
              onChangeText={setName}
              editable={!pending}
              maxLength={80}
            />
          </View>
          <View className="gap-2">
            <Text className="font-t3-medium text-xs text-foreground-muted">
              {gt("Role (optional)")}
            </Text>
            <AppTextInput
              accessibilityLabel={gt("Role (optional)")}
              value={role}
              onChangeText={setRole}
              editable={!pending}
              maxLength={120}
              placeholder={gt("Fleet coordinator")}
            />
          </View>
          <View className="gap-2">
            <Text className="font-t3-medium text-xs text-foreground-muted">
              {gt("Instructions")}
            </Text>
            <AppTextInput
              accessibilityLabel={gt("Instructions")}
              value={instructions}
              onChangeText={setInstructions}
              editable={!pending}
              multiline
              maxLength={16_000}
              className="min-h-28"
              placeholder={gt("How Chorus should answer and route work.")}
            />
          </View>
          {error !== null ? (
            <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
              {error}
            </Text>
          ) : null}
          <Button
            label={gt("Create Chorus")}
            tone="primary"
            fullWidth
            loading={pending}
            disabled={
              active.length > 0 ||
              destinations.length === 0 ||
              selectedEnvironmentId === null ||
              !name.trim()
            }
            onPress={() => void submit()}
          />
        </ScrollView>
      </ScreenContent>
    </View>
  );
}
