import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { duetRowScope, duetRowTrail, projectBadge } from "./duetHomeRow";

const thread = (overrides: Record<string, unknown> = {}) => ({
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingSubagentRequest: null,
  updatedAt: "2026-11-25T11:58:00.000Z",
  ...overrides,
});
const captain = { updatedAt: "2026-11-20T00:00:00.000Z" };

describe("duetRowTrail", () => {
  it.each([
    {
      name: "shows the time of the conversation's last activity when idle",
      activity: { primary: thread(), children: [], working: false },
      trail: { kind: "idle", at: "2026-11-25T11:58:00.000Z" },
    },
    {
      name: "falls back to the Duet's own time without a conversation shell",
      activity: { primary: undefined, children: [], working: false },
      trail: { kind: "idle", at: "2026-11-20T00:00:00.000Z" },
    },
    {
      name: "replaces the time with Working",
      activity: { primary: thread(), children: [], working: true },
      trail: { kind: "working" },
    },
    {
      name: "says what a crew task waits on, ahead of Working",
      activity: {
        primary: thread(),
        children: [thread({ hasPendingUserInput: true })],
        working: true,
      },
      trail: { kind: "waiting", on: "input" },
    },
    {
      name: "leads with an approval when several requests wait",
      activity: {
        primary: thread({ hasPendingUserInput: true }),
        children: [thread({ hasPendingApprovals: true })],
        working: true,
      },
      trail: { kind: "waiting", on: "approval" },
    },
  ])("$name", ({ activity, trail }) => {
    expect(duetRowTrail({ captain, activity })).toEqual(trail);
  });
});

describe("duetRowScope", () => {
  const environmentId = EnvironmentId.make("home");
  const projects = [
    { environmentId, id: ProjectId.make("p1"), title: "ksgcode" },
    { environmentId, id: ProjectId.make("p2"), title: "Comfy Studio" },
  ];
  it("names one scoped project with its badge, counts several, and reads empty as all", () => {
    expect(
      duetRowScope(environmentId, { scopedProjectIds: [ProjectId.make("p2")] }, projects),
    ).toEqual({
      kind: "project",
      title: "Comfy Studio",
      badge: "CS",
    });
    expect(
      duetRowScope(
        environmentId,
        { scopedProjectIds: [ProjectId.make("p1"), ProjectId.make("p2")] },
        projects,
      ),
    ).toEqual({ kind: "projects", count: 2 });
    expect(duetRowScope(environmentId, { scopedProjectIds: [] }, projects)).toEqual({
      kind: "all",
    });
    expect(projectBadge("ksgcode")).toBe("KS");
  });
});
