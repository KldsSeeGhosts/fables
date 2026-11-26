import * as SqlClient from "effect/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'`;
  yield* sql`UPDATE scheduled_tasks SET kind = 'captain_morning_brief' WHERE task_id LIKE 'captain-morning-brief:%'`;
});
