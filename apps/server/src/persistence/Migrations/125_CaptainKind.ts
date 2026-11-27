import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE captains ADD COLUMN kind TEXT NOT NULL DEFAULT 'duet'
    CHECK (kind IN ('duet', 'chorus'))
  `;
  yield* sql`
    CREATE UNIQUE INDEX captains_active_chorus_idx ON captains(kind)
    WHERE kind = 'chorus' AND archived_at IS NULL
  `;
});
