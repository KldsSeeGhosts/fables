import { useGT, useMessages } from "gt-react";
import { useState } from "react";
import * as Option from "effect/Option";
import {
  captainEarlierConversations,
  type Captain,
  type CaptainConversationEndReason,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { isCompleteTurnItemRow } from "@t3tools/client-runtime/state/threads";

import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
import { useEnvironmentThread, useEnvironmentThreadRetry } from "../../state/threads";
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
  readonly followedFrom?: ThreadId | undefined;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const key = input.threadRef === null ? null : threadKey(input.threadRef);
  const [expansion, setExpansion] = useState<{
    key: string | null;
    count: number;
    snapshots: ReadonlyArray<EnvironmentThreadState>;
  }>({ key: null, count: 0, snapshots: [] });
  const threadRef = input.threadRef;
  const history = input.captain ? captainEarlierConversations(input.captain) : [];
  const expandedCount =
    expansion.key === key
      ? expansion.count
      : Number(
          input.followedFrom !== undefined &&
            history.some((item) => item.threadId === input.followedFrom),
        );
  const conversations =
    threadRef === null
      ? []
      : history.slice(0, expandedCount).map((conversation) => ({
          ...conversation,
          ref: { environmentId: threadRef.environmentId, threadId: conversation.threadId },
        }));
  // Once a conversation has been paged through, keep its snapshot and release its live stream.
  const oldest = conversations.at(-1);
  const detailState = useEnvironmentThread(
    oldest?.ref.environmentId ?? null,
    oldest?.ref.threadId ?? null,
  );
  const retry = useEnvironmentThreadRetry(oldest?.ref ?? null);
  const snapshots = expansion.key === key ? expansion.snapshots : [];
  const missing = oldest !== undefined && Option.isNone(detailState.data);
  const failed = missing && (detailState.status === "deleted" || Option.isSome(detailState.error));
  const loading = missing && !failed;

  const entries = (() => {
    const result: TimelineEntry[] = [];
    for (const [index, conversation] of [...conversations.entries()].reverse()) {
      const state = conversation === oldest ? detailState : snapshots[index];
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
      if (projection === null) continue;
      const lastEntry = result.at(-1);
      const detail = endReasonDetail(conversation.endReason, gt);
      result.push({
        id: `captain-earlier-divider:${conversation.threadId}`,
        kind: "conversation-divider",
        createdAt: lastEntry?.createdAt ?? "1970-01-01T00:00:00.000Z",
        label: gt("Earlier conversation"),
        ...(detail === undefined ? {} : { detail }),
      });
    }
    return result;
  })();

  const unexpandedCount = Math.max(0, history.length - expandedCount);
  return {
    entries,
    expandedCount,
    unexpandedCount,
    loading,
    failed,
    retry,
    expand: () => {
      if (unexpandedCount === 0 || missing) return;
      setExpansion({
        key,
        count: expandedCount + 1,
        snapshots: oldest === undefined ? snapshots : [...snapshots, detailState],
      });
    },
    oldestExpanded: oldest === undefined ? null : { ref: oldest.ref, state: detailState },
  };
}
