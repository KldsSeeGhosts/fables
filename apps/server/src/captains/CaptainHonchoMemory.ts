// @effect-diagnostics nodeBuiltinImport:off - Honcho IDs need a small stable synchronous hash.
import {
  isCaptainThreadId,
  OrchestrationV2TurnItemJson,
  type Captain,
  type CaptainId,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2TurnItem,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeCrypto from "node:crypto";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import { forkParked } from "../serverActivation.ts";
import * as CaptainStore from "./CaptainStore.ts";

const HONCHO_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const HONCHO_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HONCHO_ID_MAX_LENGTH = 512;
const HONCHO_MESSAGE_MAX_LENGTH = 24_000;
const MIRROR_QUEUE_CAPACITY = 128;
const PREPARED_SESSION_LIMIT = 512;
const MIRRORED_ITEM_LIMIT = 4096;
const MIRROR_TIMEOUT = "1500 millis";
const MEMORY_TIMEOUT = "2 seconds";
const USER_PEER_ID = "user";

const HonchoConfig = Schema.Struct({
  baseUrl: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString.check(
    Schema.isPattern(HONCHO_ID_PATTERN),
    Schema.isMaxLength(HONCHO_ID_MAX_LENGTH),
  ),
  tokenFile: Schema.NonEmptyString,
});
const decodeHonchoConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(HonchoConfig));
const decodeTurnItem = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2TurnItemJson),
);

const RepresentationResponse = Schema.Struct({ representation: Schema.String });
const MessageSearchResponse = Schema.Array(
  Schema.Struct({
    content: Schema.String,
    session_id: Schema.optional(Schema.String),
  }),
);

class HonchoRequestError extends Schema.TaggedError<HonchoRequestError>()("HonchoRequestError", {
  operation: Schema.String,
  reason: Schema.Literals([
    "unavailable",
    "connect",
    "transport",
    "timeout",
    "http",
    "invalid_response",
  ]),
  status: Schema.optional(Schema.Number),
}) {}

type MirrorJob =
  | {
      readonly type: "message";
      readonly captainId: CaptainId;
      readonly threadId: ThreadId;
      readonly itemId: string;
      readonly role: "user" | "assistant";
      readonly text: string;
    }
  | {
      readonly type: "barrier";
      readonly deferred: Deferred.Deferred<void>;
    };

const escapeHonchoPart = (value: string) => {
  let escaped = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    if (/^[a-zA-Z0-9-]$/.test(char)) escaped += char;
    else if (char === "_") escaped += "__";
    else escaped += `_${byte.toString(16).padStart(2, "0")}`;
  }
  return escaped;
};

const honchoId = (prefix: string, value: string) => {
  const escaped = escapeHonchoPart(value);
  const unsuffixed = `${prefix}${escaped}`;
  if (unsuffixed.length <= HONCHO_ID_MAX_LENGTH) return unsuffixed;
  const digest = NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
  const headLength = HONCHO_ID_MAX_LENGTH - prefix.length - digest.length - 1;
  return `${prefix}${escaped.slice(0, headLength)}_${digest}`;
};

const captainHonchoPeerId = (captainId: CaptainId) => honchoId("duet_", captainId);
const captainHonchoSessionId = (threadId: ThreadId) => honchoId("conversation_", threadId);

const trimHonchoMessage = (text: string) =>
  text.length <= HONCHO_MESSAGE_MAX_LENGTH
    ? text
    : `${text.slice(0, HONCHO_MESSAGE_MAX_LENGTH - 1)}…`;

const safeBaseUrl = (baseUrl: string) => {
  try {
    const url = new URL(baseUrl);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      !url.href.includes("?") &&
      !url.href.includes("#")
      ? url.href.replace(/\/+$/, "")
      : undefined;
  } catch {
    return undefined;
  }
};

const validToken = (token: string) => {
  if (!HONCHO_TOKEN_PATTERN.test(token)) return false;
  const [header, payload, signature] = token.split(".") as [string, string, string];
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const algorithm: unknown = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    return (
      Predicate.isObject(claims) &&
      !Array.isArray(claims) &&
      Predicate.hasProperty(algorithm, "alg") &&
      algorithm.alg === "HS256" &&
      Buffer.from(signature, "base64url").length === 32
    );
  } catch {
    return false;
  }
};

