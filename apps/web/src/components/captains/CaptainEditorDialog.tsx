import { useAtomValue } from "@effect/atom-react";
import {
  CaptainAvatarColor,
  CaptainAvatarPreset,
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
import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { CaptainAvatar } from "./CaptainAvatar";
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
  const [avatar, setAvatar] = useState<Avatar>(
    captain?.avatar ?? { color: "violet", preset: "compass" },
  );
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
  const presetLabels = {
    compass: gt("Compass"),
    mountain: gt("Mountain"),
    terminal: gt("Terminal"),
    flag: gt("Flag", { $context: "Captain avatar icon" }),
  };
  const colorLabels = {
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {captain === undefined ? <T>New Captain</T> : <T>Edit Captain</T>}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {captain === undefined && destinations && destinations.length > 1 ? (
            <div className="grid gap-1.5">
              <label htmlFor={`${fieldId}-environment`} className="text-label">
                <T>Environment</T>
              </label>
              <Select
                value={environmentId}
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
          <div className="grid grid-cols-2 gap-3">
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor={`${fieldId}-name`} className="text-label">
                <T>Name</T>
              </label>
              <Input
                id={`${fieldId}-name`}
                required
                maxLength={80}
                value={name}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor={`${fieldId}-role`} className="text-label">
                <T>Role</T>
              </label>
              <Input
                id={`${fieldId}-role`}
                maxLength={120}
                value={role}
                disabled={saving}
                onChange={(event) => setRole(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${fieldId}-instructions`} className="text-label">
              <T>Instructions</T>
            </label>
            <Textarea
              id={`${fieldId}-instructions`}
              rows={4}
              maxLength={16_000}
              value={instructions}
              disabled={saving}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <CaptainAvatar avatar={avatar} size="header" />
            <ToggleGroup
              aria-label={gt("Avatar icon")}
              value={[avatar.preset]}
              disabled={saving}
              onValueChange={(value) => {
                const preset = CaptainAvatarPreset.literals.find((preset) => preset === value[0]);
                if (preset) setAvatar({ ...avatar, preset });
              }}
            >
              {CaptainAvatarPreset.literals.map((preset) => (
                <Toggle key={preset} value={preset} aria-label={presetLabels[preset]}>
                  <CaptainAvatar avatar={{ preset, color: avatar.color }} />
                </Toggle>
              ))}
            </ToggleGroup>
            <Select
              value={avatar.color}
              disabled={saving}
              onValueChange={(color) => {
                if (color !== null) setAvatar({ ...avatar, color });
              }}
            >
              <SelectTrigger aria-label={gt("Avatar color")}>
                <SelectValue>{colorLabels[avatar.color]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {CaptainAvatarColor.literals.map((color) => (
                  <SelectItem key={color} value={color}>
                    {colorLabels[color]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
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
