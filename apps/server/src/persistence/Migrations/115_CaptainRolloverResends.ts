import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE captain_rollover_resends (
      id INTEGER PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      source_run_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX captain_rollover_resends_thread_idx ON captain_rollover_resends(thread_id, id)
  `;
  yield* sql`
    CREATE INDEX captain_rollover_latest_compaction_idx
    ON orchestration_v2_projection_turn_items (
      thread_id, provider_thread_id, COALESCE(json_extract(payload_json, '$.completedAt'), updated_at) DESC
    ) WHERE type = 'compaction' AND status = 'completed'
  `;
});
