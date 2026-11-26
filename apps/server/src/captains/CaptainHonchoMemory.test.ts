import * as NodeUtil from "node:util";

import { assert, it } from "@effect/vitest";
import {
  CaptainId,
  EnvironmentId,
  EventId,
  MessageId,
  NodeId,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ScheduledTaskId,
  ThreadId,
  TurnItemId,
  type Captain,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as References from "effect/References";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { makeReadCaptainTurnContext } from "./captainTurnContext.ts";
import * as CaptainHonchoMemory from "./CaptainHonchoMemory.ts";
import * as CaptainStore from "./CaptainStore.ts";

const timestamp = "2026-11-24T12:00:00.000Z";
const now = DateTime.makeUnsafe(timestamp);
const earlier = ThreadId.make("captain:maria:old");
const captain = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:0"),
  name: "Maria",
  role: "Coordinator",
  instructions: "",
  reportPolicy: "context",
  coordinatorOnly: false,
  avatar: { preset: "compass", color: "violet" },
  earlierThreadIds: [earlier],
  scopedProjectIds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: null,
} satisfies Captain;
const secondCaptain = {
  ...captain,
  id: CaptainId.make("jordan"),
  name: "Jordan",
  primaryThreadId: ThreadId.make("captain:jordan:0"),
  earlierThreadIds: [],
};
const primaryThread = {
  id: captain.primaryThreadId,
  lineage: { parentThreadId: null, relationshipToParent: null },
};
const token = [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
  Buffer.from('{"sub":"canary-workspace"}').toString("base64url"),
  Buffer.from("canary-signature".padEnd(32, "!")).toString("base64url"),
].join(".");
const configPath = "/test/honcho.json";
const tokenPath = "/test/honcho-token";
const providerThreadId = ProviderThreadId.make("claude-thread");
const providerInstanceId = ProviderInstanceId.make("claude");
const markerThread = ThreadId.make("ordinary-marker");
const mainTurn = ProviderTurnId.make("unmarked-answer");
const markedTurn = ProviderTurnId.make("marked-answer");
const childTurn = ProviderTurnId.make("child-answer");

const baseItem = (id: string, threadId: ThreadId, ordinal: number) => ({
  id: TurnItemId.make(id),
  messageId: MessageId.make(id),
  threadId,
  runId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  status: "completed" as const,
  title: null,
  startedAt: now,
  completedAt: now,
  updatedAt: now,
});

const userItem = (
  id: string,
  extra: Partial<Extract<OrchestrationV2TurnItem, { type: "user_message" }>> = {},
) => ({
  ...baseItem(id, captain.primaryThreadId, 1),
  type: "user_message" as const,
  text: id,
  createdBy: "user" as const,
  creationSource: "web" as const,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  inputIntent: "turn_start" as const,
  attachments: [],
  ...extra,
});

const assistantItem = (
  id: string,
  turnId: ProviderTurnId,
  ordinal: number,
  extra: Partial<Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>> = {},
) => ({
  ...baseItem(id, captain.primaryThreadId, ordinal),
  type: "assistant_message" as const,
  text: id,
  nodeId: NodeId.make(`assistant:${id}`),
  providerThreadId,
  providerTurnId: turnId,
  streaming: false,
  ...extra,
});

const itemEvent = (item: OrchestrationV2TurnItem, eventId = String(item.id)) => ({
  id: EventId.make(eventId),
  type: "turn-item.updated" as const,
  threadId: item.threadId,
  occurredAt: now,
  payload: item,
});

