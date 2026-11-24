import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { captainThreadActivity } from "@t3tools/client-runtime/state/captains";
import {
  AuthOrchestrationReadScope,
  type Captain,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { flushSync } from "react-dom";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { useThreadShells } from "../../state/entities";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { Button, ContentButton } from "../ui/button";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { CaptainAvatar } from "./CaptainAvatar";
import { CaptainEditorDialog } from "./CaptainEditorDialog";

const captainResults = environmentAtomList("captain-shelf:environments", (environmentId) =>
  serverEnvironment.captainsLive({ environmentId, input: {} }),
);
const createPermissions = environmentAtomList("captain-shelf:create", (environmentId) =>
  serverEnvironment.createCaptain.permissionAtom(environmentId),
);

export function CaptainShelfList({
  rows,
  activeThread,
  onOpen,
  onCreate,
  onReveal,
}: {
  rows: ReadonlyArray<{
    environmentId: EnvironmentId;
    label?: string;
    captain: Captain;
    attention: number;
    working: boolean;
  }>;
  activeThread: ScopedThreadRef | null;
  onOpen: (threadRef: ScopedThreadRef) => void;
  onCreate?: (() => void) | undefined;
  onReveal?: ((header: HTMLElement) => void) | undefined;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useLocalStorage(
    "t3code:sidebar:captains-expanded",
    true,
    Schema.Boolean,
  );
  const activeCount = rows.filter(({ captain }) => captain.archivedAt === null).length;
  const attention = rows.reduce(
    (count, row) => count + Number(row.captain.archivedAt === null && row.attention > 0),
    0,
  );

  return (
    <li className="mx-0.5 mb-1 list-none">
      <div className="flex items-center">
        <CollapsibleSectionHeader
          data-sidebar-row="shelf:captains"
          tone="shelf"
          expanded={expanded}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            if (expanded) {
              setExpanded(false);
            } else {
              flushSync(() => setExpanded(true));
              onReveal?.(event.currentTarget);
            }
          }}
          accessory={
            !expanded && attention > 0 ? (
              <SectionHeaderStatus>
                <span
                  aria-label={gt(
                    "{count, plural, one {{count} Captain needs input} other {{count} Captains need input}}",
                    { count: attention },
                  )}
                >
                  {attention}
                </span>
              </SectionHeaderStatus>
            ) : (
              <span className="text-meta tabular-nums">{activeCount}</span>
            )
          }
        >
          <T>Captains</T>
        </CollapsibleSectionHeader>
        {onCreate ? (
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onCreate}
            aria-label={gt("New Captain")}
            title={gt("New Captain")}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      {expanded ? (
        <ul className="space-y-0.5">
          {rows.map(({ captain, environmentId, label, attention, working }) => {
            const selected =
              activeThread?.environmentId === environmentId &&
              activeThread.threadId === captain.primaryThreadId;
            const archived = captain.archivedAt !== null;
            const status = archived
              ? gt("Archived")
              : attention > 0
                ? gt("Needs input")
                : working
                  ? gt("Working", { $context: "Captain status" })
                  : gt("Ready");
            return (
              <li
                key={`${environmentId}:${captain.id}`}
                className={selected ? "surface-selected rounded-row" : undefined}
              >
                <ContentButton
                  variant="inset-row-multiline"
                  aria-current={selected ? "page" : undefined}
                  aria-label={gt("{name}, {status}", { name: captain.name, status })}
                  onClick={() => onOpen(scopeThreadRef(environmentId, captain.primaryThreadId))}
                >
                  <CaptainAvatar avatar={captain.avatar} />
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
                  {label ? (
                    <span className="max-w-24 truncate text-micro text-muted-foreground">
                      {label}
                    </span>
                  ) : null}
                </ContentButton>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function CaptainsShelf({
  primaryEnvironmentId,
  activeThread,
  onOpen,
  onReveal,
}: {
  primaryEnvironmentId: EnvironmentId | null;
  activeThread: ScopedThreadRef | null;
  onOpen: (threadRef: ScopedThreadRef) => void;
  onReveal: (header: HTMLElement) => void;
}) {
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const supporting = environments.filter(
    ({ environmentId, serverConfig }) =>
      readable.has(environmentId) && serverConfig?.environment.capabilities.captains === true,
  );
  const key = environmentIdsKey(supporting.map(({ environmentId }) => environmentId));
  const results = useAtomValue(captainResults(key));
  const permissions = useAtomValue(createPermissions(key));
  const shells = useThreadShells(supporting.length > 0);
  const [creating, setCreating] = useState(false);
  if (supporting.length === 0) return null;

  const destinations = supporting.flatMap(({ environmentId, label }, index) =>
    permissions[index] ? [{ id: environmentId, label }] : [],
  );
  const destination = destinations.find(({ id }) => id === primaryEnvironmentId) ?? destinations[0];
  const rows = supporting
    .flatMap(({ environmentId, label }, index) =>
      (AsyncResult.getOrElse(results[index]!, () => null)?.captains ?? []).map((captain) => ({
        environmentId,
        ...(supporting.length > 1 ? { label } : {}),
        captain,
        ...captainThreadActivity(environmentId, captain, shells),
      })),
    )
    .toSorted(
      (a, b) => Number(a.captain.archivedAt !== null) - Number(b.captain.archivedAt !== null),
    );

  return (
    <>
      <CaptainShelfList
        rows={rows}
        activeThread={activeThread}
        onOpen={onOpen}
        onReveal={onReveal}
        onCreate={destination ? () => setCreating(true) : undefined}
      />
      {creating && destination ? (
        <CaptainEditorDialog
          destination={destination}
          destinations={destinations}
          onClose={() => setCreating(false)}
          onSave={(environmentId, captain) => {
            setCreating(false);
            onOpen(scopeThreadRef(environmentId, captain.primaryThreadId));
          }}
        />
      ) : null}
    </>
  );
}
