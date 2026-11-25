import type { OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as CaptainService from "../captains/CaptainService.ts";
import * as CaptainStore from "../captains/CaptainStore.ts";
import { handleCaptainTurnEnd } from "../captains/captainRollover.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const terminalRunUpdated = (event: OrchestrationV2DomainEvent) =>
  event.type === "run.updated" &&
  (event.payload.status === "completed" ||
    event.payload.status === "failed" ||
    event.payload.status === "interrupted" ||
    event.payload.status === "cancelled" ||
    event.payload.status === "rolled_back")
    ? { threadId: event.threadId }
    : null;

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const captains = yield* CaptainService.CaptainService;
    const captainStore = yield* CaptainStore.CaptainStore;
    const threads = yield* ThreadManagement.ThreadManagementService;

    const handle = (
      threadId: Parameters<typeof captains.resetConversation>[0]["expectedThreadId"],
    ) =>
      handleCaptainTurnEnd(
        {
          findCaptainByConversation: (threadId) => captainStore.findByConversation(threadId),
          getThreadRecords: (threadId) =>
            threads.getThreadRecords(threadId, [
              "messages",
              "turnItems",
              "providerThreads",
              "subagents",
            ]),
          resetConversation: (input) => captains.resetConversation(input),
          sendToThread: (input) => threads.sendToThread(input),
        },
        { threadId },
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Captain automatic rollover failed.", { threadId, cause }),
        ),
      );

    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        const terminal = terminalRunUpdated(event);
        return terminal === null ? Effect.void : handle(terminal.threadId);
      }),
    );
  }),
);