const providerTurnEvents = (
  id: ProviderTurnId,
  ordinal: number,
  prompt: ReturnType<typeof userItem>,
  kind: "root_turn" | "subagent" = "root_turn",
) => {
  const threadId = prompt.threadId;
  const nodeId = NodeId.make(`node:${id}`);
  const runId = RunId.make(`run:${id}`);
  return [
    {
      id: EventId.make(`run-created:${id}`),
      type: "run.created",
      threadId,
      occurredAt: now,
      payload: {
        id: runId,
        threadId,
        ordinal,
        providerInstanceId,
        modelSelection: { instanceId: providerInstanceId, model: "claude" },
        providerThreadId,
        userMessageId: prompt.messageId,
        rootNodeId: nodeId,
        activeAttemptId: null,
        status: "running",
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        checkpointId: null,
        contextHandoffId: null,
      },
    },
    {
      id: EventId.make(`root:${id}`),
      type: "node.updated",
      threadId,
      occurredAt: now,
      payload: {
        id: nodeId,
        threadId,
        runId,
        parentNodeId: null,
        rootNodeId: nodeId,
        kind,
        status: "completed",
        countsForRun: true,
        providerThreadId,
        providerTurnId: id,
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId: null,
        startedAt: now,
        completedAt: now,
      },
    },
    {
      id: EventId.make(`completed:${id}`),
      type: "provider-turn.updated",
      threadId,
      occurredAt: now,
      payload: {
        id,
        providerThreadId,
        nodeId,
        runAttemptId: null,
        nativeTurnRef: null,
        ordinal,
        status: "completed",
        startedAt: now,
        completedAt: now,
      },
    },
  ] as const satisfies ReadonlyArray<OrchestrationV2DomainEvent>;
};

type BuildResponse = (
  request: Parameters<Parameters<typeof HttpClient.make>[0]>[0],
  signal: AbortSignal,
) => Effect.Effect<Response, HttpClientError.HttpClientError>;

const fixture = <R = never, E = never>(
  input: {
    readonly eventLayer?: Layer.Layer<R, E>;
    readonly config?: string | null;
    readonly configuredPath?: string;
    readonly baseUrl?: string;
    readonly token?: string | null;
    readonly readToken?: Effect.Effect<string, PlatformError.PlatformError>;
    readonly response?: BuildResponse;
  } = {},
) => {
  const requests: Array<{
    readonly pathname: string;
    readonly body: string;
    readonly authorization: string | undefined;
  }> = [];
  let tokenReads = 0;
  let configReads = 0;
  const http = HttpClient.make((request, url, signal) => {
    const body =
      request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
    requests.push({ pathname: url.pathname, body, authorization: request.headers.authorization });
    const response =
      input.response?.(request, signal) ??
      Effect.succeed(
        Response.json(
          url.pathname.endsWith("/representation") ? { representation: "Uses pnpm" } : [],
        ),
      );
    return response.pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response)));
  });
  const config =
    input.config === undefined
      ? JSON.stringify({
          baseUrl: input.baseUrl ?? "http://honcho.test",
          workspaceId: "ksg_duets",
          tokenFile: tokenPath,
        })
      : input.config;
  const readFileString: FileSystem.FileSystem["readFileString"] = (path) => {
    if (path === tokenPath) {
      tokenReads++;
      if (input.readToken !== undefined) return input.readToken;
    } else {
      configReads++;
    }
    const value = path === tokenPath ? (input.token === undefined ? token : input.token) : config;
    return value === null
      ? Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "FileSystem",
            method: "readFileString",
          }),
        )
      : Effect.succeed(value);
  };
  const store = Layer.mock(CaptainStore.CaptainStore)({
    byThread: (threadId) =>
      Effect.succeed([captain, secondCaptain].find((duet) => duet.primaryThreadId === threadId)),
    findByConversation: () => Effect.succeed(captain),
    document: (captain, name) =>
      Effect.succeed({
        captainId: captain.id,
        name,
        content: "",
        revision: 0,
        updatedAt: timestamp,
      }),
    listMemories: () => Effect.succeed([]),
  });
  const layer = CaptainHonchoMemory.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        FileSystem.layerNoop({ readFileString }),
        Path.layer,
        Layer.succeed(HttpClient.HttpClient, http),
        Layer.succeed(HostProcess.Environment, {
          HOME: "/honcho-fixture",
          T3CODE_HONCHO_CONFIG: input.configuredPath ?? (config === null ? undefined : configPath),
        }),
        store,
        Layer.mock(ProjectService.ProjectService)({}),
        input.eventLayer ?? Layer.empty,
      ),
    ),
  );
  return {
    requests,
    layer,
    configReads: () => configReads,
    tokenReads: () => tokenReads,
    posts: () => requests.filter(({ pathname }) => pathname.endsWith("/messages")),
  };
};

