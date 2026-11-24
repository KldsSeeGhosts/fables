import { useAtom } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  captainDocument,
  captainForThread,
  captainInboxItems,
  captainScheduledTasks,
} from "@t3tools/client-runtime/state/captains";
import {
  CaptainDocumentName,
  type Captain,
  type EnvironmentId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { CalendarClockIcon, FileTextIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { ContentButton } from "../ui/button";
import { StatusDot } from "../ui/status-dot";
import { Text } from "../ui/text";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { CaptainActiveTasks, CaptainFinishedTaskRows, CaptainTaskList } from "./CaptainBriefPanel";
import { captainChannelViewAtom, type CaptainChannelView } from "./captainBriefTab";
import {
  CaptainDigest,
  CaptainMorningBriefControl,
  captainDigestPreview,
  captainMorningBriefTask,
} from "./CaptainDigest";
import { CaptainDocuments } from "./CaptainDocuments";
import { CaptainEarlierConversations } from "./CaptainEarlierConversations";
import { CaptainMemories } from "./CaptainMemories";
import { CaptainInboxCard } from "./CaptainsInbox";
import { useCaptainsDirectory } from "./captainsDirectory";
import { useOpenCaptainThread } from "./captainNavigation";
import { useCaptains } from "./useCaptain";

const VIEWS = ["chat", "tasks", "make"] as const satisfies ReadonlyArray<CaptainChannelView>;

/** The Duet switcher in a Captain conversation's header: Chat, Tasks or Make. */
export function CaptainChannelSwitcher({ threadRef }: { threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const [view, setView] = useAtom(captainChannelViewAtom(threadRef));
  const labels: Record<CaptainChannelView, string> = {
    chat: gt("Chat", { $context: "Captain view: the conversation" }),
    tasks: gt("Tasks", { $context: "Captain view: delegated work" }),
    make: gt("Make", { $context: "Captain view: briefs, documents and memory" }),
  };
  return (
    <ToggleGroup
      aria-label={gt("Captain view")}
      size="segmented-wide"
      value={[view]}
      onValueChange={(value) => {
        const next = VIEWS.find((entry) => entry === value[0]);
        if (next !== undefined) setView(next);
      }}
    >
      {VIEWS.map((entry) => (
        <Toggle key={entry} value={entry}>
          {labels[entry]}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function BoardSection({
  title,
  count,
  action,
  children,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-7 items-center gap-2">
        <Text variant="label" render={<h3 />}>
          {title}
        </Text>
        {count !== undefined && count > 0 ? (
          <Text variant="meta" tone="muted" numeric>
            {count}
          </Text>
        ) : null}
        {action ? <div className="ms-auto flex items-center gap-1.5">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function BoardCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-3 shadow-xs">{children}</div>;
}

function CaptainTasksBoard({
  captain,
  environmentId,
  onOpenThread,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { environments, shells } = useCaptainsDirectory();
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
    messages,
  );
  const tasks = tasksQuery.data?.tasks ?? [];
  const scheduled = captainScheduledTasks(tasks, captain);
  const parent = scopeThreadRef(environmentId, captain.primaryThreadId);
  const thread = shells.find(
    (shell) => shell.environmentId === environmentId && shell.id === captain.primaryThreadId,
  );
  const needsYou = captainInboxItems(environments, shells).filter(
    (item) => item.environmentId === environmentId && item.captainId === captain.id,
  );

  return (
    <>
      <BoardSection title={<T>Needs you</T>} count={needsYou.length}>
        {needsYou.length === 0 ? (
          <Text variant="body" tone="muted" render={<p />}>
            <T>Nothing is waiting on you.</T>
          </Text>
        ) : (
          <div className="flex flex-col gap-2">
            {needsYou.map((item) => (
              <CaptainInboxCard
                key={`${item.kind}:${item.threadRef.threadId}`}
                item={item}
                captain={captain}
                onReview={(threadRef) => onOpenThread(threadRef.threadId)}
              />
            ))}
          </div>
        )}
      </BoardSection>
      <BoardSection title={<T>In flight</T>}>
        <BoardCard>
          <CaptainActiveTasks parent={parent} onOpen={onOpenThread} />
        </BoardCard>
      </BoardSection>
      <BoardSection
        title={<T>Scheduled</T>}
        count={scheduled.length}
        action={
          <CaptainMorningBriefControl
            captain={captain}
            environmentId={environmentId}
            thread={thread}
            task={captainMorningBriefTask(tasks, captain)}
          />
        }
      >
        <BoardCard>
          {scheduled.length === 0 ? (
            <Text variant="meta" tone="muted" render={<p />}>
              <T>No scheduled tasks.</T>
            </Text>
          ) : (
            <ul className="space-y-1.5">
              {scheduled.map((task) => (
                <li key={task.id} className="flex min-w-0 items-center gap-2 px-2 py-1">
                  <CalendarClockIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <Text variant="body" truncate render={<span className="flex-1" />}>
                    {task.title}
                  </Text>
                  <StatusDot tone={task.enabled ? "info" : "neutral"} />
                  <Text variant="meta" tone="muted" truncate>
                    {task.enabled
                      ? scheduleLabel(
                          task.schedule,
                          timestampFormat,
                          undefined,
                          task.nextRunAt,
                          messages,
                        )
                      : gt("Paused")}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </BoardCard>
      </BoardSection>
      <BoardSection title={<T>Recently finished</T>}>
        <BoardCard>
          <CaptainTaskList empty={<T>No delegated tasks finished recently.</T>}>
            <CaptainFinishedTaskRows parent={parent} onOpen={onOpenThread} />
          </CaptainTaskList>
        </BoardCard>
      </BoardSection>
      {captain.earlierThreadIds.length > 0 ? (
        <BoardSection title={<T>Earlier conversations</T>}>
          <BoardCard>
            <CaptainEarlierConversations
              captain={captain}
              environmentId={environmentId}
              onOpen={onOpenThread}
            />
          </BoardCard>
        </BoardSection>
      ) : null}
    </>
  );
}

const KNOWLEDGE_DOCUMENTS = CaptainDocumentName.literals.filter((name) => name !== "DIGEST.md");

function CaptainMakeBoard({
  captain,
  environmentId,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const messages = useMessages();
  const details = useCaptains(environmentId, captain.id);
  const { shells } = useCaptainsDirectory();
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
    messages,
  );
  const [document, setDocument] = useState<CaptainDocumentName>("NOTES.md");
  const thread = shells.find(
    (shell) => shell.environmentId === environmentId && shell.id === captain.primaryThreadId,
  );
  const briefControl = (
    <CaptainMorningBriefControl
      captain={captain}
      environmentId={environmentId}
      thread={thread}
      task={captainMorningBriefTask(tasksQuery.data?.tasks ?? [], captain)}
    />
  );
  const loading = (
    <Text variant="body" tone="muted" render={<p />}>
      {details.error ?? <T>Loading Captain…</T>}
    </Text>
  );

  return (
    <>
      <section className="rounded-2xl border border-border bg-card px-6 py-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Text variant="meta" tone="muted" render={<h3 />}>
            <T>Morning brief</T>
          </Text>
          <div className="ms-auto">{briefControl}</div>
        </div>
        <CaptainDigest
          document={captainDocument(details.data, captain.id, "DIGEST.md")}
          environmentId={environmentId}
          loading={details.data === null}
        />
      </section>
      <BoardSection title={<T>Knowledge</T>}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {KNOWLEDGE_DOCUMENTS.map((name) => {
            const preview = captainDigestPreview(captainDocument(details.data, captain.id, name));
            return (
              <ContentButton
                key={name}
                variant="selection-card"
                aria-pressed={document === name}
                aria-label={gt("Open {name}", { name })}
                onClick={() => setDocument(name)}
              >
                <span className="flex min-h-24 flex-col gap-1.5 p-3">
                  <span className="flex items-center gap-1.5">
                    <FileTextIcon aria-hidden className="size-3.5 text-muted-foreground" />
                    <Text variant="label">{name}</Text>
                  </span>
                  <Text variant="meta" tone="muted" render={<span className="line-clamp-3" />}>
                    {preview !== "" ? preview : gt("Empty")}
                  </Text>
                </span>
              </ContentButton>
            );
          })}
        </div>
        {details.data === null ? (
          loading
        ) : (
          <CaptainDocuments
            captain={captain}
            environmentId={environmentId}
            documents={details.data.documents}
            refresh={details.refresh}
            selected={document}
            onSelect={setDocument}
          />
        )}
      </BoardSection>
      <BoardSection title={<T>Memory</T>}>
        {details.data === null ? (
          loading
        ) : (
          <CaptainMemories
            captainId={captain.id}
            environmentId={environmentId}
            memories={details.data.memories}
          />
        )}
      </BoardSection>
    </>
  );
}

/** A Captain conversation's Tasks or Make view, shown in the pane in place of the chat. */
export function CaptainChannelBoard({
  threadRef,
  view,
}: {
  threadRef: ScopedThreadRef;
  view: Exclude<CaptainChannelView, "chat">;
}) {
  const query = useCaptains(threadRef.environmentId);
  const openThread = useOpenCaptainThread();
  const captain = captainForThread(query.data, threadRef.threadId);
  return (
    <div
      data-captain-channel-board={view}
      className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto bg-background"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-8 pb-16">
        {captain === undefined ? (
          <Text variant="body" tone="muted" render={<p />}>
            {query.isPending ? <T>Loading Captain…</T> : <T>This conversation has no Captain.</T>}
          </Text>
        ) : view === "tasks" ? (
          <CaptainTasksBoard
            captain={captain}
            environmentId={threadRef.environmentId}
            onOpenThread={(threadId) =>
              openThread(scopeThreadRef(threadRef.environmentId, threadId))
            }
          />
        ) : (
          <CaptainMakeBoard captain={captain} environmentId={threadRef.environmentId} />
        )}
      </div>
    </div>
  );
}
