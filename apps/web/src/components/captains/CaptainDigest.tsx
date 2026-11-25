import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, CaptainDocument, EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { SunriseIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useId, useState, type ReactNode } from "react";

import { useDuetShell } from "../../hooks/useDuetShell";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Text } from "../ui/text";
import { captainMorningBriefTaskId, useCaptainMorningBrief } from "./captainMorningBrief";
import { captainCommandError } from "./useCaptain";

const DEFAULT_BRIEF_TIME = "08:00";

/** A Captain's DIGEST.md, rendered as prose, or a prompt to schedule the brief that writes it. */
export function CaptainDigest({
  document,
  environmentId,
  loading,
  action,
}: {
  document: CaptainDocument | undefined;
  environmentId: EnvironmentId;
  loading: boolean;
  action?: ReactNode;
}) {
  const content = document?.content.trim() ?? "";
  if (content !== "") {
    return (
      <article aria-label={document?.name} className="min-w-0">
        <ChatMarkdown text={content} cwd={undefined} environmentId={environmentId} />
      </article>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border p-4">
      <Text variant="body" tone="muted" render={<p />}>
        {loading ? (
          <T>Loading the brief…</T>
        ) : (
          <T>
            No brief yet. A morning brief writes DIGEST.md with progress, blockers and decisions.
          </T>
        )}
      </Text>
      {loading ? null : action}
    </div>
  );
}

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
  const canRun = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
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

  const refresh = async () => {
    if (task === undefined || pending) return;
    setPending(true);
    setError(null);
    const result = await runNow({ environmentId, input: { id: task.id } });
    setPending(false);
    if (result._tag === "Failure")
      setError(captainCommandError(result, gt("Could not run the morning brief.")));
  };

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="secondary" size="sm" />}>
        <SunriseIcon aria-hidden />
        {task === undefined ? (
          <T>Schedule morning brief</T>
        ) : task.enabled && scheduledTime !== null ? (
          gt("Morning brief at {time}", { time: scheduledTime })
        ) : (
          <T>Morning brief off</T>
        )}
      </PopoverTrigger>
      <PopoverPopup width="sm" align="end">
        <div className="flex flex-col gap-3">
          <Text variant="label" render={<h3 />}>
            <T>Morning brief</T>
          </Text>
          <Text variant="meta" tone="muted" render={<p />}>
            {isDuet ? (
              <T>Every day, this Duet updates DIGEST.md in its current conversation.</T>
            ) : (
              <T>Every day, the Captain updates DIGEST.md in its current conversation.</T>
            )}
          </Text>
          <label htmlFor={timeId} className="flex items-center justify-between gap-3">
            <Text variant="body">
              <T>Time</T>
            </Text>
            <Input
              id={timeId}
              type="time"
              nativeInput
              size="sm"
              className="w-32"
              disabled={!canSave || pending}
              value={shownTime}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <Text variant="body">
              <T>Enabled</T>
            </Text>
            <Switch
              checked={shownEnabled}
              disabled={!canSave || pending}
              onCheckedChange={(checked) => setEnabled(checked)}
            />
          </label>
          {error !== null ? (
            <Text variant="meta" tone="destructive" role="alert" render={<p />}>
              {error}
            </Text>
          ) : null}
          <div className="flex flex-wrap justify-end gap-1.5">
            {task !== undefined ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={!canRun || pending}
                onClick={() => void refresh()}
              >
                <T>Refresh now</T>
              </Button>
            ) : null}
            <Button size="sm" disabled={!canSave || pending} onClick={() => void save()}>
              <T>Save</T>
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
