import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Socket from "effect/socket/Socket";
import * as TestClock from "effect/testing/TestClock";

import {
  SOCKET_HEARTBEAT_FRAME,
  SOCKET_HEARTBEAT_INTERVAL,
  withSocketHeartbeat,
} from "./socketHeartbeat.ts";

describe("withSocketHeartbeat", () => {
  it.effect(
    "sends heartbeats only in intervals without traffic until the writer's scope closes",
    () =>
      Effect.gen(function* () {
        const written: Array<string | Uint8Array | Socket.CloseEvent> = [];
        const socket = withSocketHeartbeat(
          Socket.make({
            reader: Effect.never,
            writer: Effect.succeed({
              write: (chunk) => Effect.sync(() => void written.push(chunk)),
              writeAll: (chunks) => Effect.sync(() => void written.push(...chunks)),
            }),
          }),
        );
        const scope = yield* Scope.make();
        const writer = yield* Scope.provide(socket.writer, scope);

        yield* writer.write("ordinary response");
        yield* TestClock.adjust(SOCKET_HEARTBEAT_INTERVAL);
        assert.deepStrictEqual(written, ["ordinary response"]);
        yield* writer.writeAll(["a", "b"]);
        yield* TestClock.adjust(SOCKET_HEARTBEAT_INTERVAL);
        assert.deepStrictEqual(written, ["ordinary response", "a", "b"]);
        yield* TestClock.adjust(SOCKET_HEARTBEAT_INTERVAL);
        yield* TestClock.adjust(SOCKET_HEARTBEAT_INTERVAL);
        assert.deepStrictEqual(written, [
          "ordinary response",
          "a",
          "b",
          SOCKET_HEARTBEAT_FRAME,
          SOCKET_HEARTBEAT_FRAME,
        ]);

        yield* Scope.close(scope, Exit.void);
        yield* TestClock.adjust(SOCKET_HEARTBEAT_INTERVAL);
        assert.strictEqual(written.length, 5);
      }),
  );
});
