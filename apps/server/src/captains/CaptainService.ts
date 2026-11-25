import {
  CaptainError,
  captainPrimaryThreadId,
  CommandId,
  type ThreadId,
  type CaptainCreateInput,
  type CaptainId,
  type CaptainResetInput,
  type CaptainUpdateInput,
  type OrchestrationV2CreationSource,
  type OrchestrationV2Run,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as CaptainHandoff from "./captainHandoff.ts";
import * as CaptainStore from "./CaptainStore.ts";

const invalid = (message: string) => new CaptainError({ code: "invalid_request", message });
const timestamp = Effect.map(DateTime.now, DateTime.formatIso);

const RESET_BLOCKING_RUN_STATUSES = [
  "preparing",
  "queued",
  "starting",
  "running",
] as const satisfies ReadonlyArray<OrchestrationV2Run["status"]>;

// Waiting means the provider turn already ended; unanswered input stays answerable after reset.
const runBlocksReset = (run: Pick<OrchestrationV2Run, "status">) =>
  (RESET_BLOCKING_RUN_STATUSES as ReadonlyArray<OrchestrationV2Run["status"]>).includes(run.status);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* CaptainStore.CaptainStore;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const threadCommands = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  const launch = yield* ThreadLaunch.ThreadLaunchService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const schedules = yield* ScheduledTaskService.ScheduledTaskService;
  const mutations = yield* Semaphore.make(1);

  const validateScope = Effect.fn("CaptainService.validateScope")(function* (
    ids: ReadonlyArray<ProjectId>,
  ) {
    const distinctIds = [...new Set(ids)];
    for (const id of distinctIds) {
      const project = yield* projects
        .getById(id)
        .pipe(Effect.catch(CaptainStore.captainUnavailable));
      if (Option.isNone(project)) return yield* invalid(`Project ${id} was not found.`);
    }
    return distinctIds;
  });

  const createPrimaryThread = Effect.fn("CaptainService.createPrimaryThread")(function* (
    threadId: ThreadId,
    projectId: ProjectId,
    title: string,
    settings: Pick<CaptainCreateInput, "modelSelection" | "runtimeMode" | "interactionMode"> & {
      readonly creationSource: OrchestrationV2CreationSource;
    },
  ) {
    yield* launch
      .launch({
        commandId: CommandId.make(`captain-primary:${threadId}`),
        threadId,
        projectId,
        title,
        titleRenamed: true,
        modelSelection: settings.modelSelection,
        runtimeMode: settings.runtimeMode,
        interactionMode: settings.interactionMode,
        workspaceStrategy: { type: "root" },
        createdBy: "user",
        creationSource: settings.creationSource,
      })
      .pipe(Effect.catch(CaptainStore.captainUnavailable));
  });

  const create = Effect.fn("CaptainService.create")(
    function* (input: CaptainCreateInput) {
      const existing = yield* store.find(input.captainId);
      if (existing !== undefined) return existing;
      const scopedProjectIds = yield* validateScope(input.scopedProjectIds);
      const projectId =
        scopedProjectIds[0] ??
        (yield* folders.ensureScratchProject.pipe(
          Effect.catch((cause) =>
            cause._tag === "ScratchUnavailableError"
              ? invalid(
                  "This environment has no scratch folder. Add a project to the Captain's workspace scope.",
                )
              : CaptainStore.captainUnavailable(cause),
          ),
        )).projectId;
      const { name, role, instructions, avatar, reportPolicy } = input;
      const coordinatorOnly = input.coordinatorOnly ?? false;
      const now = yield* timestamp;
      const primaryThreadId = captainPrimaryThreadId(input.captainId, 0);
      yield* createPrimaryThread(primaryThreadId, projectId, name, {
        ...input,
        creationSource: input.creationSource ?? "web",
      });
      const captain = yield* store.save({
        id: input.captainId,
        name,
        role,
        instructions,
        avatar,
        reportPolicy,
        coordinatorOnly,
        scopedProjectIds,
        primaryThreadId,
        earlierThreadIds: [],
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
      yield* store.notify(captain.id);
      return captain;
    },
    Effect.uninterruptible,
    mutations.withPermits(1),
  );

  const update = Effect.fn("CaptainService.update")(
    function* (input: CaptainUpdateInput) {
      const { captainId, scopedProjectIds } = input;
      const current = yield* store.requireCaptain(captainId);
      const captain = yield* store.save({
        ...current,
        name: input.name ?? current.name,
        role: input.role ?? current.role,
        instructions: input.instructions ?? current.instructions,
        avatar: input.avatar ?? current.avatar,
        reportPolicy: input.reportPolicy ?? current.reportPolicy,
        coordinatorOnly: input.coordinatorOnly ?? current.coordinatorOnly,
        scopedProjectIds:
          scopedProjectIds === undefined
            ? current.scopedProjectIds
            : yield* validateScope(scopedProjectIds),
        updatedAt: yield* timestamp,
      });
      yield* store.notify(captain.id);
      return captain;
    },
    Effect.uninterruptible,
    mutations.withPermits(1),
  );

  const setArchived = Effect.fn("CaptainService.setArchived")(
    function* ({ captainId }: { readonly captainId: CaptainId }, archived: boolean) {
      const current = yield* store.requireCaptain(captainId);
      if ((current.archivedAt !== null) === archived) return current;
      const now = yield* timestamp;
      const captain = yield* store.save({
        ...current,
        archivedAt: archived ? now : null,
        updatedAt: now,
      });
      yield* store.notify(captain.id);
      return captain;
    },
    Effect.uninterruptible,
    mutations.withPermits(1),
  );

  const requireQuietConversation = Effect.fn("CaptainService.requireQuietConversation")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.catch(CaptainStore.captainUnavailable));
    if (shell === null) return yield* invalid("The Captain's previous thread could not be found.");
    const records = yield* threads
      .getThreadRecords(threadId, ["runs"])
      .pipe(Effect.catch(CaptainStore.captainUnavailable));
    if (records.runs.some(runBlocksReset))
      return yield* invalid(
        "The Captain is still working. Stop or wait for the current turn before resetting.",
      );
    return records.thread;
  });

  const resetConversation = Effect.fn("CaptainService.resetConversation")(
    function* (input: CaptainResetInput) {
      const current = yield* store.requireCaptain(input.captainId);
      const { primaryThreadId: previousId } = current;
      if (input.expectedThreadId !== previousId) {
        if (current.earlierThreadIds[0] === input.expectedThreadId) return current;
        return yield* new CaptainError({
          code: "conflict",
          message: "The Captain's primary conversation has already changed.",
        });
      }
      if (current.archivedAt !== null)
        return yield* invalid("Restore the Captain before resetting it.");
      const primaryThreadId = captainPrimaryThreadId(
        current.id,
        current.earlierThreadIds.length + 1,
      );
      const { captain, handoff } = yield* threadCommands.withLock(
        previousId,
        Effect.gen(function* () {
          const previous = yield* requireQuietConversation(previousId);
          // Read before the reset moves scheduled tasks; NOTES.md changes only once the reset commits.
          const handoff = yield* CaptainHandoff.prepare({
            captain: current,
            previousThreadId: previousId,
          }).pipe(
            Effect.provideService(SqlClient.SqlClient, sql),
            Effect.asSome,
            Effect.catch((cause) =>
              Effect.logWarning("Could not read the Captain handoff before resetting.", {
                cause,
              }).pipe(Effect.as(Option.none<string>())),
            ),
          );
          yield* createPrimaryThread(primaryThreadId, previous.projectId, current.name, previous);

          const captain = yield* sql
            .withTransaction(
              Effect.gen(function* () {
                yield* schedules
                  .rebindThreadTasks(previousId, primaryThreadId)
                  .pipe(Effect.catch(CaptainStore.captainUnavailable));
                return yield* store.save({
                  ...current,
                  primaryThreadId,
                  earlierThreadIds: [previousId, ...current.earlierThreadIds],
                  updatedAt: yield* timestamp,
                });
              }),
            )
            .pipe(Effect.catchTags({ SqlError: CaptainStore.captainUnavailable }));
          return { captain, handoff };
        }),
      );
      if (Option.isSome(handoff)) {
        yield* CaptainHandoff.save({ captain, section: handoff.value }).pipe(
          Effect.provideService(CaptainStore.CaptainStore, store),
          Effect.catch((cause) =>
            Effect.logWarning("Could not write the Captain handoff after resetting.", { cause }),
          ),
        );
      }
      yield* schedules.invalidateList;
      yield* store.notify(captain.id);
      return captain;
    },
    Effect.uninterruptible,
    mutations.withPermits(1),
  );

  const deleteCaptain = Effect.fn("CaptainService.delete")(
    function* ({ captainId }: { readonly captainId: CaptainId }) {
      yield* store.remove(captainId);
    },
    Effect.uninterruptible,
    mutations.withPermits(1),
  );

  return {
    create,
    update,
    archive: (input: { readonly captainId: CaptainId }) => setArchived(input, true),
    unarchive: (input: { readonly captainId: CaptainId }) => setArchived(input, false),
    delete: deleteCaptain,
    resetConversation,
    subscribe: store.subscribe,
    updateDocument: store.updateDocument,
    upsertMemory: store.upsertMemory,
    deleteMemory: store.deleteMemory,
  };
});

export class CaptainService extends Context.Service<CaptainService, Effect.Success<typeof make>>()(
  "t3/captains/CaptainService",
) {}

export const layer = Layer.effect(CaptainService, make);
