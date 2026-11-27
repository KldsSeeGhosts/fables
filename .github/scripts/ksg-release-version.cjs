const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  fablesBridgeUpstreamTag,
  fablesBridgeVersion,
} = require("../../packages/shared/src/fablesReleaseBridge.ts");

const RELEASE_SERIES = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLAIN_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const isPlainSeriesTag = (tag) => PLAIN_RELEASE_TAG.test(tag) && !/^v0\.[01]\./.test(tag);

function nextBridgeVersion(tags, upstreamTag, sourceTags) {
  if (upstreamTag !== fablesBridgeUpstreamTag) {
    throw new Error(`The Fables bridge must build on ${fablesBridgeUpstreamTag}.`);
  }
  const bridgeTag = `v${fablesBridgeVersion}`;
  if (!sourceTags.includes(bridgeTag) && tags.some(isPlainSeriesTag)) {
    throw new Error("The Fables bridge must publish before the plain series.");
  }
  const occupied = tags.find(
    (tag) =>
      tag.startsWith(upstreamTag) &&
      /^\d{2}$/.test(tag.slice(upstreamTag.length)) &&
      (tag > bridgeTag || (tag === bridgeTag && !sourceTags.includes(tag))),
  );
  if (occupied !== undefined) {
    throw new Error(`The one-time Fables bridge tag ${bridgeTag} must sort after ${occupied}.`);
  }
  return fablesBridgeVersion;
}

function nextReleaseVersion(series, tags, upstreamTag, sourceTags = []) {
  if (series === "bridge") return nextBridgeVersion(tags, upstreamTag, sourceTags);
  const parts = RELEASE_SERIES.exec(series);
  if (!parts) throw new Error(`Invalid Fables release series: ${series}`);
  const [major, minor] = parts.slice(1).map(BigInt);
  const sourceTag = sourceTags.find(
    (tag) => PLAIN_RELEASE_TAG.test(tag) && tag.startsWith(`v${series}.`),
  );
  let nextPatch = 0n;
  for (const tag of tags) {
    const match = PLAIN_RELEASE_TAG.exec(tag);
    if (!match) continue;
    const [tagMajor, tagMinor, patch] = match.slice(1).map(BigInt);
    if (!sourceTag && (tagMajor > major || (tagMajor === major && tagMinor > minor))) {
      throw new Error(`Fables release series ${series} is older than ${tag}.`);
    }
    if (tagMajor === major && tagMinor === minor) {
      if (patch >= nextPatch) nextPatch = patch + 1n;
    }
  }
  if (!tags.includes(`v${fablesBridgeVersion}`)) {
    throw new Error("Publish the Fables bridge before starting the plain series.");
  }
  if (sourceTag) return sourceTag.slice(1);
  return `${series}.${nextPatch}`;
}

if (require.main === module) {
  const upstreamTag = process.argv[2];
  const seriesFile = process.argv[3] ?? join(__dirname, "../fables-release-series");
  const series = readFileSync(seriesFile, "utf8").trim();
  const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" }).split("\n");
  const sourceTags = execFileSync("git", ["tag", "--points-at", "HEAD"], {
    encoding: "utf8",
  }).split("\n");
  const version = nextReleaseVersion(series, tags, upstreamTag, sourceTags);
  if (series !== "bridge" && !sourceTags.includes(`v${version}`)) {
    const missingTag = execFileSync("git", ["tag", "--list", "--no-merged", "HEAD", "v*"], {
      encoding: "utf8",
    })
      .split("\n")
      .find((tag) => tag === `v${fablesBridgeVersion}` || isPlainSeriesTag(tag));
    if (missingTag) throw new Error(`Release source does not include ${missingTag}.`);
  }
  console.log(version);
}

module.exports = { nextReleaseVersion, PLAIN_RELEASE_TAG, fablesBridgeVersion };
