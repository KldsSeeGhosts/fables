import { CaptainId, EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { orderCaptainHomeRows } from "./captainHomeOrder";

const environmentId = EnvironmentId.make("home");
const row = (id: string, archivedAt: string | null = null) => ({
  environment: { environmentId },
  captain: { id: CaptainId.make(id), archivedAt, kind: "duet" as const },
});

it("uses the shared default Duet order for Home rows", () => {
  const first = row("first");
  const second = row("second");
  const archived = row("archived", "2026-11-24T00:00:00.000Z");

  expect(orderCaptainHomeRows([archived, first, second])).toEqual([first, second, archived]);
  expect(orderCaptainHomeRows([second, first])).toEqual([second, first]);
});

it("pins the Chorus ahead of every Duet without changing their order", () => {
  const first = row("first");
  const second = row("second");
  const chorus = {
    ...row("chorus"),
    captain: { ...row("chorus").captain, kind: "chorus" as const },
  };

  const archivedChorus = {
    ...chorus,
    captain: {
      ...chorus.captain,
      id: CaptainId.make("archived-chorus"),
      archivedAt: "2026-11-24T00:00:00.000Z",
    },
  };
  expect(orderCaptainHomeRows([archivedChorus, first, chorus, second])).toEqual([
    chorus,
    first,
    second,
    archivedChorus,
  ]);
});
