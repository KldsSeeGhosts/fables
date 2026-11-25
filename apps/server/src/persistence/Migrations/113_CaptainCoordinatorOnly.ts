import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE captains ADD COLUMN coordinator_only INTEGER NOT NULL DEFAULT 0
    CHECK (coordinator_only IN (0, 1))
  `;
});
