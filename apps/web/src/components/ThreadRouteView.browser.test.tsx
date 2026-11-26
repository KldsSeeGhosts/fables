import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CaptainId, EnvironmentId, ThreadId, type Captain } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import { ThreadRouteView } from "./ThreadRouteView";

const live = vi.hoisted(() => ({
  captain: undefined as Captain | undefined,
  listeners: new Set<() => void>(),
}));

vi.mock(import("./captains/useCaptain"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    live.listeners.add(listener);
    return () => {
      live.listeners.delete(listener);
    };
  };
  const read = () => live.captain;
  const useLive = () => useSyncExternalStore(subscribe, read, read);
  return {
    ...(await original()),
    useCaptain: (ref) => {
      const captain = useLive();
      return captain?.primaryThreadId === ref?.threadId ? captain : undefined;
    },
    useCaptainPrimaryReplacement: (ref) => {
      const captain = useLive();
      return ref !== null && captain?.earlierThreadIds.includes(ref.threadId)
        ? captain.primaryThreadId
        : undefined;
    },
  };
});

vi.mock(import("./ChatView"), () => ({
  default: (props) => (
    <div>
      <p>{props.threadId}</p>
      {"earlierConversationJustEnded" in props &&
      props.earlierConversationJustEnded !== undefined ? (
        <p>{`Ended: ${props.earlierConversationJustEnded}`}</p>
      ) : null}
    </div>
  ),
}));

vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: (ref) => (ref === null ? null : ({ deletedAt: null } as never)),
  useEnvironmentThreadRefs: () => [],
  useAnyEnvironmentHiding: () => false,
}));
vi.mock(import("../state/shell"), async (original) => ({
  ...(await original()),
  useEnvironmentShellStatus: () => "live",
}));

const environmentId = EnvironmentId.make("local");
const original = ThreadId.make("captain:maria:0");
const replacement = ThreadId.make("captain:maria:1");

const rootRoute = createRootRoute();
const thread = createRoute({
  getParentRoute: () => rootRoute,
  path: "$environmentId/$threadId",
  component: function PlainRoute() {
    const params = useParams({ strict: false });
    if (params.environmentId === undefined || params.threadId === undefined) return null;
    return (
      <ThreadRouteView
        target={{
          kind: "server",
          threadRef: scopeThreadRef(
            EnvironmentId.make(params.environmentId),
            ThreadId.make(params.threadId),
          ),
        }}
      />
    );
  },
});

it("follows a live rollover on a plain route and allows explicit navigation back", async () => {
  const captain = {
    id: CaptainId.make("maria"),
    primaryThreadId: original,
    earlierThreadIds: [],
    name: "Maria",
    role: "Coordinator",
    instructions: "",
    avatar: { preset: "compass", color: "violet" },
    scopedProjectIds: [],
    reportPolicy: "context",
    coordinatorOnly: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  } satisfies Captain;
  live.captain = captain;
  const router = createRouter({
    routeTree: rootRoute.addChildren([thread]),
    history: createMemoryHistory({ initialEntries: [`/${environmentId}/${original}`] }),
  });
  await router.load();
  // This test brings its own router to exercise a real route change.
  await using screen = await render(<RouterProvider router={router} />, { router: false });
  await expect.element(screen.getByText(original, { exact: true })).toBeVisible();

  await act(() => {
    live.captain = { ...captain, primaryThreadId: replacement, earlierThreadIds: [original] };
    for (const notify of live.listeners) notify();
  });
  await expect.element(screen.getByText(replacement, { exact: true })).toBeVisible();
  await expect.element(screen.getByText(`Ended: ${original}`, { exact: true })).toBeVisible();

  await act(() =>
    router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: original },
    }),
  );
  await expect.element(screen.getByText(original, { exact: true })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/${environmentId}/${encodeURIComponent(original)}`);
  await expect
    .element(screen.getByText(`Ended: ${original}`, { exact: true }))
    .not.toBeInTheDocument();
});
