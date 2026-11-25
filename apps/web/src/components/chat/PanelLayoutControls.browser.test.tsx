import "~/index.css";

import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { render } from "../../../test/render";
import type { LayoutState, LayoutTab } from "../../layout/layoutModel";
import { LayoutPaneContext, type LayoutPaneState } from "../../layout/layoutPaneContext";
import { useLayoutStore } from "../../layout/layoutStore";
import { ChatPaneHeader, ChatPaneHeaderControls } from "./ChatPaneHeader";

const closeLayoutTabByUser = vi.hoisted(() => vi.fn());

vi.mock(import("../../layout/layoutActions"), () => ({
  closeLayoutTabByUser,
}));

vi.mock(import("../../hooks/useDuetShell"), () => ({
  useDuetShell: () => true,
}));

import { PanelLayoutControls } from "./PanelLayoutControls";

const duetRef = {
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make("captain:duet:0"),
};
const duetTab: LayoutTab = {
  id: "duet-tab",
  content: { kind: "chat", target: { kind: "server", threadRef: duetRef } },
};

function layoutWith(neighbor: LayoutTab): LayoutState {
  const pane = (id: string, tab: LayoutTab) => ({ id, tabs: [tab], activeTabId: tab.id, size: 1 });
  return {
    focusedWorkspaceId: "workspace",
    workspaces: [
      {
        id: "workspace",
        name: null,
        focusedPaneId: "duet-pane",
        cameraWidth: null,
        columns: [
          { id: "left", width: 0.5, panes: [pane("neighbor-pane", neighbor)] },
          { id: "right", width: 0.5, panes: [pane("duet-pane", duetTab)] },
        ],
      },
    ],
  };
}

function withLayout(layout: LayoutState): Disposable {
  const previous = useLayoutStore.getState().layout;
  useLayoutStore.setState({ layout });
  return { [Symbol.dispose]: () => useLayoutStore.setState({ layout: previous }) };
}

function paneState(input: Partial<LayoutPaneState> = {}): LayoutPaneState {
  return {
    tabId: null,
    paneId: null,
    split: false,
    narrow: false,
    leadingEdge: true,
    trailingEdge: true,
    focused: true,
    related: false,
    visible: true,
    ...input,
  };
}

function controls(props: {
  threadPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  onToggleThreadPanel?: () => void;
  onToggleRightPanel?: () => void;
}) {
  return (
    <PanelLayoutControls
      threadPanelOpen={props.threadPanelOpen ?? false}
      threadPanelPresentation="inline"
      threadPanelShortcutLabel={null}
      onToggleThreadPanel={props.onToggleThreadPanel ?? (() => {})}
      rightPanel={{
        open: props.rightPanelOpen ?? false,
        shortcutLabel: null,
        onToggle: props.onToggleRightPanel ?? (() => {}),
      }}
    />
  );
}

function headerControls(
  input: { split?: boolean; tabId?: string | null } & Parameters<typeof controls>[0],
) {
  const tabId = input.tabId ?? null;
  return (
    <LayoutPaneContext
      value={paneState({
        split: input.split ?? false,
        tabId,
        paneId: tabId === null ? null : "pane",
      })}
    >
      <div style={{ width: "100%" }}>
        <ChatPaneHeader reserveNativeControlsInset={false}>
          <ChatPaneHeaderControls>{controls(input)}</ChatPaneHeaderControls>
          <div className="min-w-0 flex-1 truncate px-4">
            very-long-machine-name-for-a-remote-mac-studio /
            very-long-project-name-that-used-to-widen-the-thread-details-pill
          </div>
        </ChatPaneHeader>
      </div>
    </LayoutPaneContext>
  );
}

function duetTheme(): Disposable {
  const previous = document.documentElement.getAttribute("data-theme-id");
  document.documentElement.setAttribute("data-theme-id", "ksg-salon");
  return {
    [Symbol.dispose]: () => {
      if (previous === null) document.documentElement.removeAttribute("data-theme-id");
      else document.documentElement.setAttribute("data-theme-id", previous);
    },
  };
}

async function narrowViewport(width: number): Promise<AsyncDisposable> {
  const previous = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 700);
  return {
    [Symbol.asyncDispose]: () => page.viewport(previous.width, previous.height),
  };
}

it("keeps long environment and project names out of the compact controls inside a narrow viewport", async () => {
  using _theme = duetTheme();
  await using _viewport = await narrowViewport(390);
  const onToggleRightPanel = vi.fn();
  await using screen = await render(headerControls({ onToggleRightPanel }));

  const cluster = screen.container.querySelector<HTMLElement>("[data-panel-layout-controls]")!;
  expect(cluster.textContent).toBe("");
  const buttons = Array.from(cluster.querySelectorAll("button"));
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Toggle thread details panel",
    "Toggle right panel",
  ]);
  for (const button of buttons) {
    const rect = button.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
  }

  await userEvent.click(screen.getByRole("button", { name: "Toggle right panel" }));
  expect(onToggleRightPanel).toHaveBeenCalledOnce();
});

it("closes a split Duet pane from the last header icon", async () => {
  using _theme = duetTheme();
  using _layout = withLayout(
    layoutWith({
      id: "other-chat",
      content: {
        kind: "chat",
        target: {
          kind: "server",
          threadRef: { environmentId: duetRef.environmentId, threadId: ThreadId.make("thread") },
        },
      },
    }),
  );
  closeLayoutTabByUser.mockClear();
  await using screen = await render(headerControls({ split: true, tabId: "duet-tab" }));

  const cluster = screen.container.querySelector<HTMLElement>("[data-panel-layout-controls]")!;
  expect(
    Array.from(cluster.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label"),
    ),
  ).toEqual(["Toggle thread details panel", "Toggle right panel", "Close"]);

  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(closeLayoutTabByUser).toHaveBeenCalledWith("duet-tab");
});

it("shows no close icon for a single-pane Duet", async () => {
  using _theme = duetTheme();
  await using screen = await render(headerControls({ tabId: "tab" }));

  expect(screen.container.querySelector('button[aria-label="Close"]')).toBeNull();
});

it("shows no close icon when the only other tab in the Duet's pane is its own Tasks panel", async () => {
  using _theme = duetTheme();
  const tasksTab: LayoutTab = {
    id: "tasks",
    content: { kind: "surface", threadRef: duetRef, surfaceId: "duet-tasks" },
  };
  using _layout = withLayout({
    focusedWorkspaceId: "workspace",
    workspaces: [
      {
        id: "workspace",
        name: null,
        focusedPaneId: "duet-pane",
        cameraWidth: null,
        columns: [
          {
            id: "only",
            width: 1,
            panes: [
              { id: "duet-pane", tabs: [duetTab, tasksTab], activeTabId: "duet-tab", size: 1 },
            ],
          },
        ],
      },
    ],
  });
  await using screen = await render(headerControls({ split: true, tabId: "duet-tab" }));

  expect(screen.container.querySelector('button[aria-label="Close"]')).toBeNull();
});

it("shows no close icon when the only other pane is the Duet's own Tasks panel", async () => {
  using _theme = duetTheme();
  using _layout = withLayout(
    layoutWith({
      id: "tasks",
      content: { kind: "surface", threadRef: duetRef, surfaceId: "duet-tasks" },
    }),
  );
  await using screen = await render(headerControls({ split: true, tabId: "duet-tab" }));

  expect(screen.container.querySelector('button[aria-label="Close"]')).toBeNull();
});
