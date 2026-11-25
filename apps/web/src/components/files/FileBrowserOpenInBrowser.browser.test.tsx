import { EnvironmentId, type ProjectEntry } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { dismissContextMenu } from "~/contextMenuFallback";
import { render } from "../../../test/render";
import FileBrowserPanel from "./FileBrowserPanel";

const state = vi.hoisted(() => ({
  openInEditor: vi.fn(),
}));

const entries: readonly ProjectEntry[] = [{ path: "page.html", kind: "file" }];
const directory = {
  entries,
  load: () => Promise.resolve(),
  refresh: () => {},
  ready: true,
  error: null,
  isPending: false,
  loadingDirectories: new Set<string>(),
};
const pathSearch = {
  entries: [],
  isPending: false,
  error: null,
  truncated: false,
  refresh: () => {},
};

vi.mock("./useDirectoryEntries", () => ({ useDirectoryEntries: () => directory }));
vi.mock("~/state/queries", () => ({ useProjectPathSearch: () => pathSearch }));
vi.mock("~/hooks/useWorkspaceMutationRefresh", () => ({ useWorkspaceMutationRefresh: () => {} }));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.openInEditor) as never,
}));
vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const config = Atom.make({ availableEditors: ["file-manager"] });
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => config) as never },
  };
});
vi.mock(import("~/remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));

function findTreeRow(path: string): HTMLElement | null {
  for (const host of document.querySelectorAll("*")) {
    const row = host.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);
    if (row) return row;
  }
  return null;
}

describe("FileBrowserPanel open in browser", () => {
  it("offers Open in browser for an HTML file and opens it through the local file-manager path", async () => {
    state.openInEditor.mockReset().mockResolvedValue(AsyncResult.success(undefined));
    const environmentId = EnvironmentId.make("env-files");
    await using _screen = await render(
      <FileBrowserPanel
        environmentId={environmentId}
        cwd="/repo"
        projectName="repo"
        selectedPath={null}
        selectedPathRevealId={0}
        onOpenFile={() => {}}
        workspaceMutationId={null}
      />,
    );
    using _menu = { [Symbol.dispose]: () => dismissContextMenu() };

    await vi.waitFor(() => expect(findTreeRow("page.html")).not.toBeNull());
    findTreeRow("page.html")!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 2,
      }),
    );
    const action = page.getByRole("menuitem", { name: "Open in browser", exact: true });
    await expect.element(action).toBeVisible();
    await userEvent.click(action);

    await vi.waitFor(() =>
      expect(state.openInEditor).toHaveBeenCalledWith({
        environmentId,
        input: { cwd: "/repo/page.html", editor: "file-manager" },
      }),
    );
  });
});
