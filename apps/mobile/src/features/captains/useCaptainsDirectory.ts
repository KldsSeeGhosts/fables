import { useAtomValue } from "@effect/atom-react";
import { captainForThread } from "@t3tools/client-runtime/state/captains";
import {
  AuthOrchestrationReadScope,
  isCaptainThreadId,
  type Captain,
  type CaptainSnapshot,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { useAtomValueWhileVisible } from "../home/home-route-visibility";
import { useEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";

export interface CaptainEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly snapshot: CaptainSnapshot | null;
  readonly captains: ReadonlyArray<Captain>;
}

/**
 * Every connected environment that runs Captains, its live Captains, and the shells they read.
 * A list that is covered passes `visible: false` so streaming shells stop re-rendering it.
 */
export function useCaptainsDirectory(options?: { readonly visible?: boolean }) {
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const supporting = environments.filter(
    ({ environmentId, serverConfig }) =>
      readable.has(environmentId) && serverConfig?.environment.capabilities.captains === true,
  );
  const live = useAtomValue(
    serverEnvironment.captainsLiveAcross(
      JSON.stringify(supporting.map(({ environmentId }) => environmentId)),
    ),
  );
  const shells = useAtomValueWhileVisible(
    environmentThreadShells.threadShellsAtom,
    options?.visible ?? true,
  );
  const captainEnvironments: CaptainEnvironment[] = supporting.map(({ environmentId, label }) => {
    const result = live.find((entry) => entry.environmentId === environmentId)?.result;
    const snapshot = result === undefined ? null : Option.getOrNull(AsyncResult.value(result));
    return {
      environmentId,
      label,
      snapshot,
      captains: (snapshot?.captains ?? []).filter((captain) => captain.archivedAt === null),
    };
  });
  return {
    environments: captainEnvironments,
    shells,
    showsEnvironment: captainEnvironments.length > 1,
  };
}

/** The Captain a thread is the conversation of, or null for every other thread. */
export function useCaptainOfThread(environmentId: EnvironmentId, threadId: ThreadId) {
  const isCaptain = isCaptainThreadId(threadId);
  const config = useEnvironmentServerConfig(isCaptain ? environmentId : null);
  const canRead = useEnvironmentScope(isCaptain ? environmentId : null, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    isCaptain && canRead && config?.environment.capabilities.captains === true
      ? serverEnvironment.captainsLive({ environmentId, input: {} })
      : null,
  );
  return captainForThread(query.data, threadId) ?? null;
}
