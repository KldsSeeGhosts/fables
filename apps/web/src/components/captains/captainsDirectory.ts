import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

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
