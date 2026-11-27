import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationReadScope, type Captain, type EnvironmentId } from "@t3tools/contracts";
import { selectFleetChorus, type FleetChorusView } from "@t3tools/client-runtime/state/captains";
import { AsyncResult } from "effect/reactivity";
import { useContext } from "react";

import { useThreadShells } from "../../state/entities";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";

const captainResults = environmentAtomList("captain-shelf:environments", (environmentId) =>
  serverEnvironment.captainsLive({ environmentId, input: {} }),
);
const createPermissions = environmentAtomList("captain-shelf:create", (environmentId) =>
  serverEnvironment.createCaptain.permissionAtom(environmentId),
);
const fleetChorusResults = environmentAtomList("captain-shelf:fleet-chorus", (environmentId) =>
  serverEnvironment.fleetChorusLive({ environmentId, input: {} }),
);

/** Connected environments that can list Captains, with each one's live Captain list. */
export function useCaptainEnvironments() {
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const supporting = environments.filter(
    ({ environmentId, serverConfig }) =>
      readable.has(environmentId) && serverConfig?.environment.capabilities.captains === true,
  );
  const key = environmentIdsKey(supporting.map(({ environmentId }) => environmentId));
  const results = useAtomValue(captainResults(key));
  return { supporting, key, results };
}

/** The one fleet Chorus projection, chosen from the connected servers that understand it. */
export function useFleetChorusStatus() {
  const registry = useContext(RegistryContext);
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const fleetEnvironments = environments.filter(
    ({ environmentId, serverConfig }) =>
      readable.has(environmentId) && serverConfig?.environment.capabilities.fleetChorus === true,
  );
  const environmentIds = fleetEnvironments.map(({ environmentId }) => environmentId);
  const key = environmentIdsKey(environmentIds);
  const results = useAtomValue(fleetChorusResults(key));
  const fleet = selectFleetChorus(
    fleetEnvironments.map(({ environmentId, connection }, index) => ({
      environmentId,
      connected: connection.phase === "connected",
      status: AsyncResult.getOrElse(results[index]!, () => null),
    })),
  );
  return {
    fleet,
    refresh: () => {
      for (const environmentId of environmentIds) {
        registry.refresh(serverEnvironment.fleetChorusLive({ environmentId, input: {} }));
      }
    },
  };
}

export function useFleetChorus(): FleetChorusView | null {
  return useFleetChorusStatus().fleet;
}

/** Where a new Captain can be created, preferring the primary environment. */
export function useCaptainDestinations(primaryEnvironmentId: EnvironmentId | null) {
  const { supporting, key } = useCaptainEnvironments();
  const permissions = useAtomValue(createPermissions(key));
  const destinations = supporting.flatMap(({ environmentId, label }, index) =>
    permissions[index] ? [{ id: environmentId, label }] : [],
  );
  return {
    destinations,
    destination: destinations.find(({ id }) => id === primaryEnvironmentId) ?? destinations[0],
  };
}

/** One environment's Captains, as the Captains page lists them. */
export interface CaptainChannelEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly captains: ReadonlyArray<Captain>;
}

/** Every Captain on every environment, with the thread shells their activity comes from. */
export function useCaptainsDirectory() {
  const { supporting, results } = useCaptainEnvironments();
  const shells = useThreadShells(supporting.length > 0);
  const environments = supporting.map(({ environmentId, label }, index) => ({
    environmentId,
    label,
    loading: AsyncResult.isInitial(results[index]!),
    captains: AsyncResult.getOrElse(results[index]!, () => null)?.captains ?? [],
  }));
  return { environments, shells };
}
