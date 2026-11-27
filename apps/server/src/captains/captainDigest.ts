const cleanLine = (line: string) => line.replace(/\s+$/u, "");

/** The first lines of DIGEST.md's `## New` section, without the heading or outer blank lines. */
export const captainDigestNewLines = (content: string, maxLines = 5) => {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => /^##\s+New\s*$/iu.test(line.trim()));
  if (start === -1) return [];
  const body: Array<string> = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/u.test(line.trim())) break;
    body.push(cleanLine(line));
  }
  while (body[0]?.trim() === "") body.shift();
  while (body.at(-1)?.trim() === "") body.pop();
  return body.slice(0, maxLines);
};

export const captainDigestSummary = (content: string) => {
  const first = captainDigestNewLines(content)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/u, "")
        .replace(/\s+/gu, " "),
    )
    .find((line) => line !== "");
  if (first === undefined) return "No new items.";
  return first.length <= 160 ? first : `${first.slice(0, 159)}…`;
};
