import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { Captain, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { ContentButton } from "../ui/button";
import { useQuietThreadShell } from "../../state/entities";

function EarlierConversation({
  environmentId,
  threadId,
  number,
  onOpen,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  number: number;
  onOpen: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const thread = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  return (
    <li>
      <ContentButton variant="inset-row-multiline" onClick={() => onOpen(threadId)}>
        <span className="min-w-0 flex-1 truncate text-body">
          {thread?.title ?? gt("Conversation {number}", { number })}
        </span>
        {thread ? (
          <time className="text-micro text-muted-foreground" dateTime={thread.createdAt}>
            {new Date(thread.createdAt).toLocaleString()}
          </time>
        ) : null}
      </ContentButton>
    </li>
  );
}

export function CaptainEarlierConversations({
  captain,
  environmentId,
  onOpen,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  onOpen: (threadId: ThreadId) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {captain.earlierThreadIds.map((threadId, index) => (
        <EarlierConversation
          key={threadId}
          environmentId={environmentId}
          threadId={threadId}
          number={captain.earlierThreadIds.length - index}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}
