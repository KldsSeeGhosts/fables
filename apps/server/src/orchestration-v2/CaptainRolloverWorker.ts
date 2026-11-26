import { isCaptainThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Result from "effect/Result";
import * as KeyedLock from "@t3tools/shared/KeyedLock";

import * as CaptainService from "../captains/CaptainService.ts";
import * as CaptainStore from "../captains/CaptainStore.ts";
import { handleCaptainTurnEnd } from "../captains/captainRollover.ts";
import { forkParked } from "../serverActivation.ts";
import * as EventSink from "./EventSink.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const captains = yield* CaptainService.CaptainService;
    const captainStore = yield* CaptainStore.CaptainStore;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const reactions = yield* KeyedLock.makeRunner<string>();
    const afterSequence = yield* eventSink.latestSequence().pipe(Effect.orDie);

    yield* forkParked(
      eventSink.stream({ afterSequence, eventType: "run.updated" }).pipe(
        Stream.filterMap(({ event, commandId }) =>
          event.type === "run.updated" &&
          isCaptainThreadId(event.threadId) &&
          !String(commandId).startsWith("command:runtime-reconcile:") &&
          (event.payload.status === "completed" || event.payload.status === "failed")
            ? Result.succeed({ threadId: event.threadId, run: event.payload })
            : Result.failVoid,
        ),
        Stream.runForEach((terminal) =>
          reactions.run(
            terminal.threadId,
            handleCaptainTurnEnd(
              {
                findCaptainPrimary: captainStore.byThread,
                getThreadRecords: (threadId, run) =>
                  threads.getThreadRecords(
                    threadId,
                    ["messages", "turnItems", "providerThreads", "subagents"],
                    {
                      messageIds: [run.userMessageId],
                      turnItemRunId: run.id,
                      turnItemTypes: ["error", "compaction"],
                      providerThreadIds:
                        run.providerThreadId === null ? [] : [run.providerThreadId],
                      omitSettledSubagents: true,
                    },
                  ),
                resetConversation: captains.resetConversation,
                sendToThread: threads.sendToThread,
              },
              terminal,
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Captain automatic rollover failed.", {
                  threadId: terminal.threadId,
                  cause,
                }),
              ),
            ),
          ),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("Captain rollover event stream failed.", { cause }),
        ),
      ),
    );
  }),
);
