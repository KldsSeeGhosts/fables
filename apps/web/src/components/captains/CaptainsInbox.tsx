import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainDocument,
  captainInboxItems,
  captainThreadActivity,
  type CaptainInboxItem,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, CaptainId, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT, useLocale } from "gt-react";
import { GitForkIcon, MessageCircleQuestionIcon, ShieldAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { Text } from "../ui/text";
import { ApprovalBoundaryCard } from "./ApprovalBoundaryCard";
import { CaptainAvatar } from "./CaptainAvatar";
import {
  CaptainFinishedTaskRows,
  CaptainLocalTaskRows,
  CaptainRemoteTaskRows,
  CaptainTaskList,
} from "./CaptainBriefPanel";
import type { CaptainChannelEnvironment } from "./CaptainChannelRail";
import { captainDigestPreview } from "./CaptainDigest";
import { useCaptains } from "./useCaptain";

/** Captains whose delegated tasks the Inbox subscribes to; the rest show only local activity. */
const DETAILED_CAPTAINS = 3;
const FINISHED_PER_CAPTAIN = 3;

export function CaptainSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <Text variant="meta" tone="muted" render={<h3 />}>
        {title}
      </Text>
      {children}
    </section>
  );
}

/** One request waiting on the user, from a Captain's conversation or its delegated thread. */
export function CaptainInboxCard({
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

function DigestPreview({
  environmentId,
  captain,
  onOpen,
}: {
  environmentId: EnvironmentId;
  captain: Captain;
  onOpen: () => void;
}) {
  const details = useCaptains(environmentId, captain.id);
  const preview = captainDigestPreview(captainDocument(details.data, captain.id, "DIGEST.md"));
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-card border border-border p-3">
      <CaptainAvatar avatar={captain.avatar} size="header" />
      <div className="min-w-0 flex-1 space-y-1">
        <Text variant="label" truncate render={<h4 className="block" />}>
          {captain.name}
        </Text>
        <Text variant="body" tone="muted" render={<p className="line-clamp-3" />}>
          {preview !== "" ? preview : details.isPending ? <T>Loading…</T> : <T>No brief yet.</T>}
        </Text>
      </div>
      <Button size="sm" variant="ghost" onClick={onOpen}>
        <T>Open</T>
      </Button>
    </li>
  );
}

function greeting(hour: number) {
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/** Everything every Captain has waiting, running and recently done, on one page. */
export function CaptainsInbox({
  environments,
  shells,
  onOpenThread,
  onOpenCaptain,
}: {
  environments: ReadonlyArray<CaptainChannelEnvironment>;
  shells: ReadonlyArray<EnvironmentThreadShell>;
  onOpenThread: (threadRef: ScopedThreadRef) => void;
  onOpenCaptain: (environmentId: EnvironmentId, captainId: CaptainId) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const now = new Date(`${useNowMinute()}Z`);
  const items = captainInboxItems(environments, shells);
  const captainOf = (environmentId: EnvironmentId, captainId: CaptainId) =>
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
  const hello = {
    morning: gt("Good morning"),
    afternoon: gt("Good afternoon"),
    evening: gt("Good evening"),
  }[greeting(now.getHours())];
  const open = (environmentId: EnvironmentId) => (threadId: ScopedThreadRef["threadId"]) =>
    onOpenThread(scopeThreadRef(environmentId, threadId));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
      <header className="space-y-2">
        <Text variant="display-lg" render={<h2 />}>
          {hello}
        </Text>
        <Text variant="body" tone="muted" render={<p className="flex flex-wrap gap-x-4" />}>
          <span>
            {new Intl.DateTimeFormat(locale, {
              weekday: "long",
              month: "long",
              day: "numeric",
            }).format(now)}
          </span>
          <span>
            {gt("{count, plural, one {{count} needs you} other {{count} need you}}", {
              count: items.length,
            })}
          </span>
          <span>{gt("{count} in flight", { count: inFlight })}</span>
        </Text>
      </header>

      <CaptainSection title={<T>Needs you</T>}>
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
      </CaptainSection>

      <CaptainSection title={<T>In flight</T>}>
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
      </CaptainSection>

      <CaptainSection title={<T>Recently finished</T>}>
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
      </CaptainSection>

      {active.length > 0 ? (
        <CaptainSection title={<T>Digests</T>}>
          <ul className="flex flex-col gap-2">
            {active.map(({ environmentId, captain }) => (
              <DigestPreview
                key={`${environmentId}:${captain.id}`}
                environmentId={environmentId}
                captain={captain}
                onOpen={() => onOpenCaptain(environmentId, captain.id)}
              />
            ))}
          </ul>
        </CaptainSection>
      ) : (
        <Text variant="body" tone="muted" render={<p />}>
          <T>Create a Captain to delegate work and get a daily brief.</T>
        </Text>
      )}
    </div>
  );
}
