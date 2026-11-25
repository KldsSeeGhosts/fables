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
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";

vi.mock(import("../../hooks/useTheme"), async (original) => {
  const actual = await original();
  return { ...actual, useTheme: () => ({ ...actual.useTheme(), theme: "ksg-salon" }) };
});

import { CaptainShelfList } from "./CaptainsShelf";

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

it("lists Captains as plain rows under one Captains section, without tree chrome", async () => {
  await using screen = await renderList({});
  const header = screen.container.querySelector('[data-sidebar-row="shelf:captains"]');
  expect(header?.textContent).toBe("Captains");
  const row = screen.getByRole("button", { name: "Maria, Ready, All workspace, Coordinator" });
  await expect.element(row).toBeVisible();
  const item = row.element().closest("li")!;
  expect(getComputedStyle(item, "::before").content).toBe("none");
  expect(getComputedStyle(row.element()).boxShadow).toBe("none");
  const avatar = row.element().querySelector<HTMLElement>("[data-captain-avatar]")!;
  expect(avatar.hasAttribute("data-captain-disc")).toBe(false);
  expect(getComputedStyle(avatar).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

it("shows an idle channel's creature and name, with its details on hover", async () => {
  await using screen = await renderList({});
  const row = screen.getByRole("button", { name: "Maria, Ready, All workspace, Coordinator" });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toBe("Maria");
  const avatar = row.element().querySelector("[data-captain-avatar]");
  expect(avatar?.getAttribute("data-captain-state")).toBe("idle");
  expect(avatar?.querySelector("[data-captain-creature-line]")).not.toBeNull();
  expect(avatar?.querySelector("[data-captain-mascot-eyes]")).toBeNull();
  expect(screen.container.querySelector("[data-duet-live]")).toBeNull();

  await userEvent.hover(row);
  const card = page.getByText("Coordinator", { exact: true });
  await expect.element(card).toBeVisible();
  await expect.element(page.getByText("All workspace", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Ready", { exact: true })).toBeVisible();
});

it("animates a working creature and counts running tasks without naming them in the row", async () => {
  await using screen = await renderList({ working: true, children: [child] });
  const row = screen.getByRole("button", { name: "Maria, Working, 1 running, Fix the login flow" });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toBe("Maria1");
  const avatar = row.element().querySelector("[data-captain-avatar]")!;
  expect(avatar.getAttribute("data-captain-state")).toBe("working");
  const motion = (selector: string) =>
    getComputedStyle(avatar.querySelector(selector)!).animationName;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  expect(motion("[data-captain-creature-body]")).toBe(
    reduced ? "none" : "captain-creature-breathe",
  );
  expect(motion("[data-captain-creature-line]")).toBe(reduced ? "none" : "captain-creature-roll");

  await userEvent.hover(row);
  await expect.element(page.getByText("Fix the login flow", { exact: true })).toBeVisible();
});

it("gives needs input precedence over working with a warm dot", async () => {
  const waiting = { ...child, hasPendingUserInput: true };
  await using screen = await renderList({ attention: 1, working: true, children: [waiting] });
  const row = screen.getByRole("button", { name: "Maria, Needs input, Fix the login flow" });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toBe("Maria");
  expect(screen.container.querySelector('[data-captain-state="waiting"]')).not.toBeNull();
  expect(
    row.element().querySelector('[data-duet-live="needs-input"]')?.getAttribute("aria-label"),
  ).toBe("1 request");
  expect(
    screen.container
      .querySelector('[data-sidebar-row="shelf:captains"] [data-duet-live="needs-input"]')
      ?.getAttribute("aria-label"),
  ).toBe("1 Captain needs input");
});

it("recedes an archived channel without live status", async () => {
  await using screen = await renderList({
    captain: { ...captain, archivedAt: DateTime.formatIso(now) },
    attention: 1,
    working: true,
  });
  const row = screen.getByRole("button", { name: "Maria, Archived" });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toBe("Maria");
  expect(screen.container.querySelector('[data-captain-state="archived"]')).not.toBeNull();
  expect(screen.container.querySelector("[data-duet-live]")).toBeNull();
});

it("opens the Captains page from the section label, which counts Captains needing input", async () => {
  const onOpenOverview = vi.fn();
  await using screen = await render(
    <ul>
      <CaptainShelfList
        rows={[{ environmentId, captain, attention: 1, working: false, primary }]}
        activeThread={null}
        onOpen={() => {}}
        onOpenOverview={onOpenOverview}
      />
    </ul>,
  );
  await expect.element(screen.getByLabelText("1 Captain needs input")).toHaveTextContent("1");
  const link = screen.container.querySelector<HTMLElement>("[data-captains-overview-link]")!;
  expect(link.textContent).toBe("Captains1");
  await userEvent.click(link);
  expect(onOpenOverview).toHaveBeenCalledOnce();
});
