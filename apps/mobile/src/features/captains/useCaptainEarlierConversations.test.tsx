import { expect, it, vi } from "vite-plus/test";
import {
  CaptainId,
  EnvironmentId,
  ThreadId,
  type Captain,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act } from "react";
import { createRoot } from "react-dom/client";

const subscriptionCalls = vi.hoisted(() => ({
  ids: [] as ThreadId[],
  failed: false,
  retry: vi.fn(),
}));

vi.mock(import("../../state/threads"), async () => {
  const Option = await import("effect/Option");
  const fixture =
    await import("../../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures");
  const row = fixture.v2MessageRow("Earlier captain prompt", 0);
  const projection = {
    ...fixture.v2Projection,
    visibleTurnItems: [row] as ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  };
  return {
    useEnvironmentThread: (_environment: EnvironmentId | null, id: ThreadId | null) => {
      if (id !== null) subscriptionCalls.ids.push(id);
      return {
        data: id === null || subscriptionCalls.failed ? Option.none() : Option.some(projection),
        status: id === null ? "empty" : subscriptionCalls.failed ? "synchronizing" : "live",
        error: subscriptionCalls.failed ? Option.some("Failed") : Option.none(),
        history: {
          hasMoreHistory: false,
          loading: false,
          error: null,
          historyCursor: null,
          expanded: false,
          latestLocalTurnOrdinal: null,
        },
        sequence: 1,
      } as ReturnType<typeof import("../../state/threads").useEnvironmentThread>;
    },
    useEnvironmentThreadRetry: () => subscriptionCalls.retry,
  };
});

vi.mock(import("../../state/use-composer-drafts"), () => ({
  moveThreadComposerDraft: vi.fn(async () => {}),
}));

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

function Probe({ followedFrom }: { followedFrom?: ThreadId | undefined } = {}) {
  const earlier = useCaptainEarlierConversations({ threadRef, captain, followedFrom });
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
      {earlier.failed ? (
        <button type="button" onClick={earlier.retry}>
          Retry
        </button>
      ) : null}
      <output>{visible.join("\n")}</output>
    </div>
  );
}

it("loads an earlier Duet conversation only when requested and marks why it ended", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  subscriptionCalls.ids.length = 0;
  subscriptionCalls.failed = false;
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<Probe />));
    const output = () => container.querySelector("output")?.textContent ?? "";
    expect(output()).toBe("");
    expect(subscriptionCalls.ids).toEqual([]);

    act(() => {
      container.querySelector("button")?.click();
    });

    expect(output()).toContain("Earlier captain prompt");
    expect(output()).toContain("divider:Earlier conversation:context full");
    expect(subscriptionCalls.ids).toContain(captain.earlierThreadIds[0]);
  } finally {
    act(() => root.unmount());
  }
});

it("keeps the just-ended Duet expanded and retries a failed history load", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  subscriptionCalls.failed = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() => root.render(<Probe followedFrom={captain.earlierThreadIds[0]} />));
    expect(container.querySelector("output")?.textContent).toBe("");
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    act(() => retry?.click());
    expect(subscriptionCalls.retry).toHaveBeenCalledOnce();

    subscriptionCalls.failed = false;
    act(() => root.render(<Probe followedFrom={captain.earlierThreadIds[0]} />));
    expect(container.querySelector("output")?.textContent).toContain("Earlier captain prompt");
  } finally {
    act(() => root.unmount());
  }
});
