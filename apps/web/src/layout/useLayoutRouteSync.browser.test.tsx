import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  findLayoutTabByContent,
  openLayoutGhostChat,
  selectFocusedTab,
  showLayoutContent,
  type LayoutState,
  type LayoutTabContent,
} from "./layoutModel";
import { saveLayoutNow, useLayoutStore } from "./layoutStore";
import { useLayoutRouteSync } from "./useLayoutRouteSync";

vi.mock(import("../hooks/useDuetShell"), () => ({ useDuetShell: () => true }));

const storageKey = "t3code:layout-state:v2";
const environmentId = EnvironmentId.make("local");
const target = (id: string) =>
  ({
    kind: "server",
    threadRef: scopeThreadRef(environmentId, ThreadId.make(id)),
  }) as const;
const chat = (id: string) => ({ kind: "chat", target: target(id) }) as const;
const duet = chat("captain:ye:0");
const unrelated = chat("publisher");
const kept = chat("kept");

function setup() {
  const store = useLayoutStore.getState();
  saveLayoutNow();
  const saved = localStorage.getItem(storageKey);
  store.reset();
  return {
    [Symbol.dispose]() {
      useLayoutStore.setState({ layout: store.layout });
      saveLayoutNow();
      if (saved === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, saved);
    },
  };
}

function RoutedPane({ thread }: { thread: ThreadRouteTarget | null }) {
  const focused = selectFocusedTab(useLayoutRouteSync(thread))?.content;
  return (
    <output>
      {focused?.kind === "chat" && focused.target.kind === "server"
        ? focused.target.threadRef.threadId
        : null}
    </output>
  );
}

const layout = () => useLayoutStore.getState().layout;
const tab = (content: LayoutTabContent, state: LayoutState = layout()) =>
  findLayoutTabByContent(state, content);

it("drops the temporary tab when an unrelated sidebar thread opened from a Duet task returns to the Duet", async () => {
  using _store = setup();
  useLayoutStore.getState().openTab(duet);
  const task = chat("duet-task");
  useLayoutStore.setState({
    layout: openLayoutGhostChat(layout(), duet.target.threadRef, task.target)!,
  });
  await using screen = await render(<RoutedPane thread={task.target} />);
  await expect.element(screen.getByText("duet-task")).toBeVisible();

  await screen.rerender(<RoutedPane thread={unrelated.target} />);
  await expect.element(screen.getByText("publisher")).toBeVisible();

  await act(() => useLayoutStore.getState().focusChat(duet.target));
  await screen.rerender(<RoutedPane thread={duet.target} />);
  await expect.element(screen.getByText("captain:ye:0")).toBeVisible();
  expect(tab(unrelated)).toBeNull();

  await screen.rerender(<RoutedPane thread={unrelated.target} />);
  await expect.element(screen.getByText("publisher")).toBeVisible();
  expect(tab(duet)?.pane.id).toBe(tab(unrelated)?.pane.id);
  expect(tab(duet)).not.toBeNull();
});

it("repairs a saved Duet pane on load and keeps intentional tabs and visible previews", async () => {
  using _store = setup();
  const store = useLayoutStore.getState();
  store.openTab(duet);
  store.openKeptTab(kept);
  const withPreview = showLayoutContent(layout(), unrelated);
  useLayoutStore.setState({ layout: withPreview });
  store.focusChat(duet.target);
  const visible = chat("visible");
  store.openTab(chat("other"), { placement: "new-column" });
  useLayoutStore.setState({ layout: showLayoutContent(layout(), visible) });
  store.focusChat(duet.target);
  saveLayoutNow();
  await useLayoutStore.persist.rehydrate();

  await using screen = await render(<RoutedPane thread={duet.target} />);
  await expect.element(screen.getByText("captain:ye:0")).toBeVisible();
  expect(tab(unrelated)).toBeNull();
  expect(tab(kept)?.pane.id).toBe(tab(duet)?.pane.id);
  expect(tab(visible)?.pane.activeTabId).toBe(tab(visible)?.tab.id);
  saveLayoutNow();
  expect(localStorage.getItem(storageKey)).not.toContain("publisher");
});
