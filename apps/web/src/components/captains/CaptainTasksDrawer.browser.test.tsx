import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  CaptainId,
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  type AssetResource,
  type Captain,
  type CaptainSnapshot,
  type OrchestrationV2Subagent,
  type ScheduledTask,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";

const state = vi.hoisted(() => ({
  captains: null as CaptainSnapshot | null,
  children: [] as ReturnType<typeof makeThreadFixture>[],
  parent: null as ReturnType<typeof makeThreadFixture> | null,
  subagents: [] as OrchestrationV2Subagent[],
  assetResources: [] as AssetResource[],
  scheduledTasks: [] as ScheduledTask[],
  startTurn: vi.fn(),
  runNow: vi.fn(),
  setEnabled: vi.fn(),
  deleteTask: vi.fn(),
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
  useQuietThreadProjection: (() => ({ projection: { subagents: state.subagents } })) as never,
  useQuietThreadShells: (() => state.children) as never,
  useQuietThreadShell: ((ref: { threadId: ThreadId }) =>
    ref.threadId === state.parent?.id
      ? state.parent
      : (state.children.find((thread) => thread.id === ref.threadId) ?? null)) as never,
}));

vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({
    data: { tasks: state.scheduledTasks, timeZone: "UTC" },
    error: null,
    failure: null,
    isPending: false,
    refresh: () => {},
  })) as never,
}));

const permission = Atom.make(true);
vi.mock(import("../../state/server"), async (importOriginal) => {
  const actual = await importOriginal();
  const command = (run: unknown) => ({
    run,
    permissionAtom: () => permission,
    label: "test command",
  });
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      runScheduledTaskNow: command(state.runNow),
      setScheduledTaskEnabled: command(state.setEnabled),
      deleteScheduledTask: command(state.deleteTask),
      upsertScheduledTask: command(vi.fn()),
    } as never,
  };
});

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: () => state.startTurn,
}));

