import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { Captain, captainEarlierConversations } from "./captain.ts";

const decodeCaptain = Schema.decodeUnknownSync(Captain);

const olderServerCaptain = {
  id: "maria",
  name: "Maria",
  role: "Coordinator",
  instructions: "",
  avatar: { preset: "compass", color: "violet" },
  scopedProjectIds: [],
  reportPolicy: "react",
  primaryThreadId: "captain:maria:0",
  earlierThreadIds: [],
  createdAt: "2026-11-24T12:00:00.000Z",
  updatedAt: "2026-11-24T12:00:00.000Z",
  archivedAt: null,
};

describe("Captain", () => {
  it("decodes a Captain from a server without the coordinator setting as not coordinating", () => {
    expect(decodeCaptain(olderServerCaptain).coordinatorOnly).toBe(false);
    expect(decodeCaptain({ ...olderServerCaptain, coordinatorOnly: true }).coordinatorOnly).toBe(
      true,
    );
  });

  it("decodes Captains without end reasons and derives manual endings", () => {
    const decoded = decodeCaptain({
      ...olderServerCaptain,
      earlierThreadIds: ["captain:maria:0"],
      primaryThreadId: "captain:maria:1",
    });
    expect(decoded.earlierThreadEndReasons).toEqual([]);
    expect(captainEarlierConversations(decoded)).toEqual([
      { threadId: "captain:maria:0", endReason: "manual" },
    ]);
  });

  it("keeps end reasons aligned with earlier conversations", () => {
    const decoded = decodeCaptain({
      ...olderServerCaptain,
      earlierThreadIds: ["captain:maria:0", "captain:maria:1"],
      earlierThreadEndReasons: ["context_overflow", "threshold"],
      primaryThreadId: "captain:maria:2",
    });
    expect(captainEarlierConversations(decoded)).toEqual([
      { threadId: "captain:maria:0", endReason: "context_overflow" },
      { threadId: "captain:maria:1", endReason: "threshold" },
    ]);
  });
});