const eventFixture = Effect.gen(function* () {
  const markers = yield* Queue.unbounded<string>();
  let markerId = 0;
  const eventLayer = Layer.effect(
    EventSink.EventSinkV2,
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      return {
        ...sink,
        stream: (input) =>
          sink.stream(input).pipe(
            Stream.rechunk(1),
            Stream.tap(({ event }) =>
              event.threadId === markerThread ? Queue.offer(markers, event.id) : Effect.void,
            ),
          ),
      } satisfies EventSink.EventSinkV2["Service"];
    }),
  ).pipe(
    Layer.provide(
      EventSink.layer.pipe(Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer))),
    ),
    Layer.provideMerge(Sqlite.layerMemory),
  );

  const publish = Effect.fn("HonchoTest.publish")(function* (
    events: ReadonlyArray<OrchestrationV2DomainEvent>,
  ) {
    const sink = yield* EventSink.EventSinkV2;
    const marker = itemEvent(userItem(`marker:${++markerId}`, { threadId: markerThread }));
    yield* sink.write({ events: [...events, marker] });
    assert.equal(yield* Queue.take(markers), marker.id);
  });
  return { eventLayer, publish };
});

const stalledResponse =
  (started: Deferred.Deferred<void>, ended: Deferred.Deferred<void>) =>
  (_request: Parameters<BuildResponse>[0], signal: AbortSignal) =>
    Effect.sync(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"representation":'));
          signal.addEventListener(
            "abort",
            () => {
              controller.error(signal.reason);
              Deferred.doneUnsafe(ended, Effect.void);
            },
            { once: true },
          );
        },
        pull() {
          Deferred.doneUnsafe(started, Effect.void);
          return new Promise<void>(() => {});
        },
      });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });

it.effect("uses a quiet config opt-out and logs missing or invalid config by severity", () =>
  Effect.gen(function* () {
    const problems = [
      { configuredPath: "disabled", levels: [] },
      { config: null, levels: ["Debug"] },
      { config: null, configuredPath: configPath, levels: ["Warn"] },
      { config: "{", levels: ["Warn"] },
      ...[
        "not a URL",
        "http://user:pass@honcho.test",
        "http://honcho.test/?",
        "http://honcho.test/#",
      ].map((baseUrl) => ({ baseUrl, levels: ["Warn"] })),
    ];
    for (const problem of problems) {
      const { layer, requests, configReads, tokenReads } = fixture(problem);
      const levels: string[] = [];
      yield* Effect.gen(function* () {
        const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
        assert.isFalse(service.enabled);
        assert.deepStrictEqual(yield* service.search(captain, "pnpm"), []);
        assert.isTrue(Option.isNone(yield* service.longTermMemory(captain)));
      }).pipe(
        Effect.provide(layer),
        Effect.withLogger(Logger.make(({ logLevel }) => levels.push(logLevel))),
        Effect.provideService(References.MinimumLogLevel, "Debug"),
      );
      assert.deepStrictEqual(levels, problem.levels);
      assert.equal(configReads(), problem.levels.length);
      assert.lengthOf(requests, 0);
      assert.equal(tokenReads(), 0);
    }
  }),
);

it.effect("disables the service after one missing or malformed token warning", () =>
  Effect.gen(function* () {
    const { eventLayer, publish } = yield* eventFixture;
    for (const invalid of [null, "encoded.but.not-a-jwt"]) {
      const { layer, requests, tokenReads } = fixture({ eventLayer, token: invalid });
      const warnings: unknown[] = [];
      yield* Effect.gen(function* () {
        const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
        assert.isTrue(service.enabled);
        yield* publish([itemEvent(userItem("first"))]);
        yield* service.drain;
        assert.isFalse(service.enabled);
        yield* publish([itemEvent(userItem("second"))]);
        assert.deepStrictEqual(yield* service.search(captain, "pnpm"), []);
        const read = yield* makeReadCaptainTurnContext;
        assert.notInclude((yield* read(primaryThread)).text, "Long-term memory");
        yield* service.drain;
      }).pipe(
        Effect.provide(layer),
        Effect.withLogger(
          Logger.make(({ message, logLevel }) => {
            if (logLevel === "Warn") warnings.push(message);
          }),
        ),
      );
      assert.lengthOf(requests, 0);
      assert.equal(tokenReads(), 1);
      assert.lengthOf(warnings, 1);
    }
  }),
);

