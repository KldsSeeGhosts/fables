import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const persisted = vi.hoisted(() => ({ title: "" }));
const openMenu = vi.hoisted(() => vi.fn());
const duetShell = vi.hoisted(() => ({ enabled: false }));
const captainState = vi.hoisted(() => ({ enabled: false }));
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

import { render, stubGlobal } from "../../../test/render";
import { showLayoutTabMenu } from "../../layout/PaneTabs";
import { LayoutPaneContext, useLayoutPane } from "../../layout/layoutPaneContext";
import { findLayoutTab } from "../../layout/layoutModel";
import { useLayoutStore } from "../../layout/layoutStore";
import { ensureLocalApi } from "../../localApi";
import { ChatHeader } from "./ChatHeader";

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

it("keeps a Duet channel's title menu at the header start and centres only the animated orb", async () => {
  duetShell.enabled = true;
  captainState.enabled = true;
  openMenu.mockClear();
  try {
    await using screen = await render(
      <header data-chat-header className="relative flex h-12" style={{ width: 900 }}>
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
