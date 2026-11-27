import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  CaptainId,
  clampManagedRuntimeMode,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { StackActions, useNavigation } from "@react-navigation/native";
import { Atom } from "effect/reactivity";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SelectionRow } from "../../components/ui/SelectionRow";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { useSheetContentBottomInset } from "../../components/ui/useBarInset";
import {
  buildModelOptions,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
} from "../../lib/modelOptions";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const createPermissions = Atom.family((key: string) => {
  const ids = JSON.parse(key) as ReadonlyArray<EnvironmentId>;
  return Atom.make((get) =>
    ids.map((id) => get(serverEnvironment.createCaptain.permissionAtom(id))),
  ).pipe(Atom.setIdleTTL(0));
});

export function useCaptainCreateDestinations() {
  const { environments } = useEnvironments();
  const supporting = environments.filter(
    ({ connection, serverConfig }) =>
      connection.phase === "connected" && serverConfig?.environment.capabilities.captains === true,
  );
  const permissions = useAtomValue(
    createPermissions(JSON.stringify(supporting.map(({ environmentId }) => environmentId))),
  );
  return supporting.filter((_, index) => permissions[index]);
}

export function CaptainCreateSheet() {
  const navigation = useNavigation();
  const gt = useGT();
  const bottomInset = useSheetContentBottomInset();
  const destinations = useCaptainCreateDestinations();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environmentId = selected ?? destinations[0]?.environmentId ?? null;
  const config = useEnvironmentServerConfig(environmentId);
  const [captainId] = useState(() => CaptainId.make(uuidv4()));
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === environmentId &&
      project.archivedAt === null &&
      !isScratchProject(project, config?.scratchWorkspaceRoot),
  );
  const [projectIds, setProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopedProjectIds = projectIds.filter((id) => projects.some((project) => project.id === id));
  const primaryProject = projects.find((project) => project.id === scopedProjectIds[0]) ?? null;
  const hasWorkspace = primaryProject !== null || config?.scratchWorkspaceRoot !== undefined;
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useAtomCommand(serverEnvironment.createCaptain, { reportFailure: false });
  const canCreate = destinations.some((destination) => destination.environmentId === environmentId);

  const save = async () => {
    if (
      environmentId === null ||
      config === null ||
      !canCreate ||
      !hasWorkspace ||
      saving ||
      !name.trim()
    )
      return;
    const projectId = primaryProject?.id ?? null;
    const { settings } = resolveProjectSettings(config.settings, projectId, primaryProject);
    const defaultModel = resolveDefaultableModelSelection(
      config,
      settings.defaultModelSelection,
      projectId,
    );
    const modelSelection = resolveNewTaskModelSelection({
      draftSelection: null,
      projectDefaultSelection: defaultModel,
      stickySelection: null,
      modelOptions: buildModelOptions(config, defaultModel, undefined, projectId),
    });
    if (modelSelection === null) {
      setError(gt("Configure a model on this environment before creating a Duet."));
      return;
    }

    setSaving(true);
    setError(null);
    const result = await create({
      environmentId,
      input: {
        captainId,
        kind: "duet",
        name: name.trim(),
        role: role.trim(),
        instructions,
        avatar: { preset: "circle", color: "teal" },
        scopedProjectIds,
        coordinatorOnly: true,
        reportPolicy: "react",
        modelSelection,
        runtimeMode:
          clampManagedRuntimeMode(config.managedPolicy, settings.defaultRuntimeMode) ??
          settings.defaultRuntimeMode,
        interactionMode: "default",
        creationSource: "mobile",
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      if (navigation.isFocused()) {
        navigation.dispatch(
          StackActions.replace("Thread", {
            environmentId,
            threadId: result.value.primaryThreadId,
          }),
        );
      }
    } else {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : gt("Could not save Duet."));
    }
  };

  const inputClass =
    "min-h-11 rounded-lg border border-border bg-grouped-card px-3 py-2 text-base text-foreground";
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("New Duet")} onClose={() => navigation.goBack()} />
      <ScreenContent>
        <ScreenScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: bottomInset }}
        >
          <View className="gap-4 px-4 pt-3">
            {destinations.length > 1 ? (
              <View className="gap-1">
                <Text accessibilityRole="header" className="font-t3-medium text-sm text-foreground">
                  {gt("Environment")}
                </Text>
                {destinations.map(({ environmentId: id, label }) => (
                  <SelectionRow
                    key={id}
                    title={label}
                    selected={environmentId === id}
                    disabled={saving}
                    onPress={() => {
                      setSelected(id);
                      setProjectIds([]);
                      setError(null);
                    }}
                  />
                ))}
              </View>
            ) : null}
            <View className="gap-1.5">
              <Text className="font-t3-medium text-sm text-foreground">{gt("Name")}</Text>
              <TextInput
                accessibilityLabel={gt("Name")}
                onChangeText={setName}
                value={name}
                maxLength={80}
                editable={!saving}
                className={inputClass}
              />
            </View>
            <View className="gap-1.5">
              <Text className="font-t3-medium text-sm text-foreground">
                {gt("Role", { $context: "a Duet's assignment" })}
              </Text>
              <TextInput
                accessibilityLabel={gt("Role", { $context: "a Duet's assignment" })}
                onChangeText={setRole}
                value={role}
                maxLength={120}
                editable={!saving}
                className={inputClass}
              />
            </View>
            <View className="gap-1.5">
              <Text className="font-t3-medium text-sm text-foreground">{gt("Instructions")}</Text>
              <TextInput
                accessibilityLabel={gt("Instructions")}
                onChangeText={setInstructions}
                value={instructions}
                maxLength={16_000}
                editable={!saving}
                multiline
                className={inputClass}
              />
            </View>
            {projects.length === 0 ? null : (
              <View className="gap-1.5">
                <Button
                  label={scopeOpen ? gt("Hide project scope") : gt("Project scope")}
                  onPress={() => setScopeOpen((open) => !open)}
                />
                <Text className="text-sm text-foreground-muted">
                  {scopedProjectIds.length === 0
                    ? gt("All projects")
                    : gt("{count, plural, one {{count} project} other {{count} projects}}", {
                        count: scopedProjectIds.length,
                      })}
                </Text>
                {scopeOpen || !hasWorkspace
                  ? projects.map(({ id, title }, index) => (
                      <SelectionRow
                        key={id}
                        title={title}
                        selected={scopedProjectIds.includes(id)}
                        role="checkbox"
                        disabled={saving}
                        isFirst={index === 0}
                        isLast={index === projects.length - 1}
                        onPress={() =>
                          setProjectIds((ids) =>
                            ids.includes(id) ? ids.filter((chosen) => chosen !== id) : [...ids, id],
                          )
                        }
                      />
                    ))
                  : null}
              </View>
            )}
            {config === null || hasWorkspace ? null : (
              <Text className="text-sm text-foreground-muted">
                {gt("This environment needs a project in the Duet’s scope.")}
              </Text>
            )}
            {error === null ? null : (
              <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                {error}
              </Text>
            )}
            <Button
              tone="primary"
              label={gt("Create Duet")}
              disabled={!canCreate || !name.trim() || !hasWorkspace || config === null}
              loading={saving}
              onPress={() => void save()}
            />
          </View>
        </ScreenScrollView>
      </ScreenContent>
    </View>
  );
}
