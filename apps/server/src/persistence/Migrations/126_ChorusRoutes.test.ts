import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

it.effect("adds the Chorus route ledger", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 125 });
    yield* runMigrations({ toMigrationInclusive: 126 });

    const columns = yield* sql<{ readonly name: string }>`
      SELECT name FROM pragma_table_info('chorus_routes') ORDER BY cid
    `;
    assert.deepStrictEqual(
      columns.map(({ name }) => name),
      [
        "message_id",
        "run_id",
        "environment_id",
        "source_captain_id",
        "source_thread_id",
        "duet_id",
        "thread_id",
        "sent_at",
        "last_seen_status",
        "result",
      ],
    );
    const indexes = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'chorus_routes' AND name LIKE 'chorus_routes%'
      ORDER BY name
    `;
    assert.deepStrictEqual(
      indexes.map(({ name }) => name),
      ["chorus_routes_source_idx"],
    );
    assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 126 }), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
