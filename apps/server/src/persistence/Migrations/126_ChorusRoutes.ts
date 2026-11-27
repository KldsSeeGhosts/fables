import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE chorus_routes (
      message_id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      environment_id TEXT NOT NULL,
      source_captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
      source_thread_id TEXT NOT NULL,
      duet_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      last_seen_status TEXT NOT NULL,
      result TEXT
    )
  `;
  yield* sql`
    CREATE INDEX chorus_routes_source_idx
    ON chorus_routes(source_captain_id, sent_at, message_id)
  `;
});
