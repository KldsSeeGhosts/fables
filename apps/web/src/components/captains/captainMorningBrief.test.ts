import { describe, expect, it } from "vite-plus/test";

import { captainMorningBriefDefaultTime } from "./captainMorningBrief";

describe("captainMorningBriefDefaultTime", () => {
  it("keeps Duets at the standard default and starts a Chorus after them", () => {
    expect(captainMorningBriefDefaultTime({ kind: "duet" })).toBe("08:00");
    expect(captainMorningBriefDefaultTime({ kind: "chorus" })).toBe("08:15");
  });
});
