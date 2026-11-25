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
import { act, render } from "../../../test/render";
import { useProjects } from "../../state/entities";

vi.mock(import("../../hooks/useTheme"), async (original) => {
  const actual = await original();
  return { ...actual, useTheme: () => ({ ...actual.useTheme(), theme: "ksg-salon" }) };
});
vi.mock(import("../../hooks/useNowMinute"), () => ({ useNowMinute: () => "2026-11-24T10:00" }));
vi.mock("../../state/entities", { spy: true });

import { CaptainShelfList } from "./CaptainsShelf";

const environmentId = EnvironmentId.make("environment");
const now = DateTime.makeUnsafe("2026-11-24T10:00:00.000Z");
const duetOrderStorageKey = "t3code:sidebar:duet-order";
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
const primary = {
  ...scopeThreadShell(environmentId, baseThread),
  updatedAt: "2026-11-24T09:50:00.000Z",
};
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

function captainNamed(id: string, name: string): Captain {
  return {
    ...captain,
    id: CaptainId.make(id),
    primaryThreadId: ThreadId.make(`captain:${id}:0`),
    name,
  };
}

function renderList(
  row: Partial<Parameters<typeof CaptainShelfList>[0]["rows"][number]>,
  options: {
    rows?: Parameters<typeof CaptainShelfList>[0]["rows"];
    projects?: ReturnType<typeof useProjects>;
  } = {},
) {
  window.localStorage.removeItem(duetOrderStorageKey);
  vi.mocked(useProjects).mockReturnValue(options.projects ?? []);
  return render(
    <ul>
      <CaptainShelfList
        rows={
          options.rows ?? [
            { environmentId, captain, attention: 0, working: false, primary, ...row },
          ]
        }
        activeThread={null}
        onOpen={() => {}}
      />
    </ul>,
  );
}

function rowOrder(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-duet-channel-card]")).map(
    (row) => row.textContent ?? "",
  );
}

const pointerEvent = (type: string, x: number, y: number) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: x,
    clientY: y,
  });

async function pointerDrag(start: HTMLElement, distance?: number) {
  const bounds = start.getBoundingClientRect();
  const rowHeight = start.closest("[data-duet-channel-card]")?.getBoundingClientRect().height;
  const dragDistance = distance ?? rowHeight ?? bounds.height;
  const x = bounds.x + 24;
  const y = bounds.y + 24;
  await act(() => {
    start.dispatchEvent(pointerEvent("pointerdown", x, y));
  });
  for (const offset of [dragDistance, dragDistance + 2]) {
    await act(() => {
      document.dispatchEvent(pointerEvent("pointermove", x, y + offset));
    });
  }
  await act(() => {
    document.dispatchEvent(pointerEvent("pointerup", x, y + dragDistance + 2));
  });
}

