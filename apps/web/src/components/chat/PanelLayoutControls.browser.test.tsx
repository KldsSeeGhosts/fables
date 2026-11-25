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
  threadPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  onToggleThreadPanel?: () => void;
  onToggleRightPanel?: () => void;
}) {
  const threadId = props.threadId ?? "thread";
  return (
    <PanelLayoutControls
      threadPanelOpen={props.threadPanelOpen ?? false}
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
    />
  );
}

it("keeps a coding thread's top right to the details pill and right panel toggle", async () => {
  const onToggleRightPanel = vi.fn();
  await using screen = await render(controls({ onToggleRightPanel }));

  const buttons = Array.from(screen.container.querySelectorAll("button")).map((button) =>
    button.getAttribute("aria-label"),
  );
  expect(buttons).toEqual(["Toggle thread details panel", "Toggle right panel"]);
  await expect
    .element(screen.getByRole("button", { name: "Toggle thread details panel" }))
    .toHaveTextContent("environment/main");
  expect(screen.container.querySelector('[aria-label="More header actions"]')).toBeNull();

  const toggle = screen.getByRole("button", { name: "Toggle right panel" });
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(toggle);
  expect(onToggleRightPanel).toHaveBeenCalledOnce();
});

it("shows a Duet's machine and scope on the pill", async () => {
  const onToggleThreadPanel = vi.fn();
  await using screen = await render(
    controls({
      threadId: "captain:maria:0",
      rightPanelOpen: true,
      onToggleThreadPanel,
    }),
  );

  const pill = screen.getByRole("button", { name: "Toggle thread details panel" });
  await expect.element(pill).toHaveTextContent("environment/No scope");
  await expect
    .element(screen.getByRole("button", { name: "Toggle right panel" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(screen.container.querySelector('[aria-label^="Status:"]')).toBeNull();
  expect(screen.container.querySelector('[aria-label="More header actions"]')).toBeNull();

  await userEvent.click(pill);
  expect(onToggleThreadPanel).toHaveBeenCalledOnce();
});

it("shows the context ring only while the details card is collapsed", async () => {
  await using collapsed = await render(controls({ threadPanelOpen: false }));
  expect(collapsed.container.querySelector("[data-context-ring]")).not.toBeNull();

  await using open = await render(controls({ threadPanelOpen: true }));
  expect(open.container.querySelector("[data-context-ring]")).toBeNull();
});
