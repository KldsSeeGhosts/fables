import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
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

/** Offers a fresh Duet conversation when the active one's context is nearly full. */
export function CaptainContextResetNotice({
  threadRef,
  usedPercentage,
  onOpenThread,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly usedPercentage: number | null;
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
  const percent =
    usedPercentage !== null && Number.isFinite(usedPercentage)
      ? Math.round(Math.max(0, Math.min(100, usedPercentage)))
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
    usedPercentage === null ||
    usedPercentage < 75
  ) {
    return resetDialog;
  }

  const locked = usedPercentage >= 90;
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
    title: gt("This conversation is {percent}% full.", { percent }),
    description: gt("Start a new one and NOTES.md, memories and running tasks carry over."),
    actions: (
      <Button size="xs" variant="secondary" onClick={() => setResetTarget({ captain, threadRef })}>
        <T>New conversation</T>
      </Button>
    ),
    ...(locked
      ? {}
      : {
          dismissLabel: gt("Dismiss context usage notice"),
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
