import {
  CaptainId,
  CaptainMemoryId,
  EnvironmentId,
  ThreadId,
  type Captain,
  type CaptainDocument,
  type CaptainMemory,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { userEvent, type Locator } from "vite-plus/test/browser";
import { render } from "../../../test/render";

import { SidebarProvider } from "../ui/sidebar";
import { CaptainDocuments } from "./CaptainDocuments";
import { CaptainMemories } from "./CaptainMemories";
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
  coordinatorOnly: false,
  kind: "duet",
  createdAt: DateTime.formatIso(DateTime.makeUnsafe("2026-11-24")),
  updatedAt: DateTime.formatIso(DateTime.makeUnsafe("2026-11-24")),
  archivedAt: null,
} satisfies Captain;
const threadRef = { environmentId, threadId: captain.primaryThreadId };

async function activate(locator: Locator) {
  (locator.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
}

it("shows Captain attention on the section and opens the primary thread on selection", async () => {
  const open = vi.fn();
  await using screen = await render(
    <SidebarProvider>
      <ul>
        <CaptainShelfList
          rows={[{ environmentId, captain, attention: 1, working: true }]}
          activeThread={null}
          onOpen={open}
          onCreate={() => {}}
        />
      </ul>
    </SidebarProvider>,
  );
  await expect.element(screen.getByRole("button", { name: /Maria, Needs input/ })).toBeVisible();
  await expect.element(screen.getByLabelText("1 Duet needs input")).toBeVisible();
  await activate(screen.getByRole("button", { name: /Maria, Needs input/ }));
  expect(open).toHaveBeenCalledWith(threadRef);
});

it("opens Duet documents in the Memory editor and shows locked memory", async () => {
  const notes = {
    captainId: captain.id,
    name: "NOTES.md",
    content: "Check the release.",
    revision: 4,
    updatedAt: captain.updatedAt,
  } satisfies CaptainDocument;
  const memory = {
    captainId: captain.id,
    id: CaptainMemoryId.make("locked"),
    text: "Keep the patch small.",
    essential: true,
    userControlled: true,
    createdAt: captain.createdAt,
    updatedAt: captain.updatedAt,
  } satisfies CaptainMemory;
  await using screen = await render(
    <>
      <CaptainDocuments details={{ captain, documents: [notes] }} environmentId={environmentId} />
      <CaptainMemories captainId={captain.id} environmentId={environmentId} memories={[memory]} />
    </>,
  );
  await activate(screen.getByRole("button", { name: /NOTES\.md/ }));
  await expect
    .element(screen.getByRole("textbox", { name: "NOTES.md" }))
    .toHaveValue("Check the release.");
  await activate(screen.getByRole("button", { name: "Back to documents" }));
  await activate(screen.getByRole("button", { name: /AGENTS\.md/ }));
  await expect.element(screen.getByRole("textbox", { name: "AGENTS.md" })).toHaveValue("");
  await expect.element(screen.getByText("Keep the patch small.")).toBeVisible();
  await expect.element(screen.getByText("Locked")).toBeVisible();
  await expect.element(screen.getByText("Essential", { exact: true })).toBeVisible();
});