vi.mock(import("../../assets/assetUrls"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAssetUrlState: ((_environmentId: unknown, resource: AssetResource | null) => {
    if (resource) state.assetResources.push(resource);
    return {
      _tag: "Success",
      url: "https://assets.test/preview.png",
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  }) as never,
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
  coordinatorOnly: false,
  createdAt: DateTime.formatIso(DateTime.makeUnsafe("2026-11-24")),
  updatedAt: DateTime.formatIso(DateTime.makeUnsafe("2026-11-24")),
  archivedAt: null,
} satisfies Captain;
const threadRef = { environmentId, threadId: captain.primaryThreadId };
const childThreadId = ThreadId.make("thread:fix-checkout");

function fixCheckoutThread({ needsInput = true }: { readonly needsInput?: boolean } = {}) {
  return makeThreadFixture({
    id: childThreadId,
    environmentId,
    projectId: ProjectId.make("project"),
    title: "Fix checkout",
    branch: "fix/checkout",
    worktreePath: "/workspace/fix-checkout",
    updatedAt: "2100-01-01T00:00:00.000Z",
    hasPendingUserInput: needsInput,
    lineage: {
      rootThreadId: captain.primaryThreadId,
      parentThreadId: captain.primaryThreadId,
      relationshipToParent: "subagent",
    },
  });
}

function delegatedTask(
  status: OrchestrationV2Subagent["status"],
  result: string,
): OrchestrationV2Subagent {
  const now = DateTime.makeUnsafe("2100-01-01T00:00:00.000Z");
  return {
    id: NodeId.make(`agent-${status}`),
    threadId: captain.primaryThreadId,
    runId: null,
    parentNodeId: NodeId.make("parent"),
    origin: "app_owned",
    createdBy: "agent",
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerThreadId: null,
    childThreadId,
    nativeTaskRef: null,
    prompt: "Fix checkout",
    title: "Fix checkout",
    model: null,
    status,
    result,
    startedAt: now,
    completedAt: status === "running" ? null : now,
    updatedAt: now,
  };
}

function routine(
  id: string,
  title: string,
  enabled: boolean,
  schedule: ScheduledTask["schedule"] = { type: "interval", everyMs: 60_000 },
): ScheduledTask {
  return {
    id: ScheduledTaskId.make(id),
    title,
    prompt: `${title} prompt`,
    enabled,
    schedule,
    projectId: ProjectId.make("project"),
    threadId: captain.primaryThreadId,
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    nextRunAt: "2026-11-25T09:00:00.000Z",
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
  };
}

function resetState() {
  state.captains = { captains: [captain], documents: [], memories: [] };
  state.parent = makeThreadFixture({
    id: captain.primaryThreadId,
    environmentId,
    projectId: ProjectId.make("project"),
    title: "Maria",
  });
  state.children = [fixCheckoutThread()];
  state.subagents = [];
  state.assetResources = [];
  state.scheduledTasks = [];
  state.startTurn.mockReset();
  state.startTurn.mockResolvedValue({ _tag: "Success", value: {} });
  state.runNow.mockReset().mockReturnValue(Effect.succeed({}));
  state.setEnabled.mockReset().mockReturnValue(Effect.succeed({}));
  state.deleteTask.mockReset().mockReturnValue(Effect.succeed({}));
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

it("wraps a working task's status text in the shine element", async () => {
  resetState();
  state.children = [
    makeThreadFixture({
      id: childThreadId,
      environmentId,
      projectId: ProjectId.make("project"),
      title: "Fix checkout",
      branch: "fix/checkout",
      updatedAt: "2100-01-01T00:00:00.000Z",
      runtime: { status: "running" } as EnvironmentThreadShell["runtime"],
      lineage: {
        rootThreadId: captain.primaryThreadId,
        parentThreadId: captain.primaryThreadId,
        relationshipToParent: "subagent",
      },
    }),
  ];
  await using screen = await render(
    <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />,
  );

  await expect.element(screen.getByText("Working")).toBeVisible();
  expect(screen.container.querySelector(".working-status-shine")?.textContent).toBe("Working");
});

it("shows a finished local task's result image and never shows one while it is working", async () => {
  resetState();
  state.children = [fixCheckoutThread({ needsInput: false })];
  const result = "Done.\n\n![result](screenshots/result.png)";
  state.subagents = [delegatedTask("completed", result)];
  {
    await using screen = await render(
      <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />,
    );
    await expect.element(screen.getByText("Fix checkout")).toBeVisible();
    await expect.element(screen.getByText("Ready for you")).toBeVisible();

    const row = screen.getByRole("button", { name: /Fix checkout/ }).query();
    expect(row?.querySelectorAll("img")).toHaveLength(1);
    expect(row?.querySelector("img")?.getAttribute("src")).toBe("https://assets.test/preview.png");
    expect(state.assetResources[0]).toEqual({
      _tag: "media-file",
      threadId: childThreadId,
      path: "/workspace/fix-checkout/screenshots/result.png",
      hostOnly: true,
    });
  }

  state.subagents = [delegatedTask("running", result)];
  state.assetResources = [];
  {
    await using screen = await render(
      <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />,
    );
    await expect.element(screen.getByText("Fix checkout")).toBeVisible();
    await expect.element(screen.getByText("Working")).toBeVisible();

    const row = screen.getByRole("button", { name: /Fix checkout/ }).query();
    expect(row?.querySelectorAll("img")).toHaveLength(0);
    expect(state.assetResources).toEqual([]);
  }
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

it("runs an existing morning brief from the Scheduled tab", async () => {
  resetState();
  const brief = routine("captain-morning-brief:maria", "Morning brief for Maria", true, {
    type: "fixed_time",
    timeOfDay: "08:00",
  });
  state.scheduledTasks = [brief];
  await using screen = await render(
    <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />,
  );

  await userEvent.click(screen.getByRole("tab", { name: "Scheduled" }));
  await userEvent.click(screen.getByRole("button", { name: "Run now" }));

  await vi.waitFor(() =>
    expect(state.runNow).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      environmentId,
      input: { id: brief.id },
    }),
  );
});

it("runs, pauses and resumes routines from their row actions", async () => {
  resetState();
  const enabled = routine("routine-enabled", "Weekly review", true);
  const paused = routine("routine-paused", "Paused digest", false);
  state.scheduledTasks = [enabled, paused];
  await using screen = await render(
    <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />,
  );

  await userEvent.click(screen.getByRole("tab", { name: "Scheduled" }));
  await userEvent.click(screen.getByRole("button", { name: "Actions for Weekly review" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Run now" }));
  await vi.waitFor(() =>
    expect(state.runNow).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      environmentId,
      input: { id: enabled.id },
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: "Actions for Weekly review" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Pause" }));
  await vi.waitFor(() =>
    expect(state.setEnabled).toHaveBeenCalledWith(expect.anything(), {
      environmentId,
      input: { id: enabled.id, enabled: false },
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: "Actions for Paused digest" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Resume" }));
  await vi.waitFor(() =>
    expect(state.setEnabled).toHaveBeenCalledWith(expect.anything(), {
      environmentId,
      input: { id: paused.id, enabled: true },
    }),
  );
});

it("notes that routines do not run while the Captain is archived", async () => {
  resetState();
  state.captains = {
    captains: [{ ...captain, archivedAt: "2026-11-24T12:00:00.000Z" }],
    documents: [],
    memories: [],
  };
  state.scheduledTasks = [routine("routine-enabled", "Weekly review", true)];
  await using screen = await render(
    <CaptainTasksDrawer threadRef={threadRef} onClose={() => {}} />,
  );

  await userEvent.click(screen.getByRole("tab", { name: "Scheduled" }));

  await expect
    .element(screen.getByText("Routines don't run while this Captain is archived."))
    .toBeVisible();
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
