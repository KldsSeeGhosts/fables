import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadToolCallVisibility } from "./toolCallVisibility.ts";

const captainThreadId = ThreadId.make("captain:example:0");
const ordinaryThreadId = ThreadId.make("thread-ordinary");

describe("resolveThreadToolCallVisibility", () => {
  it("uses the Duet setting for a Captain thread", () => {
    expect(
      resolveThreadToolCallVisibility({
        threadId: captainThreadId,
        toolCallVisibility: "showAll",
        duetToolCallVisibility: "zen",
      }),
    ).toBe("zen");
  });

  it("falls back to the main setting when the Duet setting inherits", () => {
    expect(
      resolveThreadToolCallVisibility({
        threadId: captainThreadId,
        toolCallVisibility: "hideSuccessful",
        duetToolCallVisibility: "inherit",
      }),
    ).toBe("hideSuccessful");
    expect(
      resolveThreadToolCallVisibility({
        threadId: captainThreadId,
        toolCallVisibility: "hideSuccessful",
      }),
    ).toBe("hideSuccessful");
  });

  it("always uses the main setting for a non-Captain thread", () => {
    expect(
      resolveThreadToolCallVisibility({
        threadId: ordinaryThreadId,
        toolCallVisibility: "showAll",
        duetToolCallVisibility: "zen",
      }),
    ).toBe("showAll");
  });
});
