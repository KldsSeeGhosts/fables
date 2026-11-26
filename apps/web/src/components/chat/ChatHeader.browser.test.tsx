import "~/index.css";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const persisted = vi.hoisted(() => ({ title: "" }));
const openMenu = vi.hoisted(() => vi.fn());
const duetShell = vi.hoisted(() => ({ enabled: false }));
const captainState = vi.hoisted(() => ({ enabled: false }));
const workingThreads = vi.hoisted(() => new Set<string>());
const reasoningThreads = vi.hoisted(() => new Set<string>());
vi.mock(import("../../hooks/useDuetShell"), () => ({
  useDuetShell: () => duetShell.enabled,
}));
vi.mock(import("../captains/useCaptain"), async (importOriginal) => ({
  ...(await importOriginal()),
  useCaptain: ((ref: { threadId: string } | null) =>
    captainState.enabled && ref?.threadId.startsWith("captain:")
      ? {
          id: "maria",
          primaryThreadId: ref.threadId,
          earlierThreadIds: [],
          name: "Maria",
          role: "Coordinator",
          instructions: "",
          avatar: { preset: "compass", color: "violet" },
          scopedProjectIds: [],
          reportPolicy: "context",
          coordinatorOnly: false,
          createdAt: "2026-11-24T00:00:00.000Z",
          updatedAt: "2026-11-24T00:00:00.000Z",
          archivedAt: null,
        }
      : null) as never,
}));
vi.mock(import("../../state/entities"), async (importOriginal) => {
  const { makeStreamingWorkTimelineFixture, makeThreadProjectionFixture } =
    await import("../../test-fixtures");
  return {
    ...(await importOriginal()),
    useQuietThreadShell: ((ref: { threadId: string } | null) =>
      ref !== null && workingThreads.has(ref.threadId)
        ? {
            hasPendingApprovals: false,
            hasPendingUserInput: false,
            pendingSubagentRequest: null,
            pendingBackgroundTasks: [{ kind: "command" }],
            runtime: { status: "running" },
          }
        : null) as never,
    useQuietThreadProjection: ((ref: { threadId: string } | null) =>
      ref !== null && reasoningThreads.has(ref.threadId)
        ? {
            projection: {
              ...makeThreadProjectionFixture(),
              visibleTurnItems: makeStreamingWorkTimelineFixture("reasoning").visibleTurnItems,
            },
          }
        : null) as never,
  };
});
vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() =>
    async ({ input }: { input: { title: string } }) => {
      persisted.title = input.title;
      return { _tag: "Success" };
    }) as never,
}));
vi.mock(import("~/hooks/useThreadActionMenu"), () => ({
  useThreadActionMenu: () => ({ openMenu, closeMenu: () => {} }),
}));

import { act, fakeTimers, render, stubGlobal } from "../../../test/render";
import { showLayoutTabMenu } from "../../layout/PaneTabs";
import { LayoutPaneContext, useLayoutPane } from "../../layout/layoutPaneContext";
import {
  createLayoutState,
  findLayoutTab,
  selectFocusedChatTab,
  type LayoutState,
  type LayoutTab,
} from "../../layout/layoutModel";
import { useLayoutStore } from "../../layout/layoutStore";
import { ensureLocalApi } from "../../localApi";
import { ChatPaneHeader, ChatPaneHeaderControls, useHeaderControlsInset } from "./ChatPaneHeader";
import { ChatHeader } from "./ChatHeader";
import { PanelLayoutControls } from "./PanelLayoutControls";

function header(title: string) {
  return (
    <>
      <ChatHeader
        activeThreadEnvironmentId={EnvironmentId.make("environment")}
        activeThreadId={ThreadId.make("thread")}
        activeThreadTitle={title}
        isServerThread
        activeProject={null}
        parentThreadLink={null}
        onOpenThread={() => {}}
        rightPanelOpen={false}
      />
      <div tabIndex={0}>Outside rename</div>
    </>
  );
}

function duetHeader(threadId: string, title: string) {
  return (
    <div className="flex h-12 w-[900px]">
      <ChatHeader
        activeThreadEnvironmentId={EnvironmentId.make("environment")}
        activeThreadId={ThreadId.make(threadId)}
        activeThreadTitle={title}
        isServerThread
        activeProject={null}
        parentThreadLink={null}
        onOpenThread={() => {}}
        rightPanelOpen={false}
      />
    </div>
  );
}

