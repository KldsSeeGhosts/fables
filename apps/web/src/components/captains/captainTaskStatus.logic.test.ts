import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import {
  captainLocalTaskStatus,
  captainSubagentTaskStatus,
  captainTaskDetail,
  captainTaskIsRecent,
  captainThreadTaskStatus,
  compareCaptainTasks,
} from "./captainTaskStatus.logic";

const idle = {
  hasPendingUserInput: false,
  hasPendingApprovals: false,
  pendingSubagentRequest: null,
  runtime: null,
  latestRun: null,
  settledAt: null,
} satisfies Parameters<typeof captainThreadTaskStatus>[0];

const withRun = (status: string) =>
  ({
    ...idle,
    latestRun: { status } as EnvironmentThreadShell["latestRun"],
  }) satisfies Parameters<typeof captainThreadTaskStatus>[0];

describe("captainThreadTaskStatus", () => {
  it("never reports a failed or stopped run as done or ready", () => {
    expect(captainThreadTaskStatus(withRun("failed"))).toBe("failed");
    expect(captainThreadTaskStatus(withRun("cancelled"))).toBe("stopped");
    expect(captainThreadTaskStatus(withRun("interrupted"))).toBe("stopped");
    expect(captainThreadTaskStatus(withRun("completed"))).toBe("ready");
  });

  it("puts a pending request ahead of everything and treats settled work as done", () => {
    expect(captainThreadTaskStatus({ ...withRun("failed"), hasPendingApprovals: true })).toBe(
      "needs-input",
    );
    expect(captainThreadTaskStatus({ ...withRun("completed"), settledAt: "2026-11-25" })).toBe(
      "done",
    );
  });

  it("is unknown when the task's thread is not loaded", () => {
    expect(captainThreadTaskStatus(null)).toBe("unknown");
    expect(captainThreadTaskStatus(undefined)).toBe("unknown");
  });
});

describe("captainSubagentTaskStatus", () => {
  it("maps linked task outcomes to the same vocabulary", () => {
    expect(captainSubagentTaskStatus({ status: "running" })).toBe("working");
    expect(captainSubagentTaskStatus({ status: "waiting" })).toBe("needs-input");
    expect(captainSubagentTaskStatus({ status: "completed" })).toBe("ready");
    expect(captainSubagentTaskStatus({ status: "failed" })).toBe("failed");
    expect(captainSubagentTaskStatus({ status: "cancelled" })).toBe("stopped");
  });
});

describe("captainLocalTaskStatus", () => {
  it("lets the child's live request or run win over the parent's record", () => {
    expect(
      captainLocalTaskStatus(
        { ...withRun("completed"), hasPendingApprovals: true },
        {
          status: "completed",
        },
      ),
    ).toBe("needs-input");
    expect(
      captainLocalTaskStatus(
        { ...idle, runtime: { status: "running" } as EnvironmentThreadShell["runtime"] },
        { status: "completed" },
      ),
    ).toBe("working");
  });

  it("treats a settled child as done and otherwise follows the parent's record", () => {
    expect(
      captainLocalTaskStatus({ ...idle, settledAt: "2026-11-25" }, { status: "completed" }),
    ).toBe("done");
    expect(captainLocalTaskStatus(idle, { status: "failed" })).toBe("failed");
    expect(captainLocalTaskStatus(null, { status: "running" })).toBe("working");
    expect(captainLocalTaskStatus(withRun("completed"), null)).toBe("ready");
  });
});

describe("captainTaskIsRecent and compareCaptainTasks", () => {
  it("keeps open work whatever its age and drops old outcomes", () => {
    expect(captainTaskIsRecent("needs-input", 0, 100)).toBe(true);
    expect(captainTaskIsRecent("working", 0, 100)).toBe(true);
    expect(captainTaskIsRecent("failed", 0, 100)).toBe(false);
    expect(captainTaskIsRecent("failed", 200, 100)).toBe(true);
  });

  it("orders needs you, then running, then failures and reviews, newest first", () => {
    const tasks = [
      { id: "done", status: "done", updatedAtMs: 9 },
      { id: "ready-old", status: "ready", updatedAtMs: 1 },
      { id: "working", status: "working", updatedAtMs: 2 },
      { id: "ready-new", status: "ready", updatedAtMs: 5 },
      { id: "ask", status: "needs-input", updatedAtMs: 0 },
      { id: "failed", status: "failed", updatedAtMs: 3 },
    ] as const;
    expect([...tasks].sort(compareCaptainTasks).map((task) => task.id)).toEqual([
      "ask",
      "working",
      "failed",
      "ready-new",
      "ready-old",
      "done",
    ]);
  });
});

describe("captainTaskDetail", () => {
  it("shows the first line of a markdown result as plain text", () => {
    expect(
      captainTaskDetail({
        status: "ready",
        subagent: {
          result: "\n# Fixed the **probe**\nMore",
        },
      }),
    ).toBe("Fixed the probe");
    expect(
      captainTaskDetail({
        status: "ready",
        subagent: {
          result: "---\nCommitted `47ad049` on [t3/tasks](https://example.com) for _review_.",
        },
      }),
    ).toBe("Committed 47ad049 on t3/tasks for review.");
  });
});
