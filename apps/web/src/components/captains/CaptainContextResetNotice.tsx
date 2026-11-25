import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { Captain, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { ComposerBanner } from "../chat/ComposerBanner";
import { ComposerBannerStack, type ComposerBannerStackItem } from "../chat/ComposerBannerStack";
import { CaptainResetDialog } from "./CaptainResetButton";
import { useCaptain } from "./useCaptain";

const CONTEXT_NOTICE_MARKS = [75, 90, 97] as const;
type ContextNoticeMark = (typeof CONTEXT_NOTICE_MARKS)[number];

/** Offers a fresh Duet conversation when the active one is nearing automatic compaction. */
export function CaptainContextResetNotice({
  threadRef,
  contextWindow,
  onOpenThread,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly contextWindow: Pick<
    ContextWindowSnapshot,
    "usedTokens" | "maxTokens" | "autoCompactThreshold"
  > | null;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const gt = useGT();
  const captain = useCaptain(threadRef);
  const canReset = useAtomValue(
    serverEnvironment.resetCaptainConversation.permissionAtom(threadRef?.environmentId ?? null),
  );
  const [resetTarget, setResetTarget] = useState<{
    readonly captain: Captain;
    readonly threadRef: ScopedThreadRef;
  } | null>(null);
  const [dismissedMarkByThreadKey, setDismissedMarkByThreadKey] = useState<
    Readonly<Record<string, ContextNoticeMark>>
  >(() => ({}));
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  // No threshold means the provider does not report one or compaction is off; measure the window.
  const compacts = contextWindow?.autoCompactThreshold != null;
  const compactionLimit = contextWindow?.autoCompactThreshold ?? contextWindow?.maxTokens ?? null;
  const compactionPercentage =
    contextWindow !== null && compactionLimit !== null && compactionLimit > 0
      ? (contextWindow.usedTokens / compactionLimit) * 100
      : null;
  const percent =
    compactionPercentage !== null && Number.isFinite(compactionPercentage)
      ? Math.round(Math.max(0, Math.min(100, compactionPercentage)))
      : null;
  const noticeMark =
    compactionPercentage === null || compactionPercentage < CONTEXT_NOTICE_MARKS[0]
      ? null
      : compactionPercentage >= CONTEXT_NOTICE_MARKS[2]
        ? CONTEXT_NOTICE_MARKS[2]
        : compactionPercentage >= CONTEXT_NOTICE_MARKS[1]
          ? CONTEXT_NOTICE_MARKS[1]
          : CONTEXT_NOTICE_MARKS[0];
  const resetDialog = resetTarget ? (
    <CaptainResetDialog
      captain={resetTarget.captain}
      environmentId={resetTarget.threadRef.environmentId}
      onClose={() => setResetTarget(null)}
      onReset={onOpenThread}
    />
  ) : null;

  if (
    threadRef === null ||
    threadKey === null ||
    captain === undefined ||
    captain.primaryThreadId !== threadRef.threadId ||
    captain.archivedAt !== null ||
    !canReset ||
    percent === null ||
    compactionPercentage === null ||
    compactionPercentage < 75
  ) {
    return resetDialog;
  }

  const warning = compactionPercentage >= 90;
  const dismissedMark = dismissedMarkByThreadKey[threadKey];
  if (noticeMark === null || (dismissedMark !== undefined && noticeMark <= dismissedMark)) {
    return resetDialog;
  }

  const dismiss = () => {
    setDismissedMarkByThreadKey((current) => {
      if (current[threadKey] === noticeMark) return current;
      return { ...current, [threadKey]: noticeMark };
    });
  };
  const item: ComposerBannerStackItem = {
    id: `captain-context-reset:${threadKey}`,
    variant: warning ? "warning" : "info",
    icon: <MessageSquarePlusIcon />,
    title: compacts
      ? gt("This conversation is {percent}% of the way to automatic compaction.", { percent })
      : gt("This conversation is {percent}% full.", { percent }),
    description: gt("Start a new one and NOTES.md, memories and running tasks carry over."),
    actions: (
      <Button size="xs" variant="secondary" onClick={() => setResetTarget({ captain, threadRef })}>
        <T>New conversation</T>
      </Button>
    ),
    dismissLabel: compacts ? gt("Dismiss compaction notice") : gt("Dismiss context usage notice"),
    onDismiss: dismiss,
  };

  return (
    <>
      <ComposerBanner.Dock>
        <ComposerBannerStack items={[item]} />
      </ComposerBanner.Dock>
      {resetDialog}
    </>
  );
}
