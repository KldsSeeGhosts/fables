import type { OrchestrationV2Run, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as KeyedLock from "@t3tools/shared/KeyedLock";

import * as CaptainService from "../captains/CaptainService.ts";
import * as CaptainStore from "../captains/CaptainStore.ts";
import { handleCaptainTurnEnd, type RolloverRun } from "../captains/captainRollover.ts";
import { forkParked } from "../serverActivation.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const RESEND_RETRY_INTERVAL = "5 seconds";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const captains = yield* CaptainService.CaptainService;
    const store = yield* CaptainStore.CaptainStore;
    const commands = yield* ThreadCommandExecutor.ThreadCommandExecutor;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const resendLock = yield* KeyedLock.make<ThreadId>();
    const delayedDrains = yield* FiberMap.make<ThreadId>();

    const drain = Effect.fn("CaptainRolloverWorker.drain")(
      function* (threadId: ThreadId, retryImmediately: boolean) {
        for (const pending of yield* store.pendingRolloverResends(threadId)) {
          const send = threads.sendToThread(pending).pipe(
            Effect.asVoid,
            Effect.catchTags({
              ThreadManagementThreadNotFoundError: () => Effect.void,
              ThreadManagementProjectionLoadError: (cause) =>
                threads
                  .getThreadShell(threadId)
                  .pipe(
                    Effect.flatMap((shell) => (shell === null ? Effect.void : Effect.fail(cause))),
                  ),
            }),
          );
          yield* retryImmediately
            ? send.pipe(Effect.retry({ schedule: Schedule.exponential("100 millis"), times: 3 }))
            : send;
          yield* store.clearRolloverResend(pending.commandId);
        }
      },
      (effect, threadId) => resendLock.withLock(threadId, effect),
    );

    const drainOrSchedule = Effect.fn("CaptainRolloverWorker.drainOrSchedule")(
      (threadId: ThreadId) =>
        drain(threadId, true).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Captain rollover resend remains pending.", { threadId, cause }).pipe(
              Effect.andThen(
                drain(threadId, false).pipe(
                  Effect.retry({ schedule: Schedule.spaced(RESEND_RETRY_INTERVAL) }),
                  Effect.delay(RESEND_RETRY_INTERVAL),
                  FiberMap.run(delayedDrains, threadId, { onlyIfMissing: true }),
                ),
              ),
            ),
          ),
          Effect.asVoid,
        ),
    );

    const getThreadRecords = Effect.fn("CaptainRolloverWorker.getThreadRecords")(function* (
      threadId: ThreadId,
      run: RolloverRun,
    ) {
      const records = yield* threads.getThreadRecords(
        threadId,
        ["messages", "turnItems", "providerThreads", "providerTurns", "subagents"],
        {
          messageIds: run.status === "failed" ? [run.userMessageId] : [],
          turnItemRunId: run.id,
          turnItemTypes: run.status === "failed" ? ["error", "compaction"] : [],
          turnItemStatuses: ["failed"],
          providerThreadIds: run.providerThreadId === null ? [] : [run.providerThreadId],
          providerTurnThreadIds: run.providerThreadId === null ? [] : [run.providerThreadId],
          latestProviderTurnUsageOnly: true,
          ...(run.status === "completed" ? { omitSettledSubagents: true } : { subagentIds: [] }),
        },
      );
      const latestCompletedCompactionAt =
        run.status === "completed" && run.providerThreadId !== null
          ? yield* store.latestCompletedCompactionAt(threadId, run.providerThreadId)
          : undefined;
      return { ...records, latestCompletedCompactionAt };
    });

    const onTerminal = Effect.fn("CaptainRolloverWorker.onTerminal")(
      function* (threadId: ThreadId, run: OrchestrationV2Run) {
        const result = yield* handleCaptainTurnEnd(
          {
            findCaptainPrimary: store.byThread,
            getThreadRecords,
            resetConversation: captains.resetConversation,
          },
          { threadId, run },
        );
        if (result._tag === "rolled-over") yield* drainOrSchedule(result.primaryThreadId);
      },
      (effect, threadId) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Captain automatic rollover failed.", { threadId, cause }),
          ),
        ),
    );

    yield* Effect.acquireRelease(commands.setCaptainTurnEndHandler(onTerminal), () =>
      commands.setCaptainTurnEndHandler(() => Effect.void),
    );
    yield* forkParked(
      store.pendingRolloverResends(undefined).pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(new Set(rows.map((row) => row.threadId)), drainOrSchedule, {
            concurrency: 4,
            discard: true,
          }),
        ),
        Effect.tapError((cause) =>
          Effect.logWarning("Could not restore Captain rollover resends.", { cause }),
        ),
        Effect.retry({ schedule: Schedule.spaced(RESEND_RETRY_INTERVAL) }),
      ),
    );
  }),
);