it.each(["blur", "Enter"] as const)(
  "preserves a concurrent title update when an untouched rename ends with %s",
  async (finish) => {
    persisted.title = "New thread";
    await using screen = await render(header(persisted.title));
    await screen.getByRole("button", { name: "Thread actions for New thread" }).dblClick();
    const input = screen.getByRole("textbox", { name: "Thread title" });
    await expect.element(input).toHaveValue("New thread");

    persisted.title = "Fix login redirect";
    await screen.rerender(header(persisted.title));
    if (finish === "Enter") await userEvent.keyboard("{Enter}");
    else await screen.getByText("Outside rename").click();

    await expect.element(input).not.toBeInTheDocument();
    expect(persisted.title).toBe("Fix login redirect");

    await screen.rerender(header(persisted.title));
    await screen.getByRole("button", { name: "Thread actions for Fix login redirect" }).dblClick();
    await screen.getByRole("textbox", { name: "Thread title" }).fill("My edited title");
    persisted.title = "Another concurrent title";
    await screen.rerender(header(persisted.title));
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("textbox", { name: "Thread title" }))
      .not.toBeInTheDocument();
    expect(persisted.title).toBe("My edited title");
  },
);

it("preserves a concurrent title update when an untouched tab menu rename ends", async () => {
  persisted.title = "New thread";
  const content = { kind: "launcher", id: "rename-target", context: null } as const;
  useLayoutStore.getState().openTab(content, { placement: "active-pane", position: "end" });
  const tabId = findLayoutTab(useLayoutStore.getState().layout, (tab) => tab.content === content)!
    .tab.id;
  function TabHeader({ title }: { title: string }) {
    return (
      <LayoutPaneContext value={{ ...useLayoutPane(), tabId }}>{header(title)}</LayoutPaneContext>
    );
  }
  await using screen = await render(<TabHeader title={persisted.title} />);
  using _menu = vi.spyOn(ensureLocalApi().contextMenu, "show").mockResolvedValue("rename");
  await showLayoutTabMenu(tabId, { x: 0, y: 0 }, []);
  const input = screen.getByRole("textbox", { name: "Thread title" });
  await expect.element(input).toHaveValue("New thread");

  persisted.title = "Fix login redirect";
  await screen.rerender(<TabHeader title={persisted.title} />);
  await userEvent.keyboard("{Enter}");

  await expect.element(input).not.toBeInTheDocument();
  expect(persisted.title).toBe("Fix login redirect");
});

it("opens the thread menu on a desktop title click without waiting", async () => {
  openMenu.mockClear();
  using _bridge = stubGlobal("desktopBridge", {});
  await using screen = await render(header("New thread"));
  await screen.getByRole("button", { name: "Thread actions for New thread" }).click();
  expect(openMenu).toHaveBeenCalledOnce();
});

it("keeps the Escape that cancels a rename from also reaching window shortcuts", async () => {
  persisted.title = "New thread";
  await using screen = await render(header(persisted.title));
  await screen.getByRole("button", { name: "Thread actions for New thread" }).dblClick();
  const input = screen.getByRole("textbox", { name: "Thread title" });
  await input.fill("Unsaved title");

  // The thread find bar closes from a window keydown listener that skips handled events.
  const windowEscapes: boolean[] = [];
  const recordEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") windowEscapes.push(event.defaultPrevented);
  };
  window.addEventListener("keydown", recordEscape);
  using _listener = {
    [Symbol.dispose]: () => window.removeEventListener("keydown", recordEscape),
  };
  await userEvent.keyboard("{Escape}");

  await expect.element(input).not.toBeInTheDocument();
  expect(persisted.title).toBe("New thread");
  expect(windowEscapes).toEqual([true]);
});

it("uses the always-tabless Duet header and keeps the hidden terminal chip", async () => {
  duetShell.enabled = true;
  try {
    await using screen = await render(
      <ChatHeader
        activeThreadEnvironmentId={EnvironmentId.make("environment")}
        activeThreadId={ThreadId.make("thread")}
        activeThreadTitle="New thread"
        isServerThread
        activeProject={null}
        parentThreadLink={null}
        onOpenThread={() => {}}
        rightPanelOpen={false}
        hiddenTerminal={{ shortcutLabel: null, running: false, onShow: () => {} }}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: "Thread actions for New thread" }))
      .toBeVisible();
    expect(screen.container.querySelector("[data-pane-notch]")).toBeNull();
    expect(screen.container.querySelector("[data-hidden-terminal-chip]")).not.toBeNull();
    expect(screen.container.querySelector('[aria-label="Status: Idle"]')).toBeNull();
  } finally {
    duetShell.enabled = false;
  }
});

