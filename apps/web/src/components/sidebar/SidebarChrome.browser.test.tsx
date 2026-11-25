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

it("keeps the Duet footer to one compact row of icon-only utilities", async () => {
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
  expect(labels.some((label) => label?.startsWith("Use "))).toBe(false);
  expect(labels).not.toContain("Sidebar actions");
  expect(labels).not.toContain("Linked environments");
  expect(footer.lastElementChild?.tagName).toBe("UL");
  expect(footer.lastElementChild?.className).toContain("flex-1");
  for (const button of footer.querySelectorAll("button")) {
    expect(button.textContent?.trim()).toBe("");
  }

  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  await vi.waitFor(() => expect(screen.router!.state.location.pathname).toBe("/settings"));
});
