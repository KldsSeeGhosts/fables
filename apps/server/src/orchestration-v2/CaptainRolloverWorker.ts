import type { OrchestrationV2DomainEvent, RunId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as CaptainService from "../captains/CaptainService.ts";
import * as CaptainStore from "../captains/CaptainStore.ts";
import { handleCaptainTurnEnd } from "../captains/captainRollover.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

const terminalRunUpdated = (event: OrchestrationV2DomainEvent) =>
  event.type === "run.updated" &&
  (event.payload.status === "completed" ||
    event.payload.status === "failed" ||
    event.payload.status === "interrupted" ||
    event.payload.status === "cancelled" ||
    event.payload.status === "rolled_back")
    ? { threadId: event.threadId, runId: event.payload.id }
    : null;

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const captains = yield* CaptainService.CaptainService;
    const captainStore = yield* CaptainStore.CaptainStore;
    const threads = yield* ThreadManagement.ThreadManagementService;

    const handle = (terminal: {
      readonly threadId: Parameters<typeof captains.resetConversation>[0]["expectedThreadId"];
      readonly runId: RunId;
    }) =>
      handleCaptainTurnEnd(
        {
          findCaptainByConversation: (threadId) =>
            captainStore.findByConversation(threadId).pipe(Effect.mapError(asError)),
          getThreadRecords: (threadId) =>
            threads
              .getThreadRecords(threadId, ["messages", "turnItems", "providerThreads", "subagents"])
              .pipe(Effect.mapError(asError)),
          resetConversation: (input) =>
            captains.resetConversation(input).pipe(Effect.mapError(asError)),
          sendToThread: (input) => threads.sendToThread(input).pipe(Effect.mapError(asError)),
        },
        terminal,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Captain automatic rollover failed.", {
            threadId: terminal.threadId,
            cause,
          }),
        ),
      );

    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        const terminal = terminalRunUpdated(event);
        return terminal === null ? Effect.void : handle(terminal);
      }),
    );
  }),
);
