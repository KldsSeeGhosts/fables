import {
  Captain,
  CaptainDocument,
  CaptainDocumentName,
  CaptainError,
  CaptainMemory,
  ChatAttachment,
  CommandId,
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
  type CaptainId,
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
  Effect.logWarning("Captain operation failed.", { cause }).pipe(
    Effect.andThen(
      new CaptainError({ code: "unavailable", message: "Could not access Captain state." }),
    ),
  );

const missing = () => new CaptainError({ code: "not_found", message: "Captain not found." });

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
    coordinator_only AS coordinatorOnly,
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
    const [row] = yield* sql`
      ${profiles} WHERE primary_thread_id = ${threadId}
        OR EXISTS (SELECT 1 FROM json_each(earlier_thread_ids) AS earlier WHERE earlier.value = ${threadId})
    `;
    return row === undefined ? undefined : yield* decodeCaptain(row);
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

  const requireOwner = Effect.fn("CaptainStore.requireOwner")(function* (
    id: CaptainId,
    threadId: ThreadId | undefined,
  ) {
    const captain = threadId === undefined ? yield* requireCaptain(id) : yield* byThread(threadId);
    if (captain?.id !== id) return yield* missing();
    return captain;
  });

  const save = Effect.fn("CaptainStore.save")(function* (captain: Captain) {
    const row = yield* encodeCaptain({
      ...captain,
      earlierThreadEndReasons: captain.earlierThreadEndReasons ?? [],
    });
    yield* sql`
      INSERT INTO captains (
        id, name, role, instructions, avatar, primary_thread_id, earlier_thread_ids,
        earlier_thread_end_reasons, scoped_project_ids, report_policy, coordinator_only, created_at, updated_at, archived_at
      ) VALUES (
        ${captain.id}, ${captain.name}, ${captain.role}, ${captain.instructions},
        ${row.avatar}, ${captain.primaryThreadId},
        ${row.earlierThreadIds}, ${row.earlierThreadEndReasons}, ${row.scopedProjectIds},
        ${captain.reportPolicy}, ${row.coordinatorOnly}, ${captain.createdAt}, ${captain.updatedAt}, ${captain.archivedAt}
      ) ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, role = excluded.role, instructions = excluded.instructions,
        avatar = excluded.avatar, primary_thread_id = excluded.primary_thread_id,
        earlier_thread_ids = excluded.earlier_thread_ids,
        earlier_thread_end_reasons = excluded.earlier_thread_end_reasons,
        scoped_project_ids = excluded.scoped_project_ids,
        report_policy = excluded.report_policy, coordinator_only = excluded.coordinator_only,
        updated_at = excluded.updated_at, archived_at = excluded.archived_at
    `;
    return captain;
  }, Effect.catch(captainUnavailable));

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
    send: typeof RolloverResendJson.Type,
  ) {
    const payload = yield* encodeRolloverResend(send);
    yield* sql`
        INSERT INTO captain_rollover_resends (command_id, source_run_id, thread_id, payload_json)
        VALUES (${send.commandId}, ${runId}, ${send.threadId}, ${payload})
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
    yield* sql`DELETE FROM captains WHERE id = ${id}`;
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
    captainId: CaptainId,
    options: { readonly essential?: boolean; readonly query?: string; readonly limit: number },
  ) {
    const rows = yield* sql`
      ${memories} WHERE captain_id = ${captainId}
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