it("switches between a Duet and a sibling thread from the visible header", async () => {
  duetShell.enabled = true;
  captainState.enabled = true;
  const originalLayout = useLayoutStore.getState().layout;
  const environmentId = EnvironmentId.make("environment");
  const duetId = ThreadId.make("captain:maria:0");
  const ordinaryId = ThreadId.make("publisher");
  const open = (threadId: ThreadId) =>
    useLayoutStore.getState().openTab({
      kind: "chat",
      target: { kind: "server", threadRef: scopeThreadRef(environmentId, threadId) },
    });
  useLayoutStore.getState().reset();
  open(ordinaryId);
  open(duetId);

  function FocusedHeader() {
    const layout = useLayoutStore((state) => state.layout);
    const focused = selectFocusedChatTab(layout);
    const paneContext = useLayoutPane();
    const content = focused?.tab.content;
    if (!focused || content?.kind !== "chat" || content.target.kind !== "server") return null;
    return (
      <LayoutPaneContext value={{ ...paneContext, paneId: focused.pane.id, tabId: focused.tab.id }}>
        <ChatPaneHeader reserveNativeControlsInset={false}>
          <ChatHeader
            activeThreadEnvironmentId={environmentId}
            activeThreadId={content.target.threadRef.threadId}
            activeThreadTitle="Publisher"
            isServerThread
            activeProject={null}
            parentThreadLink={null}
            onOpenThread={() => {}}
            rightPanelOpen={false}
          />
        </ChatPaneHeader>
      </LayoutPaneContext>
    );
  }

  try {
    await using screen = await render(<FocusedHeader />);
    await screen.getByRole("button", { name: "New thread", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Thread actions for Publisher" }))
      .toBeVisible();
    await screen.getByRole("button", { name: "New thread", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "Duet menu for Maria" })).toBeVisible();
  } finally {
    useLayoutStore.setState({ layout: originalLayout });
    duetShell.enabled = false;
    captainState.enabled = false;
  }
});

it("keeps a Duet channel's title menu at the header start and centres only the animated orb", async () => {
  duetShell.enabled = true;
  captainState.enabled = true;
  openMenu.mockClear();
  try {
    await using screen = await render(
      <header
        data-chat-header
        className="relative flex h-12"
        style={{ width: 900, position: "relative" }}
      >
        <ChatHeader
          activeThreadEnvironmentId={EnvironmentId.make("environment")}
          activeThreadId={ThreadId.make("captain:maria:0")}
          activeThreadTitle="Maria"
          isServerThread
          activeProject={null}
          parentThreadLink={null}
          onOpenThread={() => {}}
          rightPanelOpen={false}
        />
      </header>,
    );

    expect(screen.container.querySelector('[aria-label="Thread actions for Maria"]')).toBeNull();
    expect(screen.container.querySelector("[data-pane-notch]")).toBeNull();
    expect(screen.container.querySelector("[data-captain-hero-live]")).toBeNull();

    const hero = screen.container.querySelector<HTMLElement>("[data-captain-header-hero]")!;
    expect(getComputedStyle(hero).display).toBe("flex");
    expect(getComputedStyle(hero).pointerEvents).toBe("none");
    expect(hero.querySelector("button, a, [role='button']")).toBeNull();
    const avatar = hero.querySelector("[data-captain-avatar]")!;
    expect(avatar.getAttribute("data-duet-palette")).toBe("plum");
    expect(avatar.hasAttribute("data-captain-disc")).toBe(true);
    const headerBox = screen.container.querySelector("header")!.getBoundingClientRect();
    const heroBox = hero.getBoundingClientRect();
    expect(
      Math.abs(heroBox.left + heroBox.width / 2 - (headerBox.left + headerBox.width / 2)),
    ).toBeLessThan(1);

    const menuButton = screen.getByRole("button", { name: "Duet menu for Maria" });
    await expect.element(menuButton).toBeVisible();
    const menuBox = menuButton.element().getBoundingClientRect();
    expect(menuBox.left - headerBox.left).toBeLessThan(40);
    expect(hero.contains(menuButton.element())).toBe(false);

    await userEvent.click(menuButton);
    await vi.waitFor(() => {
      const items = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).map((element) => element.textContent);
      expect(items).toEqual(
        expect.arrayContaining([
          "Customize Duet",
          "Rename",
          "Memory",
          "Change icon",
          "New conversation",
          "Archive",
        ]),
      );
    });
    await userEvent.keyboard("{Escape}");

    await vi.waitFor(() => {
      expect(hero.querySelector('[aria-live="polite"]')?.textContent).toBe("Idle");
    });
    expect(openMenu).not.toHaveBeenCalled();
  } finally {
    duetShell.enabled = false;
    captainState.enabled = false;
  }
});

