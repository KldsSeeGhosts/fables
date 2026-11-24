import { useAtomValue } from "@effect/atom-react";
import type { Captain, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";

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
import { Button } from "../ui/button";
import { captainCommandError } from "./useCaptain";

export function CaptainResetButton({
  captain,
  environmentId,
  onReset,
  compact = false,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  onReset: (threadId: ThreadId) => void;
  compact?: boolean;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      onReset(result.value.primaryThreadId);
    }
  };

  return (
    <>
      <Button
        size={compact ? "icon-xs" : "sm"}
        variant={compact ? "ghost" : "secondary"}
        disabled={!allowed || captain.archivedAt !== null}
        title={gt("Reset conversation")}
        aria-label={gt("Reset conversation")}
        onClick={() => setOpen(true)}
      >
        <RotateCcwIcon />
        {compact ? null : <T>Reset conversation</T>}
      </Button>
      {open ? (
        <AlertDialog
          open
          onOpenChange={(next) => {
            if (!next && !saving) {
              setError(null);
              setOpen(false);
            }
          }}
        >
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <T>Reset conversation?</T>
              </AlertDialogTitle>
              <AlertDialogDescription>
                <T>
                  A new conversation will keep the Captain’s documents, memories and scheduled
                  tasks. You can still open the earlier conversation.
                </T>
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error ? (
              <p role="alert" className="text-body text-destructive-foreground">
                {error}
              </p>
            ) : null}
            <AlertDialogFooter>
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setError(null);
                  setOpen(false);
                }}
              >
                <T>Cancel</T>
              </Button>
              <Button disabled={saving || !allowed} onClick={() => void submit()}>
                <T>Reset conversation</T>
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      ) : null}
    </>
  );
}
