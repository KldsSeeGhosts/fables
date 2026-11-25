/* oxlint-disable t3code/no-dot-separated-text -- The Duet schedule row uses the requested compact "Morning brief · time" label. */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, CaptainDocument, EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { SunriseIcon } from "lucide-react";
import { useId, useState } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Text } from "../ui/text";
import { captainMorningBriefTaskId, useCaptainMorningBrief } from "./captainMorningBrief";
import { captainCommandError } from "./useCaptain";

const DEFAULT_BRIEF_TIME = "08:00";

/** The first lines of a digest as plain text, for previews. */
export function captainDigestPreview(document: CaptainDocument | undefined) {
  return (document?.content ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s?)/u, "").trim())
    .filter((line) => line !== "")
    .join(" ");
}

export const captainMorningBriefTask = (
  tasks: ReadonlyArray<ScheduledTask>,
  captain: Pick<Captain, "id">,
) => tasks.find((task) => task.id === captainMorningBriefTaskId(captain.id));

/** Schedules, reschedules or runs a Captain's morning brief. */
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
  const scheduledTime = task?.schedule.type === "fixed_time" ? task.schedule.timeOfDay : null;
  const [time, setTime] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownTime = time ?? scheduledTime ?? DEFAULT_BRIEF_TIME;
  const shownEnabled = enabled ?? task?.enabled ?? true;
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
      setError(captainCommandError(result, gt("Could not save the morning brief.")));
    else {
      setTime(null);
      setEnabled(null);
    }
  };

  const dirty = time !== null || enabled !== null;
  const timeLabel = new Date(`2024-01-01T${shownTime}:00`).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="rounded-lg border border-(--duet-hairline) px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <SunriseIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <Text variant="label" truncate render={<div />}>
            {gt("Morning brief · {time}", { time: timeLabel })}
          </Text>
          <Text variant="meta" tone="muted" render={<div />}>
            {isDuet ? (
              <T>Updates DIGEST.md each day.</T>
            ) : (
              <T>Updates the Captain digest each day.</T>
            )}
          </Text>
        </div>
        <Input
          id={timeId}
          aria-label={gt("Morning brief time")}
          type="time"
          nativeInput
          size="sm"
          className="w-28"
          disabled={!canSave || pending}
          value={shownTime}
          onChange={(event) => setTime(event.target.value)}
        />
        <Switch
          aria-label={gt("Enable morning brief")}
          checked={shownEnabled}
          disabled={!canSave || pending}
          onCheckedChange={(checked) => setEnabled(checked)}
        />
      </div>
      {dirty ? (
        <div className="mt-2 flex justify-end">
          <Button size="xs" disabled={!canSave || pending} onClick={() => void save()}>
            <T>Save</T>
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <p role="alert" className="mt-2 text-meta text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
