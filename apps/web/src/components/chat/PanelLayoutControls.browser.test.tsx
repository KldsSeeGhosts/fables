import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

vi.mock(import("../../hooks/useDuetShell"), () => ({
  useDuetShell: () => true,
}));

vi.mock(import("../captains/useCaptain"), async (importOriginal) => ({
  ...(await importOriginal()),
  useCaptain: ((ref: { threadId: string } | null) =>
    ref?.threadId.startsWith("captain:")
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
          createdAt: "2026-11-24T00:00:00.000Z",
          updatedAt: "2026-11-24T00:00:00.000Z",
          archivedAt: null,
        }
      : null) as never,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: () => [],
  useQuietThreadShell: () => null,
}));

vi.mock(import("../../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironment: () => null,
  usePrimaryEnvironmentId: () => EnvironmentId.make("environment"),
}));

import { PanelLayoutControls } from "./PanelLayoutControls";

const environmentId = EnvironmentId.make("environment");
const machine = {
  label: "This Mac",
  machine: "desktop" as const,
  environmentId,
  unavailable: false,
  environments: [
    {
      environmentId,
      projectId: null,
      label: "This Mac",
      isPrimary: true,
      machine: "desktop" as const,
    },
  ],
  locked: false,
};

function controls(props: { threadId?: string; onToggleThreadPanel?: () => void }) {
  const threadId = props.threadId ?? "thread";
  return (
    <PanelLayoutControls
      threadPanelOpen={false}
      threadPanelPresentation="inline"
      threadPanelShortcutLabel={null}
      onToggleThreadPanel={props.onToggleThreadPanel ?? (() => {})}
      branchLabel="main"
      contextPercent={42}
      threadRef={{ environmentId, threadId: ThreadId.make(threadId) }}
      duetControls={{
        onNew: () => {},
        machine,
        terminal: { label: "Terminal", onClick: () => {} },
        browser: { label: "Browser", onClick: () => {} },
        diff: { label: "Diff", onClick: () => {} },
      }}
    />
  );
}

it("keeps machine selection in the coding thread overflow menu", async () => {
  await using screen = await render(controls({}));

  await expect.element(screen.getByRole("button", { name: "New side chat" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Terminal" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Browser" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Diff" })).toBeVisible();
  expect(screen.container.querySelector('[aria-label="Choose machine"]')).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "More header actions" }));
  await vi.waitFor(() => expect(document.body.textContent).toContain("Run on"));
});

it("folds coding utility controls into overflow below 720px", async () => {
  await using screen = await render(
    <header data-chat-header style={{ width: "500px" }}>
      {controls({})}
    </header>,
  );

  await vi.waitFor(() =>
    expect(screen.container.querySelector('[aria-label="Terminal"]')).toBeNull(),
  );
  await userEvent.click(screen.getByRole("button", { name: "More header actions" }));
  await vi.waitFor(() => {
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (element) => element.textContent,
    );
    expect(items).toContain("Terminal");
    expect(items).toContain("Browser");
    expect(items).toContain("Diff");
  });
});

it("keeps a Captain header to the orb, details, Tasks and one overflow menu", async () => {
  const onToggleThreadPanel = vi.fn();
  await using screen = await render(controls({ threadId: "captain:maria:0", onToggleThreadPanel }));

  await expect.element(screen.getByRole("button", { name: "Tasks" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^Status:/ })).toBeVisible();
  expect(screen.container.querySelector('[aria-label="New conversation"]')).toBeNull();
  expect(screen.container.querySelector('[aria-label="Choose machine"]')).toBeNull();
  expect(screen.container.querySelector('[aria-label="Terminal"]')).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "More header actions" }));
  await vi.waitFor(() => {
    const text = document.body.textContent ?? "";
    expect(text).toContain("Run on");
    expect(text).toContain("Terminal");
  });
  await userEvent.keyboard("{Escape}");

  await userEvent.click(screen.getByRole("button", { name: "Toggle thread details panel" }));
  expect(onToggleThreadPanel).toHaveBeenCalledOnce();
});