const beforeDispatchCodes = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const failedToConnect = (cause: unknown) => {
  const socketError = Predicate.hasProperty(cause, "cause") ? cause.cause : undefined;
  return [cause, socketError].some(
    (error) =>
      Predicate.hasProperty(error, "code") &&
      typeof error.code === "string" &&
      beforeDispatchCodes.has(error.code),
  );
};

const retryable = (error: HonchoRequestError) =>
  error.reason === "connect" || error.status === 429 || error.status === 503;

const rememberKey = (cache: Map<string, true>, key: string, limit: number) => {
  cache.delete(key);
  cache.set(key, true);
  if (cache.size > limit) cache.delete(cache.keys().next().value!);
};

const mirrorableUserMessage = (
  item: OrchestrationV2TurnItem,
): item is Extract<OrchestrationV2TurnItem, { type: "user_message" }> =>
  item.type === "user_message" &&
  item.status === "completed" &&
  item.createdBy === "user" &&
  item.scheduledTaskId === undefined &&
  item.senderThreadId === undefined &&
  item.linkedSender === undefined &&
  item.idleCompaction === undefined &&
  item.workflowScript !== true &&
  item.retryOfRunId === undefined &&
  item.text.trim() !== "";

const containsToken = (value: unknown, token: string) =>
  JSON.stringify(value)?.includes(token) === true;

