import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { CaptainId, EnvironmentId, ThreadId, type Captain } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { captainTaskGroups, captainTaskSections } from "./captainTaskList";

const environmentId = EnvironmentId.make("home");
const nowMs = Date.parse("2026-11-25T12:00:00.000Z");

const captain = (id: string, archivedAt: string | null = null): Captain => ({
  id: CaptainId.make(id),
  name: id,
  role: "",
  instructions: "",
  avatar: { preset: "circle", color: "blue" },
  scopedProjectIds: [],
  reportPolicy: "react",
  coordinatorOnly: false,
  primaryThreadId: ThreadId.make(`captain:${id}:1`),
  earlierThreadIds: [ThreadId.make(`captain:${id}:0`)],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  archivedAt,
});

const task = (
  id: string,
  parent: ThreadId,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell =>
  ({
    environmentId,
    id: ThreadId.make(id),
    title: id,
    branch: null,
    archivedAt: null,
    deletedAt: null,
    settledAt: null,
    createdAt: "2026-11-25T11:00:00.000Z",
    updatedAt: "2026-11-25T11:00:00.000Z",
    hasPendingUserInput: false,
    hasPendingApprovals: false,
    pendingSubagentRequest: null,
    runtime: null,
    latestRun: null,
    lineage: { rootThreadId: parent, parentThreadId: parent, relationshipToParent: "subagent" },
    ...overrides,
  }) as EnvironmentThreadShell;

describe("captainTaskGroups", () => {
  const maria = captain("maria");
  const ada = captain("ada");
  const shells = [
    task("old-done", maria.primaryThreadId, {
      settledAt: "2026-11-20T09:00:00.000Z",
      updatedAt: "2026-11-20T09:00:00.000Z",
    }),
    task("question", maria.earlierThreadIds[0]!, {
      hasPendingUserInput: true,
      updatedAt: "2026-11-01T09:00:00.000Z",
    }),
    task("fresh-done", maria.primaryThreadId, { settledAt: "2026-11-25T10:00:00.000Z" }),
    task("not-a-captain", ThreadId.make("thread-elsewhere")),
  ];

  it("keeps open work and the last day's outcomes for today, newest first", () => {
    const groups = captainTaskGroups({
      environments: [{ environmentId, captains: [maria, ada] }],
      shells,
      range: "today",
      nowMs,
    });
    expect(groups.map(({ captain }) => captain.id)).toEqual(["maria"]);
    expect(groups[0]!.rows.map(({ thread }) => thread.id)).toEqual(["fresh-done", "question"]);
    expect(groups[0]!.rows[1]!.status).toBe("needs-input");
  });

  it("lists every delegated task for all", () => {
    const groups = captainTaskGroups({
      environments: [{ environmentId, captains: [maria] }],
      shells,
      range: "all",
      nowMs,
    });
    expect(groups[0]!.rows.map(({ thread }) => thread.id)).toEqual([
      "fresh-done",
      "old-done",
      "question",
    ]);
  });

  it("narrows to one Captain and skips archived Captains", () => {
    const archived = captain("gone", "2026-11-24T00:00:00.000Z");
    const groups = captainTaskGroups({
      environments: [{ environmentId, captains: [maria, archived] }],
      shells: [...shells, task("orphan", archived.primaryThreadId)],
      range: "all",
      nowMs,
      captainId: "gone",
    });
    expect(groups).toEqual([]);
  });
});

describe("captainTaskSections", () => {
  const row = (
    id: string,
    status: "needs-input" | "working" | "ready" | "failed" | "done",
    at: number,
  ) => ({
    thread: task(id, ThreadId.make("captain:maria:1")),
    status,
    detail: null,
    updatedAtMs: at,
  });

  it("lists Running before Finished, with what needs input first", () => {
    const sections = captainTaskSections([
      row("built", "ready", 50),
      row("building", "working", 40),
      row("push", "needs-input", 10),
      row("smoke", "failed", 60),
      row("preview", "working", 30),
    ]);
    expect(sections.map(({ kind, rows }) => [kind, rows.map(({ thread }) => thread.id)])).toEqual([
      ["running", ["push", "building", "preview"]],
      ["finished", ["smoke", "built"]],
    ]);
  });

  it("leaves out an empty section", () => {
    expect(captainTaskSections([row("built", "done", 1)]).map(({ kind }) => kind)).toEqual([
      "finished",
    ]);
  });
});