it("truncates a split Duet title before the compact controls", async () => {
  duetShell.enabled = true;
  captainState.enabled = false;
  const longTitle =
    "A very long split pane thread title that must truncate before the compact header controls";
  function SplitHeader() {
    const [controlsInset, measureControls] = useHeaderControlsInset();
    return (
      <LayoutPaneContext value={{ ...useLayoutPane(), split: true, tabId: "duet-tab" }}>
        <div style={{ width: 360 }}>
          <ChatPaneHeader reserveNativeControlsInset={false}>
            <ChatPaneHeaderControls measureRef={measureControls}>
              <PanelLayoutControls
                threadPanelOpen={false}
                threadPanelPresentation="inline"
                threadPanelShortcutLabel={null}
                onToggleThreadPanel={() => {}}
                rightPanel={{ open: false, shortcutLabel: null, onToggle: () => {} }}
              />
            </ChatPaneHeaderControls>
            <ChatHeader
              activeThreadEnvironmentId={EnvironmentId.make("environment")}
              activeThreadId={ThreadId.make("thread")}
              activeThreadTitle={longTitle}
              isServerThread
              activeProject={null}
              parentThreadLink={null}
              onOpenThread={() => {}}
              rightPanelOpen={false}
              trailingInset={controlsInset}
            />
          </ChatPaneHeader>
        </div>
      </LayoutPaneContext>
    );
  }
  try {
    await using screen = await render(<SplitHeader />);
    await vi.waitFor(() => {
      const cluster = screen.container.querySelector<HTMLElement>("[data-panel-layout-controls]")!;
      const title = screen.container.querySelector<HTMLElement>("[data-duet-header-title]")!;
      expect(cluster).not.toBeNull();
      expect(title).not.toBeNull();
      expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(
        cluster.getBoundingClientRect().left,
      );
    });
  } finally {
    duetShell.enabled = false;
  }
});

it("includes layout tab actions in a split Duet title menu", async () => {
  duetShell.enabled = true;
  captainState.enabled = true;
  const originalLayout = useLayoutStore.getState().layout;
  useLayoutStore.setState({ layout: createLayoutState() });
  const environmentId = EnvironmentId.make("environment");
  const threadRef = scopeThreadRef(environmentId, ThreadId.make("captain:maria:0"));
  const content = { kind: "chat", target: { kind: "server", threadRef } } as const;
  const neighborRef = scopeThreadRef(environmentId, ThreadId.make("thread:neighbor"));
  useLayoutStore
    .getState()
    .openTab(
      { kind: "chat", target: { kind: "server", threadRef: neighborRef } },
      { placement: "active-pane", position: "end" },
    );
  useLayoutStore.getState().openTab(content, { placement: "active-pane", position: "end" });
  const tabId = findLayoutTab(useLayoutStore.getState().layout, (tab) => tab.content === content)!
    .tab.id;
  function SplitDuetHeader() {
    return (
      <LayoutPaneContext value={{ ...useLayoutPane(), split: true, tabId }}>
        <ChatHeader
          activeThreadEnvironmentId={environmentId}
          activeThreadId={threadRef.threadId}
          activeThreadTitle="Maria"
          isServerThread
          activeProject={null}
          parentThreadLink={null}
          onOpenThread={() => {}}
          rightPanelOpen={false}
        />
      </LayoutPaneContext>
    );
  }
  try {
    await using screen = await render(<SplitDuetHeader />);
    await userEvent.click(screen.getByRole("button", { name: "Duet menu for Maria" }));

    await vi.waitFor(() => {
      const items = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).map((element) => element.textContent);
      for (const label of ["Split right", "Split down", "Close"]) {
        expect(items.some((item) => item?.startsWith(label))).toBe(true);
      }
    });
    await userEvent.keyboard("{Escape}");
  } finally {
    useLayoutStore.setState({ layout: originalLayout });
    duetShell.enabled = false;
    captainState.enabled = false;
  }
});

