import { describe, expect, it } from "vite-plus/test";

import { canOpenFileInBrowserLocally } from "./openFileInBrowser";

describe("canOpenFileInBrowserLocally", () => {
  it("allows browser-previewable files only for a resolved local execution environment", () => {
    const input = {
      filePath: "docs/page.html",
      availableEditors: ["file-manager" as const],
    };
    expect(
      canOpenFileInBrowserLocally({
        ...input,
        remoteOpen: { state: { mode: "local-exec" }, isResolved: true },
      }),
    ).toBe(true);
    expect(
      canOpenFileInBrowserLocally({
        ...input,
        remoteOpen: { state: { mode: "local-exec" }, isResolved: false },
      }),
    ).toBe(false);
    expect(
      canOpenFileInBrowserLocally({
        ...input,
        remoteOpen: {
          state: { mode: "remote-links", host: { kind: "tailscale", host: "example" } },
          isResolved: true,
        },
      }),
    ).toBe(false);
    expect(
      canOpenFileInBrowserLocally({
        ...input,
        filePath: "docs/page.ts",
        remoteOpen: { state: { mode: "local-exec" }, isResolved: true },
      }),
    ).toBe(false);
  });
});
