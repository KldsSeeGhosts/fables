import type {
  EnvironmentId,
  SecretReference,
  UnifiedSettings,
  UsageLimitSourceConfig,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { useId, useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
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
import { sourceIdFromUrl } from "./AddUsageLimitSourceDialog.logic";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

/** Send the management key once to server secret storage; settings retain only a redaction marker. */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
  sources,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
}) {
  const gt = useGT();
  const formId = useId();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<UsageLimitSourceConfig["kind"]>("cpa-manager");
  const [url, setUrl] = useState("");
  const secretSources = useSecretSources(environmentId);
  const [keyDraft, setKeyDraft] = useState<string | SecretReference>("");
  const [keyValid, setKeyValid] = useState(true);
  const managementKey = typeof keyDraft === "string" ? keyDraft.trim() : keyDraft;
  const trimmedUrl = url.trim();
  const http = kind === "http";
  const endpoint = URL.parse(trimmedUrl);
  const canSave =
    keyValid &&
    (http
      ? endpoint !== null &&
        /^https?:$/.test(endpoint.protocol) &&
        !endpoint.username &&
        !endpoint.password
      : trimmedUrl.length > 0 && managementKey !== "");

  const reset = () => {
    setLabel("");
    setUrl("");
    setKeyDraft("");
    setKeyValid(true);
  };

  const save = () => {
    if (!canSave) return;
    const id = sourceIdFromUrl(trimmedUrl, sources, kind);
    updateSettings({
      usageLimitSources: {
        [id]: {
          kind,
          ...(label.trim() ? { label: label.trim() } : {}),
          url: trimmedUrl,
          managementKey,
          enabled: true,
        },
      },
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <T>Add a usage hub</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              Show pooled account limits on <Var>{environmentLabel}</Var>. CPA Manager also lists
              every auth file, including disabled accounts. The key stays on that server.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-kind">
                <T>Hub type</T>
              </Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  if (value) setKind(value);
                }}
              >
                <SelectTrigger id="usage-source-kind">
                  <SelectValue>
                    {kind === "http"
                      ? gt("HTTP quota source")
                      : kind === "cpa-manager"
                        ? gt("CPA Manager")
                        : gt("CLIProxyAPI")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="cpa-manager">
                    <T>CPA Manager</T>
                  </SelectItem>
                  <SelectItem value="cliproxy">
                    <T>CLIProxyAPI</T>
                  </SelectItem>
                  <SelectItem value="http">
                    <T>HTTP quota source</T>
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-url">
                {http ? <T>Endpoint URL</T> : <T>Hub URL</T>}
              </Label>
              <Input
                id="usage-source-url"
                placeholder={
                  kind === "cpa-manager"
                    ? "https://hub.example.ts.net"
                    : "https://hub.example.ts.net:8318"
                }
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-key">
                {http ? (
                  <T>Bearer token (optional)</T>
                ) : kind === "cpa-manager" ? (
                  <T>Manager admin key</T>
                ) : (
                  <T>Management key</T>
                )}
              </Label>
              <SecretSourceInput
                id="usage-source-key"
                aria-label={http ? gt("Bearer token (optional)") : gt("Management key")}
                value={keyDraft}
                sources={secretSources}
                environmentId={environmentId}
                onChange={(event) => setKeyDraft(event.target.value)}
                onSecretChange={(secret) => setKeyDraft(secret ?? "")}
                onValidityChange={setKeyValid}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">
                <T>Label (optional)</T>
              </Label>
              <Input
                id="usage-source-label"
                placeholder={gt("Defaults to the hub's host name")}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            <T>Cancel</T>
          </Button>
          <Button type="submit" form={formId} disabled={!canSave}>
            {http ? <T>Add source</T> : <T>Add hub</T>}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
