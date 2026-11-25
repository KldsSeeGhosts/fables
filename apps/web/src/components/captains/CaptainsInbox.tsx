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
import { GitForkIcon, MessageCircleQuestionIcon, PlusIcon, ShieldAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useTimeOfDayGreeting } from "../chat/ChatHero";
import ChatMarkdown from "../ChatMarkdown";
import { Button, ContentButton } from "../ui/button";
import { Text } from "../ui/text";
import { ApprovalBoundaryCard } from "./ApprovalBoundaryCard";
import { CaptainAvatar } from "./CaptainAvatar";
import { captainDigestPreview } from "./CaptainDigest";
import { captainDigestMarkdownExcerpt } from "./captainDigestExcerpt";
import type { CaptainChannelEnvironment } from "./captainsDirectory";
import {
  OverviewFinishedTaskRows,
  OverviewLocalTaskRows,
  OverviewRemoteActiveTaskRows,
  OverviewTaskList,
  useOverviewRemoteTaskCounts,
} from "./CaptainsOverviewTasks";
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
    <section className="space-y-3 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2">
        <Text variant="title" render={<h3 />}>
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
  const isDuet = useDuetShell();
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
          {gt("Delegated by {name}", {
            name: captain?.name ?? (isDuet ? gt("a Duet") : gt("a Captain")),
          })}
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

function blocked(thread: EnvironmentThreadShell) {
  return (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest != null
  );
}

