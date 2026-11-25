import { describe, expect, it } from "vite-plus/test";

import {
  CAPTAIN_DOCUMENT_MAX_LENGTH,
  CAPTAIN_HANDOFF_MAX_LENGTH,
  formatCaptainHandoff,
  upsertCaptainHandoffSection,
} from "./captainHandoff.ts";

const generatedAt = "2026-11-25T10:00:00.000Z";

describe("formatCaptainHandoff", () => {
  it("formats every populated section", () => {
    const section = formatCaptainHandoff({
      generatedAt,
      activeTasks: [
        {
          id: "task-1",
          title: "Review the migration",
          status: "running",
          progress: "Checking projection rows\nimplementation detail",
          followId: "thread:child",
        },
      ],
      pendingRequests: [
        {
          kind: "user_input",
          threadId: "thread:child",
          requestId: "request-1",
          detail: "Which migration should ship?",
        },
        {
          kind: "command",
          threadId: "captain:maria:0",
          requestId: "request-2",
          detail: "Run the test suite",
        },
      ],
      lastUserMessage: "Please finish the migration",
      lastAssistantMessage: "I am checking the projection rows",
      scheduledTaskCount: 2,
    });

    expect(section).toBe(
      `## Handoff from the previous conversation (${generatedAt})\n\n` +
        "### Active delegated tasks\n" +
        "- Review the migration [task-1] (running, follow: thread:child): Checking projection rows\n\n" +
        "### Waiting on the user\n" +
        "- user input on thread:child: Which migration should ship? [request: request-1]\n" +
        "- command approval on captain:maria:0: Run the test suite [request: request-2]\n\n" +
        "### Last user message\n" +
        "> Please finish the migration\n\n" +
        "### Captain's last reply\n" +
        "> I am checking the projection rows\n\n" +
        "### Scheduled tasks\n" +
        "- 2 scheduled tasks moved to the new conversation.\n\n" +
        "<!-- end captain handoff -->",
    );
  });

  it("quotes multiline messages without creating markdown headings", () => {
    const section = formatCaptainHandoff({
      generatedAt,
      activeTasks: [],
      pendingRequests: [],
      lastUserMessage: "First line\n## not a notes heading",
    });

    expect(section).toContain("### Last user message\n> First line\n> ## not a notes heading");
  });

  it("omits sections without facts", () => {
    expect(
      formatCaptainHandoff({
        generatedAt,
        activeTasks: [],
        pendingRequests: [],
      }),
    ).toBe(
      `## Handoff from the previous conversation (${generatedAt})\n\n<!-- end captain handoff -->`,
    );
  });

  it("keeps a long handoff within the section cap", () => {
    const section = formatCaptainHandoff({
      generatedAt,
      activeTasks: Array.from({ length: 12 }, (_, index) => ({
        id: `task-${index}`,
        title: `Task ${index} ${"title".repeat(30)}`,
        status: "running",
        progress: "progress".repeat(30),
        followId: `thread:${index}`,
      })),
      pendingRequests: Array.from({ length: 8 }, (_, index) => ({
        kind: "command",
        threadId: `thread:${index}`,
        requestId: `request-${index}`,
        detail: "detail".repeat(40),
      })),
      lastUserMessage: "user".repeat(200),
      lastAssistantMessage: "assistant".repeat(200),
      scheduledTaskCount: 12,
    });

    expect(section.length).toBeLessThanOrEqual(CAPTAIN_HANDOFF_MAX_LENGTH);
    expect(section).toContain("Additional handoff details were omitted");
    expect(section).toContain("<!-- end captain handoff -->");
  });
});

describe("upsertCaptainHandoffSection", () => {
  it("replaces an earlier handoff and preserves the rest of NOTES.md", () => {
    const content =
      "Own notes.\n\n" +
      "## Handoff from the previous conversation (2026-11-24T09:00:00.000Z)\n\n" +
      "### Active delegated tasks\n" +
      "- Old task\n\n" +
      "## Stable notes\n" +
      "Keep this exactly.\n";
    const nextSection = `## Handoff from the previous conversation (${generatedAt})\n\n### Last user message\n> Continue`;

    expect(upsertCaptainHandoffSection(content, nextSection)).toEqual({
      content: `${nextSection}\n\nOwn notes.\n\n## Stable notes\nKeep this exactly.\n`,
      included: true,
    });
  });

  it("preserves unheaded notes when replacing a generated handoff", () => {
    const first = formatCaptainHandoff({
      generatedAt: "2026-11-24T09:00:00.000Z",
      activeTasks: [],
      pendingRequests: [],
    });
    const second = `## Handoff from the previous conversation (${generatedAt})`;
    const once = upsertCaptainHandoffSection("Plain notes without a heading.", first).content;

    expect(upsertCaptainHandoffSection(once, second).content).toBe(
      `${second}\n\nPlain notes without a heading.`,
    );
  });

  it("ends a handoff only at an unquoted marker line", () => {
    const first = formatCaptainHandoff({
      generatedAt: "2026-11-24T09:00:00.000Z",
      activeTasks: [],
      pendingRequests: [],
      lastUserMessage: "Keep <!-- end captain handoff --> as text\n<!-- end captain handoff -->",
    });
    const second = `## Handoff from the previous conversation (${generatedAt})`;
    const once = upsertCaptainHandoffSection("Own notes.", first).content;

    expect(upsertCaptainHandoffSection(once, second).content).toBe(`${second}\n\nOwn notes.`);
  });

  it("never cuts the notes to fit a handoff", () => {
    const section = `## Handoff from the previous conversation (${generatedAt})`;
    const full = "x".repeat(CAPTAIN_DOCUMENT_MAX_LENGTH - 10);

    expect(upsertCaptainHandoffSection(full, section)).toEqual({ content: full, included: false });
    const generated = formatCaptainHandoff({
      generatedAt: "2026-11-24T09:00:00.000Z",
      activeTasks: [],
      pendingRequests: [],
    });
    const stale = upsertCaptainHandoffSection("Own notes.", generated).content;
    expect(upsertCaptainHandoffSection(`${stale}${full}`, section)).toEqual({
      content: `Own notes.${full}`,
      included: false,
    });
  });
});
