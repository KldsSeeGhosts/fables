import {
  CaptainId,
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
  TurnItemId,
  type Captain,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";

const subscriptionCalls = vi.hoisted(() => ({ refsLengths: [] as number[] }));

vi.mock(import("../../state/threads"), async (importOriginal) => {
  const Option = await import("effect/Option");
  const DateTimeModule = await import("effect/DateTime");
  const now = DateTimeModule.makeUnsafe("2026-11-24T00:00:00.000Z");
  const threadId = ThreadId.make("captain:maria:0");
  const userItem = {
    id: TurnItemId.make("earlier-user-item"),
    threadId,
    runId: RunId.make("earlier-run"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "user_message",
    messageId: MessageId.make("earlier-user-message"),
    inputIntent: "turn_start",
    text: "Earlier captain prompt",
    attachments: [],
    createdBy: "user",
    creationSource: "web",
  } satisfies OrchestrationV2TurnItem;
  const projection = {
    visibleTurnItems: [
      {
        position: 0,
        visibility: "local",
        sourceThreadId: threadId,
        sourceItemId: userItem.id,
        item: userItem,
      },
    ],
    attempts: [],
    nodes: [],
    plans: [],
  } as unknown as OrchestrationV2ThreadProjection;
  return {
    ...(await importOriginal()),
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
    if (entry.kind === "message") return [entry.message.text];
    if (entry.kind === "conversation-divider") {
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
  subscriptionCalls.refsLengths.length = 0;
  await using screen = await render(<Probe />);

  expect(screen.getByRole("button", { name: "Show earlier conversation" })).toBeDefined();
  expect((screen.getByRole("status").element() as HTMLOutputElement).value).toBe("");
  expect(subscriptionCalls.refsLengths.some((length) => length > 0)).toBe(false);

  await userEvent.click(screen.getByRole("button", { name: "Show earlier conversation" }));

  await vi.waitFor(() => {
    const value = (screen.getByRole("status").element() as HTMLOutputElement).value;
    expect(value).toContain("Earlier captain prompt");
    expect(value).toContain("divider:Earlier conversation:context full");
  });
  expect(subscriptionCalls.refsLengths).toContain(1);
});
