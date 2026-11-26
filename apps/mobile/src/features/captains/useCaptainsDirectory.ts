import { useAtomValue } from "@effect/atom-react";
import {
  captainConversationKeys,
  captainForEarlierConversation,
  captainForThread,
} from "@t3tools/client-runtime/state/captains";
import {
  AuthOrchestrationReadScope,
  isCaptainThreadId,
  type Captain,
  type CaptainSnapshot,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentThreadShells } from "../../state/threads";
import { useAtomValueWhileVisible } from "../home/home-route-visibility";
import { useEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";

/** Loading and failed environments are not empty ones, so lists say which they are. */
export type CaptainEnvironmentStatus = "loading" | "failed" | "ready";

export interface CaptainEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: CaptainEnvironmentStatus;
  readonly snapshot: CaptainSnapshot | null;
  readonly captains: ReadonlyArray<Captain>;
}

const NO_SHELLS: ReadonlyArray<EnvironmentThreadShell> = [];

function environmentStatus(result: AsyncResult.AsyncResult<CaptainSnapshot, unknown> | undefined): {
  readonly status: CaptainEnvironmentStatus;
  readonly snapshot: CaptainSnapshot | null;
} {
  const snapshot = result === undefined ? null : Option.getOrNull(AsyncResult.value(result));
  // A failed refresh keeps showing what was loaded before it.
  if (snapshot !== null) return { status: "ready", snapshot };
  return {
    status: result !== undefined && AsyncResult.isFailure(result) ? "failed" : "loading",
    snapshot,
  };
}

/** Every connected environment that runs Captains, with its live Captains and their status. */
export function useCaptainEnvironments(environmentId?: EnvironmentId | null) {
  const { environments } = useEnvironments();
  const readable = useEnvironmentsWithScope(environments, AuthOrchestrationReadScope);
  const scope = environmentId ?? null;
  const supporting = environments.filter(
    (environment) =>
      (scope === null || environment.environmentId === scope) &&
      readable.has(environment.environmentId) &&
      environment.serverConfig?.environment.capabilities.captains === true,
  );
  const live = useAtomValue(
    serverEnvironment.captainsLiveAcross(
      JSON.stringify(supporting.map((environment) => environment.environmentId)),
    ),
  );
  return supporting.map(({ environmentId: id, label }): CaptainEnvironment => {
    const { status, snapshot } = environmentStatus(
      live.find((entry) => entry.environmentId === id)?.result,
    );
    return {
      environmentId: id,
      label,
      status,
      snapshot,
      captains: (snapshot?.captains ?? []).filter((captain) => captain.archivedAt === null),
    };
  });
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
  return captainConversationKeys(useCaptainEnvironments());
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
