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
  const [dismissedThreadKeys, setDismissedThreadKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  const compactionLimit = contextWindow?.autoCompactThreshold ?? contextWindow?.maxTokens ?? null;
  const compactionPercentage =
    contextWindow !== null && compactionLimit !== null && compactionLimit > 0
      ? (contextWindow.usedTokens / compactionLimit) * 100
      : null;
  const percent =
    compactionPercentage !== null && Number.isFinite(compactionPercentage)
      ? Math.round(Math.max(0, Math.min(100, compactionPercentage)))
      : null;
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

  const locked = compactionPercentage >= 90;
  if (!locked && dismissedThreadKeys.has(threadKey)) return resetDialog;

  const dismiss = () => {
    setDismissedThreadKeys((current) => {
      if (current.has(threadKey)) return current;
      const next = new Set(current);
      next.add(threadKey);
      return next;
    });
  };
  const item: ComposerBannerStackItem = {
    id: `captain-context-reset:${threadKey}`,
    variant: locked ? "warning" : "info",
    icon: <MessageSquarePlusIcon />,
    title: gt("This conversation is {percent}% of the way to automatic compaction.", { percent }),
    description: gt("Start a new one and NOTES.md, memories and running tasks carry over."),
    actions: (
      <Button size="xs" variant="secondary" onClick={() => setResetTarget({ captain, threadRef })}>
        <T>New conversation</T>
      </Button>
    ),
    ...(locked
      ? {}
      : {
          dismissLabel: gt("Dismiss compaction notice"),
          onDismiss: dismiss,
        }),
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
