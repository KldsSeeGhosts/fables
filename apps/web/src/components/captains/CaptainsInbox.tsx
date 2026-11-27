import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainInboxItems,
  captainThreadActivity,
  type CaptainInboxItem,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId, FleetChorusHome, ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT, useLocale } from "gt-react";
import { GitForkIcon, MessageCircleQuestionIcon, PlusIcon, ShieldAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useTimeOfDayGreeting } from "../chat/ChatHero";
import { Button, ContentButton } from "../ui/button";
import { Text } from "../ui/text";
import { ApprovalBoundaryCard } from "./ApprovalBoundaryCard";
import { CaptainAvatar } from "./CaptainAvatar";
import type { CaptainChannelEnvironment } from "./captainsDirectory";
import {
  OverviewFinishedTaskRows,
  OverviewLocalTaskRows,
  OverviewRemoteActiveTaskRows,
  OverviewTaskList,
  useOverviewRemoteTaskCounts,
} from "./CaptainsOverviewTasks";
import { MorningBriefs } from "./MorningBriefs";

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
            name: captain?.name ?? gt("a Duet"),
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
              <span className="flex min-w-0 items-center gap-2">
                <Text variant="label" truncate>
                  {captain.name}
                </Text>
              </span>
              {captain.role ? (
                <Text variant="meta" tone="muted" truncate>
                  {captain.role}
                </Text>
              ) : null}
            </span>
            <Text variant="body" tone="muted" truncate>
              {status}
            </Text>
            {runningCount > 0 || waitingCount > 0 ? (
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta">
                {runningCount > 0 ? (
                  <span className="text-(--duet-working-text) tabular-nums">
                    {gt("{count} running", { count: runningCount })}
                  </span>
                ) : null}
                {waitingCount > 0 ? (
                  <span className="text-(--duet-needs-input-text) tabular-nums">
                    {gt("{count} waiting", { count: waitingCount })}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        </span>
      </ContentButton>
    </li>
  );
}

/** What every Captain has waiting, running and recently done, in one editorial column. */
export function CaptainsInbox({
  environments,
  chorusHome,
  shells,
  onOpenThread,
  onOpenCaptain,
  onCreate,
}: {
  environments: ReadonlyArray<CaptainChannelEnvironment>;
  chorusHome: FleetChorusHome | null;
  shells: ReadonlyArray<EnvironmentThreadShell>;
  onOpenThread: (threadRef: ScopedThreadRef) => void;
  /** Opens a Captain's conversation. */
  onOpenCaptain: (environmentId: EnvironmentId, captain: Captain) => void;
  onCreate?: (() => void) | undefined;
}) {
  const gt = useGT();
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
    .flatMap(({ environmentId, label, captains }) =>
      captains.flatMap((captain) =>
        captain.archivedAt === null &&
        (captain.kind !== "chorus" ||
          (chorusHome?.environmentId === environmentId &&
            chorusHome.threadId === captain.primaryThreadId))
          ? [
              {
                environmentId,
                label,
                captain,
                ...captainThreadActivity(environmentId, captain, shells),
              },
            ]
          : [],
      ),
    )
    .toSorted(
      (a, b) =>
        Number(b.captain.kind === "chorus") - Number(a.captain.kind === "chorus") ||
        Number(b.attention > 0) - Number(a.attention > 0) ||
        Number(b.working) - Number(a.working) ||
        b.captain.updatedAt.localeCompare(a.captain.updatedAt),
    );
  const duets = active.filter(({ captain }) => captain.kind === "duet");
  const detailed = active.slice(0, DETAILED_CAPTAINS);
  const open = (environmentId: EnvironmentId) => (threadId: ScopedThreadRef["threadId"]) =>
    onOpenThread(scopeThreadRef(environmentId, threadId));

  return (
    <div className="@container mx-auto flex w-full max-w-4xl flex-col gap-9 px-6 pt-12 pb-20">
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
              {gt("{count, plural, one {{count} Duet} other {{count} Duets}}", {
                count: duets.length,
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
            <T>New Duet</T>
          </Button>
        ) : null}
      </header>

      {duets.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3">
          {duets.map(({ environmentId, captain, children, attention, working }, index) => (
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
          <T>No Duets yet. Create one to delegate work and get recaps.</T>
        </Text>
      )}

      <DuetSection title=<T>Needs you</T> count={items.length}>
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

      <DuetSection title=<T>In flight</T>>
        <OverviewTaskList empty=<T>No delegated work is running.</T>>
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

      <DuetSection title=<T>Recently finished</T>>
        <OverviewTaskList empty=<T>No delegated tasks finished recently.</T>>
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

      <DuetSection title=<T>Recaps</T>>
        {active.length > 0 ? (
          <MorningBriefs duets={active} now={now} onOpenCaptain={onOpenCaptain} />
        ) : (
          <Text variant="body" tone="muted" render={<p />}>
            <T>Create a Duet to delegate work and get recaps.</T>
          </Text>
        )}
      </DuetSection>
    </div>
  );
}
