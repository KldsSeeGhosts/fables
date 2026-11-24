import {
  isCaptainThreadId,
  OrchestratorMcpFailure,
  type Captain,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CaptainStore from "./CaptainStore.ts";

export const captainDelegationProject = Effect.fn("CaptainService.delegationProject")(
  function* (input: {
    readonly captain: Captain | undefined;
    readonly currentProjectId: ProjectId;
    readonly requestedProjectId?: ProjectId | undefined;
  }) {
    const { captain, currentProjectId, requestedProjectId } = input;
    const scope = captain?.scopedProjectIds ?? [];
    if (scope.length === 0) return requestedProjectId ?? currentProjectId;
    const projectId = requestedProjectId ?? (scope.length === 1 ? scope[0]! : currentProjectId);
    if (!scope.includes(projectId)) {
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "Choose a local project in this Captain's workspace scope for the delegated task.",
      });
    }
    return projectId;
  },
);

export const makeCaptainCanWake = Effect.gen(function* () {
  const store = yield* Effect.serviceOption(CaptainStore.CaptainStore);

  return Effect.fn("CaptainService.canWake")(
    function* (threadId: ThreadId) {
      if (!isCaptainThreadId(threadId) || Option.isNone(store)) return true;
      const captain = yield* store.value.findByConversation(threadId);
      return (
        captain === undefined ||
        (captain.primaryThreadId === threadId &&
          captain.archivedAt === null &&
          captain.reportPolicy === "react")
      );
    },
    Effect.orElseSucceed(() => false),
  );
});
