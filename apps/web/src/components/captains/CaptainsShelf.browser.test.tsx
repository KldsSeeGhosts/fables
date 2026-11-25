import { scopeThreadShell } from "@t3tools/client-runtime/state/models";
import {
  CaptainId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type Captain,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";

vi.mock(import("../../hooks/useTheme"), async (original) => {
  const actual = await original();
  return { ...actual, useTheme: () => ({ ...actual.useTheme(), theme: "ksg-salon" }) };
});

const directory = vi.hoisted(() => ({ captains: [] as Captain[], shells: [] as unknown[] }));
vi.mock(import("./captainsDirectory"), async (original) => {
  const actual = await original();
  // Only the fields the shelf reads; the real list carries full environment records.
  const useCaptainEnvironments = () =>
    ({
      supporting: [{ environmentId: EnvironmentId.make("environment"), label: "Studio" }],
      key: "environment",
      results: [AsyncResult.success({ captains: directory.captains, documents: [], memories: [] })],
    }) as unknown as ReturnType<typeof actual.useCaptainEnvironments>;
  return { ...actual, useCaptainEnvironments };
});
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadShells: () => directory.shells as never,
}));

import { CaptainShelfList, CaptainsHubRow } from "./CaptainsShelf";

const environmentId = EnvironmentId.make("environment");
const now = DateTime.makeUnsafe("2026-11-24T10:00:00.000Z");
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
  createdAt: DateTime.formatIso(now),
  updatedAt: DateTime.formatIso(now),
  archivedAt: null,
} satisfies Captain;

const providerInstanceId = ProviderInstanceId.make("codex");
const baseThread: OrchestrationV2ThreadShell = {
  id: captain.primaryThreadId,
  projectId: ProjectId.make("project"),
  title: "Maria",
  providerInstanceId,
  modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: {
    rootThreadId: captain.primaryThreadId,
    parentThreadId: null,
    relationshipToParent: null,
  },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "web",
  latestRunId: null,
  activeRunId: null,
  status: "idle",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};
const primary = scopeThreadShell(environmentId, baseThread);
const child = {
  ...primary,
  id: ThreadId.make("child"),
  title: "Fix the login flow",
  lineage: {
    rootThreadId: captain.primaryThreadId,
    parentThreadId: captain.primaryThreadId,
    relationshipToParent: "subagent" as const,
  },
};

function renderList(row: Partial<Parameters<typeof CaptainShelfList>[0]["rows"][number]>) {
  return render(
    <ul>
      <CaptainShelfList
        rows={[{ environmentId, captain, attention: 0, working: false, primary, ...row }]}
        activeThread={null}
        onOpen={() => {}}
      />
    </ul>,
  );
}

it("shows an idle channel's scope and role without a status ring", async () => {
  await using screen = await renderList({});
  await expect
    .element(screen.getByRole("button", { name: "Maria, Ready, All workspace, Coordinator" }))
    .toBeVisible();
  expect(screen.container.querySelector("[data-captain-avatar-orbit]")).toBeNull();
  expect(screen.container.querySelector("[data-duet-attention-pill]")).toBeNull();
  expect(screen.container.querySelector("[data-captain-tile]")).not.toBeNull();
});

it("turns the working orbit and names the running task", async () => {
  await using screen = await renderList({ working: true, children: [child] });
  await expect
    .element(screen.getByRole("button", { name: "Maria, Working, 1 running, Fix the login flow" }))
    .toBeVisible();
  expect(screen.container.querySelector('[data-captain-avatar-orbit="working"]')).not.toBeNull();
  expect(screen.container.querySelector("[data-captain-avatar-ping]")).toBeNull();
});

it("gives needs input precedence over working with a halo and request pill", async () => {
  const waiting = { ...child, hasPendingUserInput: true };
  await using screen = await renderList({ attention: 1, working: true, children: [waiting] });
  await expect
    .element(screen.getByRole("button", { name: "Maria, Needs input, Fix the login flow" }))
    .toBeVisible();
  expect(
    screen.container.querySelector('[data-captain-avatar-orbit="needs-input"]'),
  ).not.toBeNull();
  expect(screen.container.querySelector('[data-captain-avatar-orbit="working"]')).toBeNull();
  expect(screen.container.querySelector("[data-captain-avatar-ping]")).not.toBeNull();
  await expect.element(screen.getByLabelText("1 request")).toHaveTextContent("1");
});

it("recedes an archived channel without live status", async () => {
  await using screen = await renderList({
    captain: { ...captain, archivedAt: DateTime.formatIso(now) },
    attention: 1,
    working: true,
  });
  await expect.element(screen.getByRole("button", { name: "Maria, Archived" })).toBeVisible();
  expect(
    screen.container.querySelector("[data-duet-card-title]")?.getAttribute("data-duet-card-title"),
  ).toBe("receded");
  expect(screen.container.querySelector("[data-captain-avatar-orbit]")).toBeNull();
  expect(screen.container.querySelector("[data-duet-attention-pill]")).toBeNull();
});

it("summarizes working and waiting channels beside Everything", async () => {
  const ada = {
    ...captain,
    id: CaptainId.make("ada"),
    name: "Ada",
    primaryThreadId: ThreadId.make("captain:ada:0"),
  };
  directory.captains = [captain, ada];
  directory.shells = [
    {
      ...primary,
      runtime: {
        status: "running",
        activeRunId: null,
        providerInstanceId,
        providerName: null,
        lastError: null,
        updatedAt: DateTime.formatIso(now),
      },
    },
    { ...primary, id: ada.primaryThreadId, hasPendingApprovals: true },
  ];
  await using screen = await render(<CaptainsHubRow active={false} onOpen={() => {}} />);
  await expect.element(screen.getByLabelText("1 channel working")).toHaveTextContent("1");
  await expect.element(screen.getByLabelText("1 Captain needs input")).toHaveTextContent("1");

  directory.shells = [];
  await screen.rerender(<CaptainsHubRow active={false} onOpen={() => {}} />);
  await expect.element(screen.getByText("2", { exact: true })).toBeVisible();
});
