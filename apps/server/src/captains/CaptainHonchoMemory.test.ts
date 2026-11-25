// @effect-diagnostics nodeBuiltinImport:off - test fixtures write the optional user config file.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CaptainId,
  ProjectId,
  ThreadId,
  type Captain,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/http";

import { formatCaptainLongTermMemoryBlock } from "./captainTurnContext.ts";
import * as CaptainHonchoMemory from "./CaptainHonchoMemory.ts";
import * as CaptainStore from "./CaptainStore.ts";

const captain = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:0"),
  name: "Maria",
  role: "Coordinator",
  instructions: "",
  reportPolicy: "context",
  coordinatorOnly: false,
  avatar: { preset: "compass", color: "violet" },
  earlierThreadIds: [],
  scopedProjectIds: [ProjectId.make("workspace")],
  createdAt: "2026-11-24T12:00:00.000Z",
  updatedAt: "2026-11-24T12:00:00.000Z",
  archivedAt: null,
} satisfies Captain;

const token = "canary-header.canary-payload.canary-signature";

interface RecordedRequest {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

const turnItem = (
  threadId: string,
  type: "user_message" | "assistant_message",
  text: string,
  extra: Record<string, unknown> = {},
) =>
  ({
    id: `item-${type}-${threadId}-${text}`,
    threadId,
    type,
    status: "completed",
    createdBy: "user",
    text,
    createdAt: "2026-11-24T12:00:00.000Z",
    updatedAt: "2026-11-24T12:00:00.000Z",
    ...extra,
  }) as unknown as OrchestrationV2TurnItem;

const fixture = (input: {
  readonly status?: number;
  readonly config?: string;
  readonly token?: string;
  readonly neverRespond?: boolean;
}) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-honcho-test-"));
  const configPath = NodePath.join(dir, "honcho.json");
  const tokenPath = NodePath.join(dir, "token");
  NodeFS.writeFileSync(tokenPath, input.token ?? token);
  NodeFS.writeFileSync(
    configPath,
    input.config ??
      JSON.stringify({
        baseUrl: "http://honcho.test",
        workspaceId: "ksg_duets",
        tokenFile: tokenPath,
      }),
  );
  const requests: Array<RecordedRequest> = [];
  const http = HttpClient.make((request) => {
    const body =
      request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
    requests.push({ url: request.url, authorization: request.headers.authorization, body });
    return input.neverRespond === true
      ? Effect.never
      : Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(
              request.url.endsWith("/representation")
                ? JSON.stringify({ representation: "Remembered preference" })
                : request.url.endsWith("/search")
                  ? JSON.stringify([{ content: "Uses pnpm", created_at: "2026-11-24T12:00:00Z" }])
                  : "{}",
              { status: input.status ?? 200, headers: { "content-type": "application/json" } },
            ),
          ),
        );
  });
  const store = Layer.mock(CaptainStore.CaptainStore)({
    findByConversation: () => Effect.succeed(captain),
  });
  const layer = CaptainHonchoMemory.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(HttpClient.HttpClient, http),
        Layer.succeed(HostProcess.Environment, {
          T3CODE_HONCHO_CONFIG: configPath,
          HOME: dir,
        }),
        store,
      ),
    ),
  );
  return { requests, layer };
};

const withService = <A>(
  fixtureLayer: Layer.Layer<CaptainHonchoMemory.CaptainHonchoMemory>,
  f: (service: CaptainHonchoMemory.CaptainHonchoMemory["Service"]) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
    return yield* f(service);
  }).pipe(Effect.provide(fixtureLayer), Effect.scoped);

