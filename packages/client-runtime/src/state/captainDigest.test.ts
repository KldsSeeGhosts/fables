import { expect, it } from "vite-plus/test";

import {
  captainBriefItems,
  captainBriefVisible,
  captainDigestMarkdownExcerpt,
  captainDigestNewSection,
  captainDigestRest,
  type CaptainBriefEntry,
} from "./captainDigest.ts";

it("reads only the New section of a digest", () => {
  const digest =
    "# Digest\n\n## New\n- Shipped the login fix\n- Crew is on the docs\n\n## Earlier\n- Old news";
  expect(captainDigestNewSection(digest)).toBe("- Shipped the login fix\n- Crew is on the docs");
});

it("keeps subheadings inside the New section", () => {
  expect(captainDigestNewSection("## New\n### Today\nOne line")).toBe("### Today\nOne line");
});

it("returns null only when the digest has no New section", () => {
  expect(captainDigestNewSection("## Earlier\nOld")).toBeNull();
});

it("returns an empty New section as empty, not as the older entries", () => {
  expect(captainDigestNewSection("## New\n\n## Earlier\nOld")).toBe("");
});

it("bounds a long digest excerpt", () => {
  const long = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
  const excerpt = captainDigestMarkdownExcerpt(long);
  expect(excerpt.truncated).toBe(true);
  expect(excerpt.markdown.endsWith("…")).toBe(true);
});

const item = (markdown: string, references: string[] = []): CaptainBriefEntry => ({
  kind: "item",
  markdown,
  references,
});

it("splits a list into items and joins continuation lines", () => {
  expect(captainBriefItems("- one\n  more\n- two\n\n- three")).toEqual([
    item("one\nmore"),
    item("two"),
    item("three"),
  ]);
});

it("keeps a nested list inside its parent with relative indent", () => {
  expect(captainBriefItems("- parent\n  - child\n- next")).toEqual([
    item("parent\n- child"),
    item("next"),
  ]);
});

it("treats paragraphs as items and headings as labels", () => {
  expect(captainBriefItems("### Today\nfirst\n\nsecond")).toEqual([
    { kind: "label", text: "Today" },
    item("first"),
    item("second"),
  ]);
});

it("keeps Chorus recap labels out of the collapsed item count", () => {
  const markdown = "**Mac Studio**\n**Release**\n- one\n- two\n**Build box**\n- Offline";
  const entries = captainBriefItems(markdown, { boldLabels: true });
  expect(entries).toEqual([
    { kind: "label", text: "Mac Studio" },
    { kind: "label", text: "Release" },
    item("one"),
    item("two"),
    { kind: "label", text: "Build box" },
    item("Offline"),
  ]);
  expect(captainBriefVisible(entries, false).visible).toEqual(entries);
});

it("splits ordered markers", () => {
  expect(captainBriefItems("1. a\n2) b")).toEqual([item("a"), item("b")]);
});

it("keeps a fenced block with list-like lines in one item", () => {
  const entries = captainBriefItems("- run:\n  ```\n  - not an item\n  ```\n- next");
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({ kind: "item" });
  expect((entries[0] as { markdown: string }).markdown).toContain("- not an item");
});

it("lifts trailing links on the line, after a continuation, and before a period", () => {
  expect(captainBriefItems("- Fix shipped [PR #15](https://x/15)")).toEqual([
    item("Fix shipped", ["[PR #15](https://x/15)"]),
  ]);
  expect(captainBriefItems("- Fix shipped\n  [a](https://x/a) [b](https://x/b)")).toEqual([
    item("Fix shipped", ["[a](https://x/a)", "[b](https://x/b)"]),
  ]);
  expect(captainBriefItems("- Fix shipped [a](https://x/a).")).toEqual([
    item("Fix shipped", ["[a](https://x/a)"]),
  ]);
});

it("leaves a mid-sentence link in the text", () => {
  expect(captainBriefItems("- See [PR](https://x/1) for details")).toEqual([
    item("See [PR](https://x/1) for details"),
  ]);
});

it("keeps an item that is only a link", () => {
  expect(captainBriefItems("- [PR](https://x/1)")).toEqual([item("[PR](https://x/1)")]);
});

it("does not lift a trailing markdown image", () => {
  expect(captainBriefItems("- Chart ![chart](https://x/c.png)")).toEqual([
    item("Chart ![chart](https://x/c.png)"),
  ]);
});

it("returns no entries for empty input", () => {
  expect(captainBriefItems("")).toEqual([]);
});

it("collapses only briefs with more than four items", () => {
  const make = (count: number) =>
    Array.from({ length: count }, (_, index) => item(`item ${index + 1}`));
  expect(captainBriefVisible(make(4), false)).toMatchObject({
    collapsible: false,
    hiddenCount: 0,
  });
  const five = captainBriefVisible(make(5), false);
  expect(five.visible).toHaveLength(3);
  expect(five).toMatchObject({ collapsible: true, hiddenCount: 2 });
  expect(captainBriefVisible(make(5), true).visible).toHaveLength(5);
});

it("drops a label left dangling before the hidden items and does not count labels", () => {
  const entries: CaptainBriefEntry[] = [
    { kind: "label", text: "A" },
    item("1"),
    item("2"),
    item("3"),
    { kind: "label", text: "B" },
    item("4"),
    item("5"),
  ];
  expect(captainBriefVisible(entries, false).visible).toEqual(entries.slice(0, 4));
  expect(captainBriefVisible(entries.slice(0, 5), false).collapsible).toBe(false);
});

it("returns the digest without its New section and title", () => {
  expect(captainDigestRest("# Digest\n\n## New\n- a\n\n## Earlier\n- b")).toBe("## Earlier\n- b");
  expect(captainDigestRest("## Earlier\n- b")).toBe("");
  expect(captainDigestRest("## New\n- a")).toBe("");
  expect(captainBriefItems(captainDigestNewSection("## New\n\n## Earlier\nx") ?? "x")).toEqual([]);
});
