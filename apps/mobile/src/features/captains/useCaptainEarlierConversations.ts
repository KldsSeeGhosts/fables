import { useGT, useLocale, useMessages } from "gt-react-native";
import { useMemo, useState } from "react";
import * as Option from "effect/Option";
import {
  captainEarlierConversations,
  type Captain,
  type CaptainConversationEndReason,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import { useEnvironmentThreads } from "../../state/threads";
import { scopedThreadKey } from "../../lib/scopedEntities";
import {
  buildThreadFeed,
  createThreadFeedCache,
  type ThreadFeedEntry,
} from "../../lib/threadActivity";

function endReasonDetail(
  reason: CaptainConversationEndReason,
  gt: ReturnType<typeof useGT>,
): string | undefined {
  switch (reason) {
    case "context_overflow":
      return gt("context full");
    case "compaction_failed":
      return gt("compaction failed");
    case "threshold":
      return gt("context threshold reached");
    case "manual":
      return undefined;
  }
}

export function useCaptainEarlierConversations(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly captain: Captain | null;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const locale = useLocale();
  const key =
    input.threadRef === null
      ? null
      : scopedThreadKey(input.threadRef.environmentId, input.threadRef.threadId);
  const [expansion, setExpansion] = useState<{ key: string | null; count: number }>({
    key: null,
    count: 0,
  });
  const [feedCache] = useState(createThreadFeedCache);
  const expandedCount = expansion.key === key ? expansion.count : 0;
  const conversations = useMemo(() => {
    const threadRef = input.threadRef;
    if (threadRef === null || input.captain === null) return [];
    return captainEarlierConversations(input.captain)
      .slice(0, expandedCount)
      .reverse()
      .map((conversation) => ({
        ...conversation,
        ref: {
          environmentId: threadRef.environmentId,
          threadId: conversation.threadId,
        },
      }));
  }, [input.threadRef, input.captain, expandedCount]);
  const states = useEnvironmentThreads(conversations.map((conversation) => conversation.ref));

  const entries = useMemo(() => {
    const result: ThreadFeedEntry[] = [];
    for (const [index, conversation] of conversations.entries()) {
      const state = states[index];
      const projection = state && Option.isSome(state.data) ? state.data.value : null;
      if (projection !== null) {
        const visibleTurnItems = projection.visibleTurnItems.map((item) =>
          item.visibility === "local" ? { ...item, visibility: "inherited" as const } : item,
        );
        result.push(
          ...buildThreadFeed(visibleTurnItems, {
            attempts: projection.attempts,
            nodes: projection.nodes,
            cache: feedCache,
            resolve,
            locale,
          }),
        );
      }
      const lastEntry = result.at(-1);
      const detail = endReasonDetail(conversation.endReason, gt);
      result.push({
        type: "conversation-divider",
        id: `captain-earlier-divider:${conversation.threadId}`,
        createdAt: lastEntry?.createdAt ?? input.captain?.updatedAt ?? "1970-01-01T00:00:00.000Z",
        label: gt("Earlier conversation"),
        ...(detail === undefined ? {} : { detail }),
      });
    }
    return result;
  }, [conversations, states, feedCache, resolve, locale, gt, input.captain?.updatedAt]);

  const unexpandedCount = Math.max(
    0,
    (input.captain?.earlierThreadIds.length ?? 0) - expandedCount,
  );
  const loading =
    expandedCount > 0 &&
    states.some((state) => state.status === "empty" || state.status === "synchronizing");
  return {
    entries,
    expandedCount,
    unexpandedCount,
    loading,
    expand: () => {
      if (input.captain === null || unexpandedCount === 0) return;
      setExpansion({ key, count: expandedCount + 1 });
    },
    oldestExpanded:
      conversations.length === 0
        ? null
        : {
            ref: conversations[0]!.ref,
            state: states[0] ?? null,
          },
  };
}
