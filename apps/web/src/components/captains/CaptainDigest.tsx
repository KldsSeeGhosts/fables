import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { SunriseIcon } from "lucide-react";
import { useId, useState } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Text } from "../ui/text";
import {
  captainMorningBriefDefaultTime,
  captainMorningBriefTaskId,
  useCaptainMorningBrief,
} from "./captainMorningBrief";
import { captainCommandError } from "./useCaptain";

export const captainMorningBriefTask = (
  tasks: ReadonlyArray<ScheduledTask>,
  captain: Pick<Captain, "id">,
) => tasks.find((task) => task.id === captainMorningBriefTaskId(captain.id));

/** Schedules, reschedules or runs a Captain's recap. */
export function CaptainMorningBriefControl({
  captain,
  environmentId,
  thread,
  task,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  thread: EnvironmentThreadShell | undefined;
  task: ScheduledTask | undefined;
}) {
  const gt = useGT();
  const isDuet = useDuetShell();
  const timeId = useId();
  const morningBrief = useCaptainMorningBrief(environmentId);
  const canRun = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const scheduledTime = task?.schedule.type === "fixed_time" ? task.schedule.timeOfDay : null;
  const [time, setTime] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownTime = time ?? scheduledTime ?? captainMorningBriefDefaultTime(captain);
  const shownEnabled = enabled ?? task?.enabled ?? false;
  const canSave = morningBrief.canSave && thread !== undefined && captain.archivedAt === null;

  const save = async () => {
    if (thread === undefined || pending) return;
    setPending(true);
    setError(null);
    const result = await morningBrief.save({
      captain,
      thread,
      timeOfDay: shownTime,
      enabled: shownEnabled,
    });
    setPending(false);
    if (result?._tag === "Failure")
      setError(captainCommandError(result, gt("Could not save the recap.")));
    else {
      setTime(null);
      setEnabled(null);
    }
  };

  const run = async () => {
    if (task === undefined || pending) return;
    setPending(true);
    setError(null);
    const result = await runNow({ environmentId, input: { id: task.id } });
    setPending(false);
    if (result._tag === "Failure")
      setError(captainCommandError(result, gt("Could not run the recap.")));
  };

  const dirty = time !== null || enabled !== null;
  const shownError = error ?? (task?.lastRunStatus === "failed" ? task.lastRunError : null);
  return (
    <div className="rounded-lg border border-(--duet-hairline) px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <SunriseIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <Text variant="label" truncate render={<div />}>
            <T>Recap</T>
          </Text>
        </div>
        <Switch
          aria-label={gt("Enable recap")}
          checked={shownEnabled}
          disabled={!canSave || pending}
          onCheckedChange={(checked) => setEnabled(checked)}
        />
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2 ps-7">
        <Input
          id={timeId}
          aria-label={gt("Recap time")}
          type="time"
          nativeInput
          size="sm"
          className="w-32 shrink-0"
          disabled={!canSave || pending}
          value={shownTime}
          onChange={(event) => setTime(event.target.value)}
        />
        <div className="min-w-0">
          <Text variant="meta" tone="muted" truncate render={<div />}>
            {isDuet ? <T>Updates DIGEST.md each day.</T> : <T>Updates the Duet digest each day.</T>}
          </Text>
        </div>
      </div>
      {task !== undefined || dirty ? (
        <div className="mt-2 flex justify-end gap-1.5">
          {task !== undefined ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={!canRun || pending || captain.archivedAt !== null}
              onClick={() => void run()}
            >
              <T>Run now</T>
            </Button>
          ) : null}
          {dirty ? (
            <Button size="xs" disabled={!canSave || pending} onClick={() => void save()}>
              <T>Save</T>
            </Button>
          ) : null}
        </div>
      ) : null}
      {shownError !== null ? (
        <p role="alert" className="mt-2 text-meta text-destructive-foreground">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
