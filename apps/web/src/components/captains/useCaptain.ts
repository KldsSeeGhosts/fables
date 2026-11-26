import { useAtomValue } from "@effect/atom-react";
import {
  captainForEarlierConversation,
  captainForThread,
} from "@t3tools/client-runtime/state/captains";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationReadScope,
  isCaptainThreadId,
  type CaptainId,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useMessages } from "gt-react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";

export function useCaptains(environmentId: EnvironmentId | null, captainId?: CaptainId) {
  const messages = useMessages();
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  return useEnvironmentQuery(
    environmentId !== null && canRead && config?.environment.capabilities.captains === true
      ? serverEnvironment.captainsLive({
          environmentId,
          input: captainId === undefined ? {} : { captainId },
        })
      : null,
    messages,
  );
}

export function useCaptain(threadRef: ScopedThreadRef | null) {
  const query = useCaptains(
    threadRef && isCaptainThreadId(threadRef.threadId) ? threadRef.environmentId : null,
  );
  return threadRef === null ? undefined : captainForThread(query.data, threadRef.threadId);
}

export function useCaptainPrimaryReplacement(threadRef: ScopedThreadRef | null) {
  const query = useCaptains(
    threadRef && isCaptainThreadId(threadRef.threadId) ? threadRef.environmentId : null,
  );
  return threadRef === null
    ? undefined
    : captainForEarlierConversation(query.data, threadRef.threadId)?.primaryThreadId;
}

export function captainCommandError<A, E>(
  result: Extract<AtomCommandResult<A, E>, { readonly _tag: "Failure" }>,
  fallback: string,
) {
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error ? failure.message : fallback;
}
