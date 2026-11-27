const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  fablesBridgeFirstCounter,
  fablesBridgeUpstreamTag,
} = require("../../packages/shared/src/fablesReleaseBridge.ts");

const RELEASE_SERIES = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLAIN_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function nextBridgeVersion(tags, upstreamTag) {
  if (upstreamTag !== fablesBridgeUpstreamTag) {
    throw new Error(`The Fables bridge must build on ${fablesBridgeUpstreamTag}.`);
  }
  if (tags.some((tag) => PLAIN_RELEASE_TAG.test(tag) && !/^v0\.[01]\./.test(tag))) {
    throw new Error("The Fables bridge must publish before the plain series.");
  }
  let counter = fablesBridgeFirstCounter;
  for (const tag of tags) {
    if (!tag.startsWith(upstreamTag)) continue;
    const suffix = tag.slice(upstreamTag.length);
    if (/^\d{2}$/.test(suffix)) counter = Math.max(counter, Number(suffix) + 1);
  }
  if (counter > 99) throw new Error(`Fork counter exhausted for ${upstreamTag}.`);
  return `${upstreamTag.slice(1)}${String(counter).padStart(2, "0")}`;
}

function nextReleaseVersion(series, tags, upstreamTag) {
  if (series === "bridge") return nextBridgeVersion(tags, upstreamTag);
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
  const upstreamTag = process.argv[2];
  const seriesFile = process.argv[3] ?? join(__dirname, "../fables-release-series");
  const series = readFileSync(seriesFile, "utf8").trim();
  const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" }).split("\n");
  console.log(nextReleaseVersion(series, tags, upstreamTag));
}

module.exports = { nextReleaseVersion, PLAIN_RELEASE_TAG };
