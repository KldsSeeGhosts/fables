import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Socket from "effect/socket/Socket";

// Reverse proxies close a socket after 60 seconds without upstream bytes
// (nginx proxy_read_timeout, AWS ALB), and a suspended client stops pinging.
export const SOCKET_HEARTBEAT_INTERVAL = Duration.seconds(20);

// RPC clients count any decoded frame as liveness and ignore unsolicited pongs.
export const SOCKET_HEARTBEAT_FRAME = '{"_tag":"Pong"}';

/** Server side: keeps the upstream active when the server has nothing else to send. */
export function withSocketHeartbeat(socket: Socket.Socket): Socket.Socket {
  return Socket.make({
    reader: socket.reader,
    writer: Effect.flatMap(socket.writer, (writer) => {
      let sentSinceTick = false;
      const markSent = Effect.sync(() => {
        sentSinceTick = true;
      });
      const heartbeat = writer.write(SOCKET_HEARTBEAT_FRAME);
      // One skipped tick leaves at most 40 seconds between writes, below the proxy timeout.
      const tick = Effect.suspend(() => {
        if (!sentSinceTick) return heartbeat;
        sentSinceTick = false;
        return Effect.void;
      });
      return tick.pipe(
        Effect.delay(SOCKET_HEARTBEAT_INTERVAL),
        Effect.forever,
        Effect.ignore,
        Effect.forkScoped,
        Effect.as({
          write: (chunk) => writer.write(chunk).pipe(Effect.tap(markSent)),
          writeAll: (chunks) => writer.writeAll(chunks).pipe(Effect.tap(markSent)),
        } satisfies Socket.Writer),
      );
    }),
  });
}
