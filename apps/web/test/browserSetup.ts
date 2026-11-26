import { beforeEach } from "vite-plus/test";
import { commands } from "vite-plus/test/browser";

import { initializeI18n } from "../src/i18n/initializeI18n";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Defined in vite.config.ts. Moves Playwright's mouse off the page. */
    resetPointer: () => Promise<void>;
    /** Defined in vite.config.ts. Presses the primary button where the mouse is, without releasing. */
    pointerDown: () => Promise<void>;
    /** Defined in vite.config.ts. Releases the primary button. */
    pointerUp: () => Promise<void>;
  }
}

// Playwright's mouse outlives each test and each file, so whatever the next test mounts
// under its last position starts hovered. Registered here rather than in render() so tests
// that mount without it are covered too. Before each test, not after: a timed-out test keeps
// running and can move the mouse after its own afterEach.
beforeEach(async () => {
  await commands.resetPointer();
});

// Layout tests measure the stock look; without a stored theme this fork boots into KSG Salon.
if (window.localStorage.getItem("t3code:theme") === null) {
  window.localStorage.setItem("t3code:theme", "system");
}

// The app initializes GT at startup; components using its hooks need the same here.
initializeI18n(() => {});
