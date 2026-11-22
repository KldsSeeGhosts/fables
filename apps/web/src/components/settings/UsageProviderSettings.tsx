import type { EnvironmentId, UnifiedSettings } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { GaugeIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";
import { useSearchableSetting } from "./settingsSearch";
import { SettingsEmptyState, SettingsRow, SettingsSection } from "./settingsLayout";

export function UsageProviderSettings({
  environmentId,
  environmentLabel,
  sources,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly readOnly: boolean;
}) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [adding, setAdding] = useState(false);
  const entries = Object.entries(sources);

  return (
    <>
      <SettingsSection
        {...searchableSetting("usage-providers")}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="secondary" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3" aria-hidden />
              <T>Add usage provider</T>
            </Button>
          ) : null
        }
      >
        {entries.length === 0 ? (
          <div className="py-8">
            <SettingsEmptyState
              icon={<GaugeIcon />}
              title={gt("No usage providers configured.")}
              description={gt(
                "Add a CPA Manager or CLIProxyAPI hub to show pooled account limits next to your providers.",
              )}
            />
          </div>
        ) : (
          entries.map(([id, source]) => {
            const label = source.label?.trim() || source.url;
            const providerName =
              source.kind === "cpa-manager" ? gt("CPA Manager") : gt("CLI Proxy");
            return (
              <SettingsRow
                key={id}
                title={
                  <Tooltip>
                    <TooltipTrigger render={<span tabIndex={0} />}>{label}</TooltipTrigger>
                    <TooltipPopup>
                      <span className="block">{providerName}</span>
                      {label !== source.url ? <span className="block">{source.url}</span> : null}
                    </TooltipPopup>
                  </Tooltip>
                }
                description={providerName}
                status={source.enabled ? undefined : <T context="provider status">Disabled</T>}
                control={
                  !readOnly ? (
                    <RemoveUsageProviderButton
                      label={label}
                      onConfirm={() => updateSettings({ usageLimitSources: { [id]: null } })}
                    />
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {adding && !readOnly ? (
        <AddUsageLimitSourceDialog
          open
          onOpenChange={setAdding}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          sources={sources}
        />
      ) : null}
    </>
  );
}

function RemoveUsageProviderButton({
  label,
  onConfirm,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        <T>Remove</T>
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>
                Remove <Var>{label}</Var>?
              </T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>
                The hub's management key is deleted from this server. Its accounts leave the Limits
                view; the hub itself is untouched. Add it again with the URL and key to bring them
                back.
              </T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              <T>Remove hub</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
