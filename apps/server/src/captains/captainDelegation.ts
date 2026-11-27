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

export type CaptainDelegationCoveringDuet = Pick<
  Captain,
  "id" | "kind" | "name" | "scopedProjectIds" | "archivedAt"
>;

export type CaptainDelegationCoverage = (
  projectId: ProjectId,
) => Effect.Effect<ReadonlyArray<CaptainDelegationCoveringDuet>, OrchestratorMcpFailure>;

const coversProject = (duet: Pick<Captain, "scopedProjectIds">, projectId: ProjectId) =>
  duet.scopedProjectIds.length === 0 || duet.scopedProjectIds.includes(projectId);

const activeCoveringDuets = (
  duets: ReadonlyArray<CaptainDelegationCoveringDuet>,
  projectId: ProjectId,
  captainId: Captain["id"],
) =>
  duets.filter(
    (duet) =>
      duet.id !== captainId &&
      duet.kind === "duet" &&
      duet.archivedAt === null &&
      coversProject(duet, projectId),
  );

const localCaptainDelegationCoverage: CaptainDelegationCoverage = Effect.fn(
  "CaptainService.localDelegationCoverage",
)(function* (projectId) {
  const store = yield* Effect.serviceOption(CaptainStore.CaptainStore);
  if (Option.isNone(store)) return [];
  const duets = yield* store.value
    .activeDuets()
    .pipe(
      Effect.mapError(
        (error) =>
          new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
      ),
    );
  return duets.filter((duet) => coversProject(duet, projectId));
});

const nameList = (names: ReadonlyArray<string>) =>
  names.length <= 2
    ? names.join(" or ")
    : `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;

export const captainDelegationProject = Effect.fn("CaptainService.delegationProject")(
  function* (input: {
    readonly captain: Captain | undefined;
    readonly currentProjectId: ProjectId;
    readonly requestedProjectId?: ProjectId | undefined;
    readonly coveringDuets?: CaptainDelegationCoverage | undefined;
  }) {
    const { captain, currentProjectId, requestedProjectId } = input;
    const scope = captain?.scopedProjectIds ?? [];
    const projectId =
      scope.length === 0
        ? (requestedProjectId ?? currentProjectId)
        : (requestedProjectId ?? (scope.length === 1 ? scope[0]! : currentProjectId));
    if (scope.length > 0 && !scope.includes(projectId)) {
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "Choose a local project in this Duet's workspace scope for the delegated task.",
      });
    }
    if (captain?.kind === "chorus") {
      const coverage = input.coveringDuets ?? localCaptainDelegationCoverage;
      const covering = activeCoveringDuets(yield* coverage(projectId), projectId, captain.id);
      if (covering.length > 0) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `Route this with duet_send to ${nameList(covering.map((duet) => duet.name))}. Do not start a Solo for this project yourself.`,
        });
      }
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
