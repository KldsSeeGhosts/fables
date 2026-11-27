import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(peer_environment_links)
  `;
  if (!columns.some((column) => column.name === "chorus_home_thread_id")) {
    yield* sql`
      ALTER TABLE peer_environment_links ADD COLUMN chorus_home_thread_id TEXT
    `;
  }
  if (!columns.some((column) => column.name === "chorus_home_seen_at")) {
    yield* sql`
      ALTER TABLE peer_environment_links ADD COLUMN chorus_home_seen_at TEXT
    `;
  }
  if (!columns.some((column) => column.name === "chorus_home_capable")) {
    yield* sql`
      ALTER TABLE peer_environment_links ADD COLUMN chorus_home_capable INTEGER
    `;
  }
});
