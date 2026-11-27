const assert = require("node:assert/strict");
const test = require("node:test");
const { nextReleaseVersion } = require("./ksg-release-version.cjs");

test("starts at 0.2.0 and advances once a plain tag exists", () => {
  const tags = ["v0.1.13-nightly.20261126.530501", "upstream/v0.1.13-nightly.20261126.5305"];
  assert.equal(nextReleaseVersion("0.2", tags), "0.2.0");
  assert.equal(nextReleaseVersion("0.2", [...tags, "v0.2.0"]), "0.2.1");
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
