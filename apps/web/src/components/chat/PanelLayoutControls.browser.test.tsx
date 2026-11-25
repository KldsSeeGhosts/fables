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
          coordinatorOnly: false,
          createdAt: "2026-11-24T00:00:00.000Z",
          updatedAt: "2026-11-24T00:00:00.000Z",
          archivedAt: null,
        }
      : null) as never,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: () => [],
}));

import { PanelLayoutControls } from "./PanelLayoutControls";

const environmentId = EnvironmentId.make("environment");

function controls(props: {
  threadId?: string;
  rightPanelOpen?: boolean;
  onToggleThreadPanel?: () => void;
  onToggleRightPanel?: () => void;
  withDuetControls?: boolean;
}) {
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
      rightPanel={{
        open: props.rightPanelOpen ?? false,
        shortcutLabel: null,
        onToggle: props.onToggleRightPanel ?? (() => {}),
      }}
      duetControls={
        props.withDuetControls
          ? {
              terminal: { label: "Terminal", onClick: () => {} },
              browser: { label: "Browser", onClick: () => {} },
              diff: { label: "Diff", onClick: () => {} },
            }
          : null
      }
    />
  );
}

it("keeps a coding thread's top right to the details pill, right panel toggle, and overflow actions", async () => {
  const onToggleRightPanel = vi.fn();
  await using screen = await render(controls({ onToggleRightPanel, withDuetControls: true }));

  const buttons = Array.from(screen.container.querySelectorAll("button")).map((button) =>
    button.getAttribute("aria-label"),
  );
  expect(buttons).toEqual([
    "Toggle thread details panel",
    "Toggle right panel",
    "More header actions",
  ]);
  await expect
    .element(screen.getByRole("button", { name: "Toggle thread details panel" }))
    .toHaveTextContent("main");

  const toggle = screen.getByRole("button", { name: "Toggle right panel" });
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(toggle);
  expect(onToggleRightPanel).toHaveBeenCalledOnce();
});

it("shows a Duet's scope on the pill and exposes KSG quick actions in the overflow menu", async () => {
  const onToggleThreadPanel = vi.fn();
  await using screen = await render(
    controls({
      threadId: "captain:maria:0",
      rightPanelOpen: true,
      onToggleThreadPanel,
      withDuetControls: true,
    }),
  );

  await expect
    .element(screen.getByRole("button", { name: "Toggle thread details panel" }))
    .toHaveTextContent("No scope");
  await expect
    .element(screen.getByRole("button", { name: "Toggle right panel" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(screen.container.querySelector('[aria-label^="Status:"]')).toBeNull();
  expect(screen.container.querySelector('[aria-label="Tasks"]')).toBeNull();
  await expect.element(screen.getByRole("button", { name: "More header actions" })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Toggle thread details panel" }));
  expect(onToggleThreadPanel).toHaveBeenCalledOnce();
});
