import * as NodeAssert from "node:assert/strict";

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { it } from "@effect/vitest";

import migration from "./124_ScheduledTaskKind.ts";

it.effect("backfills existing captain recap task kinds", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE scheduled_tasks (task_id TEXT PRIMARY KEY)`;
    yield* sql`INSERT INTO scheduled_tasks (task_id) VALUES ('captain-morning-brief:maria')`;
    yield* sql`INSERT INTO scheduled_tasks (task_id) VALUES ('daily-report')`;
    yield* migration;
    NodeAssert.deepStrictEqual(
      (yield* sql<{ readonly task_id: string; readonly kind: string }>`
        SELECT task_id, kind FROM scheduled_tasks ORDER BY task_id
      `).map((row) => ({ task_id: row.task_id, kind: row.kind })),
      [
        { task_id: "captain-morning-brief:maria", kind: "captain_morning_brief" },
        { task_id: "daily-report", kind: "agent" },
      ],
    );
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