it("leaves Close out of the title menu when the Duet's only neighbor is its own Tasks panel", async () => {
  duetShell.enabled = true;
  captainState.enabled = true;
  const originalLayout = useLayoutStore.getState().layout;
  const environmentId = EnvironmentId.make("environment");
  const threadRef = scopeThreadRef(environmentId, ThreadId.make("captain:maria:0"));
  const pane = (id: string, tab: LayoutTab) => ({ id, tabs: [tab], activeTabId: tab.id, size: 1 });
  const layout: LayoutState = {
    focusedWorkspaceId: "workspace",
    workspaces: [
      {
        id: "workspace",
        name: null,
        focusedPaneId: "duet-pane",
        cameraWidth: null,
        columns: [
          {
            id: "left",
            width: 0.5,
            panes: [
              pane("duet-pane", {
                id: "duet-tab",
                content: { kind: "chat", target: { kind: "server", threadRef } },
              }),
            ],
          },
          {
            id: "right",
            width: 0.5,
            panes: [
              pane("tasks-pane", {
                id: "tasks-tab",
                content: { kind: "surface", threadRef, surfaceId: "duet-tasks" },
              }),
            ],
          },
        ],
      },
    ],
  };
  useLayoutStore.setState({ layout });
  function DuetBesideTasksHeader() {
    return (
      <LayoutPaneContext value={{ ...useLayoutPane(), split: true, tabId: "duet-tab" }}>
        <ChatHeader
          activeThreadEnvironmentId={environmentId}
          activeThreadId={threadRef.threadId}
          activeThreadTitle="Maria"
          isServerThread
          activeProject={null}
          parentThreadLink={null}
          onOpenThread={() => {}}
          rightPanelOpen={false}
        />
      </LayoutPaneContext>
    );
  }
  try {
    await using screen = await render(<DuetBesideTasksHeader />);
    await userEvent.click(screen.getByRole("button", { name: "Duet menu for Maria" }));

    await vi.waitFor(() => {
      const items = Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).map((element) => element.textContent ?? "");
      expect(items.some((item) => item.startsWith("Split right"))).toBe(true);
      expect(items.some((item) => item.startsWith("Close"))).toBe(false);
    });
    await userEvent.keyboard("{Escape}");
  } finally {
    useLayoutStore.setState({ layout: originalLayout });
    duetShell.enabled = false;
    captainState.enabled = false;
  }
});

it("cross-fades the outgoing and current live status pills at their own widths", async () => {
  duetShell.enabled = true;
  captainState.enabled = true;
  workingThreads.clear();
  workingThreads.add("captain:maria:0");
  reasoningThreads.clear();
  try {
    using _timers = fakeTimers();
    vi.setSystemTime(0);
    await using screen = await render(duetHeader("captain:maria:0", "Maria"));
    const hero = screen.container.querySelector<HTMLElement>("[data-captain-header-hero]")!;
    const pill = (layer: "current" | "outgoing") =>
      hero.querySelector<HTMLElement>(`[data-captain-hero-live-label="${layer}"]`);

    expect(pill("outgoing")).toBeNull();
    expect(pill("current")?.textContent).toBe("Running a command");
    expect(hero.querySelector(".working-status-shine")).toBeNull();

    reasoningThreads.add("captain:maria:0");
    vi.setSystemTime(1_000);
    await screen.rerender(duetHeader("captain:maria:0", "Maria"));

    const outgoing = pill("outgoing");
    const current = pill("current");
    expect(hero.querySelectorAll("[data-captain-hero-live]")).toHaveLength(2);
    expect(outgoing?.textContent).toBe("Running a command");
    expect(current?.textContent).toBe("Thinking");
    expect(outgoing?.getBoundingClientRect().width).toBeGreaterThan(
      current?.getBoundingClientRect().width ?? 0,
    );

    await act(() => vi.advanceTimersByTimeAsync(220));

    expect(hero.querySelectorAll("[data-captain-hero-live]")).toHaveLength(1);
    expect(pill("outgoing")).toBeNull();
    expect(pill("current")?.textContent).toBe("Thinking");
  } finally {
    duetShell.enabled = false;
    captainState.enabled = false;
    workingThreads.clear();
    reasoningThreads.clear();
  }
});

it("resets a Duet's live status when switching to another Duet", async () => {
  duetShell.enabled = true;
  captainState.enabled = true;
  workingThreads.clear();
  workingThreads.add("captain:maria:0");
  try {
    await using screen = await render(duetHeader("captain:maria:0", "Maria"));
    await vi.waitFor(() => {
      expect(screen.container.querySelector("[data-captain-hero-live]")?.textContent).toContain(
        "Running a command",
      );
    });
    const current = screen.container.querySelector('[data-captain-hero-live-label="current"]');
    expect(current?.textContent).toBe("Running a command");
    expect(current?.querySelector(".working-status-shine")).toBeNull();

    await screen.rerender(duetHeader("captain:james:0", "James"));

    const hero = screen.container.querySelector<HTMLElement>("[data-captain-header-hero]")!;
    expect(hero.querySelector("[data-captain-hero-live]")).toBeNull();
    expect(hero.textContent).not.toContain("Running a command");
    expect(hero.querySelector('[aria-live="polite"]')?.textContent).toBe("Idle");
  } finally {
    duetShell.enabled = false;
    captainState.enabled = false;
    workingThreads.clear();
  }
});
