import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  captainConversationKeys,
  captainForEarlierConversation,
  captainForThread,
  selectFleetChorus,
  type FleetChorusView,
} from "@t3tools/client-runtime/state/captains";
import {
  AuthOrchestrationReadScope,
  isCaptainThreadId,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { AsyncResult } from "effect/reactivity";
import { useContext, useEffect } from "react";

import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { useAtomValueWhileVisible } from "../home/home-route-visibility";
import {
  useEnvironmentScope,
  useEnvironmentsDenyingScope,
  useEnvironmentsWithScope,
} from "../../state/session";
import {
  liveCaptainEnvironments,
  resolveCaptainEnvironments,
  type CaptainEnvironment,
} from "./captainEnvironments";
import { cachedCaptainsAtom, cachedCaptainsOf, persistCaptains } from "./captainsCache";

export type { CaptainEnvironment } from "./captainEnvironments";

const NO_SHELLS: ReadonlyArray<EnvironmentThreadShell> = [];

/** Every connected environment that runs Captains, with its live Captains and their status. */
export function useCaptainEnvironments(environmentId?: EnvironmentId | null) {
  const { environments } = useEnvironments();
  const scope = environmentId ?? null;
  const candidates = environments
    .filter((environment) => scope === null || environment.environmentId === scope)
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      captainsCapability: environment.serverConfig?.environment.capabilities.captains,
    }));
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const denied = useEnvironmentsDenyingScope(environments, AuthOrchestrationReadScope);
  const live = useAtomValue(
    serverEnvironment.captainsLiveAcross(
      JSON.stringify(
        liveCaptainEnvironments(candidates, readable).map((candidate) => candidate.environmentId),
      ),
    ),
  );
  const cached = useAtomValue(cachedCaptainsAtom, cachedCaptainsOf);
  return resolveCaptainEnvironments({ candidates, readable, denied, live, cached });
}

/** The one fleet Chorus projection, chosen from connected servers that understand it. */
export function useFleetChorusStatus() {
  const registry = useContext(RegistryContext);
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const supporting = environments.filter(
    (environment) =>
      readable.has(environment.environmentId) &&
      environment.serverConfig?.environment.capabilities.fleetChorus === true,
  );
  const environmentIds = supporting.map(({ environmentId }) => environmentId);
  const live = useAtomValue(
    serverEnvironment.fleetChorusLiveAcross(JSON.stringify(environmentIds)),
  );
  const fleet = selectFleetChorus(
    live.map(({ environmentId, result }) => ({
      environmentId,
      connected:
        supporting.find((environment) => environment.environmentId === environmentId)?.connection
          .phase === "connected",
      status: AsyncResult.getOrElse(result, () => null),
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

// Snapshots already handed to the cache; an unchanged live list keeps its snapshot object.
const persistedSnapshots = new WeakSet<object>();

/** Saves each environment's live Captains so the next launch draws them before it connects. */
function usePersistLiveCaptains(environments: ReadonlyArray<CaptainEnvironment>) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes live Captains to the on-device cache the next launch reads
  useEffect(() => {
    for (const { environmentId, snapshot } of environments) {
      if (snapshot === null || persistedSnapshots.has(snapshot)) continue;
      persistedSnapshots.add(snapshot);
      persistCaptains(environmentId, snapshot.captains);
    }
  }, [environments]);
}

/**
 * Captain environments plus the shells they read. A list that is covered passes
 * `visible: false` so streaming shells stop re-rendering it.
 */
export function useCaptainsDirectory(options?: {
  readonly visible?: boolean;
  readonly environmentId?: EnvironmentId | null;
}) {
  const environments = useCaptainEnvironments(options?.environmentId);
  const shells = useAtomValueWhileVisible(
    environmentThreadShells.threadShellsAtom,
    (options?.visible ?? true) && environments.length > 0,
  );
  return {
    environments,
    shells: environments.length === 0 ? NO_SHELLS : shells,
    showsEnvironment: environments.length > 1,
  };
}

/**
 * Keys of every active Captain's conversations, newline-joined so an unchanged set compares
 * equal. Thread lists leave these to the Captains section, as desktop's sidebar does.
 */
export function useCaptainConversationKeys(): string {
  const environments = useCaptainEnvironments();
  // Home is the only caller, so each live list is saved from one place.
  usePersistLiveCaptains(environments);
  return captainConversationKeys(environments);
}

/** The active Captain a thread is the conversation of, or null for every other thread. */
function useThreadCaptains(environmentId: EnvironmentId | null, threadId: ThreadId | null) {
  const isCaptain = environmentId !== null && threadId !== null && isCaptainThreadId(threadId);
  const config = useEnvironmentServerConfig(isCaptain ? environmentId : null);
  const canRead = useEnvironmentScope(isCaptain ? environmentId : null, AuthOrchestrationReadScope);
  return useEnvironmentQuery(
    isCaptain && canRead && config?.environment.capabilities.captains === true
      ? serverEnvironment.captainsLive({ environmentId, input: {} })
      : null,
  );
}

export function useCaptainOfThread(environmentId: EnvironmentId | null, threadId: ThreadId | null) {
  const query = useThreadCaptains(environmentId, threadId);
  const captain = threadId === null ? undefined : captainForThread(query.data, threadId);
  return captain === undefined || captain.archivedAt !== null ? null : captain;
}

export function useCaptainPrimaryReplacement(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
) {
  const query = useThreadCaptains(environmentId, threadId);
  return threadId === null
    ? undefined
    : captainForEarlierConversation(query.data, threadId)?.primaryThreadId;
}
