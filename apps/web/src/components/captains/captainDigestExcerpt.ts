const MAX_EXCERPT_LINES = 10;
const MAX_EXCERPT_CHARS = 720;

/** A bounded prefix of DIGEST.md that keeps its markdown structure intact for preview cards. */
export function captainDigestMarkdownExcerpt(content: string): string {
  const source = content.trim();
  if (source === "") return "";
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
  return truncated ? `${text}\n\n…` : text;
}
