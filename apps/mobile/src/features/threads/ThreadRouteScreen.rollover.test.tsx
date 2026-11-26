import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { useCaptainThreadRouteRollover } from "../captains/useCaptainEarlierConversations";
import { moveThreadComposerDraft } from "../../state/use-composer-drafts";

vi.mock(import("../../state/use-composer-drafts"), () => ({
  moveThreadComposerDraft: vi.fn(async () => {}),
}));
vi.mock(import("../../state/threads"), () => ({
  useEnvironmentThread: vi.fn(),
  useEnvironmentThreadRetry: vi.fn(),
}));

const environmentId = EnvironmentId.make("environment");
const old = ThreadId.make("captain:maria:0");
const current = ThreadId.make("captain:maria:1");

function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(moveThreadComposerDraft).mockClear();
  const root = createRoot(document.createElement("div"));
  const setParams = vi.fn();
  function Route({ threadId, primary }: { threadId: ThreadId; primary: ThreadId }) {
    const route = useCaptainThreadRouteRollover({
      thread: { environmentId, threadId },
      isPrimary: threadId === primary,
      replacement: threadId === primary ? undefined : primary,
      focused: true,
      follow: (next) => setParams({ threadId: next.threadId }),
    });
    return <output>{route.followedFrom}</output>;
  }
  const render = (threadId: ThreadId, primary: ThreadId) =>
    act(() => root.render(<Route threadId={threadId} primary={primary} />));
  return { render, setParams, [Symbol.dispose]: () => act(() => root.unmount()) };
}

it("keeps an explicit older-conversation route on that thread", () => {
  using route = setup();
  route.render(old, current);
  expect(route.setParams).not.toHaveBeenCalled();
  expect(moveThreadComposerDraft).not.toHaveBeenCalled();
});

it("follows the primary that changes live and transfers its draft", () => {
  using route = setup();
  route.render(old, old);
  route.render(old, current);
  expect(route.setParams).toHaveBeenCalledExactlyOnceWith({ threadId: current });
  expect(moveThreadComposerDraft).toHaveBeenCalledExactlyOnceWith(
    `${environmentId}:${old}`,
    `${environmentId}:${current}`,
  );

  route.render(current, current);
  route.render(old, current);
  expect(route.setParams).toHaveBeenCalledTimes(1);
});
