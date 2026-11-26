import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({ runAction: vi.fn() }));

vi.mock(import("~/state/use-atom-command"), () => ({
  useAtomCommand: (() => state.runAction) as never,
}));

import { PullRequestOperationError } from "@t3tools/contracts";
import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import "~/index.css";
import { render } from "../../../test/render";
import { ToastProvider } from "../ui/toast";
import { PullRequestStackMenu } from "./PullRequestStackMenu";

function setup(detail: string) {
  state.runAction
    .mockReset()
    .mockResolvedValue(
      AsyncResult.failure(
        Cause.fail(new PullRequestOperationError({ operation: "runAction", detail })),
      ),
    );
}

const HEAD_MOVED = "The stack head moved. Refresh the stack before trying again.";

it.each([
  { label: "Merge stack", detail: HEAD_MOVED, description: HEAD_MOVED },
  { label: "Rebase stack", detail: HEAD_MOVED, description: HEAD_MOVED },
  {
    label: "Rebase stack",
    detail: "GitHub CLI command failed.",
    description:
      "The host refused the rebase. A rebase stops at the first commit that does not apply cleanly.",
  },
])("$label refused with $detail shows $description", async (row) => {
  setup(row.detail);
  await using screen = await render(
    <ToastProvider>
      <PullRequestStackMenu
        environmentId={EnvironmentId.make("environment")}
        reference={{
          projectId: ProjectId.make("project"),
          repository: "owner/repository",
          number: 2,
        }}
        hostLabel="GitHub"
        terminology={sourceControlClients.get("github").changeRequest}
        stack={{
          id: "stack",
          number: 1,
          url: "https://github.com/owner/repository/stack/1",
          base: "main",
          layers: [{ number: 2, headBranch: "feature", headSha: "abc123", state: "open" }],
        }}
        canMerge
        stale={false}
        canRebase
        {...stackAutoMergeProps}
        mergeMethod="squash"
        onActed={() => {}}
      />
    </ToastProvider>,
  );
  if (row.label === "Rebase stack") {
    await screen.getByRole("button", { name: "Stack 1, layer 1 of 1" }).click();
    await page.getByRole("menuitem", { name: row.label }).click();
  } else {
    await screen.getByRole("button", { name: row.label, exact: true }).click();
  }
  await page.getByRole("dialog").getByRole("button", { name: row.label, exact: true }).click();
  await expect.element(page.getByText(row.description, { exact: true })).toBeInTheDocument();
});

const stackAutoMergeProps = {
  shownHeadSha: "shown-head",
  canAutoMerge: false,
  preferAutoMerge: false,
  autoMergeArmed: false,
  canCancelAutoMerge: false,
};

it("enables auto-merge through the selected layer and cancels its armed request", async () => {
  setup(HEAD_MOVED);
  const environmentId = EnvironmentId.make("environment");
  const reference = {
    projectId: ProjectId.make("project"),
    repository: "owner/repository",
    number: 2,
  };
  const stack = {
    id: "stack",
    number: 1,
    url: "https://github.com/owner/repository/stack/1",
    base: "main",
    layers: [
      { number: 1, headBranch: "lower", headSha: "lower-head", state: "open" },
      { number: 2, headBranch: "selected", headSha: "current-head", state: "open" },
      { number: 3, headBranch: "upper", headSha: "upper-head", state: "open" },
    ],
  } as const;
  const tree = (armed: boolean) => (
    <ToastProvider>
      <PullRequestStackMenu
        environmentId={environmentId}
        reference={reference}
        hostLabel="GitHub"
        terminology={sourceControlClients.get("github").changeRequest}
        stack={stack}
        canMerge={false}
        stale={false}
        canRebase={false}
        {...stackAutoMergeProps}
        canAutoMerge
        canCancelAutoMerge
        autoMergeArmed={armed}
        mergeMethod="squash"
        onActed={() => {}}
      />
    </ToastProvider>
  );
  await using screen = await render(tree(false));
  const trigger = screen.getByRole("button", { name: "Stack 1, layer 2 of 3" });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Auto-merge stack (2)" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enable auto-merge" }).click();
  await expect.element(page.getByText(HEAD_MOVED, { exact: true })).toBeInTheDocument();
  expect(state.runAction).toHaveBeenNthCalledWith(1, {
    environmentId,
    input: {
      ...reference,
      stackNumber: 1,
      action: "enable-auto-merge",
      mergeMethod: "squash",
      expectedHeadSha: "shown-head",
      expectedStackHeads: [
        { number: 1, headSha: "lower-head" },
        { number: 2, headSha: "current-head" },
      ],
    },
  });

  await screen.rerender(tree(true));
  await trigger.click();
  await page.getByRole("menuitem", { name: "Cancel stack auto-merge" }).click();
  expect(state.runAction).toHaveBeenNthCalledWith(2, {
    environmentId,
    input: { ...reference, stackNumber: 1, action: "disable-auto-merge" },
  });
});