it.live("stays off when unconfigured and makes no requests", () => {
  const missing = NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-honcho-off-")),
    "missing.json",
  );
  const requests: Array<RecordedRequest> = [];
  const layer = CaptainHonchoMemory.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            requests.push({
              url: request.url,
              authorization: request.headers.authorization,
              body: "",
            });
            return Effect.die("unexpected request");
          }),
        ),
        Layer.succeed(HostProcess.Environment, { T3CODE_HONCHO_CONFIG: missing, HOME: "/" }),
      ),
    ),
  );
  return withService(layer, (service) =>
    Effect.gen(function* () {
      assert.isFalse(service.enabled);
      assert.deepStrictEqual(yield* service.search(captain, "pnpm"), []);
      assert.isTrue(Option.isNone(yield* service.longTermMemory(captain)));
      assert.deepStrictEqual(requests, []);
    }),
  );
});

it.live("mirrors only captain user and final assistant messages", () => {
  const { requests, layer } = fixture({});
  return withService(layer, (service) =>
    Effect.gen(function* () {
      yield* service.mirrorTurnItem(turnItem("captain:maria:0", "user_message", "Remember this"));
      yield* service.mirrorTurnItem(
        turnItem("captain:maria:0", "assistant_message", "Final answer", { phase: "final_answer" }),
      );
      yield* service.mirrorTurnItem(
        turnItem("captain:maria:0", "assistant_message", "Commentary", { phase: "commentary" }),
      );
      yield* service.mirrorTurnItem(turnItem("ordinary", "user_message", "Not mirrored"));
      yield* service.drain;
      const messagePosts = requests.filter(({ url }) => url.includes("/messages"));
      assert.lengthOf(messagePosts, 2);
      assert.include(messagePosts[0]!.body, "Remember this");
      assert.include(messagePosts[0]!.body, '"peer_id":"user"');
      assert.include(messagePosts[1]!.body, "Final answer");
      assert.include(messagePosts[1]!.body, '"peer_id":"duet_maria"');
      assert.equal(messagePosts[0]!.authorization, `Bearer ${token}`);
      assert.isTrue(requests.some(({ url }) => url.endsWith("/sessions")));
    }),
  );
});

it.live("drops failed mirroring after retries without surfacing an error", () => {
  const { requests, layer } = fixture({ status: 500 });
  return withService(layer, (service) =>
    Effect.gen(function* () {
      yield* service.mirrorTurnItem(turnItem("captain:maria:0", "user_message", "Remember this"));
      yield* service.drain;
      assert.equal(requests.filter(({ url }) => url.endsWith("/sessions")).length, 3);
    }),
  );
});

it.live("omits long-term memory on failure and search falls back to empty", () => {
  const { layer } = fixture({ status: 500 });
  return withService(layer, (service) =>
    Effect.gen(function* () {
      assert.isTrue(Option.isNone(yield* service.longTermMemory(captain)));
      assert.deepStrictEqual(yield* service.search(captain, "pnpm"), []);
    }),
  );
});

it.live("times out long-term memory instead of failing the caller", () => {
  const { layer } = fixture({ neverRespond: true });
  return withService(layer, (service) =>
    Effect.gen(function* () {
      assert.isTrue(Option.isNone(yield* service.longTermMemory(captain)));
    }),
  );
});

it.live("returns representation and search recall when configured", () => {
  const { layer } = fixture({});
  return withService(layer, (service) =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* service.longTermMemory(captain),
        Option.some("Remembered preference"),
      );
      assert.deepStrictEqual(yield* service.search(captain, "package manager"), ["Uses pnpm"]);
    }),
  );
});

it.live("caps the briefing block and never logs the token", () => {
  const { layer } = fixture({ status: 500 });
  const messages: Array<unknown> = [];
  const logger = Logger.make(({ message }) => messages.push(message));
  const block = formatCaptainLongTermMemoryBlock("x".repeat(5_000));
  assert.isAtMost(block.length, 4_020);
  return withService(layer, (service) =>
    Effect.gen(function* () {
      yield* service.longTermMemory(captain);
      yield* service.search(captain, "pnpm");
    }),
  ).pipe(
    Effect.withLogger(logger),
    Effect.andThen(
      Effect.sync(() => {
        assert.notInclude(JSON.stringify(messages), token);
      }),
    ),
  );
});