export class CaptainHonchoMemory extends Context.Service<
  CaptainHonchoMemory,
  {
    readonly enabled: boolean;
    readonly longTermMemory: (captain: Captain) => Effect.Effect<Option.Option<string>>;
    readonly search: (
      captain: Captain,
      query: string | undefined,
    ) => Effect.Effect<ReadonlyArray<string>>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/captains/CaptainHonchoMemory") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const http = Option.map(yield* Effect.serviceOption(HttpClient.HttpClient), HttpClient.withScope);
  const captainStore = yield* Effect.serviceOption(CaptainStore.CaptainStore);
  const eventSink = yield* Effect.serviceOption(EventSink.EventSinkV2);
  const sql = yield* Effect.serviceOption(SqlClient.SqlClient);

  const configuredPath = environment.T3CODE_HONCHO_CONFIG?.trim();
  const useDefaultPath = configuredPath === undefined || configuredPath === "";
  const configPath = useDefaultPath
    ? path.join(environment.HOME?.trim() ?? "", ".config", "ksg-code", "honcho.json")
    : configuredPath;
  const config =
    configuredPath === "disabled"
      ? Option.none()
      : yield* fs.readFileString(configPath).pipe(
          Effect.flatMap(decodeHonchoConfig),
          Effect.flatMap((config) => {
            const baseUrl = safeBaseUrl(config.baseUrl);
            return baseUrl === undefined
              ? Effect.fail("invalid_base_url" as const)
              : Effect.succeed({ ...config, baseUrl });
          }),
          Effect.matchEffect({
            onSuccess: Effect.succeedSome,
            onFailure: (error) =>
              (useDefaultPath &&
              typeof error !== "string" &&
              error._tag === "PlatformError" &&
              error.reason._tag === "NotFound"
                ? Effect.logDebug("Duet Honcho memory config was not found.")
                : Effect.logWarning("Duet Honcho memory is disabled.", {
                    reason: "config_unavailable",
                  })
              ).pipe(Effect.as(Option.none())),
          }),
        );

  let tokenDisabled = false;
  const enabled = () => Option.isSome(config) && Option.isSome(http) && !tokenDisabled;
  const sessionsPrepared = new Map<string, true>();
  const enqueuedItems = new Map<string, true>();
  const jobs = yield* Queue.bounded<MirrorJob>(MIRROR_QUEUE_CAPACITY);

  // The request span covers the token read and every transport step.
  const readToken = Effect.fnUntraced(function* () {
    if (Option.isNone(config) || tokenDisabled) return Option.none<string>();
    const stored = yield* fs.readFileString(config.value.tokenFile).pipe(Effect.option);
    if (tokenDisabled) return Option.none<string>();
    const token = Option.getOrUndefined(stored)?.trim() ?? "";
    if (validToken(token)) return Option.some(token);

    tokenDisabled = true;
    yield* Effect.logWarning("Duet Honcho memory is disabled.", { reason: "token_unavailable" });
    return Option.none<string>();
  });

  const request = Effect.fn("CaptainHonchoMemory.request")(
    function* <A>(
      operation: string,
      request: HttpClientRequest.HttpClientRequest,
      timeout: typeof MIRROR_TIMEOUT | typeof MEMORY_TIMEOUT,
      readBody: (
        response: HttpClientResponse.HttpClientResponse,
      ) => Effect.Effect<A, HonchoRequestError>,
    ) {
      const token = yield* readToken();
      if (Option.isNone(token) || Option.isNone(http)) {
        return yield* new HonchoRequestError({ operation, reason: "unavailable" });
      }
      const response = yield* http.value
        .execute(HttpClientRequest.bearerToken(request, token.value))
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          // Client spans and failures can retain the original request with its authorization.
          Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          Effect.mapError(
            (error) =>
              new HonchoRequestError({
                operation,
                reason:
                  error.reason._tag === "TransportError" && failedToConnect(error.reason.cause)
                    ? "connect"
                    : "transport",
              }),
          ),
        );
      if (response.status < 200 || response.status >= 300) {
        return yield* new HonchoRequestError({
          operation,
          reason: "http",
          status: response.status,
        });
      }
      const body = yield* readBody(response);
      if (containsToken(body, token.value)) {
        return yield* new HonchoRequestError({ operation, reason: "invalid_response" });
      }
      return body;
    },
    (effect, operation, _request, duration) =>
      // Closing the client scope aborts stalled reads and cancels unused response bodies.
      Effect.scoped(effect).pipe(
        Effect.timeoutOrElse({
          duration,
          orElse: () => Effect.fail(new HonchoRequestError({ operation, reason: "timeout" })),
        }),
        Effect.catchDefect(() =>
          Effect.fail(new HonchoRequestError({ operation, reason: "transport" })),
        ),
      ),
  );

  const requestJson = <A>(
    operation: string,
    input: HttpClientRequest.HttpClientRequest,
    schema: Schema.Codec<A, unknown, never, never>,
  ) =>
    request(operation, input, MEMORY_TIMEOUT, (response) =>
      response.json.pipe(
        Effect.flatMap(Schema.decodeEffect(schema)),
        Effect.mapError(() => new HonchoRequestError({ operation, reason: "invalid_response" })),
      ),
    );

  const endpoint = (path: string) =>
    config._tag === "Some"
      ? `${config.value.baseUrl}/v3/workspaces/${config.value.workspaceId}${path}`
      : "";

  const prepareSession = Effect.fn("CaptainHonchoMemory.prepareSession")(function* (input: {
    readonly captainId: CaptainId;
    readonly threadId: ThreadId;
  }) {
    const sessionId = captainHonchoSessionId(input.threadId);
    if (sessionsPrepared.has(sessionId)) {
      rememberKey(sessionsPrepared, sessionId, PREPARED_SESSION_LIMIT);
      return;
    }
    const captainPeerId = captainHonchoPeerId(input.captainId);
    yield* request(
      "prepare duet memory session",
      HttpClientRequest.post(endpoint("/sessions")).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          id: sessionId,
          scopes: [captainPeerId],
          metadata: {
            t3CaptainId: input.captainId,
            t3ThreadId: input.threadId,
          },
          peers: {
            [USER_PEER_ID]: { observe_me: true, observe_others: false },
            [captainPeerId]: { observe_me: true, observe_others: true },
          },
        }),
      ),
      MIRROR_TIMEOUT,
      () => Effect.void,
    );
    rememberKey(sessionsPrepared, sessionId, PREPARED_SESSION_LIMIT);
  });

  const postMirror = Effect.fn("CaptainHonchoMemory.postMirror")(function* (
    job: Extract<MirrorJob, { type: "message" }>,
  ) {
    if (!enabled()) return;
    yield* prepareSession(job);
    yield* request(
      "mirror duet message",
      HttpClientRequest.post(
        endpoint(`/sessions/${encodeURIComponent(captainHonchoSessionId(job.threadId))}/messages`),
      ).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          messages: [
            {
              peer_id: job.role === "user" ? USER_PEER_ID : captainHonchoPeerId(job.captainId),
              content: job.text,
              metadata: {
                t3CaptainId: job.captainId,
                t3ThreadId: job.threadId,
                t3TurnItemId: job.itemId,
                t3Role: job.role,
              },
            },
          ],
        }),
      ),
      MIRROR_TIMEOUT,
      () => Effect.void,
    );
  });

  const processMirrorJob = Effect.fn("CaptainHonchoMemory.processMirrorJob")(function* (
    job: MirrorJob,
  ) {
    if (job.type === "barrier") {
      yield* Deferred.succeed(job.deferred, undefined);
      return;
    }
    yield* postMirror(job).pipe(
      Effect.retry({
        times: 2,
        schedule: Schedule.exponential("150 millis"),
        while: retryable,
      }),
    );
  });

  yield* forkParked(
    Stream.runForEach(Stream.fromQueue(jobs), (job) =>
      processMirrorJob(job).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            job.type === "message" &&
            Option.getOrUndefined(Cause.findErrorOption(cause))?.reason !== "unavailable"
              ? Effect.logWarning("Duet Honcho memory dropped a mirrored message.", {
                  threadId: job.threadId,
                  itemId: job.itemId,
                })
              : Effect.void,
        ),
      ),
    ),
  );

  const enqueueMessage = (
    captain: Captain,
    message: Pick<Extract<MirrorJob, { type: "message" }>, "itemId" | "text">,
    role: "user" | "assistant",
    dedupeId = message.itemId,
  ) =>
    Effect.suspend(() => {
      const threadId = captain.primaryThreadId;
      const key = `${threadId.length}:${threadId}:${role}:${dedupeId}`;
      if (enqueuedItems.has(key)) {
        rememberKey(enqueuedItems, key, MIRRORED_ITEM_LIMIT);
        return Effect.void;
      }
      if (
        Queue.offerUnsafe(jobs, {
          type: "message",
          captainId: captain.id,
          threadId,
          itemId: message.itemId,
          role,
          text: trimHonchoMessage(message.text),
        })
      ) {
        rememberKey(enqueuedItems, key, MIRRORED_ITEM_LIMIT);
        return Effect.void;
      }
      return Effect.logWarning("Duet Honcho memory dropped a mirrored message.", {
        reason: "queue_full",
        threadId,
        itemId: message.itemId,
      });
    });

  const mirrorEvent = Effect.fn("CaptainHonchoMemory.mirrorEvent")(function* ({
    event,
  }: OrchestrationV2StoredEvent) {
    if (!enabled() || Option.isNone(captainStore)) return;
    const captain = yield* captainStore.value.byThread(event.threadId);
    if (captain === undefined) return;

    if (event.type === "turn-item.updated" && mirrorableUserMessage(event.payload)) {
      yield* enqueueMessage(
        captain,
        { itemId: event.payload.id, text: event.payload.text },
        "user",
      );
    }
    if (event.type !== "provider-turn.updated" || Option.isNone(sql)) return;

    const turn = event.payload;
    const [prompt] = yield* sql.value<{ readonly payload_json: string }>`
      SELECT prompt.payload_json
      FROM orchestration_v2_projection_nodes AS root
      JOIN orchestration_v2_projection_runs AS run
        ON run.run_id = root.run_id AND run.thread_id = root.thread_id
      JOIN orchestration_v2_projection_turn_items AS prompt
        ON prompt.run_id = run.run_id AND prompt.thread_id = run.thread_id
        AND prompt.type = 'user_message'
        AND json_extract(prompt.payload_json, '$.messageId') = json_extract(run.payload_json, '$.userMessageId')
      WHERE root.node_id = ${turn.nodeId} AND root.thread_id = ${event.threadId}
        AND root.kind = 'root_turn'
      LIMIT 1
    `;
    if (
      prompt === undefined ||
      !mirrorableUserMessage(yield* decodeTurnItem(prompt.payload_json))
    ) {
      return;
    }

    const answers = yield* sql.value<{ readonly itemId: string; readonly text: string }>`
      SELECT item.turn_item_id AS itemId, json_extract(item.payload_json, '$.text') AS text
      FROM orchestration_v2_projection_turn_items AS item
      WHERE item.provider_turn_id = ${turn.id} AND item.thread_id = ${event.threadId}
        AND item.type = 'assistant_message' AND item.status = 'completed'
        AND item.parent_item_id IS NULL
        AND COALESCE(json_extract(item.payload_json, '$.streaming'), 0) = 0
        AND json_extract(item.payload_json, '$.delivery') IS NULL
        AND COALESCE(json_extract(item.payload_json, '$.phase'), 'final_answer') = 'final_answer'
      ORDER BY item.ordinal DESC
    `;
    const answer = answers.find(({ text }) => typeof text === "string" && text.trim() !== "");
    if (answer !== undefined) yield* enqueueMessage(captain, answer, "assistant", turn.id);
  });

  if (enabled() && Option.isSome(captainStore) && Option.isSome(eventSink)) {
    const afterSequence = yield* eventSink.value
      .latestSequence()
      .pipe(Effect.orElseSucceed(() => 0));
    yield* forkParked(
      eventSink.value.stream({ afterSequence }).pipe(
        Stream.filter(
          ({ event }) =>
            enabled() &&
            isCaptainThreadId(event.threadId) &&
            ((event.type === "turn-item.updated" && mirrorableUserMessage(event.payload)) ||
              (event.type === "provider-turn.updated" && event.payload.status === "completed")),
        ),
        Stream.runForEach((stored) =>
          mirrorEvent(stored).pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              () => Effect.logWarning("Duet Honcho memory could not read a conversation update."),
            ),
          ),
        ),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          () => Effect.logWarning("Duet Honcho memory mirroring stopped."),
        ),
      ),
    );
  }

  const withoutFailure =
    <A>(operation: string, fallback: A, emptyStatus?: number) =>
    <R>(effect: Effect.Effect<A, HonchoRequestError, R>) => {
      const warn = Effect.logWarning("Duet Honcho memory request failed.", { operation }).pipe(
        Effect.as(fallback),
      );
      return effect.pipe(
        Effect.catch((error) =>
          error.reason === "unavailable" ||
          (emptyStatus !== undefined && error.status === emptyStatus)
            ? Effect.succeed(fallback)
            : warn,
        ),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          () => warn,
        ),
      );
    };

  const longTermMemory = Effect.fn("CaptainHonchoMemory.longTermMemory")(function* (
    captain: Captain,
  ) {
    if (!enabled()) return Option.none<string>();
    const peerId = captainHonchoPeerId(captain.id);
    return yield* requestJson(
      "read duet long-term memory",
      HttpClientRequest.post(endpoint(`/peers/${peerId}/representation`)).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          target: USER_PEER_ID,
          scope: peerId,
        }),
      ),
      RepresentationResponse,
    ).pipe(
      Effect.map(({ representation }) => {
        const text = representation.trim();
        return text === "" ? Option.none<string>() : Option.some(text);
      }),
      withoutFailure("read duet long-term memory", Option.none<string>(), 404),
    );
  });

  const search = Effect.fn("CaptainHonchoMemory.search")(function* (
    captain: Captain,
    query: string | undefined,
  ) {
    if (!enabled()) return [];
    const sessions = new Set(
      [captain.primaryThreadId, ...captain.earlierThreadIds].map(captainHonchoSessionId),
    );
    return yield* requestJson(
      "search duet long-term memory",
      HttpClientRequest.post(endpoint("/search")).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          query: query ?? "important durable facts, preferences, decisions, and open loops",
          limit: 5,
          scope: captainHonchoPeerId(captain.id),
        }),
      ),
      MessageSearchResponse,
    ).pipe(
      Effect.map((messages) =>
        messages
          .filter(({ session_id }) => session_id !== undefined && sessions.has(session_id))
          .map(({ content }) => content.trim())
          .filter((content) => content !== ""),
      ),
      withoutFailure("search duet long-term memory", [] as ReadonlyArray<string>, 404),
    );
  });

  const drain = Effect.gen(function* () {
    const barrier = yield* Deferred.make<void>();
    yield* Queue.offer(jobs, { type: "barrier", deferred: barrier });
    yield* Deferred.await(barrier);
  });

  return CaptainHonchoMemory.of({
    get enabled() {
      return enabled();
    },
    longTermMemory,
    search,
    drain,
  });
});

export const layer = Layer.effect(CaptainHonchoMemory, make);
