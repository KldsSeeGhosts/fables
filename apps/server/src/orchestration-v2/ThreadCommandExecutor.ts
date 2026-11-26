import type { OrchestrationV2Run, ThreadId } from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

type CaptainTurnEndHandler = (threadId: ThreadId, run: OrchestrationV2Run) => Effect.Effect<void>;

export class ThreadCommandExecutor extends Context.Service<
  ThreadCommandExecutor,
  KeyedLock.KeyedLock<ThreadId> & {
    /**
     * One thread deletion plans and commits at a time: each decides what its deleted fork
     * sources keep for the forks still alive. Take it before any thread lock.
     */
    readonly withDeletionLock: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    readonly setCaptainTurnEndHandler: (handler: CaptainTurnEndHandler) => Effect.Effect<void>;
    readonly handleCaptainTurnEnd: CaptainTurnEndHandler;
  }
>()("t3/orchestration-v2/ThreadCommandExecutor") {}

export const make = Effect.gen(function* () {
  const deletion = yield* Semaphore.make(1);
  const captainTurnEnd = yield* Ref.make<CaptainTurnEndHandler>(() => Effect.void);
  return ThreadCommandExecutor.of({
    ...(yield* KeyedLock.make<ThreadId>()),
    withDeletionLock: Effect.fn("ThreadCommandExecutor.withDeletionLock")(function* <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) {
      return yield* deletion.withPermit(effect);
    }),
    setCaptainTurnEndHandler: Effect.fn("ThreadCommandExecutor.setCaptainTurnEndHandler")(
      (handler: CaptainTurnEndHandler) => Ref.set(captainTurnEnd, handler),
    ),
    handleCaptainTurnEnd: Effect.fn("ThreadCommandExecutor.handleCaptainTurnEnd")(
      (threadId: ThreadId, run: OrchestrationV2Run) =>
        Ref.get(captainTurnEnd).pipe(Effect.flatMap((handler) => handler(threadId, run))),
    ),
  });
});

export const layer = Layer.effect(ThreadCommandExecutor, make);
