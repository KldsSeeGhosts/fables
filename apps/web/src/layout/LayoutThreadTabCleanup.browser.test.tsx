import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { makeThreadProjectionFixture } from "../test-fixtures";
import * as entities from "../state/entities";
import * as shell from "../state/shell";
import { LayoutThreadTabCleanup } from "./LayoutThreadTabCleanup";
import { findLayoutTabByContent } from "./layoutModel";
import { useLayoutStore } from "./layoutStore";

vi.mock(import("../state/entities"), { spy: true });
vi.mock(import("../state/shell"), { spy: true });

function OpenTabs() {
  const layout = useLayoutStore((state) => state.layout);
  return <LayoutThreadTabCleanup layout={layout} />;
}

it("prunes inactive deleted and archived tabs once live state confirms them", async () => {
  const store = useLayoutStore.getState();
  using _store = {
    [Symbol.dispose]: () => useLayoutStore.setState({ layout: store.layout }),
  };
  store.reset();
  const environmentId = EnvironmentId.make("local");
  const chat = (id: string) =>
    ({
      kind: "chat",
      target: { kind: "server", threadRef: scopeThreadRef(environmentId, ThreadId.make(id)) },
    }) as const;
  const archive = chat("archived");
  const deleted = chat("deleted");
  const settled = chat("unlisted-but-present");
  const active = chat("active");
  for (const content of [archive, deleted, settled, active]) store.openTab(content);
  const isOpen = (content: typeof active) =>
    findLayoutTabByContent(useLayoutStore.getState().layout, content) !== null;

  using shellStatus = vi.spyOn(shell, "useEnvironmentShellStatus").mockReturnValue("cached");
  using _unlisted = vi.spyOn(entities, "useQuietThreadShell").mockReturnValue(null);
  using _status = vi.spyOn(entities, "useThreadStatus").mockImplementation((ref) => {
    if (ref?.threadId === deleted.target.threadRef.threadId) return "deleted";
    return ref ? "live" : "empty";
  });
  const projection = makeThreadProjectionFixture();
  using _detail = vi.spyOn(entities, "useQuietThreadProjection").mockImplementation((ref) =>
    ref
      ? {
          environmentId,
          projection: {
            ...projection,
            thread: {
              ...projection.thread,
              archivedAt:
                ref.threadId === archive.target.threadRef.threadId
                  ? projection.thread.createdAt
                  : null,
            },
          },
        }
      : null,
  );

  await using screen = await render(<OpenTabs />);
  expect(isOpen(archive)).toBe(true);
  expect(isOpen(deleted)).toBe(true);

  shellStatus.mockReturnValue("live");
  await screen.rerender(<OpenTabs key="live" />);
  expect(isOpen(archive)).toBe(false);
  expect(isOpen(deleted)).toBe(false);
  expect(isOpen(settled)).toBe(true);
  expect(isOpen(active)).toBe(true);
});
