/** The first five nonempty lines of DIGEST.md's `## New` section. */
export const captainDigestNewLines = (content: string) => {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => /^##\s+New\s*$/iu.test(line.trim()));
  if (start === -1) return [];
  const body: Array<string> = [];
  for (let index = start + 1; index < lines.length && body.length < 5; index++) {
    const line = lines[index]!.trim();
    if (/^#{1,2}\s/u.test(line)) break;
    if (line !== "") body.push(line.length <= 240 ? line : `${line.slice(0, 239)}…`);
  }
  return body;
};

export const captainDigestSummary = (content: string) => {
  const [first] = captainDigestNewLines(content);
  return first?.replace(/^[-*]\s+/u, "").replace(/\s+/gu, " ") ?? "No new items.";
};
