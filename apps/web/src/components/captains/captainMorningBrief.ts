import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ScheduledTaskId, type Captain, type EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const MORNING_BRIEF_PROMPT =
  "Prepare a concise morning brief covering recent progress, open tasks, blockers, and decisions that need the user's attention. " +
  "Read DIGEST.md with captain_document_read, then update it with captain_document_write using the current revision.";

export const captainMorningBriefTaskId = (captainId: Captain["id"]) =>
  ScheduledTaskId.make(`captain-morning-brief:${captainId}`);

export function useCaptainMorningBrief(environmentId: EnvironmentId | null) {
  const gt = useGT();
  const canSave = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask);
  return {
    canSave,
    async save({
      captain,
      thread,
      timeOfDay,
      weekdays,
      enabled,
    }: {
      captain: Pick<Captain, "id" | "name" | "primaryThreadId" | "archivedAt">;
      thread: Pick<
        EnvironmentThreadShell,
        "environmentId" | "id" | "projectId" | "modelSelection" | "runtimeMode" | "interactionMode"
      >;
      timeOfDay: string;
      weekdays?: ReadonlyArray<number>;
      enabled: boolean;
    }) {
      if (
        environmentId === null ||
        !canSave ||
        captain.archivedAt !== null ||
        thread.environmentId !== environmentId ||
        thread.id !== captain.primaryThreadId
      )
        return null;

      return upsert({
        environmentId,
        input: {
          id: captainMorningBriefTaskId(captain.id),
          title: gt("Morning brief for {name}", { name: captain.name }),
          prompt: MORNING_BRIEF_PROMPT,
          enabled,
          schedule: {
            type: "fixed_time",
            timeOfDay,
            ...(weekdays === undefined ? {} : { weekdays }),
          },
          projectId: thread.projectId,
          threadId: captain.primaryThreadId,
          threadMode: "continue",
          workspaceStrategy: { type: "root" },
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          creationSource: "web",
        },
      });
    },
  };
}
