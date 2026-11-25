// @effect-diagnostics nodeBuiltinImport:off - Honcho IDs need a small stable synchronous hash.
import {
  isCaptainThreadId,
  type Captain,
  type CaptainId,
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
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";

import { forkParked } from "../serverActivation.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as CaptainStore from "./CaptainStore.ts";

const HONCHO_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const HONCHO_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HONCHO_ID_MAX_LENGTH = 512;
const HONCHO_MESSAGE_MAX_LENGTH = 24_000;
const MIRROR_QUEUE_CAPACITY = 128;
const MIRROR_TIMEOUT = "1500 millis";
const MEMORY_TIMEOUT = "2 seconds";
const USER_PEER_ID = "user";

const HonchoConfig = Schema.Struct({
  baseUrl: Schema.NonEmptyString.check(Schema.isPattern(/^https?:\/\/\S+$/i)),
  workspaceId: Schema.NonEmptyString.check(
    Schema.isPattern(HONCHO_ID_PATTERN),
    Schema.isMaxLength(HONCHO_ID_MAX_LENGTH),
  ),
  tokenFile: Schema.NonEmptyString,
});
type HonchoConfig = typeof HonchoConfig.Type;
const decodeHonchoConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(HonchoConfig));

const RepresentationResponse = Schema.Struct({ representation: Schema.String });
const MessageSearchResponse = Schema.Array(
  Schema.Struct({
    content: Schema.String,
    created_at: Schema.String,
  }),
);

