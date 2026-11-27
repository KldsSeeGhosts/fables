import { fleetChorusCaptain } from "@t3tools/client-runtime/state/captains";
import { CaptainId, EnvironmentId, ThreadId, type FleetChorusStatus } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { captainOverviewRows } from "./captainOverview";

const home = EnvironmentId.make("home");
const peer = EnvironmentId.make("peer");
const status: FleetChorusStatus = {
  state: "ready",
  home: { environmentId: home, label: "Home", threadId: ThreadId.make("captain:chorus:1") },
  localHome: false,
  conflictingHomes: [],
  updatedAt: "2026-11-24T00:00:00.000Z",
};
const chorus = { ...fleetChorusCaptain(status), id: CaptainId.make("stored-chorus") };
const duet = { ...chorus, kind: "duet" as const, id: CaptainId.make("duet") };
const directories = [
  { environmentId: peer, label: "Peer", captains: [duet, chorus] },
  { environmentId: home, label: "Home", captains: [chorus] },
];

it("pins the true Chorus home above Duets and excludes stored copies on other machines", () => {
  const rows = captainOverviewRows(directories, [], { viaEnvironmentId: peer, status });
  expect(rows.map(({ captain, environment }) => [captain.id, environment.environmentId])).toEqual([
    [chorus.id, home],
    [duet.id, peer],
  ]);
  expect(rows[0]).toMatchObject({ fleetState: "ready", hasCaptainRecord: true });
});

it("keeps a projected Chorus row when the home is offline or too old", () => {
  for (const state of ["offline", "too_old"] as const) {
    const rows = captainOverviewRows(directories.slice(0, 1), [], {
      viaEnvironmentId: peer,
      status: { ...status, state },
    });
    expect(rows[0]).toMatchObject({
      captain: { kind: "chorus" },
      environment: { environmentId: home },
      fleetState: state,
      hasCaptainRecord: false,
    });
  }
  expect(captainOverviewRows(directories, [], null).map(({ captain }) => captain.id)).toEqual([
    duet.id,
  ]);
});
