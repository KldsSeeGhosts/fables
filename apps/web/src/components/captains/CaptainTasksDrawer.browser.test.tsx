import {
  CaptainId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type Captain,
  type CaptainSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";

const state = vi.hoisted(() => ({
  captains: null as CaptainSnapshot | null,
  children: [] as ReturnType<typeof makeThreadFixture>[],
  parent: null as ReturnType<typeof makeThreadFixture> | null,
  startTurn: vi.fn(),
}));

vi.mock(import("./useCaptain"), async (importOriginal) => ({
  ...(await importOriginal()),
  useCaptains: (() => ({
    data: state.captains,
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: state.captains !== null,
    refresh: () => {},
  })) as never,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: (() => []) as never,
  useQuietThreadProjection: (() => null) as never,
  useQuietThreadShells: (() => state.children) as never,
  useQuietThreadShell: ((ref: { threadId: ThreadId }) =>
    ref.threadId === state.parent?.id
      ? state.parent
      : (state.children.find((thread) => thread.id === ref.threadId) ?? null)) as never,
}));

vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({
    data: null,
    error: null,
    failure: null,
    isPending: false,
    refresh: () => {},
  })) as never,
}));

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: () => state.startTurn,
}));

import { PanelTabSlotsContext } from "../PanelTabBreadcrumb";
import { CaptainTasksDrawer } from "./CaptainTasksDrawer";

const environmentId = EnvironmentId.make("environment");
const captain = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:0"),
  earlierThreadIds: [],
  name: "Maria",
  role: "Coordinator",
  instructions: "",
  avatar: { preset: "compass", color: "violet" },
  scopedProjectIds: [],
  reportPolicy: "context",
  createdAt: DateTime.formatIso(DateTime.makeUnsafe("2026-11-24")),
  updatedAt: DateTime.formatIso(DateTime.makeUnsafe("2026-11-24")),
  archivedAt: null,
} satisfies Captain;
const threadRef = { environmentId, threadId: captain.primaryThreadId };
const childThreadId = ThreadId.make("thread:fix-checkout");

function resetState() {
  state.captains = { captains: [captain], documents: [], memories: [] };
  state.parent = makeThreadFixture({
    id: captain.primaryThreadId,
    environmentId,
    projectId: ProjectId.make("project"),
    title: "Maria",
  });
  state.children = [
    makeThreadFixture({
      id: childThreadId,
      environmentId,
      projectId: ProjectId.make("project"),
      title: "Fix checkout",
      branch: "fix/checkout",
      updatedAt: "2100-01-01T00:00:00.000Z",
      hasPendingUserInput: true,
      lineage: {
        rootThreadId: captain.primaryThreadId,
        parentThreadId: captain.primaryThreadId,
        relationshipToParent: "subagent",
      },
    }),
  ];
  state.startTurn.mockReset();
  state.startTurn.mockResolvedValue({ _tag: "Success", value: {} });
}

it("shows Captain tasks with their status and workspace detail", async () => {
  resetState();
  await using screen = await render(
    <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />,
  );

  await expect.element(screen.getByText("Tasks in #Maria")).toBeVisible();
  await expect
    .element(screen.getByRole("tab", { name: "Today" }))
    .toHaveAttribute("aria-selected", "true");
  await expect.element(screen.getByRole("tab", { name: "All" })).toBeVisible();
  await expect.element(screen.getByRole("tab", { name: "Scheduled" })).toBeVisible();
  await expect.element(screen.getByText("Fix checkout")).toBeVisible();
  await expect.element(screen.getByText("Needs input")).toBeVisible();
  await expect.element(screen.getByText("fix/checkout")).toBeVisible();
});

it("queues a quick task as a user turn on the Captain primary thread", async () => {
  resetState();
  await using screen = await render(
    <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />,
  );
  const input = screen.getByRole("textbox", { name: "Add a task..." });

  await userEvent.type(input, "Review the release{Enter}");

  expect(state.startTurn).toHaveBeenCalledWith({
    environmentId,
    input: expect.objectContaining({
      threadId: captain.primaryThreadId,
      dispatchMode: "queue",
      message: expect.objectContaining({ role: "user", text: "Review the release" }),
    }),
  });
  await expect.element(input).toHaveValue("");
});

it("renders the right-panel add-surface button in its header when panel tabs are hidden, and hides the duplicate header when tabs show", async () => {
  resetState();
  {
    await using screen = await render(
      <PanelTabSlotsContext
        value={{
          breadcrumb: null,
          actions: null,
          registerActions: () => () => {},
          showPanelTabs: false,
          addSurfaceButton: <button type="button">Add panel</button>,
        }}
      >
        <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />
      </PanelTabSlotsContext>,
    );
    await expect.element(screen.getByText("Tasks in #Maria")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Add panel" })).toBeVisible();
  }
  {
    await using screen = await render(
      <PanelTabSlotsContext
        value={{
          breadcrumb: null,
          actions: null,
          registerActions: () => () => {},
          showPanelTabs: true,
          addSurfaceButton: null,
        }}
      >
        <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />
      </PanelTabSlotsContext>,
    );
    await expect.element(screen.getByText("Tasks in #Maria")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("tab", { name: "Today" })).toBeVisible();
  }
});
