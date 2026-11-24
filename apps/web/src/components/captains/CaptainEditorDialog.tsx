import { useAtomValue } from "@effect/atom-react";
import {
  CaptainAvatarColor,
  CaptainId,
  clampManagedRuntimeMode,
  DEFAULT_SERVER_SETTINGS,
  type Captain,
  type CaptainAvatar as Avatar,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useGT, T } from "gt-react";
import { useId, useState } from "react";

import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { cn, randomUUID } from "../../lib/utils";
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
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  CaptainAvatar,
  captainAvatarShapes,
  captainAvatarSwatches,
  randomCaptainAvatar,
} from "./CaptainAvatar";
import { CaptainScope } from "./CaptainScope";
import { captainCommandError } from "./useCaptain";

type Destination = { readonly id: EnvironmentId; readonly label: string };

export function CaptainEditorDialog({
  destination,
  destinations,
  captain,
  onClose,
  onSave,
}: {
  destination: Destination;
  destinations?: ReadonlyArray<Destination>;
  captain?: Captain;
  onClose: () => void;
  onSave: (environmentId: EnvironmentId, captain: Captain) => void;
}) {
  const gt = useGT();
  const fieldId = useId();
  const [environmentId, setEnvironmentId] = useState(destination.id);
  const [captainId] = useState(() => CaptainId.make(randomUUID()));
  const [name, setName] = useState(captain?.name ?? "");
  const [role, setRole] = useState(captain?.role ?? "");
  const [instructions, setInstructions] = useState(captain?.instructions ?? "");
  const [avatar, setAvatar] = useState<Avatar>(captain?.avatar ?? randomCaptainAvatar());
  const [scopedProjectIds, setScope] = useState<ReadonlyArray<ProjectId>>(
    captain?.scopedProjectIds ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canCreate = useAtomValue(serverEnvironment.createCaptain.permissionAtom(environmentId));
  const canUpdate = useAtomValue(serverEnvironment.updateCaptain.permissionAtom(environmentId));
  const create = useAtomCommand(serverEnvironment.createCaptain, { reportFailure: false });
  const update = useAtomCommand(serverEnvironment.updateCaptain, { reportFailure: false });
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const canSave = captain === undefined ? canCreate : canUpdate;
  const shapeLabels = {
    circle: gt("Circle"),
    squircle: gt("Rounded square"),
    drop: gt("Drop", { $context: "Captain avatar shape" }),
    hexagon: gt("Hexagon"),
    cloud: gt("Cloud", { $context: "Captain avatar shape" }),
    diamond: gt("Diamond"),
  };
  const colorLabels = {
    ink: gt("Ink", { $context: "color" }),
    violet: gt("Violet"),
    blue: gt("Blue"),
    emerald: gt("Emerald"),
    amber: gt("Amber"),
    rose: gt("Rose", { $context: "color" }),
  };

  const save = async () => {
    if (!canSave || saving || !name.trim()) return;
    const profile = {
      name: name.trim(),
      role: role.trim(),
      instructions,
      avatar,
      scopedProjectIds,
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
          reportPolicy: "context",
          modelSelection,
          runtimeMode:
            clampManagedRuntimeMode(config?.managedPolicy, defaults.defaultRuntimeMode) ??
            defaults.defaultRuntimeMode,
          interactionMode: "default",
        },
      });
    })();
    setSaving(false);
    if (result === null) {
      setError(gt("Configure a model on this environment before creating a Captain."));
    } else if (result._tag === "Failure") {
      setError(captainCommandError(result, gt("Could not save Captain.")));
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
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {captain === undefined ? <T>New Captain</T> : <T>Edit Captain</T>}
            </DialogTitle>
            <DialogDescription>
              <T>A Captain keeps its own conversation, memories, and documents across sessions.</T>
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
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
            <div className="flex gap-3">
              <CaptainAvatar avatar={avatar} size="large" />
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ToggleGroup
                aria-label={gt("Avatar shape")}
                value={[avatar.preset]}
                disabled={saving}
                onValueChange={(value) => {
                  const preset = captainAvatarShapes.find((shape) => shape === value[0]);
                  if (preset) setAvatar((current) => ({ ...current, preset }));
                }}
              >
                {captainAvatarShapes.map((shape) => (
                  <Toggle
                    key={shape}
                    value={shape}
                    aria-label={shapeLabels[shape]}
                    title={shapeLabels[shape]}
                  >
                    <CaptainAvatar avatar={{ preset: shape, color: avatar.color }} size="picker" />
                  </Toggle>
                ))}
              </ToggleGroup>
              <ToggleGroup
                aria-label={gt("Avatar color")}
                value={[avatar.color]}
                disabled={saving}
                onValueChange={(value) => {
                  const color = CaptainAvatarColor.literals.find((color) => color === value[0]);
                  if (color) setAvatar((current) => ({ ...current, color }));
                }}
              >
                {CaptainAvatarColor.literals.map((color) => (
                  <Toggle
                    key={color}
                    value={color}
                    aria-label={colorLabels[color]}
                    title={colorLabels[color]}
                  >
                    <span
                      aria-hidden
                      className={cn("size-3 rounded-full", captainAvatarSwatches[color])}
                    />
                  </Toggle>
                ))}
              </ToggleGroup>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${fieldId}-instructions`} className="text-label">
                <T>Instructions</T>
              </label>
              <Textarea
                id={`${fieldId}-instructions`}
                rows={5}
                maxLength={16_000}
                placeholder={gt(
                  "What this Captain is responsible for, how it should work, and when to check in with you.",
                )}
                value={instructions}
                disabled={saving}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </div>
            <CaptainScope
              projects={projects}
              selected={scopedProjectIds}
              disabled={saving}
              onChange={setScope}
            />
            {error !== null ? (
              <p role="alert" className="text-body text-destructive-foreground">
                {error}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              <T>Cancel</T>
            </Button>
            <Button type="submit" disabled={saving || !canSave || !name.trim()}>
              {captain === undefined ? <T>Create Captain</T> : <T>Save changes</T>}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
