import { expect, it } from "vite-plus/test";

import { isDuetShellTheme } from "./duetShell";

it("uses Duet naming only for the KSG Salon theme", () => {
  expect(isDuetShellTheme("ksg-salon")).toBe(true);
  expect(isDuetShellTheme("t3-chat")).toBe(false);
  expect(isDuetShellTheme("material-you")).toBe(false);
});