class HonchoRequestError extends Schema.TaggedError<HonchoRequestError>()("HonchoRequestError", {
  operation: Schema.String,
  reason: Schema.Literals(["unavailable", "transport", "timeout", "http", "invalid_response"]),
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

const captainHonchoUserPeerId = () => USER_PEER_ID;

const trimHonchoMessage = (text: string) =>
  text.length <= HONCHO_MESSAGE_MAX_LENGTH ? text : `${text.slice(0, HONCHO_MESSAGE_MAX_LENGTH)}…`;

const retryable = (error: HonchoRequestError) =>
  error.reason === "transport" ||
  error.reason === "timeout" ||
  error.status === 429 ||
  (error.status !== undefined && error.status >= 500);

const mirrorableUserMessage = (item: OrchestrationV2TurnItem) =>
  item.type === "user_message" &&
  item.status === "completed" &&
  item.createdBy === "user" &&
  item.text.trim() !== "";

const mirrorableAssistantMessage = (item: OrchestrationV2TurnItem) =>
  item.type === "assistant_message" &&
  item.status === "completed" &&
  item.delivery !== "async" &&
  (item.phase === undefined || item.phase === "final_answer") &&
  item.text.trim() !== "";

export interface CaptainHonchoMemoryShape {
  readonly enabled: boolean;
  readonly mirrorTurnItem: (item: OrchestrationV2TurnItem) => Effect.Effect<void>;
  readonly longTermMemory: (captain: Captain) => Effect.Effect<Option.Option<string>>;
  readonly search: (
    captain: Captain,
    query: string | undefined,
  ) => Effect.Effect<ReadonlyArray<string>>;
  /** Test hook: completes after every job queued before it has finished. */
  readonly drain: Effect.Effect<void>;
}

export class CaptainHonchoMemory extends Context.Service<
  CaptainHonchoMemory,
  CaptainHonchoMemoryShape
>()("t3/captains/CaptainHonchoMemory") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const http = yield* Effect.serviceOption(HttpClient.HttpClient);
  const captainStore = yield* Effect.serviceOption(CaptainStore.CaptainStore);
  const eventSink = yield* Effect.serviceOption(EventSink.EventSinkV2);

  const configuredPath = environment.T3CODE_HONCHO_CONFIG?.trim();
  const home = environment.HOME?.trim();
  const configPath =
    configuredPath !== undefined && configuredPath !== ""
      ? configuredPath
      : home !== undefined && home !== ""
        ? path.join(home, ".config", "ksg-code", "honcho.json")
        : path.join(".config", "ksg-code", "honcho.json");

  const config = yield* fs
    .readFileString(configPath)
    .pipe(Effect.flatMap(decodeHonchoConfig), Effect.option);
  if (Option.isNone(config)) {
    yield* Effect.logWarning("Captain Honcho memory is disabled.", {
      reason: "config_unavailable",
      configPath,
    });
  }

  const tokenDisabled = yield* Ref.make(false);
  const tokenWarningLogged = yield* Ref.make(false);
  const sessionsPrepared = yield* Ref.make<ReadonlySet<string>>(new Set());
  const enqueuedItems = yield* Ref.make<ReadonlySet<string>>(new Set());
  const jobs = yield* Queue.bounded<MirrorJob>(MIRROR_QUEUE_CAPACITY);

  const readToken = Effect.fnUntraced(function* (): Effect.fn.Return<Option.Option<string>> {
    if (Option.isNone(config) || (yield* Ref.get(tokenDisabled))) return Option.none<string>();
    const stored = yield* fs.readFileString(config.value.tokenFile).pipe(Effect.option);
    const token = Option.getOrUndefined(stored)?.trim() ?? "";
    if (!HONCHO_TOKEN_PATTERN.test(token)) {
      yield* Ref.set(tokenDisabled, true);
      const first = yield* Ref.modify(tokenWarningLogged, (logged) => [!logged, true] as const);
      if (first) {
        yield* Effect.logWarning("Captain Honcho memory is disabled.", {
          reason: "token_unavailable",
        });
      }
      return Option.none<string>();
    }
    return Option.some(token);
  });

  const execute = Effect.fnUntraced(function* (
    operation: string,
    request: HttpClientRequest.HttpClientRequest,
    timeout: typeof MIRROR_TIMEOUT | typeof MEMORY_TIMEOUT,
  ): Effect.fn.Return<HttpClientResponse.HttpClientResponse, HonchoRequestError> {
    const token = yield* readToken();
    if (Option.isNone(token) || Option.isNone(http)) {
      return yield* new HonchoRequestError({ operation, reason: "unavailable" });
    }
    const transport = http.value.execute(HttpClientRequest.bearerToken(request, token.value)).pipe(
      // A redirect could carry the bearer token to another origin. The underlying error is
      // deliberately discarded because client errors can retain request headers.
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.mapError(() => new HonchoRequestError({ operation, reason: "transport" as const })),
    );
    return yield* transport.pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(new HonchoRequestError({ operation, reason: "timeout" as const })),
      }),
    );
  });

  const requestUnit = Effect.fnUntraced(function* (
    operation: string,
    request: HttpClientRequest.HttpClientRequest,
    timeout: typeof MIRROR_TIMEOUT | typeof MEMORY_TIMEOUT,
  ): Effect.fn.Return<void, HonchoRequestError> {
    const response = yield* execute(operation, request, timeout);
    if (response.status < 200 || response.status >= 300) {
      return yield* new HonchoRequestError({
        operation,
        reason: "http",
        status: response.status,
      });
    }
  });

  const requestJson = Effect.fnUntraced(function* <A>(
    operation: string,
    request: HttpClientRequest.HttpClientRequest,
    schema: Schema.Codec<A, unknown, never, never>,
  ): Effect.fn.Return<A, HonchoRequestError> {
    const response = yield* execute(operation, request, MEMORY_TIMEOUT);
    if (response.status < 200 || response.status >= 300) {
      return yield* new HonchoRequestError({
        operation,
        reason: "http",
        status: response.status,
      });
    }
    const body = yield* response.json.pipe(
      Effect.mapError(
        () => new HonchoRequestError({ operation, reason: "invalid_response" as const }),
      ),
    );
    return yield* Schema.decodeEffect(schema)(body).pipe(
      Effect.mapError(
        () => new HonchoRequestError({ operation, reason: "invalid_response" as const }),
      ),
    );
  });

  const endpoint = (path: string) =>
    config._tag === "Some"
      ? `${config.value.baseUrl.replace(/\/+$/, "")}/v3/workspaces/${encodeURIComponent(config.value.workspaceId)}${path}`
      : "";

  const prepareSession = Effect.fnUntraced(function* (input: {
    readonly captainId: CaptainId;
    readonly threadId: ThreadId;
  }) {
    if (Option.isNone(config)) return;
    const sessionId = captainHonchoSessionId(input.threadId);
    if ((yield* Ref.get(sessionsPrepared)).has(sessionId)) return;
    const captainPeerId = captainHonchoPeerId(input.captainId);
    yield* requestUnit(
      "prepare duet memory session",
      HttpClientRequest.post(endpoint("/sessions")).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          id: sessionId,
          metadata: {
            t3CaptainId: input.captainId,
            t3ThreadId: input.threadId,
          },
          peers: {
            [captainHonchoUserPeerId()]: { observe_me: true, observe_others: false },
            [captainPeerId]: { observe_me: true, observe_others: true },
          },
        }),
      ),
      MIRROR_TIMEOUT,
    );
    yield* Ref.update(sessionsPrepared, (sessions) => new Set(sessions).add(sessionId));
  });

  const postMirror = Effect.fnUntraced(function* (job: Extract<MirrorJob, { type: "message" }>) {
    if (Option.isNone(config)) return;
    yield* prepareSession(job);
    yield* requestUnit(
      "mirror duet message",
      HttpClientRequest.post(
        endpoint(`/sessions/${encodeURIComponent(captainHonchoSessionId(job.threadId))}/messages`),
      ).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          messages: [
            {
              peer_id:
                job.role === "user"
                  ? captainHonchoUserPeerId()
                  : captainHonchoPeerId(job.captainId),
              content: trimHonchoMessage(job.text),
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
    );
  });

  const processMirrorJob = Effect.fnUntraced(function* (job: MirrorJob) {
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
          () =>
            job.type === "message"
              ? Effect.logWarning("Captain Honcho memory dropped a mirrored message.", {
                  threadId: job.threadId,
                  itemId: job.itemId,
                })
              : Effect.void,
        ),
      ),
    ),
  );

  const mirrorTurnItem = Effect.fn("CaptainHonchoMemory.mirrorTurnItem")(function* (
    item: OrchestrationV2TurnItem,
  ) {
    if (Option.isNone(config) || !isCaptainThreadId(item.threadId)) return;
    const role = mirrorableUserMessage(item)
      ? ("user" as const)
      : mirrorableAssistantMessage(item)
        ? ("assistant" as const)
        : undefined;
    if (role === undefined || Option.isNone(captainStore)) return;
    const captain = yield* captainStore.value
      .findByConversation(item.threadId)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (captain === undefined || captain.archivedAt !== null) return;
    const key = `${item.threadId}:${item.id}:${role}`;
    const first = yield* Ref.modify(enqueuedItems, (items) => {
      if (items.has(key)) return [false, items] as const;
      return [true, new Set(items).add(key)] as const;
    });
    if (!first) return;
    const accepted = Queue.offerUnsafe(jobs, {
      type: "message",
      captainId: captain.id,
      threadId: item.threadId,
      itemId: item.id,
      role,
      text:
        role === "user"
          ? (item as Extract<OrchestrationV2TurnItem, { type: "user_message" }>).text
          : (item as Extract<OrchestrationV2TurnItem, { type: "assistant_message" }>).text,
    });
    if (!accepted) {
      yield* Effect.logWarning("Captain Honcho memory dropped a mirrored message.", {
        reason: "queue_full",
        threadId: item.threadId,
        itemId: item.id,
      });
    }
  });

  if (Option.isSome(config) && Option.isSome(captainStore) && Option.isSome(eventSink)) {
    const afterSequence = yield* eventSink.value
      .latestSequence()
      .pipe(Effect.orElseSucceed(() => 0));
    yield* forkParked(
      Stream.runForEach(
        eventSink.value.stream({ afterSequence, eventType: "turn-item.updated" }),
        (stored) =>
          stored.event.type === "turn-item.updated"
            ? mirrorTurnItem(stored.event.payload)
            : Effect.void,
      ).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          () => Effect.logWarning("Captain Honcho memory mirroring stopped."),
        ),
      ),
    );
  }

  const withoutFailure =
    <A>(operation: string, fallback: A) =>
    <E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
      effect.pipe(
        Effect.catchCause(() =>
          Effect.logWarning("Captain Honcho memory request failed.", { operation }).pipe(
            Effect.as(fallback),
          ),
        ),
      );

  const longTermMemory = Effect.fn("CaptainHonchoMemory.longTermMemory")(function* (
    captain: Captain,
  ) {
    if (Option.isNone(config)) return Option.none<string>();
    return yield* requestJson(
      "read duet long-term memory",
      HttpClientRequest.post(
        endpoint(`/peers/${encodeURIComponent(captainHonchoPeerId(captain.id))}/representation`),
      ).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          target: captainHonchoUserPeerId(),
          max_conclusions: 25,
        }),
      ),
      RepresentationResponse,
    ).pipe(
      Effect.map(({ representation }) => {
        const text = representation.trim();
        return text === "" ? Option.none<string>() : Option.some(text);
      }),
      withoutFailure("read duet long-term memory", Option.none<string>()),
    );
  });

  const search = Effect.fn("CaptainHonchoMemory.search")(function* (
    captain: Captain,
    query: string | undefined,
  ) {
    if (Option.isNone(config)) return [];
    return yield* requestJson(
      "search duet long-term memory",
      HttpClientRequest.post(
        endpoint(`/peers/${encodeURIComponent(captainHonchoUserPeerId())}/search`),
      ).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          query: query ?? "important durable facts, preferences, decisions, and open loops",
          limit: 5,
        }),
      ),
      MessageSearchResponse,
    ).pipe(
      Effect.map((messages) =>
        messages
          .toSorted((left, right) => right.created_at.localeCompare(left.created_at))
          .map(({ content }) => content.trim())
          .filter((content) => content !== ""),
      ),
      withoutFailure("search duet long-term memory", [] as ReadonlyArray<string>),
    );
  });

  const drain = Effect.gen(function* () {
    const barrier = yield* Deferred.make<void>();
    yield* Queue.offer(jobs, { type: "barrier", deferred: barrier });
    yield* Deferred.await(barrier);
  });

  return CaptainHonchoMemory.of({
    enabled: Option.isSome(config),
    mirrorTurnItem,
    longTermMemory,
    search,
    drain,
  });
});

export const layer = Layer.effect(CaptainHonchoMemory, make);
