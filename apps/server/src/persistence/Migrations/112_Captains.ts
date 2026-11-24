import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE captains (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      instructions TEXT NOT NULL,
      avatar TEXT NOT NULL,
      primary_thread_id TEXT NOT NULL UNIQUE,
      earlier_thread_ids TEXT NOT NULL DEFAULT '[]',
      scoped_project_ids TEXT NOT NULL DEFAULT '[]',
      report_policy TEXT NOT NULL CHECK (report_policy IN ('react', 'context', 'ignore')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    )
  `;
  yield* sql`
    CREATE TABLE captain_documents (
      captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (name IN ('NOTES.md', 'AGENTS.md', 'CREW.md', 'DIGEST.md')),
      content TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (captain_id, name)
    )
  `;
  yield* sql`
    CREATE TABLE captain_memories (
      captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      text TEXT NOT NULL,
      essential INTEGER NOT NULL CHECK (essential IN (0, 1)),
      user_controlled INTEGER NOT NULL CHECK (user_controlled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (captain_id, id)
    )
  `;
});
