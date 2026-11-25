import { expect, it } from "vite-plus/test";

import { captainDigestMarkdownExcerpt, captainDigestNewSection } from "./captainDigest.ts";

it("reads only the New section of a digest", () => {
  const digest =
    "# Digest\n\n## New\n- Shipped the login fix\n- Crew is on the docs\n\n## Earlier\n- Old news";
  expect(captainDigestNewSection(digest)).toBe("- Shipped the login fix\n- Crew is on the docs");
});

it("keeps subheadings inside the New section", () => {
  expect(captainDigestNewSection("## New\n### Today\nOne line")).toBe("### Today\nOne line");
});

it("returns null when the digest has no New section or it is empty", () => {
  expect(captainDigestNewSection("## Earlier\nOld")).toBeNull();
  expect(captainDigestNewSection("## New\n\n## Earlier\nOld")).toBeNull();
});

it("bounds a long digest excerpt", () => {
  const long = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
  const excerpt = captainDigestMarkdownExcerpt(long);
  expect(excerpt.truncated).toBe(true);
  expect(excerpt.markdown.endsWith("…")).toBe(true);
});
