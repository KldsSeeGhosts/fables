import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  captainShells,
  captainShellsByConversation,
  withoutCaptainConversations,
} from "./captainShellIndex";

const home = EnvironmentId.make("home");
const work = EnvironmentId.make("work");

const shell = (
  environmentId: EnvironmentId,
  id: string,
  parent: string | null = null,
): EnvironmentThreadShell =>
  ({
    environmentId,
    id: ThreadId.make(id),
    lineage: {
      rootThreadId: ThreadId.make(parent ?? id),
      parentThreadId: parent === null ? null : ThreadId.make(parent),
      relationshipToParent: parent === null ? null : "subagent",
    },
  }) as EnvironmentThreadShell;

const maria = {
  primaryThreadId: ThreadId.make("captain:maria:1"),
  earlierThreadIds: [ThreadId.make("captain:maria:0")],
};

describe("captainShells", () => {
  it("returns a Captain's conversations and their crews in its own environment only", () => {
    const shells = [
      shell(home, "captain:maria:1"),
      shell(home, "crew-now", "captain:maria:1"),
      shell(home, "crew-before-reset", "captain:maria:0"),
      shell(home, "plain-thread"),
      shell(work, "crew-elsewhere", "captain:maria:1"),
    ];
    const own = captainShells(captainShellsByConversation(shells), home, maria);
    expect(own.map(({ id }) => id)).toEqual(["captain:maria:1", "crew-now", "crew-before-reset"]);
  });
});

describe("withoutCaptainConversations", () => {
  const threads = [shell(home, "captain:maria:1"), shell(home, "plain-thread")];

  it("drops Captain conversations from a thread list", () => {
    const keys = threadKey({ environmentId: home, threadId: maria.primaryThreadId });
    expect(withoutCaptainConversations(threads, keys).map(({ id }) => id)).toEqual([
      "plain-thread",
    ]);
  });

  it("returns the same array when there is nothing to drop", () => {
    expect(withoutCaptainConversations(threads, "")).toBe(threads);
    expect(
      withoutCaptainConversations(
        threads,
        threadKey({ environmentId: work, threadId: maria.primaryThreadId }),
      ),
    ).toBe(threads);
  });
});
