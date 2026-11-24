import { captainThreadActivity } from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, CaptainId, EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { InboxIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { Badge } from "../ui/badge";
import { Button, ContentButton } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Text } from "../ui/text";
import { CaptainAvatar } from "./CaptainAvatar";
import { CaptainEditorDialog } from "./CaptainEditorDialog";
import { useCaptainDestinations } from "./captainsDirectory";

export interface CaptainChannelEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly captains: ReadonlyArray<Captain>;
}

export type CaptainChannelSelection = {
  readonly environmentId: EnvironmentId;
  readonly captainId: CaptainId;
} | null;

function CaptainChannel({
  environmentId,
  captain,
  shells,
  selected,
  onSelect,
}: {
  environmentId: EnvironmentId;
  captain: Captain;
  shells: ReadonlyArray<EnvironmentThreadShell>;
  selected: boolean;
  onSelect: () => void;
}) {
  const gt = useGT();
  const archived = captain.archivedAt !== null;
  const { attention, working } = captainThreadActivity(environmentId, captain, shells);
  const status = archived
    ? gt("Archived")
    : attention > 0
      ? gt("Needs input")
      : working
        ? gt("Working", { $context: "Captain status" })
        : gt("Ready");
  return (
    <li className={selected ? "surface-sidebar-row-selected rounded-row" : undefined}>
      <ContentButton
        variant="inset-row-multiline"
        aria-current={selected ? "page" : undefined}
        aria-label={gt("{name}, {status}", { name: captain.name, status })}
        onClick={onSelect}
      >
        <CaptainAvatar
          avatar={captain.avatar}
          state={archived ? "archived" : attention > 0 ? "waiting" : working ? "working" : "idle"}
        />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-label">{captain.name}</span>
          <span
            className={cn(
              "truncate text-micro",
              !archived && attention > 0
                ? "text-warning-foreground"
                : !archived && working
                  ? "text-info-foreground"
                  : "text-muted-foreground",
            )}
          >
            {status}
          </span>
        </span>
      </ContentButton>
    </li>
  );
}

/** The Captains page's left rail: the Inbox, each Captain as a channel, and archived Captains. */
export function CaptainChannelRail({
  environments,
  shells,
  attention,
  selection,
  onSelect,
}: {
  environments: ReadonlyArray<CaptainChannelEnvironment>;
  shells: ReadonlyArray<EnvironmentThreadShell>;
  attention: number;
  selection: CaptainChannelSelection;
  onSelect: (selection: CaptainChannelSelection) => void;
}) {
  const gt = useGT();
  const { destinations, destination } = useCaptainDestinations(usePrimaryEnvironmentId());
  const [creating, setCreating] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const grouped = environments.length > 1;
  const archived = environments.flatMap(({ environmentId, captains }) =>
    captains.flatMap((captain) =>
      captain.archivedAt === null ? [] : [{ environmentId, captain }],
    ),
  );
  const isSelected = (environmentId: EnvironmentId, captain: Captain) =>
    selection?.environmentId === environmentId && selection.captainId === captain.id;

  return (
    <nav
      aria-label={gt("Captains")}
      className="flex min-h-0 w-60 shrink-0 flex-col gap-3 overflow-y-auto border-e border-border px-2 py-3"
    >
      <ul>
        <li className={selection === null ? "surface-sidebar-row-selected rounded-row" : undefined}>
          <ContentButton
            variant="inset-row"
            aria-current={selection === null ? "page" : undefined}
            onClick={() => onSelect(null)}
          >
            <InboxIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-label">
              <T>Inbox</T>
            </span>
            {attention > 0 ? (
              <Badge
                variant="warning"
                size="sm"
                aria-label={gt(
                  "{count, plural, one {{count} Captain needs input} other {{count} Captains need input}}",
                  { count: attention },
                )}
              >
                {attention}
              </Badge>
            ) : null}
          </ContentButton>
        </li>
      </ul>
      {environments.map(({ environmentId, label, captains }) => {
        const active = captains.filter((captain) => captain.archivedAt === null);
        if (grouped && active.length === 0) return null;
        return (
          <section key={environmentId} className="space-y-0.5">
            <Text variant="caption" tone="muted" truncate render={<h2 className="block px-2" />}>
              {grouped ? label : <T>Crew</T>}
            </Text>
            <ul className="space-y-0.5">
              {active.map((captain) => (
                <CaptainChannel
                  key={captain.id}
                  environmentId={environmentId}
                  captain={captain}
                  shells={shells}
                  selected={isSelected(environmentId, captain)}
                  onSelect={() => onSelect({ environmentId, captainId: captain.id })}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {archived.length > 0 ? (
        <section className="space-y-0.5">
          <CollapsibleSectionHeader
            tone="shelf"
            expanded={archivedOpen}
            onClick={() => setArchivedOpen(!archivedOpen)}
            accessory={<span className="text-meta tabular-nums">{archived.length}</span>}
          >
            <T>Archived</T>
          </CollapsibleSectionHeader>
          {archivedOpen ? (
            <ul className="space-y-0.5">
              {archived.map(({ environmentId, captain }) => (
                <CaptainChannel
                  key={`${environmentId}:${captain.id}`}
                  environmentId={environmentId}
                  captain={captain}
                  shells={shells}
                  selected={isSelected(environmentId, captain)}
                  onSelect={() => onSelect({ environmentId, captainId: captain.id })}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {destination ? (
        <div className="flex">
          <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
            <PlusIcon />
            <T>New Captain</T>
          </Button>
        </div>
      ) : null}
      {creating && destination ? (
        <CaptainEditorDialog
          destination={destination}
          destinations={destinations}
          onClose={() => setCreating(false)}
          onSave={(environmentId, captain) => {
            setCreating(false);
            onSelect({ environmentId, captainId: captain.id });
          }}
        />
      ) : null}
    </nav>
  );
}