it.effect("mirrors only user-authored messages and the final root answers from the EventSink", () =>
  Effect.gen(function* () {
    const { eventLayer, publish } = yield* eventFixture;
    const { layer, requests, posts } = fixture({ eventLayer });
    yield* Effect.gen(function* () {
      const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
      const user = userItem("Welcome", { text: "x".repeat(25_000) });
      const [mainRun, mainRoot, mainCompleted] = providerTurnEvents(mainTurn, 1, user);
      const mainPrompt = { ...user, runId: mainRun.payload.id, nodeId: mainRoot.payload.id };
      yield* publish([
        mainRun,
        mainRoot,
        itemEvent(mainPrompt),
        itemEvent(mainPrompt, "duplicate-user"),
        itemEvent(userItem("retired", { threadId: earlier })),
        itemEvent(userItem("ordinary", { threadId: ThreadId.make("ordinary") })),
        itemEvent(assistantItem("Before a tool call", mainTurn, 2)),
        itemEvent({
          ...baseItem("tool", captain.primaryThreadId, 3),
          type: "command_execution",
          providerThreadId,
          providerTurnId: mainTurn,
          nodeId: NodeId.make("tool-node"),
          input: "check status",
          output: "tool output",
        }),
      ]);
      yield* service.drain;
      assert.lengthOf(posts(), 1);

      const markedPrompt = userItem("Start");
      const [markedRun, markedRoot, markedCompleted] = providerTurnEvents(
        markedTurn,
        2,
        markedPrompt,
      );
      const [childRun, childRoot, childCompleted] = providerTurnEvents(
        childTurn,
        3,
        user,
        "subagent",
      );
      yield* publish([
        itemEvent(assistantItem("Fallback final answer", mainTurn, 4)),
        itemEvent(assistantItem("Async output", mainTurn, 4, { delivery: "async" })),
        mainCompleted,
        markedRun,
        markedRoot,
        itemEvent({ ...markedPrompt, runId: markedRun.payload.id, nodeId: markedRoot.payload.id }),
        itemEvent(assistantItem("Pre-steer answer", markedTurn, 1, { phase: "final_answer" })),
        itemEvent(assistantItem("Answer to the steer", markedTurn, 3)),
        itemEvent(assistantItem("Later commentary", markedTurn, 4, { phase: "commentary" })),
        markedCompleted,
        childRun,
        childRoot,
        itemEvent(assistantItem("Crew answer", childTurn, 7, { phase: "final_answer" })),
        childCompleted,
      ]);
      yield* service.drain;

      const [session] = requests;
      assert.isTrue(session?.pathname.endsWith("/sessions"));
      assert.deepInclude(JSON.parse(session!.body), {
        id: "conversation_captain_3amaria_3a0",
        scopes: ["duet_maria"],
      });
      assert.deepStrictEqual(
        posts().map(({ body }) =>
          JSON.parse(body).messages.map(
            ({ content, peer_id }: { content: string; peer_id: string }) => [content, peer_id],
          ),
        ),
        [
          [[`${"x".repeat(23_999)}…`, "user"]],
          [["Fallback final answer", "duet_maria"]],
          [["Start", "user"]],
          [["Answer to the steer", "duet_maria"]],
        ],
      );
      assert.isTrue(requests.every(({ authorization }) => authorization === `Bearer ${token}`));
      assert.lengthOf(
        requests.filter(({ pathname }) => pathname.endsWith("/sessions")),
        1,
      );
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("mirrors neither prompts nor replies from automated runs", () =>
  Effect.gen(function* () {
    const { eventLayer, publish } = yield* eventFixture;
    const { layer, requests } = fixture({ eventLayer });
    yield* Effect.gen(function* () {
      const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
      const automated = [
        userItem("scheduled", { scheduledTaskId: ScheduledTaskId.make("task") }),
        userItem("cross-thread", { senderThreadId: ThreadId.make("other") }),
        userItem("linked", {
          linkedSender: {
            threadId: ThreadId.make("other"),
            environmentId: EnvironmentId.make("linked"),
            title: "Linked",
          },
        }),
        userItem("compaction", { idleCompaction: "onReturn" }),
        userItem("workflow", { workflowScript: true }),
        userItem("retry", { retryOfRunId: RunId.make("earlier-run") }),
        userItem("agent", { createdBy: "agent" }),
      ];
      yield* publish(
        automated.flatMap((prompt, index) => {
          const turnId = ProviderTurnId.make(`automated:${prompt.id}`);
          const [run, root, completed] = providerTurnEvents(turnId, index + 1, prompt);
          return [
            run,
            root,
            itemEvent({ ...prompt, runId: run.payload.id, nodeId: root.payload.id }),
            itemEvent(assistantItem(`Reply to ${prompt.id}`, turnId, 2)),
            completed,
          ];
        }),
      );
      yield* service.drain;
      assert.lengthOf(requests, 0);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("evicts the least recently seen mirror key at the dedupe cap", () =>
  Effect.gen(function* () {
    const { eventLayer, publish } = yield* eventFixture;
    const { layer, posts } = fixture({ eventLayer });
    yield* Effect.gen(function* () {
      const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
      const cap = 4096;
      const batchSize = 128;
      const item = (index: number) => userItem(`message:${index}`);
      for (let offset = 0; offset < cap; offset += batchSize) {
        yield* publish(
          Array.from({ length: batchSize }, (_, index) => itemEvent(item(offset + index))),
        );
        yield* service.drain;
      }
      assert.lengthOf(posts(), cap);

      yield* publish([itemEvent(item(0), "touch-first"), itemEvent(item(cap))]);
      yield* service.drain;
      assert.lengthOf(posts(), cap + 1);

      yield* publish([itemEvent(item(0), "replay-first"), itemEvent(item(1), "replay-second")]);
      yield* service.drain;
      assert.lengthOf(posts(), cap + 2);
      assert.include(posts().at(-1)?.body, '"t3TurnItemId":"message:1"');
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("can mirror a replay of a message dropped when the queue was full", () =>
  Effect.gen(function* () {
    const { eventLayer, publish } = yield* eventFixture;
    const writing = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    const queueCapacity = 128;
    const overflow = userItem("overflow");
    const { layer, posts } = fixture({
      eventLayer,
      response: (request) =>
        request.url.endsWith("/messages")
          ? Deferred.succeed(writing, undefined).pipe(
              Effect.andThen(Deferred.await(resume)),
              Effect.as(Response.json([])),
            )
          : Effect.succeed(Response.json([])),
    });
    yield* Effect.gen(function* () {
      const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
      yield* publish([itemEvent(userItem("in-flight"))]);
      yield* Deferred.await(writing);
      yield* publish([
        ...Array.from({ length: queueCapacity }, (_, index) =>
          itemEvent(userItem(`queued:${index}`)),
        ),
        itemEvent(overflow),
      ]);
      yield* Deferred.succeed(resume, undefined);
      yield* service.drain;
      assert.lengthOf(posts(), queueCapacity + 1);
      assert.isFalse(posts().some(({ body }) => body.includes('"t3TurnItemId":"overflow"')));

      yield* publish([itemEvent(overflow, "replay-overflow")]);
      yield* service.drain;
      assert.lengthOf(posts(), queueCapacity + 2);
      assert.include(posts().at(-1)?.body, '"t3TurnItemId":"overflow"');
    }).pipe(Effect.provide(layer));
  }),
);

it.effect(
  "searches both peers in each Duet scope, drops foreign hits and keeps relevance order",
  () => {
    const firstSession = "conversation_captain_3amaria_3a0";
    const earlierSession = "conversation_captain_3amaria_3aold";
    const secondSession = "conversation_captain_3ajordan_3a0";
    const searchHit = (
      content: string,
      session_id: string,
      peer_id: string,
      created_at = timestamp,
    ) => ({ content, session_id, peer_id, created_at });
    const { layer, requests } = fixture({
      response: (request) => {
        assert.isTrue(request.url.endsWith("/workspaces/ksg_duets/search"));
        const body =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        const { scope } = JSON.parse(body);
        return Effect.succeed(
          Response.json(
            scope === "duet_maria"
              ? [
                  searchHit(
                    "Your relevant fact",
                    earlierSession,
                    "user",
                    "2025-11-24T12:00:00.000Z",
                  ),
                  searchHit("Jordan's private fact", secondSession, "user"),
                  searchHit("Maria's final answer", firstSession, "duet_maria"),
                  { content: "No session" },
                ]
              : [
                  searchHit("Maria's private fact", firstSession, "user"),
                  searchHit("Jordan's final answer", secondSession, "duet_jordan"),
                ],
          ),
        );
      },
    });
    return Effect.gen(function* () {
      const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
      assert.deepStrictEqual(yield* service.search(captain, "facts"), [
        "Your relevant fact",
        "Maria's final answer",
      ]);
      assert.deepStrictEqual(yield* service.search(secondCaptain, "facts"), [
        "Jordan's final answer",
      ]);
      assert.deepStrictEqual(
        requests.map(({ body }) => JSON.parse(body)),
        [
          { query: "facts", limit: 5, scope: "duet_maria" },
          { query: "facts", limit: 5, scope: "duet_jordan" },
        ],
      );
    }).pipe(Effect.provide(layer));
  },
);

it.effect("aborts a stalled body within the deadline for turn context and search", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const ended = yield* Deferred.make<void>();
    const searchStarted = yield* Deferred.make<void>();
    const searchEnded = yield* Deferred.make<void>();
    const { layer } = fixture({
      readToken: Effect.sleep("750 millis").pipe(Effect.as(token)),
      response: (request, signal) =>
        request.url.endsWith("/search")
          ? stalledResponse(searchStarted, searchEnded)(request, signal)
          : stalledResponse(started, ended)(request, signal),
    });
    yield* Effect.gen(function* () {
      const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
      const read = yield* makeReadCaptainTurnContext;
      const context = yield* read(primaryThread).pipe(Effect.forkChild);
      const search = yield* service.search(captain, "facts").pipe(Effect.forkChild);
      yield* TestClock.adjust("750 millis");
      yield* Deferred.await(started);
      yield* Deferred.await(searchStarted);
      yield* TestClock.adjust("1250 millis");
      assert.notInclude((yield* Fiber.join(context)).text, "Long-term memory");
      assert.deepStrictEqual(yield* Fiber.join(search), []);
      yield* Deferred.await(ended);
      yield* Deferred.await(searchEnded);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("propagates interruption from long-term memory and search", () =>
  Effect.gen(function* () {
    for (const operation of ["longTermMemory", "search"] as const) {
      const started = yield* Deferred.make<void>();
      const ended = yield* Deferred.make<void>();
      const warnings: unknown[] = [];
      const { layer } = fixture({ response: stalledResponse(started, ended) });
      yield* Effect.gen(function* () {
        const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
        const task =
          operation === "search"
            ? service.search(captain, "facts").pipe(Effect.asVoid)
            : service.longTermMemory(captain).pipe(Effect.asVoid);
        const fiber = yield* Effect.forkChild(task);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        assert.isTrue(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause));
        yield* Deferred.await(ended);
      }).pipe(
        Effect.provide(layer),
        Effect.withLogger(Logger.make(({ message }) => warnings.push(message))),
      );
      assert.deepStrictEqual(warnings, []);
    }
  }),
);

it.effect(
  "caps briefing recall, refreshes after compaction and keeps it out of crew context",
  () => {
    let status = 200;
    const { layer, requests } = fixture({
      response: () =>
        Effect.succeed(Response.json({ representation: "x".repeat(5_000) }, { status })),
    });
    return Effect.gen(function* () {
      const read = yield* makeReadCaptainTurnContext;
      const readPrimary = (usedTokens: number) =>
        read(primaryThread, { providerThreadId: "provider-thread", usedTokens });
      const first = yield* readPrimary(2_000);
      const block = first.text.split("\n\n").find((part) => part.startsWith("Long-term memory:"));
      assert.isDefined(block);
      assert.isAtMost(block!.length, 4_020);
      assert.deepStrictEqual(JSON.parse(requests[0]!.body), {
        target: "user",
        scope: "duet_maria",
      });
      yield* first.delivered;

      const unchanged = yield* readPrimary(2_200);
      assert.notInclude(unchanged.text, "Long-term memory");
      yield* unchanged.delivered;

      const compacted = yield* readPrimary(1_700);
      assert.include(compacted.text, block!);
      yield* compacted.delivered;

      status = 500;
      const failed = yield* readPrimary(1_000);
      assert.notInclude(failed.text, "Long-term memory");
      yield* failed.delivered;

      status = 200;
      const recovered = yield* readPrimary(1_200);
      assert.include(recovered.text, block!);
      yield* recovered.delivered;

      const crew = yield* read({
        id: ThreadId.make("crew"),
        lineage: { parentThreadId: captain.primaryThreadId, relationshipToParent: "subagent" },
      });
      assert.notInclude(crew.text, "Long-term memory");
      assert.lengthOf(requests, 5);
    }).pipe(Effect.provide(layer));
  },
);

it.effect("treats missing representation and search scopes as empty, without a warning", () => {
  const { layer } = fixture({ response: () => Effect.succeed(Response.json({}, { status: 404 })) });
  const warnings: unknown[] = [];
  return Effect.gen(function* () {
    const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
    assert.isTrue(Option.isNone(yield* service.longTermMemory(captain)));
    assert.deepStrictEqual(yield* service.search(captain, "pnpm"), []);
    assert.deepStrictEqual(warnings, []);
  }).pipe(
    Effect.provide(layer),
    Effect.withLogger(Logger.make(({ message }) => warnings.push(message))),
  );
});

const transportFailure = (request: Parameters<BuildResponse>[0], code: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      cause: Object.assign(new Error(request.headers.authorization), { code }),
    }),
  });

it.effect("retries only explicit backpressure and connection failures before dispatch", () =>
  Effect.gen(function* () {
    const cases = [
      [429, 2],
      [503, 2],
      ["ECONNREFUSED", 2],
      ["ECONNRESET", 1],
      ["timeout", 1],
      [500, 1],
    ] as const;
    for (const [firstFailure, expectedWrites] of cases) {
      const { eventLayer, publish } = yield* eventFixture;
      const firstPost = yield* Deferred.make<void>();
      const { layer, posts } = fixture({
        eventLayer,
        response: (request) => {
          if (!request.url.endsWith("/messages") || posts().length > 1) {
            return Effect.succeed(new Response("{}"));
          }
          Deferred.doneUnsafe(firstPost, Effect.void);
          if (firstFailure === "timeout") return Effect.never;
          if (typeof firstFailure === "string") {
            return Effect.fail(transportFailure(request, firstFailure));
          }
          return Effect.succeed(new Response("error", { status: firstFailure }));
        },
      });

      yield* Effect.gen(function* () {
        const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
        yield* publish([itemEvent(userItem("Remember this"))]);
        yield* Deferred.await(firstPost);
        yield* TestClock.adjust("2 seconds");
        yield* service.drain;
        assert.lengthOf(posts(), expectedWrites, String(firstFailure));
      }).pipe(Effect.provide(layer));
    }
  }),
);

it.effect("does not expose authorization in log records, trace spans or errors", () => {
  let failure: "transport" | "http" = "transport";
  const { layer } = fixture({
    response: (request) =>
      failure === "transport"
        ? Effect.fail(transportFailure(request, "ECONNRESET"))
        : Effect.succeed(
            new Response(token, { status: 500, headers: { "x-honcho-error": token } }),
          ),
  });
  const records: unknown[] = [];
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const logger = Logger.make(({ message, logLevel, cause, fiber }) =>
    records.push({
      message,
      logLevel,
      cause,
      annotations: fiber.getRef(References.CurrentLogAnnotations),
      spans: fiber.getRef(References.CurrentLogSpans),
    }),
  );

  return Effect.gen(function* () {
    const service = yield* CaptainHonchoMemory.CaptainHonchoMemory;
    const read = yield* Effect.exit(service.longTermMemory(captain));
    assert.isTrue(Exit.isSuccess(read));
    failure = "http";
    const search = yield* Effect.exit(service.search(captain, "facts"));
    assert.isTrue(Exit.isSuccess(search));
    assert.lengthOf(records, 2);
    assert.isAtLeast(spans.length, 2);
    const evidence = {
      records,
      spans: spans.map((span) => ({
        name: span.name,
        attributes: [...span.attributes],
        events: span.events,
        exit: span.status._tag === "Ended" ? span.status.exit : undefined,
      })),
      exits: [read, search],
    };
    assert.notInclude(NodeUtil.inspect(evidence, { depth: null, customInspect: false }), token);
  }).pipe(Effect.provide(layer), Effect.withLogger(logger), Effect.withTracer(tracer));
});
