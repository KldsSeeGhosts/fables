import { CaptainId, ThreadId, type Captain } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatCaptainBriefing,
  formatCaptainContextPressure,
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
    expect(coordinated).toContain("pass `repositories` with the ones the child edits");
    expect(coordinated).toContain("never by your checkout's absolute paths");
  });

  it("tells the Captain how finished crew reaches it under each report policy", () => {
    const rule = (reportPolicy: Captain["reportPolicy"]) =>
      formatCaptainBriefing({
        captain: { ...captain, coordinatorOnly: true, reportPolicy },
        projects: [],
        memories: [],
        agents: "",
        notes: "",
      });
    expect(rule("react")).toContain("let completion wake you");
    expect(rule("context")).toContain("arrive with the user's next message");
    expect(rule("context")).not.toContain("let completion wake you");
    expect(rule("ignore")).toContain("You are not told when crew finishes");
    expect(rule("ignore")).not.toContain("let completion wake you");
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

  it("points reports from an earlier conversation at their task thread", () => {
    const formatted = formatCaptainReports(
      [
        { id: "task-1", title: "Now", result: "Done.", threadId: "captain:maria:1" },
        {
          id: "task-0",
          title: "Before",
          result: "Done earlier.",
          threadId: "captain:maria:0",
          childThreadId: "thread:child-0",
        },
      ],
      "captain:maria:1",
    );

    expect(formatted).toContain('Read the full report with task_status(taskId: "task-1").');
    expect(formatted).toContain('t3_thread_read(threadId: "thread:child-0")');
    expect(formatted).not.toContain('task_status(taskId: "task-0")');
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
    expect(formatted).toContain("use the matching folder in yours");
    expect(formatted).toContain("done-check from your brief passes");
    expect(formatted).toContain("as a markdown image with its absolute path");
    expect(formatted).not.toContain("CREW.md:");
  });

  it("appends the Captain's CREW.md", () => {
    const formatted = formatCaptainCrewRules(captain, "Run the tests before reporting.");
    expect(formatted).toContain("keep a progress note in your worktree");
    expect(formatted).toContain("CREW.md:\nRun the tests before reporting.");
  });
});

describe("formatCaptainContextPressure", () => {
  it("stays quiet below three quarters of the limit", () => {
    expect(
      formatCaptainContextPressure({
        usedTokens: 70_000,
        maxTokens: 100_000,
        autoCompactThreshold: null,
      }),
    ).toBe("");
    expect(
      formatCaptainContextPressure({
        usedTokens: null,
        maxTokens: 100_000,
        autoCompactThreshold: null,
      }),
    ).toBe("");
  });

  it("measures against automatic compaction when the provider reports it", () => {
    const text = formatCaptainContextPressure({
      usedTokens: 120_000,
      maxTokens: 200_000,
      autoCompactThreshold: 150_000,
    });
    expect(text).toContain("80% of the way to automatic compaction");
    expect(text).toContain("`captain_document_write`");
    expect(text).toContain("new conversation");
  });

  it("measures against the window otherwise", () => {
    expect(
      formatCaptainContextPressure({
        usedTokens: 90_000,
        maxTokens: 100_000,
        autoCompactThreshold: null,
      }),
    ).toContain("90% full");
  });
});
