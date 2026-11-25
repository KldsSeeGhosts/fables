import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

const captainState = vi.hoisted(() => ({ scopedProjectIds: [] as string[] }));
const projectsState = vi.hoisted(() => ({ projects: [] as unknown[] }));

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
          scopedProjectIds: captainState.scopedProjectIds,
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
  useProjects: (() => projectsState.projects) as never,
}));

import { PanelLayoutControls } from "./PanelLayoutControls";

const environmentId = EnvironmentId.make("environment");

function setup(input: { scopedProjectIds?: string[]; projects?: unknown[] } = {}) {
  captainState.scopedProjectIds = input.scopedProjectIds ?? [];
  projectsState.projects = input.projects ?? [];
}

function project(id: string, title: string): EnvironmentProject {
  return {
    id: ProjectId.make(id),
    environmentId,
    title,
    workspaceRoot: `/repo/${id}`,
    isScratch: false,
    faviconPath: null,
    projectIcon: null,
  } as unknown as EnvironmentProject;
}

function controls(props: {
  threadId?: string;
  threadPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  project?: EnvironmentProject | null;
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
      project={props.project ?? null}
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
  setup();
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

it("shows All workspace for an unscoped Duet instead of its attached project", async () => {
  setup();
  const onToggleThreadPanel = vi.fn();
  await using screen = await render(
    controls({
      threadId: "captain:maria:0",
      rightPanelOpen: true,
      project: project("attached", "Old project"),
      onToggleThreadPanel,
    }),
  );

  const pill = screen.getByRole("button", { name: "Toggle thread details panel" });
  await expect.element(pill).toHaveTextContent("environment/All workspace");
  await expect
    .element(screen.getByRole("button", { name: "Toggle right panel" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(screen.container.querySelector('[aria-label^="Status:"]')).toBeNull();
  expect(screen.container.querySelector('[aria-label="More header actions"]')).toBeNull();

  await userEvent.click(pill);
  expect(onToggleThreadPanel).toHaveBeenCalledOnce();
});

it("shows one scoped project's favicon and title instead of the attached project", async () => {
  const scoped = project("scoped", "KSG Code");
  const attached = project("attached", "Old project");
  setup({ scopedProjectIds: [scoped.id], projects: [scoped, attached] });
  await using screen = await render(controls({ threadId: "captain:maria:0", project: attached }));

  const pill = screen.getByRole("button", { name: "Toggle thread details panel" });
  expect(pill.element().textContent).toContain("KSG Code");
  expect(pill.element().textContent).not.toContain("Old project");
  expect(pill.element().querySelector('[data-slot="project-monogram"]')).not.toBeNull();
});

it("counts several scoped projects instead of the attached project", async () => {
  const first = project("first", "KSG Code");
  const second = project("second", "Website");
  const attached = project("attached", "Old project");
  setup({ scopedProjectIds: [first.id, second.id], projects: [first, second, attached] });
  await using screen = await render(controls({ threadId: "captain:maria:0", project: attached }));

  const pill = screen.getByRole("button", { name: "Toggle thread details panel" });
  await expect.element(pill).toHaveTextContent("environment/2 projects");
  expect(pill.element().textContent).not.toContain("Old project");
});

it("shows the context ring only while the details card is collapsed", async () => {
  setup();
  await using collapsed = await render(controls({ threadPanelOpen: false }));
  expect(collapsed.container.querySelector("[data-context-ring]")).not.toBeNull();

  await using open = await render(controls({ threadPanelOpen: true }));
  expect(open.container.querySelector("[data-context-ring]")).toBeNull();
});
