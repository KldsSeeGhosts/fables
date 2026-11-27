import {
  CaptainId,
  EnvironmentId,
  ThreadId,
  type Captain,
  type CaptainSnapshot,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  liveCaptainEnvironments,
  resolveCaptainEnvironments,
  type CaptainEnvironmentCandidate,
} from "./captainEnvironments";

const home = EnvironmentId.make("home");

const captain = (id: string, archivedAt: string | null = null): Captain => ({
  id: CaptainId.make(id),
  name: id,
  role: "",
  instructions: "",
  avatar: { preset: "circle", color: "blue" },
  scopedProjectIds: [],
  reportPolicy: "react",
  coordinatorOnly: false,
  kind: "duet",
  primaryThreadId: ThreadId.make(`captain:${id}:1`),
  earlierThreadIds: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  archivedAt,
});

const snapshot = (captains: ReadonlyArray<Captain>): CaptainSnapshot => ({
  captains,
  documents: [],
  memories: [],
});

const candidate = (
  captainsCapability: boolean | undefined,
): ReadonlyArray<CaptainEnvironmentCandidate> => [
  { environmentId: home, label: "Home", captainsCapability },
];

const resolve = (input: {
  readonly capability?: boolean | undefined;
  readonly readable?: boolean;
  readonly denied?: boolean;
  readonly live?: AsyncResult.AsyncResult<CaptainSnapshot, unknown>;
  readonly cached?: ReadonlyArray<Captain>;
}) =>
  resolveCaptainEnvironments({
    candidates: candidate("capability" in input ? input.capability : true),
    readable: new Set(input.readable ? [home] : []),
    denied: new Set(input.denied ? [home] : []),
    live: input.live ? [{ environmentId: home, result: input.live }] : [],
    cached: new Map(input.cached ? [[home, input.cached]] : []),
  });

describe("resolveCaptainEnvironments", () => {
  it("draws cached Captains before the host has answered, so launch starts in the Duet shell", () => {
    const [environment] = resolve({ capability: undefined, cached: [captain("ye")] });
    expect(environment?.status).toBe("loading");
    expect(environment?.snapshot).toBeNull();
    expect(environment?.captains.map(({ id }) => id)).toEqual(["ye"]);
  });

  it("keeps cached Captains while the live list loads", () => {
    const [environment] = resolve({
      readable: true,
      live: AsyncResult.initial(true),
      cached: [captain("ye"), captain("old", "2026-11-02T00:00:00.000Z")],
    });
    expect(environment?.captains.map(({ id }) => id)).toEqual(["ye"]);
  });

  it("replaces the cached list once the live one arrives", () => {
    const [environment] = resolve({
      readable: true,
      live: AsyncResult.success(snapshot([captain("comfy")])),
      cached: [captain("ye")],
    });
    expect(environment?.status).toBe("ready");
    expect(environment?.captains.map(({ id }) => id)).toEqual(["comfy"]);
  });

  it("keeps archived profiles in the snapshot and out of the Home list", () => {
    const archivedAt = "2026-11-02T00:00:00.000Z";
    const chorus = { ...captain("chorus", archivedAt), kind: "chorus" as const };
    const [environment] = resolve({
      readable: true,
      live: AsyncResult.success(snapshot([captain("old", archivedAt), chorus])),
    });
    expect(environment?.captains).toEqual([]);
    expect(environment?.snapshot?.captains).toContain(chorus);
  });

  it("drops cached Captains when the host denies reading them or does not run Captains", () => {
    expect(resolve({ denied: true, cached: [captain("ye")] })).toEqual([]);
    expect(resolve({ capability: false, cached: [captain("ye")] })).toEqual([]);
  });

  it("leaves out an unanswered host with nothing cached", () => {
    expect(resolve({ capability: undefined })).toEqual([]);
  });
});

describe("liveCaptainEnvironments", () => {
  it("subscribes only to readable hosts that run Captains", () => {
    expect(liveCaptainEnvironments(candidate(true), new Set([home]))).toHaveLength(1);
    expect(liveCaptainEnvironments(candidate(undefined), new Set([home]))).toHaveLength(0);
    expect(liveCaptainEnvironments(candidate(true), new Set())).toHaveLength(0);
  });
});
