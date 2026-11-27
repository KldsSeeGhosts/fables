import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  captainShells,
  captainShellsByConversation,
  createCaptainDirectoryShellsAtom,
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

it("only notifies the Duet directory when a conversation or its crew changes", () => {
  const captain = shell(home, "captain:maria:1");
  const earlier = shell(home, "captain:maria:0");
  const crew = shell(home, "crew-before-reset", "captain:maria:0");
  const ordinary = shell(home, "plain-thread");
  const unrelatedCrew = shell(home, "plain-crew", "plain-thread");
  const source = Atom.make<ReadonlyArray<EnvironmentThreadShell>>([
    captain,
    ordinary,
    earlier,
    crew,
    unrelatedCrew,
  ]);
  const registry = AtomRegistry.make();
  const directory = createCaptainDirectoryShellsAtom(source);
  const updates: Array<ReadonlyArray<EnvironmentThreadShell>> = [];
  const unsubscribe = registry.subscribe(directory, (shells) => updates.push(shells), {
    immediate: true,
  });
  try {
    expect(updates).toEqual([[captain, earlier, crew]]);
    for (let delta = 0; delta < 100; delta++) {
      registry.set(source, [captain, { ...ordinary }, earlier, crew, { ...unrelatedCrew }]);
    }
    expect(updates).toHaveLength(1);

    const waitingCrew = { ...crew, hasPendingUserInput: true };
    registry.set(source, [captain, earlier, waitingCrew]);
    registry.set(source, [captain, earlier]);
    expect(updates).toEqual([
      [captain, earlier, crew],
      [captain, earlier, waitingCrew],
      [captain, earlier],
    ]);
  } finally {
    unsubscribe();
    registry.dispose();
  }
});

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
