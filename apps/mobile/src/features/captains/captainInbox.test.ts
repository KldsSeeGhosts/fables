import type { CaptainInboxItem } from "@t3tools/client-runtime/state/captains";
import { CaptainId, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { duetInboxGroups } from "./captainInbox";

const environmentId = EnvironmentId.make("home");
const item = (
  captain: string,
  kind: CaptainInboxItem["kind"],
  title: string,
  updatedAt: string,
): CaptainInboxItem => ({
  kind,
  environmentId,
  captainId: CaptainId.make(captain),
  threadRef: { environmentId, threadId: ThreadId.make(title) },
  title,
  isChild: false,
  updatedAt,
});

describe("duetInboxGroups", () => {
  it("keeps approvals and questions only, grouped by Duet, newest group first", () => {
    const groups = duetInboxGroups([
      item("comfy", "approval", "rm -rf", "2026-11-25T12:04:00.000Z"),
      item("ye", "subagent-request", "delegate", "2026-11-25T12:03:00.000Z"),
      item("ye", "approval", "push", "2026-11-25T12:02:00.000Z"),
      item("comfy", "input", "LoRA folder", "2026-11-25T12:01:00.000Z"),
    ]);
    expect(
      groups.map(({ captainId, items }) => [captainId, items.map(({ title }) => title)]),
    ).toEqual([
      ["comfy", ["rm -rf", "LoRA folder"]],
      ["ye", ["push"]],
    ]);
  });
});
