const assert = require("node:assert/strict");
const test = require("node:test");
const { nextReleaseVersion } = require("./ksg-release-version.cjs");
const { isFablesBridgeVersion } = require("../../packages/shared/src/fablesReleaseBridge.ts");

test("publishes an encoded bridge, then starts the plain series and advances it", () => {
  const upstream = "v0.1.13-nightly.20261126.5305";
  const installed = `${upstream}01`;
  const tags = [installed, `${upstream}03`, `upstream/${upstream}`, "v0.1.12"];
  const bridge = nextReleaseVersion("bridge", tags, upstream);
  assert.equal(bridge, "0.1.13-nightly.20261126.530504");
  assert.ok(`v${bridge}` > installed);
  assert.ok(!isFablesBridgeVersion(installed.slice(1)));
  assert.ok(isFablesBridgeVersion(bridge));

  tags.push(`v${bridge}`);
  assert.equal(nextReleaseVersion("bridge", tags, upstream), "0.1.13-nightly.20261126.530505");
  assert.equal(nextReleaseVersion("0.2", tags), "0.2.0");
  tags.push("v0.2.0");
  assert.equal(nextReleaseVersion("0.2", tags), "0.2.1");
  tags.push("v0.2.1");
  assert.equal(nextReleaseVersion("0.3", tags), "0.3.0");
});

test("refuses to issue a bridge outside the reserved run or after the plain series", () => {
  const upstream = "v0.1.13-nightly.20261126.5305";
  assert.throws(() => nextReleaseVersion("bridge", [], `${upstream}1`), /must build on/);
  assert.throws(() => nextReleaseVersion("bridge", [`${upstream}99`], upstream), /exhausted/);
  assert.throws(
    () => nextReleaseVersion("bridge", ["v0.2.0"], upstream),
    /before the plain series/,
  );
});

test("uses the highest patch and resets it on a minor or major bump", () => {
  const tags = ["v0.2.9", "v0.2.10", "v0.2.7", "v0.2.99-preview.20261126.2", "v0.2.01"];
  assert.equal(nextReleaseVersion("0.2", tags), "0.2.11");
  assert.equal(nextReleaseVersion("0.3", tags), "0.3.0");
  assert.equal(nextReleaseVersion("1.0", tags), "1.0.0");
});

test("rejects invalid or stale series", () => {
  assert.throws(() => nextReleaseVersion("0.2.0", []), /Invalid Fables release series/);
  assert.throws(() => nextReleaseVersion("0.2", ["v0.3.0"]), /older than v0.3.0/);
});
