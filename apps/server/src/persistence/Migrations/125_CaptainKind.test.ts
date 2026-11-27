import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

it.effect("defaults existing Captains to duet and allows one active Chorus", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 124 });
    yield* sql`
      INSERT INTO captains (
        id, name, role, instructions, avatar, primary_thread_id, report_policy, created_at, updated_at
      ) VALUES (
        'legacy', 'Maria', 'Coordinator', '', '{"preset":"compass","color":"violet"}',
        'captain:legacy:0', 'context', '2026-11-24T12:00:00.000Z', '2026-11-24T12:00:00.000Z'
      )
    `;

    yield* runMigrations({ toMigrationInclusive: 125 });

    const [legacy] = yield* sql<{ readonly kind: string }>`
      SELECT kind FROM captains WHERE id = 'legacy'
    `;
    assert.equal(legacy?.kind, "duet");

    const insertCaptain = (id: string, kind: string, archivedAt: string | null = null) => sql`
      INSERT INTO captains (
        id, name, role, instructions, avatar, primary_thread_id, report_policy, kind,
        created_at, updated_at, archived_at
      ) VALUES (
        ${id}, 'Maria', 'Coordinator', '', '{"preset":"compass","color":"violet"}',
        ${`captain:${id}:0`}, 'react', ${kind},
        '2026-11-24T12:00:00.000Z', '2026-11-24T12:00:00.000Z', ${archivedAt}
      )
    `;
    yield* insertCaptain("chorus-active", "chorus");
    const createConflict = yield* Effect.flip(insertCaptain("chorus-second", "chorus"));
    assert.equal(createConflict.reason._tag, "UniqueViolation");

    yield* insertCaptain("chorus-archived", "chorus", "2026-11-24T13:00:00.000Z");
    const unarchiveConflict = yield* Effect.flip(sql`
      UPDATE captains SET archived_at = NULL WHERE id = 'chorus-archived'
    `);
    assert.equal(unarchiveConflict.reason._tag, "UniqueViolation");
    assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 125 }), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
