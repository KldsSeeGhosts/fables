import { CaptainId, EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { orderCaptainHomeRows } from "./captainHomeOrder";

const environmentId = EnvironmentId.make("home");
const row = (id: string, archivedAt: string | null = null) => ({
  environment: { environmentId },
  captain: { id: CaptainId.make(id), archivedAt },
});

it("uses the shared default Duet order for Home rows", () => {
  const first = row("first");
  const second = row("second");
  const archived = row("archived", "2026-11-24T00:00:00.000Z");

  expect(orderCaptainHomeRows([archived, first, second])).toEqual([first, second, archived]);
  expect(orderCaptainHomeRows([second, first])).toEqual([second, first]);
});
