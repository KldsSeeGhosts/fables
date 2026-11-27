const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const RELEASE_SERIES = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLAIN_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function nextReleaseVersion(series, tags) {
  const parts = RELEASE_SERIES.exec(series);
  if (!parts) throw new Error(`Invalid Fables release series: ${series}`);
  const [major, minor] = parts.slice(1).map(BigInt);
  let nextPatch = 0n;
  for (const tag of tags) {
    const match = PLAIN_RELEASE_TAG.exec(tag);
    if (!match) continue;
    const [tagMajor, tagMinor, patch] = match.slice(1).map(BigInt);
    if (tagMajor > major || (tagMajor === major && tagMinor > minor)) {
      throw new Error(`Fables release series ${series} is older than ${tag}.`);
    }
    if (tagMajor === major && tagMinor === minor) {
      if (patch >= nextPatch) nextPatch = patch + 1n;
    }
  }
  return `${series}.${nextPatch}`;
}

if (require.main === module) {
  const seriesFile = process.argv[2] ?? join(__dirname, "../fables-release-series");
  const series = readFileSync(seriesFile, "utf8").trim();
  const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" }).split("\n");
  console.log(nextReleaseVersion(series, tags));
}

module.exports = { nextReleaseVersion, PLAIN_RELEASE_TAG };
