import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { DuetStatusPopover, useDuetThreadStatus } from "./DuetThreadStatus";

function StatusHarness({ threadRef }: { threadRef: ScopedThreadRef }) {
  const status = useDuetThreadStatus(threadRef);
  return (
    <DuetStatusPopover
      threadRef={threadRef}
      status={status}
      mark={null}
      trigger={<button type="button" aria-label={`Status: ${status.stateText}`} />}
    />
  );
}

it("opens the live status popover from its trigger", async () => {
  const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));
  await using screen = await render(<StatusHarness threadRef={threadRef} />);
  await screen.getByRole("button", { name: "Status: Idle" }).click();

  await expect.element(page.getByRole("dialog")).toBeVisible();
  await expect.element(page.getByRole("dialog").getByText("Idle", { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("dialog").getByRole("button", { name: "Open Tasks" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("dialog").getByText("environment", { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("dialog").getByText("Unknown", { exact: true }))
    .toBeVisible();
});
