const MAX_EXCERPT_LINES = 10;
const MAX_EXCERPT_CHARS = 720;

/** A bounded prefix of DIGEST.md that keeps its markdown structure intact for preview cards. */
export function captainDigestMarkdownExcerpt(content: string): {
  readonly markdown: string;
  readonly truncated: boolean;
} {
  const source = content.trim();
  if (source === "") return { markdown: "", truncated: false };
  const lines = source.split("\n");
  const excerpt: string[] = [];
  let chars = 0;
  let index = 0;
  for (; index < lines.length; index++) {
    const line = lines[index]!;
    const nextChars = chars + line.length + (excerpt.length === 0 ? 0 : 1);
    if (
      excerpt.length > 0 &&
      (excerpt.length >= MAX_EXCERPT_LINES || nextChars > MAX_EXCERPT_CHARS)
    )
      break;
    excerpt.push(line);
    chars = nextChars;
  }
  let truncated = index < lines.length;
  let text = excerpt.join("\n").trimEnd();
  if (text.length > MAX_EXCERPT_CHARS) {
    text = text.slice(0, MAX_EXCERPT_CHARS).trimEnd();
    truncated = true;
  }
  return { markdown: truncated ? `${text}\n\n…` : text, truncated };
}

/**
 * The body of DIGEST.md's `## New` section: empty when the section is there with nothing in it,
 * null only when the digest has no such section.
 */
export function captainDigestNewSection(content: string): string | null {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => /^##\s+New\s*$/i.test(line.trim()));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line.trim()));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

export type CaptainBriefEntry =
  | { readonly kind: "label"; readonly text: string }
  | {
      readonly kind: "item";
      readonly markdown: string;
      readonly references: ReadonlyArray<string>;
    };

const BRIEF_COLLAPSE_ABOVE = 4;
const BRIEF_COLLAPSED_ITEMS = 3;
const FENCE = /^\s*(```|~~~)/;
const THEMATIC_BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const BOLD_LABEL = /^\*\*([^*]+?)\*\*:?\s*$/;
const LIST_MARKER = /^([-*+]|\d+[.)])\s+/;
const TRAILING_LINKS = /(?:[\s,;·|]*(?<!!)\[[^\]\n]*\]\([^)\s]+\))+[\s.,;]*$/u;
const LINK = /(?<!!)\[[^\]\n]*\]\([^)\s]+\)/gu;

function liftReferences(text: string): { markdown: string; references: ReadonlyArray<string> } {
  const run = TRAILING_LINKS.exec(text);
  if (run === null) return { markdown: text, references: [] };
  const before = text.slice(0, run.index).trimEnd();
  if (before === "") return { markdown: text, references: [] };
  return { markdown: before, references: run[0].match(LINK) ?? [] };
}

/** Splits a brief into top-level items and subheading labels, lifting each item's trailing links out of its text. */
export function captainBriefItems(
  markdown: string,
  options?: { readonly boldLabels?: boolean },
): ReadonlyArray<CaptainBriefEntry> {
  const raw: Array<{ label: string } | { body: string[] }> = [];
  let current = null as string[] | null;
  let kind = "paragraph" as "paragraph" | "list";
  let markerWidth = 0;
  let inFence = false;
  let previousBlank = true;
  const lines = markdown.split("\n");

  const close = () => {
    if (current !== null) raw.push({ body: current });
    current = null;
  };
  const start = (line: string, itemKind: "paragraph" | "list", width = 0) => {
    close();
    current = [line];
    kind = itemKind;
    markerWidth = width;
  };

  for (const [index, line] of lines.entries()) {
    const blank = line.trim() === "";
    if (FENCE.test(line)) {
      inFence = !inFence;
      if (current === null) start(line.trim(), "paragraph");
      else current.push(line);
      previousBlank = false;
      continue;
    }
    if (inFence) {
      if (current === null) start(line, "paragraph");
      else current.push(line);
      previousBlank = blank;
      continue;
    }
    if (blank) {
      if (current !== null) {
        if (kind === "list") {
          const next = lines.slice(index + 1).find((candidate) => candidate.trim() !== "");
          if (next !== undefined && /^[ \t]/.test(next)) current.push("");
          else close();
        } else close();
      }
      previousBlank = true;
      continue;
    }
    const indented = /^[ \t]/.test(line);
    const label =
      HEADING.exec(line)?.[1] ?? (options?.boldLabels ? BOLD_LABEL.exec(line)?.[1] : undefined);
    if (!indented && THEMATIC_BREAK.test(line)) {
      close();
    } else if (!indented && label !== undefined) {
      close();
      raw.push({ label });
    } else if (!indented && LIST_MARKER.test(line)) {
      const marker = LIST_MARKER.exec(line)![0];
      start(line.slice(marker.length), "list", marker.length);
    } else if (indented) {
      if (current === null) start(line.trim(), "paragraph");
      else {
        const expanded = line.replace(/^\t/, " ".repeat(markerWidth || 1));
        const lead = /^ */.exec(expanded)![0].length;
        current.push(expanded.slice(Math.min(lead, markerWidth)));
      }
    } else if (current !== null && !previousBlank) {
      current.push(line);
    } else {
      start(line, "paragraph");
    }
    previousBlank = false;
  }
  close();

  const entries: CaptainBriefEntry[] = [];
  for (const entry of raw) {
    if ("label" in entry) {
      entries.push({ kind: "label", text: entry.label });
      continue;
    }
    const text = entry.body.join("\n").trim();
    if (text === "") continue;
    entries.push({ kind: "item", ...liftReferences(text) });
  }
  return entries;
}

/** The entries to show: every item when there are 4 or fewer, else the first 3 unless expanded. */
export function captainBriefVisible(
  entries: ReadonlyArray<CaptainBriefEntry>,
  expanded: boolean,
): {
  readonly visible: ReadonlyArray<CaptainBriefEntry>;
  readonly collapsible: boolean;
  readonly hiddenCount: number;
} {
  const count = entries.filter((entry) => entry.kind === "item").length;
  const collapsible = count > BRIEF_COLLAPSE_ABOVE;
  if (!collapsible || expanded) return { visible: entries, collapsible, hiddenCount: 0 };
  let seen = 0;
  const cut = entries.findIndex((entry) => entry.kind === "item" && ++seen > BRIEF_COLLAPSED_ITEMS);
  const visible = entries.slice(0, cut);
  while (visible.at(-1)?.kind === "label") visible.pop();
  return { visible, collapsible, hiddenCount: count - BRIEF_COLLAPSED_ITEMS };
}

/** DIGEST.md without its `## New` section or a leading `#` title; empty when there is no `## New` section. */
export function captainDigestRest(content: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => /^##\s+New\s*$/i.test(line.trim()));
  if (start === -1) return "";
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => /^#{1,2}\s/.test(line.trim()));
  const kept = [...lines.slice(0, start), ...(end === -1 ? [] : after.slice(end))];
  const first = kept.findIndex((line) => line.trim() !== "");
  if (first !== -1 && /^#\s/.test(kept[first]!)) kept.splice(first, 1);
  return kept.join("\n").trim();
}
