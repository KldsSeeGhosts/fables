import { NodeId, type OrchestrationV2Subagent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";

import { captainRecentlyFinishedTasks } from "./captains.ts";

const task = (
  id: string,
  status: OrchestrationV2Subagent["status"],
  completedAt: string | null,
  origin: OrchestrationV2Subagent["origin"] = "app_owned",
) =>
  ({
    id: NodeId.make(id),
    origin,
    status,
    completedAt: completedAt === null ? null : DateTime.makeUnsafe(completedAt),
  }) as OrchestrationV2Subagent;

it("lists finished delegated tasks newest first, up to the limit", () => {
  const finished = captainRecentlyFinishedTasks(
    [
      task("old", "completed", "2026-11-24T09:00:00.000Z"),
      task("failed", "failed", "2026-11-24T11:00:00.000Z"),
      task("running", "running", null),
      task("native", "completed", "2026-11-24T12:00:00.000Z", "provider_native"),
      task("cancelled", "cancelled", "2026-11-24T10:00:00.000Z"),
    ],
    2,
  );
  expect(finished.map(({ id }) => id)).toEqual(["failed", "cancelled"]);
});
