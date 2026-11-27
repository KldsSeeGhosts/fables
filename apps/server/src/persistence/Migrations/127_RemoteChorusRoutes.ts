import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE chorus_incoming_routes (
      receipt_message_id TEXT PRIMARY KEY NOT NULL,
      sender_session_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      settled_run_id TEXT
    )
  `;
  yield* sql`
    CREATE TABLE chorus_remote_routes (
      environment_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      source_captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      duet_name TEXT NOT NULL,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      last_seen_status TEXT NOT NULL,
      terminal INTEGER NOT NULL DEFAULT 0,
      result TEXT,
      delivered INTEGER NOT NULL DEFAULT 0,
      checked_at TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL,
      PRIMARY KEY (environment_id, message_id)
    )
  `;
  yield* sql`
    CREATE INDEX chorus_remote_routes_source_idx
    ON chorus_remote_routes(source_captain_id, sent_at)
  `;
  yield* sql`
    CREATE INDEX chorus_remote_routes_pending_idx
    ON chorus_remote_routes(terminal, checked_at)
  `;
});
