import {
  captainThreadActivity,
  fleetChorusCaptain,
  withoutStoredChoruses,
  type FleetChorusView,
} from "@t3tools/client-runtime/state/captains";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { Captain, EnvironmentId, FleetChorusState } from "@t3tools/contracts";

import { orderCaptainHomeRows } from "./captainHomeOrder";
import { captainShells, captainShellsByConversation } from "./captainShellIndex";

interface OverviewEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly captains: ReadonlyArray<Captain>;
}

export interface CaptainOverviewRow {
  readonly environment: Pick<OverviewEnvironment, "environmentId" | "label">;
  readonly captain: Captain;
  readonly activity: ReturnType<typeof captainThreadActivity>;
  readonly fleetState?: FleetChorusState;
  readonly hasCaptainRecord: boolean;
}

/** Fleet status supplies the only Chorus row. A synthesized row has no local tasks or digest. */
export function captainOverviewRows(
  environments: ReadonlyArray<OverviewEnvironment>,
  shells: ReadonlyArray<EnvironmentThreadShell>,
  fleet: FleetChorusView | null,
): CaptainOverviewRow[] {
  const indexed = captainShellsByConversation(shells);
  const activity = (environmentId: EnvironmentId, captain: Captain) =>
    captainThreadActivity(environmentId, captain, captainShells(indexed, environmentId, captain));
  const rows: CaptainOverviewRow[] = environments.flatMap((environment) =>
    withoutStoredChoruses(environment.captains)
      .filter((captain) => captain.archivedAt === null)
      .map((captain) => ({
        environment,
        captain,
        activity: activity(environment.environmentId, captain),
        hasCaptainRecord: true,
      })),
  );
  if (fleet !== null) {
    const { home, state } = fleet.status;
    const environmentId = home?.environmentId ?? fleet.viaEnvironmentId;
    const stored = environments
      .find((environment) => environment.environmentId === environmentId)
      ?.captains.find(
        (captain) =>
          captain.kind === "chorus" &&
          captain.archivedAt === null &&
          captain.primaryThreadId === home?.threadId,
      );
    rows.push({
      environment: { environmentId, label: home?.label ?? "" },
      captain: stored ?? fleetChorusCaptain(fleet.status),
      activity:
        stored !== undefined && state === "ready"
          ? activity(environmentId, stored)
          : { primary: undefined, children: [], attention: 0, working: false },
      fleetState: state,
      hasCaptainRecord: stored !== undefined,
    });
  }
  return orderCaptainHomeRows(rows);
}
