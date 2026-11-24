import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainDocument,
  captainInboxItems,
  captainThreadActivity,
  type CaptainInboxItem,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT, useLocale } from "gt-react";
import {
  ArrowRightIcon,
  GitForkIcon,
  MessageCircleQuestionIcon,
  PlusIcon,
  ShieldAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useTimeOfDayGreeting } from "../chat/ChatHero";
import { Badge } from "../ui/badge";
import { Button, ContentButton } from "../ui/button";
import { Text } from "../ui/text";
import { ApprovalBoundaryCard } from "./ApprovalBoundaryCard";
import { CaptainAvatar } from "./CaptainAvatar";
import {
  CaptainFinishedTaskRows,
  CaptainLocalTaskRows,
  CaptainRemoteTaskRows,
  CaptainTaskList,
} from "./CaptainBriefPanel";
import { captainDigestPreview } from "./CaptainDigest";
import type { CaptainChannelEnvironment } from "./captainsDirectory";
import { useCaptains } from "./useCaptain";

/** Captains whose delegated tasks the page subscribes to; the rest show only local activity. */
const DETAILED_CAPTAINS = 3;
const FINISHED_PER_CAPTAIN = 3;

function DuetSection({
  title,
  count,
  children,
}: {
  title: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <Text variant="label" render={<h3 />}>
          {title}
        </Text>
        {count !== undefined && count > 0 ? (
          <Text variant="meta" tone="muted" numeric>
            {count}
          </Text>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function DuetCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-3 shadow-xs">{children}</div>;
}

/** One request waiting on the user, from a Captain's conversation or its delegated thread. */
function CaptainInboxCard({
  item,
  captain,
  onReview,
}: {
  item: CaptainInboxItem;
  captain: Captain | undefined;
  onReview: (threadRef: ScopedThreadRef) => void;
}) {
  const gt = useGT();
  const [icon, label] =
    item.kind === "approval"
      ? [<ShieldAlertIcon key="icon" />, gt("Approval requested")]
      : item.kind === "input"
        ? [<MessageCircleQuestionIcon key="icon" />, gt("Question waiting")]
        : [<GitForkIcon key="icon" />, gt("Delegation request")];
  return (
    <ApprovalBoundaryCard.Root
      aria-label={gt("{kind}: {title}", { kind: label, title: item.title })}
    >
      <ApprovalBoundaryCard.Header
        icon={icon}
        attribution={
          captain ? (
            <>
              <CaptainAvatar avatar={captain.avatar} size="picker" state="waiting" />
              <span className="truncate">{captain.name}</span>
            </>
          ) : null
        }
      >
        <Text variant="meta" tone="muted">
          {label}
        </Text>
      </ApprovalBoundaryCard.Header>
      <ApprovalBoundaryCard.Title>{item.title}</ApprovalBoundaryCard.Title>
      {item.isChild ? (
        <ApprovalBoundaryCard.Detail>
          {gt("Delegated by {name}", { name: captain?.name ?? gt("a Captain") })}
        </ApprovalBoundaryCard.Detail>
      ) : null}
      <ApprovalBoundaryCard.Actions>
        <Button size="sm" onClick={() => onReview(item.threadRef)}>
          <T>Review</T>
        </Button>
      </ApprovalBoundaryCard.Actions>
    </ApprovalBoundaryCard.Root>
  );
}

function DigestCard({
  environmentId,
  captain,
  working,
  onOpen,
}: {
  environmentId: EnvironmentId;
  captain: Captain;
  working: boolean;
  onOpen: () => void;
}) {
  const gt = useGT();
  const details = useCaptains(environmentId, captain.id);
  const preview = captainDigestPreview(captainDocument(details.data, captain.id, "DIGEST.md"));
  return (
    <li className="min-w-0">
      <ContentButton
        variant="selection-card"
        aria-label={gt("Open {name}'s brief", { name: captain.name })}
        onClick={onOpen}
      >
        <span className="flex h-full min-h-36 flex-col gap-3 p-4">
          <span className="flex min-w-0 items-center gap-2.5">
            <CaptainAvatar
              avatar={captain.avatar}
              size="header"
              state={working ? "working" : "idle"}
            />
            <span className="grid min-w-0 flex-1">
              <Text variant="label" truncate>
                {captain.name}
              </Text>
              {captain.role ? (
                <Text variant="meta" tone="muted" truncate>
                  {captain.role}
                </Text>
              ) : null}
            </span>
            <ArrowRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
          <Text variant="body" tone="muted" render={<span className="line-clamp-3" />}>
            {preview !== "" ? preview : details.isPending ? <T>Loading…</T> : <T>No brief yet.</T>}
          </Text>
        </span>
      </ContentButton>
    </li>
  );
}

/** Everything every Captain has waiting, running and recently done, in one editorial column. */
export function CaptainsInbox({
  environments,
  shells,
  onOpenThread,
  onOpenCaptain,
  onCreate,
}: {
  environments: ReadonlyArray<CaptainChannelEnvironment>;
  shells: ReadonlyArray<EnvironmentThreadShell>;
  onOpenThread: (threadRef: ScopedThreadRef) => void;
  /** Opens a Captain's conversation on its Make view, where the brief lives. */
  onOpenCaptain: (environmentId: EnvironmentId, captain: Captain) => void;
  onCreate?: (() => void) | undefined;
}) {
  const gt = useGT();
  const locale = useLocale();
  const now = new Date(`${useNowMinute()}Z`);
  const hello = useTimeOfDayGreeting();
  const items = captainInboxItems(environments, shells);
  const captainOf = (environmentId: EnvironmentId, captainId: Captain["id"]) =>
    environments
      .find((environment) => environment.environmentId === environmentId)
      ?.captains.find((captain) => captain.id === captainId);
  const active = environments
    .flatMap(({ environmentId, captains }) =>
      captains.flatMap((captain) =>
        captain.archivedAt === null
          ? [{ environmentId, captain, ...captainThreadActivity(environmentId, captain, shells) }]
          : [],
      ),
    )
    .toSorted(
      (a, b) =>
        Number(b.attention > 0) - Number(a.attention > 0) ||
        Number(b.working) - Number(a.working) ||
        b.captain.updatedAt.localeCompare(a.captain.updatedAt),
    );
  const detailed = active.slice(0, DETAILED_CAPTAINS);
  const inFlight = active.reduce((count, { children }) => count + children.length, 0);
  const open = (environmentId: EnvironmentId) => (threadId: ScopedThreadRef["threadId"]) =>
    onOpenThread(scopeThreadRef(environmentId, threadId));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pt-12 pb-20">
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <Text variant="meta" tone="muted" render={<p />}>
            {new Intl.DateTimeFormat(locale, {
              weekday: "long",
              month: "long",
              day: "numeric",
            }).format(now)}
          </Text>
          <Text variant="display-lg" render={<h2 />}>
            {hello}
          </Text>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={items.length > 0 ? "warning" : "outline"} size="sm">
              {gt("{count, plural, one {{count} needs you} other {{count} need you}}", {
                count: items.length,
              })}
            </Badge>
            <Badge variant={inFlight > 0 ? "info" : "outline"} size="sm">
              {gt("{count} in flight", { count: inFlight })}
            </Badge>
            <Badge variant="outline" size="sm">
              {gt("{count, plural, one {{count} channel} other {{count} channels}}", {
                count: active.length,
              })}
            </Badge>
          </div>
        </div>
        {onCreate ? (
          <Button variant="secondary" size="sm" onClick={onCreate}>
            <PlusIcon aria-hidden />
            <T>New Captain</T>
          </Button>
        ) : null}
      </header>

      <DuetSection title={<T>Needs your approval</T>} count={items.length}>
        {items.length === 0 ? (
          <Text variant="body" tone="muted" render={<p />}>
            <T>Nothing is waiting on you.</T>
          </Text>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <CaptainInboxCard
                key={`${item.kind}:${item.threadRef.environmentId}:${item.threadRef.threadId}`}
                item={item}
                captain={captainOf(item.environmentId, item.captainId)}
                onReview={onOpenThread}
              />
            ))}
          </div>
        )}
      </DuetSection>

      <DuetSection title={<T>In flight</T>} count={inFlight}>
        <DuetCard>
          <CaptainTaskList empty={<T>No delegated work is running.</T>}>
            {active.map(({ environmentId, captain, children }) => (
              <CaptainLocalTaskRows
                key={`${environmentId}:${captain.id}`}
                threads={children}
                badge={() => captain.name}
                onOpen={open(environmentId)}
              />
            ))}
            {detailed.map(({ environmentId, captain }) => (
              <CaptainRemoteTaskRows
                key={`${environmentId}:${captain.id}`}
                parent={scopeThreadRef(environmentId, captain.primaryThreadId)}
                badge={captain.name}
              />
            ))}
          </CaptainTaskList>
        </DuetCard>
      </DuetSection>

      <DuetSection title={<T>Recently finished</T>}>
        <DuetCard>
          <CaptainTaskList empty={<T>No delegated tasks finished recently.</T>}>
            {detailed.map(({ environmentId, captain }) => (
              <CaptainFinishedTaskRows
                key={`${environmentId}:${captain.id}`}
                parent={scopeThreadRef(environmentId, captain.primaryThreadId)}
                badge={captain.name}
                limit={FINISHED_PER_CAPTAIN}
                onOpen={open(environmentId)}
              />
            ))}
          </CaptainTaskList>
        </DuetCard>
      </DuetSection>

      <DuetSection title={<T>Morning briefs</T>}>
        {active.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {active.map(({ environmentId, captain, working }) => (
              <DigestCard
                key={`${environmentId}:${captain.id}`}
                environmentId={environmentId}
                captain={captain}
                working={working}
                onOpen={() => onOpenCaptain(environmentId, captain)}
              />
            ))}
          </ul>
        ) : (
          <Text variant="body" tone="muted" render={<p />}>
            <T>Create a Captain to delegate work and get a daily brief.</T>
          </Text>
        )}
      </DuetSection>
    </div>
  );
}
