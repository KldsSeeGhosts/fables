import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { useDuetShell } from "./useDuetShell";
import { setAppearanceMode, setTheme, useTheme } from "./useTheme";

function DuetProbe() {
  const isDuet = useDuetShell();
  const { setThemeHalf, clearThemeHalves } = useTheme();
  return (
    <div>
      <div data-testid="duet-probe">{isDuet ? "duet" : "standard"}</div>
      <button type="button" onClick={() => setThemeHalf("dark", "ksg-salon")}>
        Assign dark ksg-salon
      </button>
      <button type="button" onClick={() => setThemeHalf("light", "ksg-salon")}>
        Assign light ksg-salon
      </button>
      <button type="button" onClick={() => clearThemeHalves()}>
        Clear halves
      </button>
    </div>
  );
}

function resetThemeScope(): Disposable {
  return {
    [Symbol.dispose]() {
      window.localStorage.clear();
      setTheme("t3-chat");
      setAppearanceMode("light");
    },
  };
}

describe("useDuetShell", () => {
  it("is true when ksg-salon is selected directly", async () => {
    using _reset = resetThemeScope();
    setTheme("ksg-salon");
    await using screen = await render(<DuetProbe />);
    await expect.element(screen.getByTestId("duet-probe")).toHaveTextContent("duet");
  });

  it("is true when ksg-salon is assigned to the active appearance half", async () => {
    using _reset = resetThemeScope();
    setTheme("claude");
    setAppearanceMode("dark");

    await using screen = await render(<DuetProbe />);
    await expect.element(screen.getByTestId("duet-probe")).toHaveTextContent("standard");

    await userEvent.click(screen.getByRole("button", { name: "Assign dark ksg-salon" }));
    await expect.element(screen.getByTestId("duet-probe")).toHaveTextContent("duet");

    setAppearanceMode("light");
    await expect.element(screen.getByTestId("duet-probe")).toHaveTextContent("standard");

    await userEvent.click(screen.getByRole("button", { name: "Assign light ksg-salon" }));
    await expect.element(screen.getByTestId("duet-probe")).toHaveTextContent("duet");

    await userEvent.click(screen.getByRole("button", { name: "Clear halves" }));
    await expect.element(screen.getByTestId("duet-probe")).toHaveTextContent("standard");
  });

  it("is false for non-duet themes", async () => {
    using _reset = resetThemeScope();
    setTheme("claude");
    setAppearanceMode("dark");
    await using screen = await render(<DuetProbe />);
    await expect.element(screen.getByTestId("duet-probe")).toHaveTextContent("standard");
  });
});
