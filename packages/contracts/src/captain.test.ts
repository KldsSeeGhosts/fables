import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { Captain } from "./captain.ts";

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
});
