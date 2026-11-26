import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { ToolCallVisibilitySettingsRows } from "./SettingsPanels";

const state = vi.hoisted(() => ({ duetShell: false }));

vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => DEFAULT_UNIFIED_SETTINGS) as never,
  useUpdateScopedSettings: (() => vi.fn()) as never,
}));
vi.mock(import("../../hooks/useDuetShell"), () => ({
  useDuetShell: () => state.duetShell,
}));

it.each([
  [false, "In Duets"],
  [true, "In Duets"],
] as const)("renders the Duet tool-call control as %s", async (duetShell, label) => {
  state.duetShell = duetShell;
  await using screen = await render(<ToolCallVisibilitySettingsRows />);
  await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("combobox", { name: label })).toBeVisible();
  await expect.element(screen.getByText("Tool calls in chat", { exact: true })).toBeVisible();
});
