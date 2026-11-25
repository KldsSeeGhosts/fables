import {
  CaptainId,
  CaptainMemoryId,
  EnvironmentId,
  RunId,
  ScheduledTaskId,
  ThreadId,
  type Captain,
  type CaptainDocument,
  type CaptainSnapshot,
  type ScheduledTask,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { userEvent, type Locator } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";

const environmentId = EnvironmentId.make("environment");
const at = DateTime.formatIso(DateTime.makeUnsafe("2026-11-24"));
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
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
} satisfies Captain;
const document = (name: CaptainDocument["name"], content: string) =>
  ({ captainId: captain.id, name, content, revision: 2, updatedAt: at }) satisfies CaptainDocument;
const snapshot = {
  captains: [captain],
  documents: [
    document("NOTES.md", "Check the release."),
    document("DIGEST.md", "# Today\n\nShipped the release candidate."),
  ],
  memories: [
    {
      captainId: captain.id,
      id: CaptainMemoryId.make("small"),
      text: "Keep the patch small.",
      essential: false,
      userControlled: true,
      createdAt: at,
      updatedAt: at,
    },
  ],
} satisfies CaptainSnapshot;
const childThreadId = ThreadId.make("review-release");
const primaryShell = {
  ...makeThreadFixture({ environmentId, id: captain.primaryThreadId, title: "Maria" }),
  hasPendingApprovals: true,
};
const shells = [
  primaryShell,
  {
    ...makeThreadFixture({
      environmentId,
      id: childThreadId,
      title: "Review release",
      lineage: {
        rootThreadId: captain.primaryThreadId,
        parentThreadId: captain.primaryThreadId,
        relationshipToParent: "subagent",
      },
      updatedAt: "2026-11-25T09:00:00.000Z",
    }),
    runtime: {
      status: "running" as const,
      activeRunId: RunId.make("review-release-run"),
      providerInstanceId: primaryShell.providerInstanceId,
      providerName: null,
      lastError: null,
      updatedAt: "2026-11-25T09:00:00.000Z",
    },
  },
];
const scheduledTask = {
  id: ScheduledTaskId.make("weekly-review"),
  title: "Weekly review",
  prompt: "Review the week.",
  enabled: false,
  schedule: { type: "fixed_time", timeOfDay: "09:00" },
  projectId: shells[0]!.projectId,
  threadId: captain.primaryThreadId,
  workspaceStrategy: { type: "root" },
  modelSelection: shells[0]!.modelSelection,
  runtimeMode: shells[0]!.runtimeMode,
  interactionMode: shells[0]!.interactionMode,
  createdBy: { type: "user" },
  creationSource: "web",
  createdAt: at,
  updatedAt: at,
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
  runCount: 0,
} as unknown as ScheduledTask;

const openThread = vi.hoisted(() => vi.fn());
vi.mock(import("./captainNavigation"), () => ({ useOpenCaptainThread: () => openThread }));
vi.mock(import("./captainsDirectory"), () => ({
  useCaptainEnvironments: () => ({ supporting: [], key: "", results: [] }),
  useCaptainDestinations: () => ({ destinations: [], destination: undefined }),
  useCaptainsDirectory: () => ({
    environments: [{ environmentId, label: "Local", loading: false, captains: [captain] }],
    shells,
  }),
}));
vi.mock(import("./useCaptain"), async (importOriginal) => ({
  ...(await importOriginal()),
  useCaptains: () => ({
    data: snapshot,
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: true,
    isSuccess: true,
    refresh: () => {},
  }),
}));
vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadProjection: () => ({ projection: { subagents: [] } }) as never,
}));
vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: () =>
    ({
      data: { tasks: [scheduledTask] },
      dataUpdatedAt: 0,
      error: null,
      failure: null,
      isPending: false,
      isSuccess: true,
      refresh: () => {},
    }) as never,
}));

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { captainDrawerTabAtom } from "./captainBriefTab";
import { CaptainsWorkspace } from "./CaptainsWorkspace";

const threadRef = { environmentId, threadId: captain.primaryThreadId };

async function activate(locator: Locator) {
  (locator.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
}

it("lays out Duets, active work and a markdown brief, and opens cards in the conversation", async () => {
  await using screen = await render(<CaptainsWorkspace />, { router: "/captains" });

  await expect
    .element(screen.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ }))
    .toBeVisible();
  await expect.element(screen.getByText("1 Captain")).toBeVisible();
  await expect.element(screen.getByText("1 needs you")).toBeVisible();
  await expect.element(screen.getByText("Review release").nth(1)).toBeVisible();
  await expect.element(screen.getByText("Working").nth(1)).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect.element(screen.getByText(/Shipped the release candidate\./)).toBeVisible();

  await activate(screen.getByRole("button", { name: "Open Maria" }));
  expect(openThread).toHaveBeenLastCalledWith(threadRef);
  expect(appAtomRegistry.get(captainDrawerTabAtom(threadRef))).toBe("today");

  openThread.mockClear();
  await activate(screen.getByRole("button", { name: "Review" }));
  expect(openThread).toHaveBeenLastCalledWith(threadRef);

  openThread.mockClear();
  await activate(screen.getByRole("button", { name: "Open Maria's brief" }));
  expect(openThread).toHaveBeenCalledWith(threadRef);
  expect(appAtomRegistry.get(captainDrawerTabAtom(threadRef))).toBe("today");
});
