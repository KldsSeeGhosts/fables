import {
  Captain,
  CaptainDocument,
  CaptainDocumentName,
  CaptainError,
  CaptainMemory,
  ChatAttachment,
  type EnvironmentId,
  type OrchestrationV2RunStatus,
  CommandId,
  isCaptainThreadId,
  MessageId,
  ModelSelection,
  OrchestrationMessageContext,
  OrchestrationV2Actor,
  OrchestrationV2CreationSource,
  OrchestrationV2LinkedSender,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  type ProviderThreadId,
  type RunId,
  type CaptainDeleteMemoryInput,
  CaptainId,
  type CaptainSnapshot,
  type CaptainSubscribeInput,
  type CaptainUpdateDocumentInput,
  type CaptainUpsertMemoryInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";

const CaptainRow = Schema.Struct({
  ...Captain.fields,
  avatar: Schema.fromJsonString(Captain.fields.avatar),
  earlierThreadIds: Schema.fromJsonString(Captain.fields.earlierThreadIds),
  earlierThreadEndReasons: Schema.fromJsonString(Captain.fields.earlierThreadEndReasons),
  scopedProjectIds: Schema.fromJsonString(Captain.fields.scopedProjectIds),
  coordinatorOnly: Schema.BooleanFromBit,
});
const RolloverResendJson = Schema.fromJsonString(
  Schema.Struct({
    projectId: ProjectId,
    commandId: CommandId,
    threadId: ThreadId,
    messageId: MessageId,
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
    context: Schema.optionalKey(OrchestrationMessageContext),
    mode: Schema.Literal("queue"),
    modelSelection: Schema.optionalKey(ModelSelection),
    freshContext: Schema.optionalKey(Schema.Boolean),
    outputSchema: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
    createdBy: OrchestrationV2Actor,
    creationSource: OrchestrationV2CreationSource,
    scheduledTaskId: Schema.optionalKey(ScheduledTaskId),
    senderThreadId: Schema.optionalKey(ThreadId),
    linkedSender: Schema.optionalKey(OrchestrationV2LinkedSender),
  }),
);
const encodeRolloverResend = Schema.encodeEffect(RolloverResendJson);
const decodeRolloverResend = Schema.decodeUnknownEffect(RolloverResendJson);

const MemoryRow = Schema.Struct({
  ...CaptainMemory.fields,
  essential: Schema.BooleanFromBit,
  userControlled: Schema.BooleanFromBit,
});
const decodeCaptain = Schema.decodeUnknownEffect(CaptainRow);
const encodeCaptain = Schema.encodeEffect(CaptainRow);
const decodeDocument = Schema.decodeUnknownEffect(CaptainDocument);
const decodeMemory = Schema.decodeUnknownEffect(MemoryRow);

export const captainUnavailable = (cause: unknown) =>
  Effect.logWarning("Duet operation failed.", { cause }).pipe(
    Effect.andThen(
      new CaptainError({ code: "unavailable", message: "Could not access Duet state." }),
    ),
  );

const missing = () => new CaptainError({ code: "not_found", message: "Duet not found." });

export const activeChorusConflict = () =>
  new CaptainError({
    code: "conflict",
    message: "An active Chorus already exists on this machine.",
  });

const isActiveChorusUniqueViolation = (cause: unknown) =>
  SqlError.isSqlError(cause) &&
  cause.reason._tag === "UniqueViolation" &&
  cause.reason.constraint === "captains.kind";

export class ChorusRouteDispatch extends Context.Service<
  ChorusRouteDispatch,
  {
    readonly commandId: CommandId;
    readonly messageId: MessageId;
    readonly environmentId: EnvironmentId;
    readonly sourceCaptainId: CaptainId;
    readonly sourceThreadId: ThreadId;
    readonly duetId: CaptainId;
  }
>()("t3/captains/CaptainStore/ChorusRouteDispatch") {}

export const commitChorusRoute = Effect.fn("CaptainStore.commitChorusRoute")(function* (
  route: ChorusRouteDispatch["Service"],
  threadId: ThreadId,
  sentAt: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const inserted = yield* sql`
    INSERT INTO chorus_routes (
      message_id, run_id, environment_id, source_captain_id, source_thread_id, duet_id,
      thread_id, sent_at, last_seen_status
    )
    SELECT m.message_id, r.run_id, ${route.environmentId}, source.id, source.primary_thread_id,
      destination.id, r.thread_id, ${sentAt}, r.status
    FROM orchestration_v2_projection_messages AS m
    JOIN orchestration_v2_projection_runs AS r ON r.run_id = m.run_id
    JOIN captains AS source ON source.id = ${route.sourceCaptainId}
    JOIN captains AS destination ON destination.id = ${route.duetId}
    WHERE m.message_id = ${route.messageId} AND r.thread_id = ${threadId}
      AND source.kind = 'chorus' AND source.archived_at IS NULL
      AND source.primary_thread_id = ${route.sourceThreadId}
      AND destination.kind = 'duet' AND destination.archived_at IS NULL
      AND destination.primary_thread_id = r.thread_id
    RETURNING message_id
  `;
  if (inserted.length === 0) {
    return yield* new CaptainError({
      code: "conflict",
      message:
        "The Chorus or destination Duet changed before routing could finish. Retry the route.",
    });
  }
});

export interface ChorusRoute {
  readonly messageId: MessageId;
  readonly runId: RunId;
  readonly environmentId: EnvironmentId;
  readonly sourceCaptainId: CaptainId;
  readonly sourceThreadId: ThreadId;
  readonly duetId: CaptainId;
  readonly threadId: ThreadId;
  readonly sentAt: string;
  readonly lastSeenStatus: OrchestrationV2RunStatus | "unknown";
  readonly result: string | null;
}

/** `profile` changes the Captain list; `content` only that Captain's documents or memories. */
type CaptainChange = { readonly captainId: CaptainId; readonly kind: "profile" | "content" };

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<CaptainChange>();
  const notify = (captainId: CaptainId, kind: CaptainChange["kind"] = "profile") =>
    PubSub.publish(changes, { captainId, kind }).pipe(Effect.asVoid);
  const transact = sql.withTransaction;

  const profiles = sql`SELECT id, name, role, instructions, avatar,
    primary_thread_id AS primaryThreadId, earlier_thread_ids AS earlierThreadIds,
    earlier_thread_end_reasons AS earlierThreadEndReasons,
    scoped_project_ids AS scopedProjectIds, report_policy AS reportPolicy,
    coordinator_only AS coordinatorOnly, kind,
    created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt
    FROM captains`;
  const documents = sql`SELECT captain_id AS captainId, name, content, revision,
    updated_at AS updatedAt FROM captain_documents`;
  const memories = sql`SELECT captain_id AS captainId, id, text, essential,
    user_controlled AS userControlled, created_at AS createdAt, updated_at AS updatedAt
    FROM captain_memories`;

  const findPrimary = Effect.fn("CaptainStore.findPrimary")(function* (threadId: ThreadId) {
    const [row] = yield* sql`
      ${profiles} WHERE primary_thread_id = ${threadId}
    `;
    return row === undefined ? undefined : yield* decodeCaptain(row);
  }, Effect.catch(captainUnavailable));

  const findByConversation = Effect.fn("CaptainStore.findByConversation")(function* (
    threadId: ThreadId,
  ) {
    if (!isCaptainThreadId(threadId)) return undefined;
    const encodedId = threadId.slice("captain:".length, threadId.lastIndexOf(":"));
    if (encodedId === "") return undefined;
    const captain = yield* find(CaptainId.make(encodedId));
    return captain !== undefined &&
      (captain.primaryThreadId === threadId || captain.earlierThreadIds.includes(threadId))
      ? captain
      : undefined;
  }, Effect.catch(captainUnavailable));

  const byThread = Effect.fn("CaptainStore.byThread")(function* (threadId: ThreadId) {
    const captain = yield* findPrimary(threadId);
    return captain?.archivedAt === null ? captain : undefined;
  });

  const find = Effect.fn("CaptainStore.find")(function* (id: CaptainId) {
    const [row] = yield* sql`${profiles} WHERE id = ${id}`;
    return row === undefined ? undefined : yield* decodeCaptain(row);
  }, Effect.catch(captainUnavailable));

  const requireCaptain = Effect.fn("CaptainStore.requireCaptain")(function* (id: CaptainId) {
    const captain = yield* find(id);
    if (captain === undefined) return yield* missing();
    return captain;
  });

  const findActiveChorus = Effect.fn("CaptainStore.findActiveChorus")(function* () {
    const [row] = yield* sql`
      ${profiles} WHERE kind = 'chorus' AND archived_at IS NULL LIMIT 1
    `;
    return row === undefined ? undefined : yield* decodeCaptain(row);
  }, Effect.catch(captainUnavailable));

  const privateChorusConversationIds = Effect.fn("CaptainStore.privateChorusConversationIds")(
    function* (callerId: ThreadId | undefined) {
      const rows = yield* sql<{ readonly id: ThreadId }>`
        WITH private_choruses AS (
          SELECT primary_thread_id, earlier_thread_ids FROM captains
          WHERE kind = 'chorus' AND (archived_at IS NOT NULL OR primary_thread_id <> ${callerId ?? ""})
        )
        SELECT primary_thread_id AS id FROM private_choruses
        UNION ALL
        SELECT earlier.value AS id FROM private_choruses, json_each(earlier_thread_ids) AS earlier
      `;
      return new Set(rows.map(({ id }) => id));
    },
    Effect.catchTags({ SqlError: captainUnavailable }),
  );

  const activeDuetRoster = Effect.fn("CaptainStore.activeDuetRoster")(
    function* (limit: number) {
      const rows = yield* sql<{ readonly total: number }>`
        SELECT active.*, count(*) OVER () AS total
        FROM (${profiles} WHERE kind = 'duet' AND archived_at IS NULL) AS active
        ORDER BY createdAt, id LIMIT ${limit}
      `;
      const duets = yield* Effect.forEach(rows, (row) => decodeCaptain(row));
      return { duets, total: rows[0]?.total ?? 0 };
    },
    Effect.catchTags({ SqlError: captainUnavailable, SchemaError: captainUnavailable }),
  );

  const listChorusRoutes = Effect.fn("CaptainStore.listChorusRoutes")(function* (
    sourceCaptainId: CaptainId,
  ) {
    return yield* sql<ChorusRoute>`
        SELECT message_id AS messageId, run_id AS runId, environment_id AS environmentId,
          source_captain_id AS sourceCaptainId, source_thread_id AS sourceThreadId,
          duet_id AS duetId, thread_id AS threadId, sent_at AS sentAt,
          last_seen_status AS lastSeenStatus, result
        FROM chorus_routes
        WHERE source_captain_id = ${sourceCaptainId}
        ORDER BY sent_at, message_id
      `;
  }, Effect.catch(captainUnavailable));

  const terminalChorusRouteRun = sql`run.status IN ${sql.in([
    "completed",
    "failed",
    "cancelled",
    "interrupted",
    "rolled_back",
  ] satisfies ReadonlyArray<OrchestrationV2RunStatus>)}`;
  const listChorusRouteUpdates = Effect.fn("CaptainStore.listChorusRouteUpdates")(function* (
    sourceCaptainId: CaptainId,
    limit: number,
  ) {
    return yield* sql<{
      readonly messageId: MessageId;
      readonly threadId: ThreadId;
      readonly duetName: string | null;
      readonly runId: RunId;
      readonly status: ChorusRoute["lastSeenStatus"];
      readonly result: string | null;
      readonly terminal: 0 | 1;
    }>`
      SELECT route.message_id AS messageId, route.thread_id AS threadId, duet.name AS duetName,
        COALESCE(run.run_id, route.run_id) AS runId, COALESCE(run.status, 'unknown') AS status,
        CASE WHEN ${terminalChorusRouteRun}
          THEN COALESCE((
            SELECT substr(json_extract(answer.payload_json, '$.text'), 1, 1000)
            FROM orchestration_v2_projection_messages AS answer
            WHERE answer.run_id = run.run_id AND answer.role = 'assistant' AND answer.streaming = 0
            ORDER BY answer.created_at DESC, answer.message_id DESC LIMIT 1
          ), route.result)
        END AS result,
        COALESCE(${terminalChorusRouteRun}, 0)
          AS terminal
      FROM chorus_routes AS route
      LEFT JOIN orchestration_v2_projection_messages AS prompt ON prompt.message_id = route.message_id
      LEFT JOIN orchestration_v2_projection_runs AS run
        ON run.run_id = prompt.run_id AND run.thread_id = route.thread_id
      LEFT JOIN captains AS duet ON duet.id = route.duet_id
      WHERE route.source_captain_id = ${sourceCaptainId}
        AND CASE WHEN ${terminalChorusRouteRun}
          THEN route.settled_run_id = run.run_id
          ELSE COALESCE(run.status, 'unknown') <> route.last_seen_status
        END
      ORDER BY route.sent_at, route.message_id
      LIMIT ${limit}
    `;
  }, Effect.catch(captainUnavailable));

  const settleChorusRouteRun = Effect.fn("CaptainStore.settleChorusRouteRun")(function* (
    threadId: ThreadId,
    runId: RunId,
  ) {
    yield* sql`
      UPDATE chorus_routes SET settled_run_id = ${runId}, run_id = ${runId}
      WHERE thread_id = ${threadId} AND settled_run_id IS NOT ${runId}
        AND EXISTS (
          SELECT 1 FROM orchestration_v2_projection_messages AS prompt
          WHERE prompt.message_id = chorus_routes.message_id AND prompt.run_id = ${runId}
        )
    `;
  }, Effect.catch(captainUnavailable));

  const restoreChorusRouteSettlements = Effect.fn("CaptainStore.restoreChorusRouteSettlements")(
    function* () {
      yield* sql`
        UPDATE chorus_routes AS route
        SET settled_run_id = run.run_id, run_id = run.run_id
        FROM orchestration_v2_projection_messages AS prompt
        JOIN orchestration_v2_projection_runs AS run ON run.run_id = prompt.run_id
        WHERE prompt.message_id = route.message_id AND run.thread_id = route.thread_id
          AND route.settled_run_id IS NOT run.run_id
          AND ${terminalChorusRouteRun}
      `;
    },
    Effect.catch(captainUnavailable),
  );

  const acceptedChorusRouteThread = Effect.fn("CaptainStore.acceptedChorusRouteThread")(function* (
    commandId: CommandId,
  ) {
    const [row] = yield* sql<{ readonly threadId: ThreadId }>`
        SELECT aggregate_id AS threadId
        FROM orchestration_command_receipts
        WHERE command_id = ${commandId} AND aggregate_kind = 'thread' AND status = 'accepted'
      `;
    return row?.threadId;
  }, Effect.catch(captainUnavailable));

  const markChorusRoutesDelivered = Effect.fn("CaptainStore.markChorusRoutesDelivered")(
    function* (
      updates: ReadonlyArray<{
        readonly messageId: MessageId;
        readonly status: ChorusRoute["lastSeenStatus"];
        readonly terminal: boolean;
      }>,
    ) {
      for (const { messageId, status, terminal } of updates) {
        if (terminal) {
          yield* sql`DELETE FROM chorus_routes WHERE message_id = ${messageId}`;
        } else {
          yield* sql`UPDATE chorus_routes SET last_seen_status = ${status} WHERE message_id = ${messageId}`;
        }
      }
    },
    transact,
    Effect.catch(captainUnavailable),
  );

  const requireOwner = Effect.fn("CaptainStore.requireOwner")(function* (
    id: CaptainId,
    threadId: ThreadId | undefined,
  ) {
    const captain = threadId === undefined ? yield* requireCaptain(id) : yield* byThread(threadId);
    if (captain?.id !== id) return yield* missing();
    return captain;
  });

  const save = Effect.fn("CaptainStore.save")(
    function* (captain: Captain) {
      const row = yield* encodeCaptain({
        ...captain,
        earlierThreadEndReasons: captain.earlierThreadEndReasons ?? [],
      });
      yield* sql`
      INSERT INTO captains (
        id, name, role, instructions, avatar, primary_thread_id, earlier_thread_ids,
        earlier_thread_end_reasons, scoped_project_ids, report_policy, coordinator_only, kind,
        created_at, updated_at, archived_at
      ) VALUES (
        ${captain.id}, ${captain.name}, ${captain.role}, ${captain.instructions},
        ${row.avatar}, ${captain.primaryThreadId},
        ${row.earlierThreadIds}, ${row.earlierThreadEndReasons}, ${row.scopedProjectIds},
        ${captain.reportPolicy}, ${row.coordinatorOnly}, ${captain.kind},
        ${captain.createdAt}, ${captain.updatedAt}, ${captain.archivedAt}
      ) ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, role = excluded.role, instructions = excluded.instructions,
        avatar = excluded.avatar, primary_thread_id = excluded.primary_thread_id,
        earlier_thread_ids = excluded.earlier_thread_ids,
        earlier_thread_end_reasons = excluded.earlier_thread_end_reasons,
        scoped_project_ids = excluded.scoped_project_ids,
        report_policy = excluded.report_policy, coordinator_only = excluded.coordinator_only,
        kind = excluded.kind, updated_at = excluded.updated_at, archived_at = excluded.archived_at
    `;
      return captain;
    },
    Effect.catch((cause) =>
      isActiveChorusUniqueViolation(cause)
        ? Effect.fail(activeChorusConflict())
        : captainUnavailable(cause),
    ),
  );

  const latestCompletedCompactionAt = Effect.fn("CaptainStore.latestCompletedCompactionAt")(
    function* (threadId: ThreadId, providerThreadId: ProviderThreadId) {
      const [row] = yield* sql<{ readonly completedAt: string }>`
        SELECT COALESCE(json_extract(payload_json, '$.completedAt'), updated_at) AS completedAt
        FROM orchestration_v2_projection_turn_items
        WHERE thread_id = ${threadId} AND type = 'compaction' AND status = 'completed'
          AND provider_thread_id = ${providerThreadId}
        ORDER BY completedAt DESC LIMIT 1
      `;
      return row?.completedAt;
    },
    Effect.catch(captainUnavailable),
  );

  const saveRolloverResend = Effect.fn("CaptainStore.saveRolloverResend")(function* (
    runId: RunId,
    sourceMessageId: MessageId,
    send: typeof RolloverResendJson.Type,
  ) {
    const payload = yield* encodeRolloverResend(send);
    yield* sql`
        INSERT INTO captain_rollover_resends (command_id, source_run_id, thread_id, payload_json)
        VALUES (${send.commandId}, ${runId}, ${send.threadId}, ${payload})
      `;
    yield* sql`
        UPDATE chorus_routes
        SET message_id = ${send.messageId}, thread_id = ${send.threadId},
            last_seen_status = 'unknown', result = NULL, settled_run_id = NULL
        WHERE message_id = ${sourceMessageId}
      `;
  }, Effect.catch(captainUnavailable));

  const pendingRolloverResends = Effect.fn("CaptainStore.pendingRolloverResends")(function* (
    threadId: ThreadId | undefined,
  ) {
    const rows = yield* sql<{ readonly payload: string }>`
        SELECT payload_json AS payload FROM captain_rollover_resends
        ${threadId === undefined ? sql`` : sql`WHERE thread_id = ${threadId}`}
        ORDER BY id
      `;
    return yield* Effect.forEach(rows, (row) => decodeRolloverResend(row.payload));
  }, Effect.catch(captainUnavailable));

  const clearRolloverResend = Effect.fn("CaptainStore.clearRolloverResend")(function* (
    commandId: CommandId,
  ) {
    yield* sql`DELETE FROM captain_rollover_resends WHERE command_id = ${commandId}`;
  }, Effect.catch(captainUnavailable));

  const remove = Effect.fn("CaptainStore.remove")(function* (id: CaptainId) {
    yield* transact(
      Effect.gen(function* () {
        yield* sql`
            DELETE FROM captain_rollover_resends WHERE thread_id IN (
              SELECT primary_thread_id FROM captains WHERE id = ${id}
              UNION ALL
              SELECT earlier.value FROM captains, json_each(captains.earlier_thread_ids) AS earlier
              WHERE captains.id = ${id}
            )
          `;
        yield* sql`DELETE FROM captains WHERE id = ${id}`;
      }),
    );
    yield* notify(id);
  }, Effect.catch(captainUnavailable));

  const document = Effect.fn("CaptainStore.document")(function* (
    captain: Captain,
    name: CaptainDocumentName,
  ) {
    const [row] = yield* sql`${documents} WHERE captain_id = ${captain.id} AND name = ${name}`;
    return row === undefined
      ? { captainId: captain.id, name, content: "", revision: 0, updatedAt: captain.createdAt }
      : yield* decodeDocument(row);
  }, Effect.catch(captainUnavailable));

  const listMemories = Effect.fn("CaptainStore.listMemories")(function* (
    captainId: CaptainId | undefined,
    options: { readonly essential?: boolean; readonly query?: string; readonly limit: number },
  ) {
    const rows = yield* sql`
      ${memories} WHERE 1 = 1
        ${captainId === undefined ? sql`` : sql`AND captain_id = ${captainId}`}
        AND (${options.essential ? 1 : 0} = 0 OR essential = 1)
        AND instr(lower(text), lower(${options.query ?? ""})) > 0
      ORDER BY essential DESC, updated_at DESC, id LIMIT ${options.limit}
    `;
    return yield* Effect.forEach(rows, (row) => decodeMemory(row));
  }, Effect.catch(captainUnavailable));

  const updateDocument = Effect.fn("CaptainStore.updateDocument")(
    function* (input: CaptainUpdateDocumentInput, ownerThreadId?: ThreadId) {
      const updated = yield* transact(
        Effect.gen(function* () {
          const captain = yield* requireOwner(input.captainId, ownerThreadId);
          const current = yield* document(captain, input.name);
          if (current.revision !== input.expectedRevision) {
            return yield* new CaptainError({
              code: "conflict",
              message: "This document changed. Load the latest revision before saving.",
            });
          }
          const updated = {
            ...current,
            content: input.content,
            revision: current.revision + 1,
            updatedAt: DateTime.formatIso(yield* DateTime.now),
          };
          yield* sql`
        INSERT INTO captain_documents (captain_id, name, content, revision, updated_at)
        VALUES (${updated.captainId}, ${updated.name}, ${updated.content},
          ${updated.revision}, ${updated.updatedAt})
        ON CONFLICT(captain_id, name) DO UPDATE SET
          content = excluded.content, revision = excluded.revision, updated_at = excluded.updated_at
      `;
          return updated;
        }),
      );
      yield* notify(input.captainId, "content");
      return updated;
    },
    Effect.catchTags({ SqlError: captainUnavailable }),
  );

  const upsertMemory = Effect.fn("CaptainStore.upsertMemory")(
    function* (input: CaptainUpsertMemoryInput, ownerThreadId?: ThreadId) {
      const updated = yield* transact(
        Effect.gen(function* () {
          yield* requireOwner(input.captainId, ownerThreadId);
          const [existing] = yield* sql`
        ${memories} WHERE captain_id = ${input.captainId} AND id = ${input.id}
      `;
          const previous = existing === undefined ? undefined : yield* decodeMemory(existing);
          if (ownerThreadId !== undefined && previous?.userControlled) {
            return yield* new CaptainError({
              code: "locked",
              message: "This memory is user-controlled.",
            });
          }
          const now = DateTime.formatIso(yield* DateTime.now);
          const updated = {
            ...input,
            userControlled: ownerThreadId === undefined,
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
          };
          yield* sql`
        INSERT INTO captain_memories (captain_id, id, text, essential, user_controlled, created_at, updated_at)
        VALUES (${updated.captainId}, ${updated.id}, ${updated.text}, ${Number(updated.essential)},
          ${Number(updated.userControlled)}, ${updated.createdAt}, ${updated.updatedAt})
        ON CONFLICT(captain_id, id) DO UPDATE SET text = excluded.text, essential = excluded.essential,
          user_controlled = excluded.user_controlled, updated_at = excluded.updated_at
      `;
          return updated;
        }),
      );
      yield* notify(input.captainId, "content");
      return updated;
    },
    Effect.catchTags({ SqlError: captainUnavailable, SchemaError: captainUnavailable }),
  );

  const deleteMemory = Effect.fn("CaptainStore.deleteMemory")(
    function* (input: CaptainDeleteMemoryInput, ownerThreadId?: ThreadId) {
      yield* transact(
        Effect.gen(function* () {
          yield* requireOwner(input.captainId, ownerThreadId);
          const [row] = yield* sql<{ userControlled: number }>`
        SELECT user_controlled AS userControlled FROM captain_memories
        WHERE captain_id = ${input.captainId} AND id = ${input.id}
      `;
          if (ownerThreadId !== undefined && row?.userControlled === 1) {
            return yield* new CaptainError({
              code: "locked",
              message: "This memory is user-controlled.",
            });
          }
          yield* sql`DELETE FROM captain_memories WHERE captain_id = ${input.captainId} AND id = ${input.id}`;
        }),
      );
      yield* notify(input.captainId, "content");
    },
    Effect.catchTags({ SqlError: captainUnavailable }),
  );

  const snapshot = Effect.fn("CaptainStore.snapshot")(
    function* ({ captainId }: CaptainSubscribeInput) {
      if (captainId === undefined) {
        const captains = yield* Effect.forEach(
          yield* sql`${profiles} ORDER BY created_at, id`,
          (row) => decodeCaptain(row),
        );
        return { captains, documents: [], memories: [] } satisfies CaptainSnapshot;
      }
      return yield* transact(
        Effect.gen(function* () {
          const captain = yield* find(captainId);
          if (captain === undefined) return { captains: [], documents: [], memories: [] };
          const storedDocuments = yield* Effect.forEach(
            yield* sql`${documents} WHERE captain_id = ${captainId}`,
            (row) => decodeDocument(row),
          );
          const byName = new Map(storedDocuments.map((doc) => [doc.name, doc]));
          return {
            captains: [captain],
            documents: CaptainDocumentName.literals.map(
              (name) =>
                byName.get(name) ?? {
                  captainId,
                  name,
                  content: "",
                  revision: 0,
                  updatedAt: captain.createdAt,
                },
            ),
            memories: yield* listMemories(captainId, { limit: -1 }),
          } satisfies CaptainSnapshot;
        }),
      );
    },
    Effect.catchTags({ SqlError: captainUnavailable, SchemaError: captainUnavailable }),
  );

  const subscribe = (input: CaptainSubscribeInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(snapshot(input)),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter(({ captainId, kind }) =>
              input.captainId === undefined ? kind === "profile" : captainId === input.captainId,
            ),
            // Coalesce a burst of matching changes into one snapshot.
            Stream.buffer({ capacity: 1, strategy: "sliding" }),
            Stream.mapEffect(() => snapshot(input)),
          ),
        );
      }),
    );

  return {
    byThread,
    findPrimary,
    findByConversation,
    find,
    requireCaptain,
    findActiveChorus,
    privateChorusConversationIds,
    activeDuetRoster,
    listChorusRoutes,
    listChorusRouteUpdates,
    settleChorusRouteRun,
    restoreChorusRouteSettlements,
    acceptedChorusRouteThread,
    markChorusRoutesDelivered,
    save,
    latestCompletedCompactionAt,
    saveRolloverResend,
    pendingRolloverResends,
    clearRolloverResend,
    remove,
    document,
    listMemories,
    updateDocument,
    upsertMemory,
    deleteMemory,
    snapshot,
    subscribe,
    notify,
  };
});

export class CaptainStore extends Context.Service<CaptainStore, Effect.Success<typeof make>>()(
  "t3/captains/CaptainStore",
) {}

export const layer = Layer.effect(CaptainStore, make);
