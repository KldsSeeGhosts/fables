import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isOrchestrationV2WorkActive,
  type Captain,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { AlertTriangleIcon } from "lucide-react";
import { useState } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import { useQuietThreadProjection } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { captainCommandError } from "./useCaptain";

function RunningTasksWarning({
  captain,
  environmentId,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const projection = useQuietThreadProjection(
    scopeThreadRef(environmentId, captain.primaryThreadId),
  )?.projection;
  const count = (projection?.subagents ?? []).filter(
    (task) => task.origin === "app_owned" && isOrchestrationV2WorkActive(task.status),
  ).length;
  if (count === 0) return null;
  return (
    <Alert variant="warning" role="status">
      <AlertTriangleIcon aria-hidden />
      <AlertDescription>
        {captain.reportPolicy === "ignore"
          ? gt(
              "{count, plural, =1 {A delegated task is still running. It keeps running after the reset.} other {{count} delegated tasks are still running. They keep running after the reset.}}",
              { count },
            )
          : gt(
              "{count, plural, =1 {A delegated task is still running. Its report will show on the new conversation’s next turn.} other {{count} delegated tasks are still running. Their reports will show on the new conversation’s next turn.}}",
              { count },
            )}
      </AlertDescription>
    </Alert>
  );
}

/** Confirms starting a new Captain conversation; mount it only while it is open. */
export function CaptainResetDialog({
  captain,
  environmentId,
  onReset,
  onClose,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  onReset: (threadId: ThreadId) => void;
  onClose: () => void;
}) {
  const gt = useGT();
  const isDuet = useDuetShell();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = useAtomValue(
    serverEnvironment.resetCaptainConversation.permissionAtom(environmentId),
  );
  const reset = useAtomCommand(serverEnvironment.resetCaptainConversation, {
    reportFailure: false,
  });

  const submit = async () => {
    if (!allowed || saving) return;
    setSaving(true);
    setError(null);
    const result = await reset({
      environmentId,
      input: {
        captainId: captain.id,
        expectedThreadId: captain.primaryThreadId,
      },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      setError(captainCommandError(result, gt("Could not reset conversation.")));
    } else {
      onClose();
      onReset(result.value.primaryThreadId);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <T>Reset conversation?</T>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isDuet ? (
              <T>
                A new conversation will keep this Duet’s documents, memories and scheduled tasks.
                You can still open the earlier conversation.
              </T>
            ) : (
              <T>
                A new conversation will keep the Captain’s documents, memories and scheduled tasks.
                You can still open the earlier conversation.
              </T>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <RunningTasksWarning captain={captain} environmentId={environmentId} />
        {error ? (
          <p role="alert" className="text-body text-destructive-foreground">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            <T>Cancel</T>
          </Button>
          <Button disabled={saving || !allowed} onClick={() => void submit()}>
            <T>Reset conversation</T>
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
