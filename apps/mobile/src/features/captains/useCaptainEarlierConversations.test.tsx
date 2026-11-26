import { expect, it, vi } from "vite-plus/test";
import { CaptainId, EnvironmentId, ThreadId, type Captain } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act } from "react";
import { createRoot } from "react-dom/client";

const subscriptionCalls = vi.hoisted(() => ({ refsLengths: [] as number[] }));

vi.mock(import("../../state/threads"), async () => {
  const Option = await import("effect/Option");
  const fixture =
    await import("../../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures");
  const row = fixture.v2MessageRow("Earlier captain prompt", 0);
  const projection = {
    ...fixture.v2Projection,
    visibleTurnItems: [row],
  };
  return {
    useEnvironmentThreads: (refs: ReadonlyArray<unknown>) => {
      subscriptionCalls.refsLengths.push(refs.length);
      return refs.map(
        () =>
          ({
            data: Option.some(projection),
            status: "live" as const,
            error: Option.none(),
            history: { hasMoreHistory: false, loading: false, error: null },
            sequence: 1,
          }) as never,
      );
    },
  };
});

import { useCaptainEarlierConversations } from "./useCaptainEarlierConversations";

const environmentId = EnvironmentId.make("environment");
const captain = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:1"),
  earlierThreadIds: [ThreadId.make("captain:maria:0")],
  earlierThreadEndReasons: ["context_overflow"],
  name: "Maria",
  role: "Coordinator",
  instructions: "",
  avatar: { preset: "compass", color: "violet" },
  scopedProjectIds: [],
  reportPolicy: "context",
  coordinatorOnly: false,
  createdAt: DateTime.formatIso(DateTime.makeUnsafe("2026-11-24")),
  updatedAt: DateTime.formatIso(DateTime.makeUnsafe("2026-11-24")),
  archivedAt: null,
} satisfies Captain;
const threadRef = { environmentId, threadId: captain.primaryThreadId };

function Probe() {
  const earlier = useCaptainEarlierConversations({ threadRef, captain });
  const visible = earlier.entries.flatMap((entry) => {
    if (entry.type === "message") return [entry.message.text];
    if (entry.type === "conversation-divider") {
      return [`divider:${entry.label}:${entry.detail ?? "manual"}`];
    }
    return [];
  });
  return (
    <div>
      <button type="button" onClick={earlier.expand}>
        Show earlier conversation
      </button>
      <output>{visible.join("\n")}</output>
    </div>
  );
}

it("loads an earlier Duet conversation only when requested and marks why it ended", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  subscriptionCalls.refsLengths.length = 0;
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<Probe />));
    const output = () => container.querySelector("output")?.textContent ?? "";
    expect(output()).toBe("");
    expect(subscriptionCalls.refsLengths.some((length) => length > 0)).toBe(false);

    act(() => {
      container.querySelector("button")?.click();
    });

    expect(output()).toContain("Earlier captain prompt");
    expect(output()).toContain("divider:Earlier conversation:context full");
    expect(subscriptionCalls.refsLengths).toContain(1);
  } finally {
    act(() => root.unmount());
  }
});
