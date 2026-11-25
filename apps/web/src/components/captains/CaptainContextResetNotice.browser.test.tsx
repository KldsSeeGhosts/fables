import {
  CaptainId,
  EnvironmentId,
  ThreadId,
  type Captain,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

const state = vi.hoisted(() => ({
  captain: null as Captain | null,
  canReset: true,
}));

const allowed = Atom.make(true);
const denied = Atom.make(false);
vi.mock(import("../../state/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      resetCaptainConversation: {
        run: vi.fn(),
        permissionAtom: () => (state.canReset ? allowed : denied),
        label: "test command",
      },
    } as never,
  };
});

vi.mock(import("./useCaptain"), async (importOriginal) => ({
  ...(await importOriginal()),
  useCaptain: ((threadRef: ScopedThreadRef | null) =>
    threadRef?.threadId === state.captain?.primaryThreadId ? state.captain : undefined) as never,
}));

import { CaptainContextResetNotice } from "./CaptainContextResetNotice";

const environmentId = EnvironmentId.make("environment");
const captain = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:0"),
  earlierThreadIds: [ThreadId.make("captain:maria:1")],
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

function setup(value: Captain | null = captain, canReset = true) {
  state.captain = value;
  state.canReset = canReset;
}

function notice(percent: number | null, ref: ScopedThreadRef | null = threadRef) {
  return (
    <CaptainContextResetNotice threadRef={ref} usedPercentage={percent} onOpenThread={() => {}} />
  );
}

it("shows at 80%, stays dismissed at 85%, and returns without a dismiss action at 92%", async () => {
  setup();
  await using screen = await render(notice(80));

  await expect.element(screen.getByText("This conversation is 80% full.")).toBeVisible();
  await expect
    .element(
      screen.getByText("Start a new one and NOTES.md, memories and running tasks carry over."),
    )
    .toBeVisible();
  const dismiss = screen.getByRole("button", { name: "Dismiss context usage notice" });
  await expect.element(dismiss).toBeVisible();

  await userEvent.click(dismiss);
  await expect.element(screen.getByText("This conversation is 80% full.")).not.toBeInTheDocument();

  await screen.rerender(notice(85));
  await expect.element(screen.getByText("This conversation is 85% full.")).not.toBeInTheDocument();

  await screen.rerender(notice(92));
  await expect.element(screen.getByText("This conversation is 92% full.")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Dismiss context usage notice" }))
    .not.toBeInTheDocument();
});

it("stays hidden below 75%, for non-Duet threads, archived Duets, and earlier conversations", async () => {
  setup();
  await using screen = await render(notice(null));
  await expect.element(screen.getByText(/This conversation is .* full\./)).not.toBeInTheDocument();

  await screen.rerender(notice(60));
  await expect.element(screen.getByText(/This conversation is .* full\./)).not.toBeInTheDocument();

  await screen.rerender(notice(80, { environmentId, threadId: ThreadId.make("thread:regular") }));
  await expect.element(screen.getByText(/This conversation is .* full\./)).not.toBeInTheDocument();

  setup({ ...captain, archivedAt: captain.updatedAt });
  await screen.rerender(notice(80));
  await expect.element(screen.getByText(/This conversation is .* full\./)).not.toBeInTheDocument();

  setup();
  await screen.rerender(notice(80, { environmentId, threadId: ThreadId.make("captain:maria:1") }));
  await expect.element(screen.getByText(/This conversation is .* full\./)).not.toBeInTheDocument();
});

it("stays hidden for a viewer who cannot reset the Duet", async () => {
  setup(captain, false);
  await using screen = await render(notice(95));
  await expect.element(screen.getByText(/This conversation is .* full\./)).not.toBeInTheDocument();
});

it("opens the reset dialog from the new conversation action", async () => {
  setup();
  await using screen = await render(notice(80));

  await userEvent.click(screen.getByRole("button", { name: "New conversation" }));

  await expect
    .element(page.getByRole("alertdialog", { name: "Reset conversation?" }))
    .toBeVisible();
});

it("keeps the reset dialog open when the notice disappears underneath it", async () => {
  setup();
  await using screen = await render(notice(80));

  await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
  await screen.rerender(notice(60));

  await expect.element(screen.getByText(/This conversation is .* full\./)).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("alertdialog", { name: "Reset conversation?" }))
    .toBeVisible();
});
