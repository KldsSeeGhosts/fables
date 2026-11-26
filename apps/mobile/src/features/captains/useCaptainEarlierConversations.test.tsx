import { expect, it, vi } from "vite-plus/test";
import {
  CaptainId,
  EnvironmentId,
  RunId,
  ThreadId,
  type Captain,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { deriveThreadFeedPresentation } from "../../lib/threadActivity";
import { ThreadFeedPlaceholder } from "../threads/ThreadFeedPlaceholder";

vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../components/ui/Button", () => ({
  Button: (props: { label: string; disabled: boolean; onPress: () => void }) => (
    <button type="button" disabled={props.disabled} onClick={props.onPress}>
      {props.label}
    </button>
  ),
}));

const subscriptionCalls = vi.hoisted(() => ({
  ids: [] as ThreadId[],
  failed: false,
  retry: vi.fn(),
}));

vi.mock(import("../../state/threads"), async () => {
  const Option = await import("effect/Option");
  const fixture =
    await import("../../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures");
  const prompt = fixture.v2MessageRow("Earlier captain prompt", 0);
  const reply = fixture.v2MessageRow("Earlier captain reply", 1);
  const runId = RunId.make("earlier-captain-run");
  if (reply.item.type !== "user_message") throw new Error("Expected a message fixture");
  const visibleTurnItems = [
    { ...prompt, item: { ...prompt.item, runId } },
    {
      ...reply,
      position: 1,
      item: { ...reply.item, runId, type: "assistant_message", streaming: false },
    },
  ] satisfies ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
  const projection = {
    ...fixture.v2Projection,
    visibleTurnItems,
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
  const visible = deriveThreadFeedPresentation(earlier.entries, null, new Set()).flatMap(
    (entry) => {
      if (entry.type === "message") return [entry.message.text];
      if (entry.type === "conversation-divider") {
        return [`divider:${entry.label}:${entry.detail ?? "manual"}`];
      }
      return [];
    },
  );
  return (
    <div>
      {visible.length === 0 ? (
        <ThreadFeedPlaceholder
          title="No conversation yet"
          detail="Ask the agent to inspect the repo."
          topInset={0}
          bottomInset={80}
          horizontalPadding={16}
          historyControls={{
            hasMoreHistory: earlier.unexpandedCount > 0 || earlier.failed,
            loading: earlier.loading,
            error: earlier.failed ? "Could not load earlier conversation." : null,
            label: earlier.failed ? "Retry" : "Show earlier conversation",
            onLoadEarlier: earlier.failed ? earlier.retry : earlier.expand,
            onLoadThrough: earlier.expand,
          }}
        />
      ) : null}
      <output>{visible.join("\n")}</output>
    </div>
  );
}

it("shows the history pill above an empty Duet's message and loads the earlier conversation on press", () => {
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

    const pill = container.querySelector("button");
    const emptyStateTitle = container.querySelector("span");
    expect(pill?.textContent).toBe("Show earlier conversation");
    expect(emptyStateTitle?.textContent).toBe("No conversation yet");
    expect(pill!.compareDocumentPosition(emptyStateTitle!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    act(() => pill!.click());

    expect(output()).toContain("Earlier captain prompt");
    expect(output()).toContain("Earlier captain reply");
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
