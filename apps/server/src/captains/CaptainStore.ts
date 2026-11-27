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
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";
import type * as Statement from "effect/sql/Statement";

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
const encodeThreadIds = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));
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

const isActiveChorusUniqueViolation = (cause: unknown) =>
  SqlError.isSqlError(cause) &&
  cause.reason._tag === "UniqueViolation" &&
  cause.reason.constraint === "captains.kind";

const activeChorusConflict = () =>
  new CaptainError({
    code: "conflict",
    message: "An active Chorus already exists on this machine.",
  });

export type ChorusRouteSource =
  | {
      readonly source: "local";
      readonly environmentId: EnvironmentId;
      readonly sourceCaptainId: CaptainId;
      readonly sourceThreadId: ThreadId;
    }
  | {
      readonly source: "linked";
      readonly sender: OrchestrationV2LinkedSender;
      readonly senderSessionId: string;
    };

export class ChorusRouteDispatch extends Context.Service<
  ChorusRouteDispatch,
  ChorusRouteSource & {
    readonly commandId: CommandId;
    readonly messageId: MessageId;
    readonly duetId: CaptainId;
  }
>()("t3/captains/CaptainStore/ChorusRouteDispatch") {}

export const commitChorusRoute = Effect.fn("CaptainStore.commitChorusRoute")(function* (
  route: ChorusRouteDispatch["Service"],
  threadId: ThreadId,
  sentAt: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const inserted = yield* route.source === "linked"
    ? sql`
      INSERT INTO chorus_incoming_routes (receipt_message_id, sender_session_id, message_id, run_id, thread_id)
      SELECT m.message_id, ${route.senderSessionId}, m.message_id, r.run_id, r.thread_id
      FROM orchestration_v2_projection_messages AS m
      JOIN orchestration_v2_projection_runs AS r ON r.run_id = m.run_id
      JOIN captains AS destination ON destination.id = ${route.duetId}
      WHERE m.message_id = ${route.messageId} AND r.thread_id = ${threadId}
        AND destination.kind = 'duet' AND destination.archived_at IS NULL
        AND destination.primary_thread_id = r.thread_id
      RETURNING message_id
    `
    : sql`
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

export interface RemoteChorusRouteUpdate {
  readonly messageId: MessageId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly status: OrchestrationV2RunStatus | "unknown";
  readonly terminal: boolean;
  readonly result: string | null;
}

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
  const profileLock = yield* Semaphore.make(1);
  const withProfileLock = profileLock.withPermits(1);

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

  const findChorus = Effect.fn("CaptainStore.findChorus")(function* () {
    const [row] = yield* sql`
      ${profiles} WHERE kind = 'chorus'
      ORDER BY archived_at IS NOT NULL, archived_at DESC, created_at, id LIMIT 1
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

  const activeDuetCoverage = (project: ProjectId | Statement.Fragment) => sql`
    FROM captains
    WHERE kind = 'duet' AND archived_at IS NULL
      AND (json_array_length(scoped_project_ids) = 0 OR EXISTS (
        SELECT 1 FROM json_each(scoped_project_ids) WHERE value = ${project}
      ))
  `;

  const coveringDuetNames = Effect.fn("CaptainStore.coveringDuetNames")(
    function* (projectId: ProjectId) {
      const rows = yield* sql<{ readonly name: string }>`
        SELECT name ${activeDuetCoverage(projectId)} ORDER BY name, id LIMIT 3
      `;
      return rows.map(({ name }) => name);
    },
    Effect.catchTags({ SqlError: captainUnavailable }),
  );

  const repeatSoloProjects = Effect.fn("CaptainStore.repeatSoloProjects")(
    function* (captain: Captain) {
      const cutoff = DateTime.formatIso(
        DateTime.toUtc(DateTime.subtract(yield* DateTime.now, { days: 30 })),
      );
      const conversationIds = yield* encodeThreadIds([
        captain.primaryThreadId,
        ...captain.earlierThreadIds,
      ]);
      return yield* sql<{
        readonly environmentId: EnvironmentId | null;
        readonly environmentLabel: string | null;
        readonly projectId: ProjectId;
        readonly count: number;
        readonly latestCompletedAt: string;
      }>`
        WITH recent AS (
          SELECT json_extract(task.payload_json, '$.remoteChild.environmentId') AS environmentId,
            max(json_extract(task.payload_json, '$.remoteChild.label')) AS environmentLabel,
            COALESCE(child.project_id, json_extract(task.payload_json, '$.remoteChild.projectId')) AS projectId,
            count(*) AS count, max(COALESCE(task.completed_at, task.updated_at)) AS latestCompletedAt
          FROM orchestration_v2_projection_subagents AS task
          LEFT JOIN orchestration_v2_projection_threads AS child
            ON child.thread_id = task.child_thread_id
          WHERE task.thread_id IN (SELECT value FROM json_each(${conversationIds}))
            AND task.origin = 'app_owned'
            AND task.status IN ('completed', 'failed', 'cancelled', 'interrupted')
            AND COALESCE(task.completed_at, task.updated_at) >= ${cutoff}
          GROUP BY environmentId, projectId
        )
        SELECT environmentId, environmentLabel, projectId, count, latestCompletedAt FROM recent
        WHERE projectId IS NOT NULL
          AND (environmentId IS NOT NULL OR NOT EXISTS (SELECT 1 ${activeDuetCoverage(sql`recent.projectId`)}))
        ORDER BY latestCompletedAt DESC, environmentId, projectId LIMIT 5
      `;
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
      readonly environmentId: EnvironmentId;
      readonly remote: 0 | 1;
      readonly runId: RunId;
      readonly status: ChorusRoute["lastSeenStatus"];
      readonly result: string | null;
      readonly terminal: 0 | 1;
      readonly sentAt: string;
    }>`
      SELECT route.message_id AS messageId, route.thread_id AS threadId, duet.name AS duetName,
        route.environment_id AS environmentId, 0 AS remote,
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
          AS terminal, route.sent_at AS sentAt
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
      UNION ALL
      SELECT route.message_id, route.thread_id, route.duet_name, route.environment_id, 1,
        route.run_id, route.status, route.result, route.terminal, route.sent_at
      FROM chorus_remote_routes AS route
      WHERE route.source_captain_id = ${sourceCaptainId}
        AND route.delivered = 0 AND (route.terminal = 1 OR route.status <> route.last_seen_status)
      ORDER BY sentAt, messageId
      LIMIT ${limit}
    `;
  }, Effect.catch(captainUnavailable));

  const recordRemoteChorusRoute = Effect.fn("CaptainStore.recordRemoteChorusRoute")(function* (
    sourceCaptainId: CaptainId,
    route: {
      readonly environmentId: EnvironmentId;
      readonly messageId: MessageId;
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly duetName: string;
      readonly status: OrchestrationV2RunStatus;
    },
  ) {
    const sentAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO chorus_remote_routes (
        environment_id, message_id, source_captain_id, thread_id, duet_name, run_id,
        status, last_seen_status, sent_at
      ) VALUES (
        ${route.environmentId}, ${route.messageId}, ${sourceCaptainId}, ${route.threadId},
        ${route.duetName}, ${route.runId}, ${route.status}, ${route.status}, ${sentAt}
      ) ON CONFLICT DO NOTHING
    `;
  }, Effect.catch(captainUnavailable));

  const pendingRemoteChorusRoutes = Effect.fn("CaptainStore.pendingRemoteChorusRoutes")(function* (
    limit: number,
  ) {
    return yield* sql<{
      readonly environmentId: EnvironmentId;
      readonly messageId: MessageId;
    }>`
      SELECT route.environment_id AS environmentId, route.message_id AS messageId
      FROM chorus_remote_routes AS route
      JOIN captains ON captains.id = route.source_captain_id AND captains.archived_at IS NULL
      WHERE route.terminal = 0
      ORDER BY route.checked_at, route.sent_at LIMIT ${limit}
    `;
  }, Effect.catch(captainUnavailable));

  const readIncomingChorusRoute = Effect.fn("CaptainStore.readIncomingChorusRoute")(function* (
    senderSessionId: string,
    receiptMessageId: MessageId,
  ) {
    const [row] = yield* sql<Omit<RemoteChorusRouteUpdate, "terminal"> & { terminal: 0 | 1 }>`
      SELECT route.receipt_message_id AS messageId, route.thread_id AS threadId,
        COALESCE(run.run_id, route.run_id) AS runId,
        CASE WHEN run.status IS NULL THEN 'queued'
          WHEN ${terminalChorusRouteRun} AND route.settled_run_id IS NULL THEN 'running'
          ELSE run.status END AS status,
        COALESCE(${terminalChorusRouteRun} AND route.settled_run_id = run.run_id, 0) AS terminal,
        CASE WHEN route.settled_run_id = run.run_id THEN (
          SELECT substr(json_extract(answer.payload_json, '$.text'), 1, 1000)
          FROM orchestration_v2_projection_messages AS answer
          WHERE answer.run_id = run.run_id AND answer.role = 'assistant' AND answer.streaming = 0
          ORDER BY answer.created_at DESC, answer.message_id DESC LIMIT 1
        ) END AS result
      FROM chorus_incoming_routes AS route
      LEFT JOIN orchestration_v2_projection_messages AS prompt ON prompt.message_id = route.message_id
      LEFT JOIN orchestration_v2_projection_runs AS run ON run.run_id = prompt.run_id AND run.thread_id = route.thread_id
      WHERE route.receipt_message_id = ${receiptMessageId} AND route.sender_session_id = ${senderSessionId}
    `;
    return row === undefined ? null : { ...row, terminal: row.terminal === 1 };
  }, Effect.catch(captainUnavailable));

  const updateRemoteChorusRoute = Effect.fn("CaptainStore.updateRemoteChorusRoute")(function* (
    route: { readonly environmentId: EnvironmentId; readonly messageId: MessageId },
    update: RemoteChorusRouteUpdate | null,
  ) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      UPDATE chorus_remote_routes SET
        checked_at = ${checkedAt},
        thread_id = COALESCE(${update?.threadId ?? null}, thread_id),
        run_id = COALESCE(${update?.runId ?? null}, run_id),
        status = ${update?.status ?? "unknown"},
        terminal = ${update?.terminal === true ? 1 : 0},
        result = ${update?.result ?? null}
      WHERE environment_id = ${route.environmentId} AND message_id = ${route.messageId}
        AND terminal = 0
    `;
  }, Effect.catch(captainUnavailable));

  const settleChorusRouteRun = Effect.fn("CaptainStore.settleChorusRouteRun")(
    function* (threadId: ThreadId, runId: RunId) {
      for (const table of ["chorus_routes", "chorus_incoming_routes"]) {
        const name = sql(table);
        yield* sql`
        UPDATE ${name} SET settled_run_id = ${runId}, run_id = ${runId}
        WHERE thread_id = ${threadId} AND settled_run_id IS NOT ${runId}
          AND EXISTS (
            SELECT 1 FROM orchestration_v2_projection_messages AS prompt
            WHERE prompt.message_id = ${name}.message_id AND prompt.run_id = ${runId}
          )
      `;
      }
    },
    transact,
    Effect.catch(captainUnavailable),
  );

  const restoreChorusRouteSettlements = Effect.fn("CaptainStore.restoreChorusRouteSettlements")(
    function* () {
      for (const table of ["chorus_routes", "chorus_incoming_routes"]) {
        yield* sql`
          UPDATE ${sql(table)} AS route SET settled_run_id = run.run_id, run_id = run.run_id
          FROM orchestration_v2_projection_messages AS prompt
          JOIN orchestration_v2_projection_runs AS run ON run.run_id = prompt.run_id
          WHERE prompt.message_id = route.message_id AND run.thread_id = route.thread_id
            AND route.settled_run_id IS NOT run.run_id
            AND ${terminalChorusRouteRun}
        `;
      }
    },
    transact,
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
        readonly remoteEnvironmentId?: EnvironmentId;
        readonly status: ChorusRoute["lastSeenStatus"];
        readonly terminal: boolean;
      }>,
    ) {
      for (const { messageId, remoteEnvironmentId, status, terminal } of updates) {
        if (remoteEnvironmentId !== undefined) {
          const routeKey = sql`environment_id = ${remoteEnvironmentId} AND message_id = ${messageId}`;
          if (terminal) {
            yield* sql`UPDATE chorus_remote_routes SET delivered = 1, result = NULL WHERE ${routeKey}`;
          } else {
            yield* sql`UPDATE chorus_remote_routes SET last_seen_status = ${status} WHERE ${routeKey}`;
          }
        } else if (terminal) {
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
    yield* sql`
        UPDATE chorus_incoming_routes
        SET message_id = ${send.messageId}, thread_id = ${send.threadId}, settled_run_id = NULL
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

  const subscribeChorusThreadChanges = Effect.gen(function* () {
    const subscription = yield* PubSub.subscribe(changes);
    const chorusThread = findActiveChorus().pipe(
      Effect.map((captain) => captain?.primaryThreadId ?? null),
    );
    return Stream.concat(
      Stream.fromEffect(chorusThread),
      Stream.fromSubscription(subscription).pipe(
        Stream.filter(({ kind }) => kind === "profile"),
        Stream.buffer({ capacity: 1, strategy: "sliding" }),
        Stream.mapEffect(() => chorusThread),
      ),
    ).pipe(
      Stream.changes,
      Stream.drop(1),
      Stream.catch((error) =>
        Stream.fromEffect(Effect.logWarning("Could not read the Chorus thread.", { error })),
      ),
    );
  });

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
    findChorus,
    privateChorusConversationIds,
    activeDuetRoster,
    coveringDuetNames,
    repeatSoloProjects,
    withProfileLock,
    listChorusRoutes,
    recordRemoteChorusRoute,
    pendingRemoteChorusRoutes,
    readIncomingChorusRoute,
    updateRemoteChorusRoute,
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
    subscribeChorusThreadChanges,
    notify,
  };
});

export class CaptainStore extends Context.Service<CaptainStore, Effect.Success<typeof make>>()(
  "t3/captains/CaptainStore",
) {}

export const layer = Layer.effect(CaptainStore, make);
