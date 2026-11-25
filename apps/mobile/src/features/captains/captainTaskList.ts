import { captainDelegatedLocalTasks } from "@t3tools/client-runtime/state/captains";
import {
  captainLocalTaskStatus,
  captainTaskActivityMs,
  captainTaskDetail,
  captainTaskIsRecent,
  compareCaptainTasks,
  type CaptainTaskStatus,
} from "@t3tools/client-runtime/state/captain-tasks";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId } from "@t3tools/contracts";

export type CaptainTaskRange = "today" | "all";

export interface CaptainTaskRow {
  readonly thread: EnvironmentThreadShell;
  readonly status: CaptainTaskStatus;
  readonly detail: string | null;
  readonly updatedAtMs: number;
}

export interface CaptainTaskGroup {
  readonly environmentId: EnvironmentId;
  readonly captain: Captain;
  readonly rows: ReadonlyArray<CaptainTaskRow>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Each Captain's delegated tasks, newest activity first. Today keeps open work whatever its age and
 * outcomes from the last day; Captains with nothing to list are left out. Idle crew threads are
 * in `shells` only while their conversations' families are mounted (`useCaptainFamilies`).
 */
export function captainTaskGroups(input: {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly captains: ReadonlyArray<Captain>;
  }>;
  readonly shells: ReadonlyArray<EnvironmentThreadShell>;
  readonly range: CaptainTaskRange;
  readonly nowMs: number;
  readonly captainId?: string | undefined;
}): CaptainTaskGroup[] {
  const cutoffMs = input.nowMs - DAY_MS;
  return input.environments.flatMap(({ environmentId, captains }) =>
    captains.flatMap((captain) => {
      if (captain.archivedAt !== null) return [];
      if (input.captainId !== undefined && captain.id !== input.captainId) return [];
      const rows = captainDelegatedLocalTasks({
        environmentId,
        captain,
        shells: input.shells,
        subagents: [],
      })
        .flatMap(({ thread }) => {
          if (thread === null) return [];
          const status = captainLocalTaskStatus(thread, null);
          return [
            {
              thread,
              status,
              detail: captainTaskDetail({ status, thread }),
              updatedAtMs: captainTaskActivityMs({ status, thread }),
            },
          ];
        })
        .filter(
          (row) =>
            input.range === "all" || captainTaskIsRecent(row.status, row.updatedAtMs, cutoffMs),
        )
        .sort(compareCaptainTasks);
      return rows.length === 0 ? [] : [{ environmentId, captain, rows }];
    }),
  );
}
