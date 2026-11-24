import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

it.effect("adds Captain tables to an existing database without changing scheduled tasks", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 111 });
    const before = yield* sql`SELECT sql FROM sqlite_master WHERE name = 'scheduled_tasks'`;
    yield* runMigrations({ toMigrationInclusive: 112 });
    const names = yield* sql<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'captain%' ORDER BY name
    `;
    assert.deepStrictEqual(
      names.map(({ name }) => name),
      ["captain_documents", "captain_memories", "captains"],
    );
    assert.deepStrictEqual(
      yield* sql`SELECT sql FROM sqlite_master WHERE name = 'scheduled_tasks'`,
      before,
    );
    assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 112 }), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
