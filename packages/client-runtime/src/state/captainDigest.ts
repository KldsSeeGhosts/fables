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

/** The body of DIGEST.md's `## New` section, or null when the digest has none. */
export function captainDigestNewSection(content: string): string | null {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => /^##\s+New\s*$/i.test(line.trim()));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line.trim()));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return body === "" ? null : body;
}
