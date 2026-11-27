import { MessageId, OrchestrationV2RunStatus, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as CaptainStore from "./CaptainStore.ts";

export const routeStatusTool = "chorus_route_status";
export const routeStatusInput = Schema.Struct({ messageId: MessageId });
export const routeStatusResult = Schema.Struct({
  route: Schema.NullOr(
    Schema.Struct({
      messageId: MessageId,
      threadId: ThreadId,
      runId: RunId,
      status: Schema.Union([OrchestrationV2RunStatus, Schema.Literal("unknown")]),
      terminal: Schema.Boolean,
      result: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
    }),
  ),
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const peers = yield* PeerMcpClient.PeerMcpClient;
    const links = yield* PeerLinks.PeerLinks;
    const store = yield* CaptainStore.CaptainStore;
    const refresh = Effect.gen(function* () {
      if (!(yield* links.enabled)) return;
      const pending = yield* store.pendingRemoteChorusRoutes(32);
      yield* Effect.forEach(
        pending,
        (route) =>
          peers
            .call({
              environmentId: route.environmentId,
              tool: routeStatusTool,
              arguments: { messageId: route.messageId },
              limits: { runtimeMode: "approval-required", interactionMode: "default" },
              success: routeStatusResult,
            })
            .pipe(
              Effect.map(({ route }) => route),
              Effect.timeout("5 seconds"),
              Effect.orElseSucceed(() => null),
              Effect.flatMap((update) => store.updateRemoteChorusRoute(route, update)),
            ),
        { concurrency: 8, discard: true },
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not refresh remote Chorus routes.", { error }),
      ),
    );
    yield* refresh.pipe(Effect.repeat(Schedule.spaced("5 seconds")), Effect.forkScoped);
  }),
);