function DuetOverviewCard({
  environmentId,
  captain,
  activeThreads,
  attention,
  working,
  includeRemoteCounts,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly captain: Captain;
  readonly activeThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly attention: number;
  readonly working: boolean;
  readonly includeRemoteCounts: boolean;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const remoteCounts = useOverviewRemoteTaskCounts(
    includeRemoteCounts ? scopeThreadRef(environmentId, captain.primaryThreadId) : null,
  );
  const runningCount =
    activeThreads.filter((thread) => !blocked(thread)).length + remoteCounts.running;
  const waitingCount = activeThreads.filter(blocked).length + remoteCounts.waiting;
  const latestTask = [...activeThreads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const status =
    latestTask?.title ??
    (attention > 0
      ? gt("A request is waiting in conversation")
      : working
        ? gt("Working in conversation")
        : gt("No active work"));
  const state = attention > 0 ? "waiting" : working ? "working" : "idle";
  return (
    <li className="min-w-0">
      <ContentButton
        variant="selection-card"
        data-duet-overview-card=""
        aria-label={gt("Open {name}", { name: captain.name })}
        onClick={onOpen}
        className="h-full w-full"
      >
        <span className="flex h-full w-full items-start gap-4 p-4">
          <span className="pt-0.5">
            <CaptainAvatar avatar={captain.avatar} size="hero" state={state} animateOnMount />
          </span>
          <span className="grid min-w-0 flex-1 gap-1.5">
            <span className="grid min-w-0">
              <Text variant="label" truncate>
                {captain.name}
              </Text>
              {captain.role ? (
                <Text variant="meta" tone="muted" truncate>
                  {captain.role}
                </Text>
              ) : null}
            </span>
            <Text variant="body" tone="muted" truncate>
              {status}
            </Text>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-muted-foreground">
              <span className="tabular-nums">
                {gt("{count, plural, one {{count} task running} other {{count} tasks running}}", {
                  count: runningCount,
                })}
              </span>
              <span className="tabular-nums">
                {gt("{count, plural, one {{count} task waiting} other {{count} tasks waiting}}", {
                  count: waitingCount,
                })}
              </span>
            </span>
          </span>
        </span>
      </ContentButton>
    </li>
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
  const isDuet = useDuetShell();
  const locale = useLocale();
  const details = useCaptains(environmentId, captain.id);
  const document = captainDocument(details.data, captain.id, "DIGEST.md");
  const preview = captainDigestPreview(document);
  const excerpt = preview === "" ? "" : captainDigestMarkdownExcerpt(document?.content ?? "");
  const loading = details.data === null && details.error === null;
  const dateLabel =
    document && preview !== ""
      ? new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(document.updatedAt))
      : null;
  return (
    <li className="grid min-w-0">
      <article
        data-duet-digest-card=""
        className="overflow-hidden rounded-card border border-transparent surface-card-settings-rim"
      >
        <ContentButton
          variant="card-row"
          aria-label={gt("Open {name}'s brief", { name: captain.name })}
          onClick={onOpen}
          className="w-full"
        >
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
          {dateLabel ? (
            <Text variant="meta" tone="muted" numeric>
              {dateLabel}
            </Text>
          ) : null}
        </ContentButton>
        <div className="min-h-28 px-4 pb-4">
          {excerpt !== "" ? (
            <div data-duet-digest-preview="" className="min-h-0 overflow-hidden">
              <ChatMarkdown text={excerpt} cwd={undefined} environmentId={environmentId} />
            </div>
          ) : (
            <Text variant="body" tone="muted" render={<p />}>
              {loading ? (
                <T>Loading the brief…</T>
              ) : details.error !== null ? (
                <T>The brief could not be loaded.</T>
              ) : isDuet ? (
                <T>No brief yet. Turn on the morning brief in a Duet's Tasks → Scheduled.</T>
              ) : (
                <T>No brief yet. Turn on the morning brief in a Captain's Tasks → Scheduled.</T>
              )}
            </Text>
          )}
        </div>
      </article>
    </li>
  );
}

/** What every Captain has waiting, running and recently done, in one editorial column. */
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
  const isDuet = useDuetShell();
  const locale = useLocale();
  const now = new Date(`${useNowMinute()}Z`);
  const nowMs = now.getTime();
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
  const open = (environmentId: EnvironmentId) => (threadId: ScopedThreadRef["threadId"]) =>
    onOpenThread(scopeThreadRef(environmentId, threadId));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-9 px-6 pt-12 pb-20">
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1 space-y-2.5">
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-meta text-muted-foreground">
            <span className="tabular-nums">
              {isDuet
                ? gt("{count, plural, one {{count} Duet} other {{count} Duets}}", {
                    count: active.length,
                  })
                : gt("{count, plural, one {{count} Captain} other {{count} Captains}}", {
                    count: active.length,
                  })}
            </span>
            <span className="tabular-nums">
              {gt("{count, plural, one {{count} needs you} other {{count} need you}}", {
                count: items.length,
              })}
            </span>
          </div>
        </div>
        {onCreate ? (
          <Button variant="quiet-pill" size="sm" onClick={onCreate}>
            <PlusIcon aria-hidden />
            {isDuet ? <T>New Duet</T> : <T>New Captain</T>}
          </Button>
        ) : null}
      </header>

      {active.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {active.map(({ environmentId, captain, children, attention, working }, index) => (
            <DuetOverviewCard
              key={`${environmentId}:${captain.id}`}
              environmentId={environmentId}
              captain={captain}
              activeThreads={children}
              attention={attention}
              working={working}
              includeRemoteCounts={index < DETAILED_CAPTAINS}
              onOpen={() => onOpenThread(scopeThreadRef(environmentId, captain.primaryThreadId))}
            />
          ))}
        </ul>
      ) : (
        <Text variant="body" tone="muted" render={<p />}>
          {isDuet ? (
            <T>No Duets yet. Create one to delegate work and get a daily brief.</T>
          ) : (
            <T>No Captains yet. Create one to delegate work and get a daily brief.</T>
          )}
        </Text>
      )}

      <DuetSection title={<T>Needs you</T>} count={items.length}>
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

      <DuetSection title={<T>In flight</T>}>
        <OverviewTaskList empty={<T>No delegated work is running.</T>}>
          {active.map(({ environmentId, captain, children }) => (
            <OverviewLocalTaskRows
              key={`${environmentId}:${captain.id}`}
              threads={[...children].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))}
              captainName={captain.name}
              nowMs={nowMs}
              onOpen={open(environmentId)}
            />
          ))}
          {detailed.map(({ environmentId, captain }) => (
            <OverviewRemoteActiveTaskRows
              key={`${environmentId}:${captain.id}`}
              parent={scopeThreadRef(environmentId, captain.primaryThreadId)}
              captainName={captain.name}
              nowMs={nowMs}
            />
          ))}
        </OverviewTaskList>
      </DuetSection>

      <DuetSection title={<T>Recently finished</T>}>
        <OverviewTaskList empty={<T>No delegated tasks finished recently.</T>}>
          {detailed.map(({ environmentId, captain }) => (
            <OverviewFinishedTaskRows
              key={`${environmentId}:${captain.id}`}
              parent={scopeThreadRef(environmentId, captain.primaryThreadId)}
              captainName={captain.name}
              nowMs={nowMs}
              limit={FINISHED_PER_CAPTAIN}
              onOpen={open(environmentId)}
            />
          ))}
        </OverviewTaskList>
      </DuetSection>

      <DuetSection title={<T>Morning briefs</T>}>
        {active.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
            {isDuet ? (
              <T>Create a Duet to delegate work and get a daily brief.</T>
            ) : (
              <T>Create a Captain to delegate work and get a daily brief.</T>
            )}
          </Text>
        )}
      </DuetSection>
    </div>
  );
}
