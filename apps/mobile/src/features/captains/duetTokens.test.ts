import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { DUET_TOKENS, duetTokensForAppearance } from "./duetTokens";

describe("duetTokens", () => {
  it("mirrors the ksg-salon light and dark design values", () => {
    expect(duetTokensForAppearance("light")).toMatchObject({
      background: "#ffffff",
      row: "#ededed",
      ready: "#1e7d2c",
      working: "#d97757",
      workingText: "#b85a3c",
      scrim: "rgba(0, 0, 0, 0.22)",
    });
    expect(duetTokensForAppearance("dark")).toMatchObject({
      background: "#191919",
      row: "#2b2b2b",
      ready: "#57b565",
      working: "#d97757",
      workingText: "#e8957a",
      scrim: "rgba(0, 0, 0, 0.5)",
    });
    expect(Object.keys(DUET_TOKENS.light).sort()).toEqual(Object.keys(DUET_TOKENS.dark).sort());
  });

  it("keeps hardcoded hex colors out of every Duet component", () => {
    const directory = NodePath.resolve(import.meta.dirname);
    const offenders = NodeFS.readdirSync(directory)
      .filter((name) => name.endsWith(".tsx"))
      .flatMap((name) => {
        const source = NodeFS.readFileSync(NodePath.join(directory, name), "utf8");
        return /#[0-9a-fA-F]{3,8}\b/.test(source) ? [name] : [];
      });
    expect(offenders).toEqual([]);
  });
});
