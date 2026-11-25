import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  CaptainId,
  clampManagedRuntimeMode,
  DEFAULT_SERVER_SETTINGS,
  type Captain,
  type CaptainAvatar as Avatar,
  type CaptainReportPolicy,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useGT, T } from "gt-react";
import { useId, useState } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { useCaptainAvatarLabels } from "./captainAvatarLabels";
import { CaptainAvatar, normalizeCaptainAvatar, randomCaptainAvatar } from "./CaptainAvatar";
import {
  DUET_EMBLEM_ORDER,
  DUET_PALETTE_ORDER,
  DUET_PALETTE_SWATCH,
  DUET_PICKER,
} from "./captainPalette";
import { CaptainReportPolicyPicker } from "./CaptainReportPolicyPicker";
import { CaptainScope } from "./CaptainScope";
import type { CaptainProfileSection } from "./CaptainBriefPanel";
import { CaptainDocuments } from "./CaptainDocuments";
import { CaptainEarlierConversations } from "./CaptainEarlierConversations";
import { CaptainMemories } from "./CaptainMemories";
import { captainCommandError, useCaptains } from "./useCaptain";
import { useRightPanelStore } from "../../rightPanelStore";

type Destination = { readonly id: EnvironmentId; readonly label: string };

export function CaptainEditorDialog({
  destination,
  destinations,
  captain,
  initialSection = "profile",
  onClose,
  onSave,
}: {
  destination: Destination;
  destinations?: ReadonlyArray<Destination>;
  captain?: Captain;
  /** Which section an existing Duet's dialog opens on. */
  initialSection?: CaptainProfileSection;
  onClose: () => void;
  onSave: (environmentId: EnvironmentId, captain: Captain) => void;
}) {
  const gt = useGT();
  const isDuet = useDuetShell();
  const fieldId = useId();
  const [environmentId, setEnvironmentId] = useState(destination.id);
  const [captainId] = useState(() => CaptainId.make(randomUUID()));
  const [name, setName] = useState(captain?.name ?? "");
  const [role, setRole] = useState(captain?.role ?? "");
  const [instructions, setInstructions] = useState(captain?.instructions ?? "");
  const [avatar, setAvatar] = useState<Avatar>(() =>
    normalizeCaptainAvatar(captain?.avatar ?? randomCaptainAvatar()),
  );
  const [reportPolicy, setReportPolicy] = useState<CaptainReportPolicy>("react");
  const [coordinatorOnly, setCoordinatorOnly] = useState(captain?.coordinatorOnly ?? true);
  const [scopedProjectIds, setScope] = useState<ReadonlyArray<ProjectId>>(
    captain?.scopedProjectIds ?? [],
  );
  const [section, setSection] = useState<CaptainProfileSection>(initialSection);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canCreate = useAtomValue(serverEnvironment.createCaptain.permissionAtom(environmentId));
  const canUpdate = useAtomValue(serverEnvironment.updateCaptain.permissionAtom(environmentId));
  const create = useAtomCommand(serverEnvironment.createCaptain, { reportFailure: false });
  const update = useAtomCommand(serverEnvironment.updateCaptain, { reportFailure: false });
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const canSave = captain === undefined ? canCreate : canUpdate;
  const { emblems: emblemLabels, palettes: paletteLabels } = useCaptainAvatarLabels();

  const save = async () => {
    if (!canSave || saving || !name.trim()) return;
    const profile = {
      name: name.trim(),
      role: role.trim(),
      instructions,
      avatar,
      scopedProjectIds,
      coordinatorOnly,
    };
    setError(null);
    setSaving(true);
    const result = await (async () => {
      if (captain !== undefined) {
        return update({ environmentId, input: { captainId: captain.id, ...profile } });
      }
      const project = projects.find(({ id }) => id === scopedProjectIds[0]) ?? null;
      const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
      const defaults = resolveProjectSettings(settings, project?.id ?? null, project).settings;
      const modelSelection =
        defaults.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(
          config?.providers ?? [],
          settings,
          project?.id ?? null,
        );
      if (modelSelection === null) return null;
      return create({
        environmentId,
        input: {
          ...profile,
          captainId,
          reportPolicy,
          modelSelection,
          runtimeMode:
            clampManagedRuntimeMode(config?.managedPolicy, defaults.defaultRuntimeMode) ??
            defaults.defaultRuntimeMode,
          interactionMode: "default",
          creationSource: "web",
        },
      });
    })();
    setSaving(false);
    if (result === null) {
      setError(
        isDuet
          ? gt("Configure a model on this environment before creating a Duet.")
          : gt("Configure a model on this environment before creating a Captain."),
      );
    } else if (result._tag === "Failure") {
      setError(
        captainCommandError(
          result,
          isDuet ? gt("Could not save Duet.") : gt("Could not save Captain."),
        ),
      );
    } else {
      onSave(environmentId, result.value);
    }
  };

  const showEnvironment =
    captain === undefined && destinations !== undefined && destinations.length > 1;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <div className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>
              {captain === undefined ? (
                isDuet ? (
                  <T>New Duet</T>
                ) : (
                  <T>New Captain</T>
                )
              ) : isDuet ? (
                <T>Edit Duet</T>
              ) : (
                <T>Edit Captain</T>
              )}
            </DialogTitle>
            <DialogDescription>
              {isDuet ? (
                <T>A Duet keeps its own conversation, memories, and documents across sessions.</T>
              ) : (
                <T>
                  A Captain keeps its own conversation, memories, and documents across sessions.
                </T>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {captain !== undefined ? (
              <ToggleGroup
                aria-label={
                  isDuet ? gt("Duet customization section") : gt("Captain customization section")
                }
                value={[section]}
                onValueChange={(value) => {
                  if (value[0] === "profile" || value[0] === "memory") setSection(value[0]);
                }}
              >
                <Toggle value="profile">
                  <T>Profile</T>
                </Toggle>
                <Toggle value="memory">
                  <T>Memory</T>
                </Toggle>
              </ToggleGroup>
            ) : null}
            {section === "memory" && captain !== undefined ? (
              <CaptainMemorySection
                captain={captain}
                environmentId={environmentId}
                onClose={onClose}
              />
            ) : null}
            <div style={{ display: section === "profile" ? "contents" : "none" }}>
              {showEnvironment ? (
                <div className="grid gap-1.5">
                  <label htmlFor={`${fieldId}-environment`} className="text-label">
                    <T>Environment</T>
                  </label>
                  <Select
                    value={environmentId}
                    items={destinations.map(({ id, label }) => ({ value: id, label }))}
                    onValueChange={(value) => {
                      if (value === null) return;
                      setEnvironmentId(value);
                      setScope([]);
                    }}
                    disabled={saving}
                  >
                    <SelectTrigger id={`${fieldId}-environment`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {destinations.map(({ id, label }) => (
                        <SelectItem key={id} value={id}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}
              <div className="flex items-start gap-3">
                <div className="flex size-16 shrink-0 items-center justify-center">
                  <CaptainAvatar
                    key={`${avatar.preset}:${avatar.color}`}
                    avatar={avatar}
                    size="profile"
                    animateOnMount
                  />
                </div>
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-1.5">
                    <label htmlFor={`${fieldId}-name`} className="text-label">
                      <T>Name</T>
                    </label>
                    <Input
                      id={`${fieldId}-name`}
                      required
                      autoFocus
                      maxLength={80}
                      placeholder={gt("e.g. Atlas")}
                      value={name}
                      disabled={saving}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <div className="grid min-w-0 gap-1.5">
                    <label htmlFor={`${fieldId}-role`} className="text-label">
                      <T>Role</T>{" "}
                      <span className="text-muted-foreground">
                        <T>(optional)</T>
                      </span>
                    </label>
                    <Input
                      id={`${fieldId}-role`}
                      maxLength={120}
                      placeholder={gt("e.g. Release manager")}
                      value={role}
                      disabled={saving}
                      onChange={(event) => setRole(event.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <span className="text-label">{isDuet ? <T>Creature</T> : <T>Emblem</T>}</span>
                  <ToggleGroup
                    aria-label={gt("Avatar emblem")}
                    variant="default"
                    size="compact"
                    detached
                    className="flex w-full flex-wrap"
                    value={[avatar.preset]}
                    disabled={saving}
                    onValueChange={(value) => {
                      const emblem = DUET_EMBLEM_ORDER.find(
                        (entry) => DUET_PICKER.emblems[entry] === value[0],
                      );
                      if (emblem) {
                        setAvatar((current) => ({
                          ...current,
                          preset: DUET_PICKER.emblems[emblem],
                        }));
                      }
                    }}
                  >
                    {DUET_EMBLEM_ORDER.map((emblem) => (
                      <Toggle
                        key={emblem}
                        value={DUET_PICKER.emblems[emblem]}
                        aria-label={emblemLabels[emblem]}
                        title={emblemLabels[emblem]}
                      >
                        <CaptainAvatar
                          avatar={{ preset: DUET_PICKER.emblems[emblem], color: avatar.color }}
                          size="picker"
                        />
                      </Toggle>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="grid gap-1.5">
                  <span className="text-label">
                    <T>Color</T>
                  </span>
                  <ToggleGroup
                    aria-label={gt("Avatar color")}
                    variant="default"
                    size="compact"
                    detached
                    className="flex w-full flex-wrap"
                    value={[avatar.color]}
                    disabled={saving}
                    onValueChange={(value) => {
                      const palette = DUET_PALETTE_ORDER.find(
                        (entry) => DUET_PICKER.palettes[entry] === value[0],
                      );
                      if (palette) {
                        setAvatar((current) => ({
                          ...current,
                          color: DUET_PICKER.palettes[palette],
                        }));
                      }
                    }}
                  >
                    {DUET_PALETTE_ORDER.map((palette) => (
                      <Toggle
                        key={palette}
                        value={DUET_PICKER.palettes[palette]}
                        aria-label={paletteLabels[palette]}
                        title={paletteLabels[palette]}
                      >
                        <span
                          aria-hidden
                          className="size-3.5 rounded-full ring-1 ring-border"
                          style={{ backgroundColor: DUET_PALETTE_SWATCH[palette].ink }}
                        />
                      </Toggle>
                    ))}
                  </ToggleGroup>
                </div>
              </div>
              <div className="grid gap-1.5">
                <label htmlFor={`${fieldId}-instructions`} className="text-label">
                  <T>Instructions</T>
                </label>
                <Textarea
                  id={`${fieldId}-instructions`}
                  rows={5}
                  maxLength={16_000}
                  placeholder={
                    isDuet
                      ? gt(
                          "What this Duet is responsible for, how it should work, and when to check in with you.",
                        )
                      : gt(
                          "What this Captain is responsible for, how it should work, and when to check in with you.",
                        )
                  }
                  value={instructions}
                  disabled={saving}
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="grid gap-1">
                  <span className="text-label">
                    <T>Delegate the work</T>
                  </span>
                  <p className="text-meta text-muted-foreground">
                    <T>
                      Answers quick questions itself and hands anything that edits code to crew in
                      their own worktrees.
                    </T>
                  </p>
                </div>
                <Switch
                  aria-label={gt("Delegate the work")}
                  checked={coordinatorOnly}
                  disabled={saving}
                  onCheckedChange={setCoordinatorOnly}
                />
              </div>
              <CaptainScope
                projects={projects}
                selected={scopedProjectIds}
                disabled={saving}
                onChange={setScope}
              />
              {captain === undefined ? (
                <div className="grid gap-2">
                  <span id={`${fieldId}-report-policy`} className="text-label">
                    <T>When a delegated task finishes</T>
                  </span>
                  <CaptainReportPolicyPicker
                    labelledBy={`${fieldId}-report-policy`}
                    value={reportPolicy}
                    disabled={saving}
                    onChange={setReportPolicy}
                  />
                </div>
              ) : null}
              {error !== null ? (
                <p role="alert" className="text-body text-destructive-foreground">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              {section === "memory" ? <T>Close</T> : <T>Cancel</T>}
            </Button>
            {section === "profile" ? (
              <Button
                type="button"
                disabled={saving || !canSave || !name.trim()}
                onClick={() => void save()}
              >
                {captain === undefined ? (
                  isDuet ? (
                    <T>Create Duet</T>
                  ) : (
                    <T>Create Captain</T>
                  )
                ) : (
                  <T>Save changes</T>
                )}
              </Button>
            ) : null}
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function CaptainMemorySection({
  captain,
  environmentId,
  onClose,
}: {
  readonly captain: Captain;
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const details = useCaptains(environmentId, captain.id);
  // captainsLive never completes, so `isPending` stays true after the first snapshot arrives.
  if (details.data == null) {
    return (
      <p className="text-body text-muted-foreground">
        {details.error === null ? <T>Loading memory…</T> : <T>Memory could not be loaded.</T>}
      </p>
    );
  }
  return (
    <div className="grid gap-5">
      <p className="text-body text-muted-foreground">
        <T>
          Memory tells this Duet what to carry into new conversations. Documents shape its work,
          memories are facts it can recall, and earlier conversations are read-only history.
        </T>
      </p>
      <section className="grid gap-2">
        <h3 className="text-label">
          <T>Documents</T>
        </h3>
        <CaptainDocuments
          details={{ captain, documents: details.data.documents }}
          environmentId={environmentId}
        />
      </section>
      <section className="grid gap-2">
        <h3 className="text-label">
          <T>Memories</T>
        </h3>
        <CaptainMemories
          captainId={captain.id}
          environmentId={environmentId}
          memories={details.data.memories}
        />
      </section>
      <section className="grid gap-2">
        <h3 className="text-label">
          <T>Earlier conversations</T>
        </h3>
        {captain.earlierThreadIds.length === 0 ? (
          <p className="text-meta text-muted-foreground">
            <T>No earlier conversations yet.</T>
          </p>
        ) : (
          <CaptainEarlierConversations
            captain={captain}
            environmentId={environmentId}
            onOpen={(threadId) => {
              useRightPanelStore
                .getState()
                .openThread(scopeThreadRef(environmentId, captain.primaryThreadId), threadId);
              onClose();
            }}
          />
        )}
      </section>
    </div>
  );
}
