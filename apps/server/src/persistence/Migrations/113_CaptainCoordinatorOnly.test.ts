import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

it.effect("adds coordinator_only to existing Captains as off", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 112 });
    yield* sql`
      INSERT INTO captains (
        id, name, role, instructions, avatar, primary_thread_id, report_policy, created_at, updated_at
      ) VALUES (
        'legacy', 'Maria', 'Coordinator', '', '{"preset":"compass","color":"violet"}',
        'captain:legacy:0', 'context', '2026-11-24T12:00:00.000Z', '2026-11-24T12:00:00.000Z'
      )
    `;
    yield* runMigrations({ toMigrationInclusive: 113 });
    const [row] = yield* sql<{ coordinator_only: number }>`
      SELECT coordinator_only FROM captains WHERE id = 'legacy'
    `;
    assert.equal(row?.coordinator_only, 0);
    assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 113 }), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
