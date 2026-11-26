import { useGT, useLocale, useMessages } from "gt-react-native";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import * as Option from "effect/Option";
import {
  captainEarlierConversations,
  type Captain,
  type CaptainConversationEndReason,
  type OrchestrationV2ProjectedTurnItem,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";

import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
import {
  EMPTY_CAPTAIN_ROUTE_ROLLOVER,
  trackCaptainRouteRollover,
} from "@t3tools/client-runtime/state/captains";
import { moveThreadComposerDraft } from "../../state/use-composer-drafts";
import { useEnvironmentThread, useEnvironmentThreadRetry } from "../../state/threads";
import { scopedThreadKey } from "../../lib/scopedEntities";
import {
  buildThreadFeed,
  createThreadFeedCache,
  type ThreadFeedEntry,
} from "../../lib/threadActivity";

export function useCaptainThreadRouteRollover(input: {
  readonly thread: ScopedThreadRef | null;
  readonly isPrimary: boolean;
  readonly replacement: ThreadId | undefined;
  readonly focused: boolean;
  readonly follow: (thread: ScopedThreadRef) => void;
}) {
  const [rollover, setRollover] = useState(EMPTY_CAPTAIN_ROUTE_ROLLOVER);
  const routeRollover = trackCaptainRouteRollover(
    rollover,
    input.thread,
    input.isPrimary,
    input.replacement,
  );
  if (routeRollover !== rollover) setRollover(routeRollover);
  const { following } = routeRollover;
  const moveDraftAndFollow = useEffectEvent((next: ScopedThreadRef) => {
    if (input.thread === null) return;
    void moveThreadComposerDraft(
      scopedThreadKey(input.thread.environmentId, input.thread.threadId),
      scopedThreadKey(next.environmentId, next.threadId),
    );
    input.follow(next);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the draft and follows a Duet's live rollover on the focused route
  useEffect(() => {
    if (input.focused && following !== null) moveDraftAndFollow(following);
  }, [input.focused, following]);
  return routeRollover;
}

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
  readonly followedFrom?: ThreadId | undefined;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const locale = useLocale();
  const key =
    input.threadRef === null
      ? null
      : scopedThreadKey(input.threadRef.environmentId, input.threadRef.threadId);
  const [expansion, setExpansion] = useState<{
    key: string | null;
    count: number;
    snapshots: ReadonlyArray<EnvironmentThreadState>;
  }>({ key: null, count: 0, snapshots: [] });
  const { feedCaches } = useMemo(
    () => ({
      key,
      feedCaches: new Map<
        string,
        {
          readonly cache: ReturnType<typeof createThreadFeedCache>;
          readonly source: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
          readonly rows: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
        }
      >(),
    }),
    [key],
  );
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

  const entries = useMemo(() => {
    const result: ThreadFeedEntry[] = [];
    for (const [index, conversation] of [...conversations.entries()].reverse()) {
      const state = conversation === oldest ? detailState : snapshots[index];
      const projection = state && Option.isSome(state.data) ? state.data.value : null;
      if (projection !== null) {
        const cacheKey = scopedThreadKey(conversation.ref.environmentId, conversation.ref.threadId);
        let cached = feedCaches.get(cacheKey);
        if (cached?.source !== projection.visibleTurnItems) {
          cached = {
            cache: cached?.cache ?? createThreadFeedCache(),
            source: projection.visibleTurnItems,
            rows: projection.visibleTurnItems.map((item) =>
              item.visibility === "local" ? { ...item, visibility: "inherited" as const } : item,
            ),
          };
          feedCaches.set(cacheKey, cached);
        }
        result.push(
          ...buildThreadFeed(cached.rows, {
            attempts: projection.attempts,
            nodes: projection.nodes,
            cache: cached.cache,
            resolve,
            locale,
          }),
        );
      }
      if (projection === null) continue;
      const lastEntry = result.at(-1);
      const detail = endReasonDetail(conversation.endReason, gt);
      result.push({
        type: "conversation-divider",
        id: `captain-earlier-divider:${conversation.threadId}`,
        createdAt: lastEntry?.createdAt ?? "1970-01-01T00:00:00.000Z",
        label: gt("Earlier conversation"),
        ...(detail === undefined ? {} : { detail }),
      });
    }
    return result;
  }, [conversations, oldest, detailState, snapshots, feedCaches, resolve, locale, gt]);

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
