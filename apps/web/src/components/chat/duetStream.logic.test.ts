import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  duetTaskHeaderByRowId,
  duetTimestampDividers,
  extractDuetDocumentCards,
  formatDuetTimestampDivider,
  inlineDuetThreadLinks,
  parseDuetInlineThreadHref,
} from "./duetStream.logic";

const environmentId = EnvironmentId.make("env-1");
const captainThreadId = ThreadId.make("captain:one");
const firstChild = ThreadId.make("thread:child-one");
const secondChild = ThreadId.make("thread:child-two");
const captainRef = { environmentId, threadId: captainThreadId };

const messageRow = (id: string, createdAt: string, text = "message", role = "assistant") => ({
  id,
  kind: "message",
  createdAt,
  message: { role, text },
});

describe("duetTimestampDividers", () => {
  it("opens the stream and resumes after more than fifteen minutes", () => {
    const rows = [
      messageRow("first", "2026-01-10T10:00:00.000Z"),
      messageRow("close", "2026-01-10T10:10:00.000Z"),
      messageRow("apart", "2026-01-10T10:26:00.000Z"),
      messageRow("later", "2026-01-10T10:27:00.000Z"),
    ];
    expect(duetTimestampDividers(rows)).toEqual(
      new Map([
        ["first", "2026-01-10T10:00:00.000Z"],
        ["apart", "2026-01-10T10:26:00.000Z"],
      ]),
    );
  });

  it("formats day-aware divider timestamps", () => {
    const now = new Date("2026-01-10T16:00:00");
    expect(formatDuetTimestampDivider("2026-01-10T09:30:00", "24-hour", now.getTime())).toMatch(
      /^Today /,
    );
    expect(formatDuetTimestampDivider("2026-01-09T09:30:00", "24-hour", now.getTime())).toMatch(
      /^Yesterday /,
    );
    expect(formatDuetTimestampDivider("2026-01-04T09:30:00", "24-hour", now.getTime())).toContain(
      "Jan 4",
    );
  });
});

describe("duet task headers and inline thread links", () => {
  const firstLink = `[First](<t3-thread://v2/env-1/${firstChild}>)`;
  const secondLink = `[Second](<t3-thread://v2/env-1/${secondChild}>)`;

  it("starts a header when the first linked Captain child changes", () => {
    const rows = [
      messageRow("a", "2026-01-10T10:00:00.000Z", `done ${firstLink}`),
      messageRow("b", "2026-01-10T10:01:00.000Z", `again ${firstLink}`),
      messageRow("c", "2026-01-10T10:02:00.000Z", `next ${secondLink}`),
      messageRow("d", "2026-01-10T10:03:00.000Z", "no child"),
      messageRow("e", "2026-01-10T10:04:00.000Z", `again ${secondLink}`),
    ];
    expect(duetTaskHeaderByRowId(rows, captainRef, new Set([firstChild, secondChild]))).toEqual(
      new Map([
        ["a", firstChild],
        ["c", secondChild],
      ]),
    );
  });

  it("rewrites thread links to inline drill-down hrefs", () => {
    const rewritten = inlineDuetThreadLinks(
      `Finished ${firstLink}`,
      environmentId,
      new Map([[`${environmentId}\0${firstChild}`, "Fix the bug"]]),
    );
    expect(rewritten).toBe(
      `Finished [○ First](#duet-thread/${encodeURIComponent(environmentId)}/${encodeURIComponent(firstChild)})`,
    );
    expect(parseDuetInlineThreadHref("#duet-thread/env-1/thread%3Achild-one")).toEqual({
      environmentId,
      threadId: firstChild,
    });
  });
});

describe("extractDuetDocumentCards", () => {
  it("extracts standalone markdown and captain document paragraphs", () => {
    const extracted = extractDuetDocumentCards(
      "Here is the report.\n\n[Report](docs/report.md)\n\n[DIGEST.md](captain/DIGEST.md)\n\nClosing prose.",
    );
    expect(extracted.text).toBe("Here is the report.\n\nClosing prose.");
    expect(extracted.documents.map((document) => document.title)).toEqual([
      "report.md",
      "DIGEST.md",
    ]);
    expect(extracted.documents[1]?.captainDocumentName).toBe("DIGEST.md");
  });

  it("ignores inline document links and unsupported files", () => {
    const extracted = extractDuetDocumentCards(
      "Read [the notes](notes.md) here.\n\n[image](image.png)",
    );
    expect(extracted.text).toContain("Read [the notes](notes.md) here.");
    expect(extracted.text).toContain("[image](image.png)");
    expect(extracted.documents).toEqual([]);
  });
});
