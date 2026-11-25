import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

vi.mock(import("../../hooks/useDuetShell"), () => ({ useDuetShell: () => true }));
vi.mock(import("../../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  usePullRequestsSupported: () => true,
  useIssuesSupported: () => true,
}));

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SidebarChromeFooter } from "./SidebarChrome";

it("gives the Duet footer icon-only utilities and the appearance toggle, without overflow menus", async () => {
  await using screen = await render(
    <SidebarProvider>
      <SidebarChromeFooter />
    </SidebarProvider>,
    { router: "/" },
  );

  const footer = screen.container.querySelector<HTMLElement>("[data-duet-sidebar-footer]")!;
  await vi.waitFor(() => expect(footer.querySelectorAll("button").length).toBeGreaterThan(0));
  const labels = Array.from(footer.querySelectorAll("button")).map((button) =>
    button.getAttribute("aria-label"),
  );
  expect(labels.slice(0, 4)).toEqual(["Settings", "Pull requests", "Issues", "Usage"]);
  expect(labels.at(-1)).toMatch(/^Use (light|dark) appearance$/);
  expect(labels).not.toContain("Sidebar actions");
  expect(labels).not.toContain("Linked environments");
  for (const button of footer.querySelectorAll("button")) {
    expect(button.textContent?.trim()).toBe("");
  }

  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  await vi.waitFor(() => expect(screen.router!.state.location.pathname).toBe("/settings"));
});
