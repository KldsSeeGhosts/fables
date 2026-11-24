import {
  CaptainId,
  CaptainMemoryId,
  EnvironmentId,
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
const shells = [
  {
    ...makeThreadFixture({ environmentId, id: captain.primaryThreadId, title: "Maria" }),
    hasPendingApprovals: true,
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
    isPending: false,
    isSuccess: true,
    refresh: () => {},
  }),
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
import { CaptainChannelBoard } from "./CaptainChannelBoard";
import { captainChannelViewAtom } from "./captainBriefTab";
import { CaptainsWorkspace } from "./CaptainsWorkspace";

const threadRef = { environmentId, threadId: captain.primaryThreadId };

async function activate(locator: Locator) {
  (locator.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
}

it("lays out everything waiting, running and briefed, and opens a brief on its Make view", async () => {
  await using screen = await render(<CaptainsWorkspace />, { router: "/captains" });

  await expect
    .element(screen.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ }))
    .toBeVisible();
  await expect.element(screen.getByText("1 needs you")).toBeVisible();
  await expect.element(screen.getByText("1 channel")).toBeVisible();
  await expect.element(screen.getByText(/Shipped the release candidate\./)).toBeVisible();
  await activate(screen.getByRole("button", { name: "Review" }));
  expect(openThread).toHaveBeenLastCalledWith(threadRef);

  openThread.mockClear();
  await activate(screen.getByRole("button", { name: "Open Maria's brief" }));
  expect(openThread).toHaveBeenCalledWith(threadRef);
  expect(appAtomRegistry.get(captainChannelViewAtom(threadRef))).toBe("make");
});

it("shows a Captain's task board and deliverables in its pane", async () => {
  await using screen = await render(<CaptainChannelBoard threadRef={threadRef} view="tasks" />);
  await expect.element(screen.getByRole("heading", { name: "Needs you" })).toBeVisible();
  await expect.element(screen.getByText("Weekly review")).toBeVisible();
  await expect.element(screen.getByText("Paused")).toBeVisible();

  await screen.rerender(<CaptainChannelBoard threadRef={threadRef} view="make" />);
  await expect
    .element(screen.getByRole("article", { name: "DIGEST.md" }).getByRole("heading"))
    .toHaveTextContent("Today");
  await expect
    .element(screen.getByRole("textbox", { name: "NOTES.md" }))
    .toHaveValue("Check the release.");
  await activate(screen.getByRole("button", { name: "Open AGENTS.md" }));
  await expect.element(screen.getByRole("textbox", { name: "AGENTS.md" })).toBeVisible();
  await expect.element(screen.getByText("Keep the patch small.")).toBeVisible();
});
