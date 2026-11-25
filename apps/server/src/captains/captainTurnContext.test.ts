import { CaptainId, ThreadId, type Captain } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatCaptainBriefing,
  formatCaptainCrewRules,
  formatCaptainReports,
} from "./captainTurnContext.ts";

const captain = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:0"),
  earlierThreadIds: [],
  name: "Maria",
  role: "Coordinator",
  instructions: "Keep the release moving.",
  avatar: { preset: "compass", color: "violet" },
  scopedProjectIds: [],
  reportPolicy: "context",
  coordinatorOnly: false,
  createdAt: "2026-11-24T12:00:00.000Z",
  updatedAt: "2026-11-24T12:00:00.000Z",
  archivedAt: null,
} satisfies Captain;

const briefing = (coordinatorOnly: boolean) =>
  formatCaptainBriefing({
    captain: { ...captain, coordinatorOnly },
    projects: [],
    memories: [],
    agents: "",
    notes: "",
  });

describe("formatCaptainBriefing", () => {
  it("includes the coordinator block only when coordinatorOnly is on", () => {
    expect(briefing(false)).not.toContain("How you work:");
    const coordinated = briefing(true);
    expect(coordinated).toContain("How you work:");
    expect(coordinated).toContain('`delegate_task` and `isolation: "worktree"`');
    expect(coordinated).toContain("`captain_document_write`");
  });
});

describe("formatCaptainReports", () => {
  it("uses the first paragraph as a summary and points to the full report", () => {
    const formatted = formatCaptainReports([
      {
        id: "task-1",
        title: "Fix the flaky test",
        result:
          "Fixed the flaky test.\nIt now waits for the close event.\n\nDetails that stay in the child.",
      },
    ]);

    expect(formatted).toContain(
      '- Fix the flaky test [task-1]: Fixed the flaky test. It now waits for the close event. Read the full report with task_status(taskId: "task-1").',
    );
    expect(formatted).not.toContain("Details that stay in the child.");
  });

  it("truncates a long first paragraph and keeps at most six reports", () => {
    const formatted = formatCaptainReports(
      Array.from({ length: 7 }, (_, index) => ({
        id: `task-${index}`,
        title: null,
        result: index === 0 ? "x".repeat(300) : `Result ${index}`,
      })),
    );

    expect(formatted).toContain(`${"x".repeat(280)}…`);
    expect(formatted).toContain("task-5");
    expect(formatted).not.toContain("task-6");
  });
});

describe("formatCaptainCrewRules", () => {
  it("always includes the built-in crew rules", () => {
    const formatted = formatCaptainCrewRules(captain, "");
    expect(formatted).toContain("keep a progress note in your worktree");
    expect(formatted).toContain("done-check from your brief passes");
    expect(formatted).not.toContain("CREW.md:");
  });

  it("appends the Captain's CREW.md", () => {
    const formatted = formatCaptainCrewRules(captain, "Run the tests before reporting.");
    expect(formatted).toContain("keep a progress note in your worktree");
    expect(formatted).toContain("CREW.md:\nRun the tests before reporting.");
  });
});