it("lists Duets as prominent two-line rows under one Duets section, without tree chrome", async () => {
  await using screen = await renderList({});
  const header = screen.container.querySelector('[data-sidebar-row="shelf:captains"]');
  expect(header?.textContent).toBe("Duets");
  const row = screen.getByRole("button", { name: "Maria, Ready, All workspace, Coordinator" });
  await expect.element(row).toBeVisible();
  expect(row.element().className).toContain("h-12");
  const item = row.element().closest("li")!;
  expect(getComputedStyle(item, "::before").content).toBe("none");
  expect(getComputedStyle(row.element()).boxShadow).toBe("none");
  const avatar = row.element().querySelector<HTMLElement>("[data-captain-avatar]")!;
  expect(avatar.hasAttribute("data-captain-disc")).toBe(false);
  expect(avatar.className).toContain("size-7");
  expect(getComputedStyle(avatar).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

it("shows an idle channel's scope and compact activity time, with its details on hover", async () => {
  await using screen = await renderList({});
  const row = screen.getByRole("button", { name: "Maria, Ready, All workspace, Coordinator" });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toBe("Maria10mAll workspace");
  const avatar = row.element().querySelector("[data-captain-avatar]");
  expect(avatar?.getAttribute("data-captain-state")).toBe("idle");
  expect(avatar?.querySelector("[data-captain-creature-line]")).not.toBeNull();
  expect(avatar?.querySelector("[data-captain-mascot-eyes]")).toBeNull();
  expect(screen.container.querySelector("[data-duet-live]")).toBeNull();

  await userEvent.hover(row);
  const card = page.getByText("Coordinator", { exact: true });
  await expect.element(card).toBeVisible();
  await expect.element(page.getByText("All workspace", { exact: true }).last()).toBeVisible();
  await expect.element(page.getByText("Ready", { exact: true })).toBeVisible();
});

it("shows a working status with one live task's title", async () => {
  await using screen = await renderList({ working: true, children: [child] });
  const row = screen.getByRole("button", { name: "Maria, Working, 1 running, Fix the login flow" });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toBe("MariaWorkingFix the login flow");
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

it("gives needs input precedence over working with an amber status and count", async () => {
  const waiting = { ...child, hasPendingUserInput: true };
  await using screen = await renderList({ attention: 1, working: true, children: [waiting] });
  const row = screen.getByRole("button", { name: "Maria, Needs input, Fix the login flow" });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toBe("Maria1Needs inputFix the login flow");
  expect(screen.container.querySelector('[data-captain-state="waiting"]')).not.toBeNull();
  expect(
    row.element().querySelector('[data-duet-live="needs-input"]')?.getAttribute("aria-label"),
  ).toBe("1 request");
  expect(
    screen.container
      .querySelector('[data-sidebar-row="shelf:captains"] [data-duet-live="needs-input"]')
      ?.getAttribute("aria-label"),
  ).toBe("1 Duet needs input");
});

it("shows the scoped project's favicon and name when quiet", async () => {
  const project = {
    id: ProjectId.make("project"),
    environmentId,
    title: "KSG Code",
    workspaceRoot: "/repo/ksgcode",
    faviconPath: null,
    projectIcon: null,
  } as ReturnType<typeof useProjects>[number];
  const scopedCaptain = { ...captain, scopedProjectIds: [project.id] };
  await using screen = await renderList({ captain: scopedCaptain }, { projects: [project] });
  const row = screen.getByRole("button", {
    name: "Maria, Ready, KSG Code, Coordinator",
  });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toContain("KSG Code");
});

it("adds the environment label when Duets span machines", async () => {
  await using screen = await renderList({ label: "Mac Studio" });
  const row = screen.getByRole("button", {
    name: "Maria, Ready, Mac Studio, All workspace, Coordinator",
  });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toBe("Maria10mAll workspaceMac Studio");
});

it("recedes an archived channel without live status", async () => {
  await using screen = await renderList({
    captain: { ...captain, archivedAt: DateTime.formatIso(now) },
    attention: 1,
    working: true,
  });
  const row = screen.getByRole("button", { name: "Maria, Archived" });
  await expect.element(row).toBeVisible();
  expect(row.element().textContent).toBe("MariaArchived");
  expect(screen.container.querySelector('[data-captain-state="archived"]')).not.toBeNull();
  expect(screen.container.querySelector("[data-duet-live]")).toBeNull();
});

it("opens the Duets page from the section label, which counts Duets needing input", async () => {
  const onOpenOverview = vi.fn();
  window.localStorage.removeItem(duetOrderStorageKey);
  vi.mocked(useProjects).mockReturnValue([]);
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
  await expect.element(screen.getByLabelText("1 Duet needs input")).toHaveTextContent("1");
  const link = screen.container.querySelector<HTMLElement>("[data-captains-overview-link]")!;
  expect(link.textContent).toBe("Duets1");
  await userEvent.click(link);
  expect(onOpenOverview).toHaveBeenCalledOnce();
});

it("drags Duets into a device order that later renders use", async () => {
  const ada = captainNamed("ada", "Ada");
  const rows = [
    { environmentId, captain: ada, attention: 0, working: false },
    { environmentId, captain, attention: 0, working: false },
  ];
  await using screen = await renderList({}, { rows });
  expect(rowOrder(screen.container).map((text) => text.startsWith("Ada"))).toEqual([true, false]);
  const first = screen.getByRole("button", { name: /Ada,/ }).element() as HTMLElement;
  await pointerDrag(first);

  await vi.waitFor(() => {
    expect(window.localStorage.getItem(duetOrderStorageKey)).toBe(
      JSON.stringify([`${environmentId}:maria`, `${environmentId}:ada`]),
    );
  });
  await vi.waitFor(() => {
    expect(rowOrder(screen.container).map((text) => text.startsWith("Maria"))).toEqual([
      true,
      false,
    ]);
  });
});

it("does not start a drag when the pointer starts on a row action", async () => {
  const ada = captainNamed("ada", "Ada");
  const rows = [
    { environmentId, captain: ada, attention: 0, working: false },
    { environmentId, captain, attention: 0, working: false },
  ];
  await using screen = await renderList({}, { rows });
  const action = screen.getByRole("button", { name: "Actions for Ada" }).element() as HTMLElement;

  const rowHeight = action.closest("[data-duet-channel-card]")!.getBoundingClientRect().height;
  await pointerDrag(action, rowHeight);

  expect(window.localStorage.getItem(duetOrderStorageKey)).toBeNull();
  expect(rowOrder(screen.container).map((text) => text.startsWith("Ada"))).toEqual([true, false]);
});

it("moves Duets from the row menu and persists the order", async () => {
  const ada = captainNamed("ada", "Ada");
  const archived = {
    ...captainNamed("renata", "Renata"),
    archivedAt: DateTime.formatIso(now),
  };
  const rows = [
    { environmentId, captain: ada, attention: 0, working: false },
    { environmentId, captain, attention: 0, working: false },
    { environmentId, captain: archived, attention: 0, working: false },
  ];
  await using screen = await renderList({}, { rows });
  const openActions = async (name: string) => {
    await userEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  };
  const moveUp = () => page.getByRole("menuitem", { name: "Move up", exact: true });
  const moveDown = () => page.getByRole("menuitem", { name: "Move down", exact: true });

  await openActions("Ada");
  await expect.element(moveUp()).toHaveAttribute("aria-disabled", "true");
  await expect.element(moveDown()).not.toHaveAttribute("aria-disabled", "true");
  await userEvent.click(moveDown());

  const expectedOrder = [
    `${environmentId}:maria`,
    `${environmentId}:ada`,
    `${environmentId}:renata`,
  ];
  await vi.waitFor(() => {
    expect(window.localStorage.getItem(duetOrderStorageKey)).toBe(JSON.stringify(expectedOrder));
  });
  await vi.waitFor(() => {
    expect(rowOrder(screen.container).map((text) => text.startsWith("Maria"))).toEqual([
      true,
      false,
      false,
    ]);
  });

  await openActions("Ada");
  await expect.element(moveUp()).not.toHaveAttribute("aria-disabled", "true");
  await expect.element(moveDown()).toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("{Escape}");

  await openActions("Renata");
  await expect.element(moveUp()).toHaveAttribute("aria-disabled", "true");
  await expect.element(moveDown()).toHaveAttribute("aria-disabled", "true");
});
