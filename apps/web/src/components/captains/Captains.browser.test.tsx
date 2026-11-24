import {
  CaptainId,
  CaptainMemoryId,
  EnvironmentId,
  ThreadId,
  type Captain,
  type CaptainDocument,
  type CaptainSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { userEvent, type Locator } from "vite-plus/test/browser";
import { render } from "../../../test/render";

const live = vi.hoisted(() => ({ data: null as CaptainSnapshot | null }));
vi.mock(import("./useCaptain"), async (importOriginal) => ({
  ...(await importOriginal()),
  useCaptains: () => ({
    data: live.data,
    dataUpdatedAt: 0,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: live.data !== null,
    refresh: () => {},
  }),
}));

import { CaptainBriefPanel } from "./CaptainBriefPanel";
import { CaptainShelfList } from "./CaptainsShelf";

const environmentId = EnvironmentId.make("environment");
const captain = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:0"),
  earlierThreadIds: [ThreadId.make("earlier")],
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

async function activate(locator: Locator) {
  (locator.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
}

it("shows collapsed Captain attention and opens the primary thread on selection", async () => {
  const open = vi.fn();
  await using screen = await render(
    <ul>
      <CaptainShelfList
        rows={[{ environmentId, captain, attention: 1, working: true }]}
        activeThread={null}
        onOpen={open}
        onCreate={() => {}}
      />
    </ul>,
  );
  await expect.element(screen.getByRole("button", { name: /Maria, Needs input/ })).toBeVisible();
  await activate(screen.getByRole("button", { name: /^Crew/ }));
  await expect.element(screen.getByLabelText("1 Captain needs input")).toBeVisible();
  await expect.element(screen.getByText("Maria")).not.toBeInTheDocument();
  await activate(screen.getByRole("button", { name: /^Crew/ }));
  await activate(screen.getByRole("button", { name: /Maria, Needs input/ }));
  expect(open).toHaveBeenCalledWith(threadRef);
});

it("opens Brief, server documents with revisions, and locked memory", async () => {
  const notes = {
    captainId: captain.id,
    name: "NOTES.md",
    content: "Check the release.",
    revision: 4,
    updatedAt: captain.updatedAt,
  } satisfies CaptainDocument;
  live.data = {
    captains: [captain],
    documents: [notes],
    memories: [
      {
        captainId: captain.id,
        id: CaptainMemoryId.make("locked"),
        text: "Keep the patch small.",
        essential: true,
        userControlled: true,
        createdAt: captain.createdAt,
        updatedAt: captain.updatedAt,
      },
    ],
  };
  await using screen = await render(
    <CaptainBriefPanel threadRef={threadRef} onDelete={() => {}} />,
  );
  await expect.element(screen.getByText("Workspace scope")).toBeVisible();
  await expect.element(screen.getByText("Earlier conversations")).toBeVisible();
  await activate(screen.getByRole("tab", { name: "Docs" }));
  await expect
    .element(screen.getByRole("textbox", { name: "NOTES.md" }))
    .toHaveValue("Check the release.");
  await expect.element(screen.getByText("Server revision 4")).toBeVisible();
  await activate(screen.getByRole("button", { name: "AGENTS.md" }));
  await expect.element(screen.getByRole("textbox", { name: "AGENTS.md" })).toHaveValue("");
  await activate(screen.getByRole("tab", { name: "Memory" }));
  await expect.element(screen.getByText("Keep the patch small.")).toBeVisible();
  await expect.element(screen.getByText("Locked")).toBeVisible();
  await expect.element(screen.getByText("Essential", { exact: true })).toBeVisible();
});
