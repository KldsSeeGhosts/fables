import { useGT, useMessages } from "gt-react";
import { useState } from "react";
import * as Option from "effect/Option";
import {
  captainEarlierConversations,
  type Captain,
  type CaptainConversationEndReason,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { isCompleteTurnItemRow } from "@t3tools/client-runtime/state/threads";

import { useEnvironmentThreads } from "../../state/threads";
import {
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  type TimelineEntry,
} from "../../session-logic";

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
  readonly captain: Captain | undefined;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const key = input.threadRef === null ? null : threadKey(input.threadRef);
  const [expansion, setExpansion] = useState<{ key: string | null; count: number }>({
    key: null,
    count: 0,
  });
  const expandedCount = expansion.key === key ? expansion.count : 0;
  const threadRef = input.threadRef;
  const conversations =
    threadRef === null || input.captain === undefined
      ? []
      : captainEarlierConversations(input.captain)
          .slice(0, expandedCount)
          .reverse()
          .map((conversation) => ({
            ...conversation,
            ref: {
              environmentId: threadRef.environmentId,
              threadId: conversation.threadId,
            },
          }));
  const states = useEnvironmentThreads(conversations.map((conversation) => conversation.ref));

  const entries = (() => {
    const result: TimelineEntry[] = [];
    for (const [index, conversation] of conversations.entries()) {
      const state = states[index];
      const projection = state && Option.isSome(state.data) ? state.data.value : null;
      if (projection !== null) {
        const visibleTurnItems = projection.visibleTurnItems
          .filter(isCompleteTurnItemRow)
          .map((item) =>
            item.visibility === "local" ? { ...item, visibility: "inherited" as const } : item,
          );
        result.push(
          ...deriveTimelineEntriesFromVisibleTurnItemsWithState({
            visibleTurnItems,
            optimisticMessages: [],
            attempts: projection.attempts,
            nodes: projection.nodes,
            plans: projection.plans,
            resolve,
          }).entries,
        );
      }
      const lastEntry = result.at(-1);
      const detail = endReasonDetail(conversation.endReason, gt);
      result.push({
        id: `captain-earlier-divider:${conversation.threadId}`,
        kind: "conversation-divider",
        createdAt: lastEntry?.createdAt ?? input.captain?.updatedAt ?? "1970-01-01T00:00:00.000Z",
        label: gt("Earlier conversation"),
        ...(detail === undefined ? {} : { detail }),
      });
    }
    return result;
  })();

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
      if (input.captain === undefined || unexpandedCount === 0) return;
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
