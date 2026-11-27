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

const nameList = (names: ReadonlyArray<string>) =>
  names.length <= 2
    ? names.join(" or ")
    : `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;

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
        message: "Choose a local project in this Duet's workspace scope for the delegated task.",
      });
    }
    return projectId;
  },
);

export const assertChorusProjectUncovered = Effect.fn(
  "CaptainService.assertChorusProjectUncovered",
)(function* (store: CaptainStore.CaptainStore["Service"], projectId: ProjectId) {
  const names = yield* store
    .coveringDuetNames(projectId)
    .pipe(
      Effect.mapError(
        (error) =>
          new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
      ),
    );
  if (names.length > 0) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: `Route this with duet_send to ${nameList(names)}. Do not start a Solo for this project yourself.`,
    });
  }
});

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
