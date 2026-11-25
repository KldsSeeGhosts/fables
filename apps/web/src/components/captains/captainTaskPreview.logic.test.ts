import { describe, expect, it } from "vite-plus/test";

import {
  TASK_PREVIEW_DATA_URL_MAX_CHARS,
  taskPreviewImageSource,
} from "./captainTaskPreview.logic";

const workspaceRoot = "/workspace";

describe("taskPreviewImageSource", () => {
  it("returns null when the result has no usable image", () => {
    expect(taskPreviewImageSource("", workspaceRoot)).toBeNull();
    expect(taskPreviewImageSource("Fixed the task.", workspaceRoot)).toBeNull();
    expect(
      taskPreviewImageSource("[not an image](https://example.com/page)", workspaceRoot),
    ).toBeNull();
    expect(
      taskPreviewImageSource("![blob](blob:https://example.com/image)", workspaceRoot),
    ).toBeNull();
  });

  it("returns one usable image source", () => {
    expect(
      taskPreviewImageSource("Done.\n\n![result](https://example.com/result.png)", workspaceRoot),
    ).toBe("https://example.com/result.png");
    expect(taskPreviewImageSource("![result](screenshots/result.png)", workspaceRoot)).toBe(
      "screenshots/result.png",
    );
  });

  it("returns the last usable image source", () => {
    expect(
      taskPreviewImageSource(
        [
          "![first](https://example.com/first.png)",
          "![second](https://example.com/second.png)",
          "![blocked](blob:https://example.com/blocked.png)",
        ].join("\n\n"),
        workspaceRoot,
      ),
    ).toBe("https://example.com/second.png");
  });

  it("skips a data URL over the cap", () => {
    const oversized = `data:image/png;base64,${"A".repeat(TASK_PREVIEW_DATA_URL_MAX_CHARS)}`;
    expect(
      taskPreviewImageSource(
        `![fallback](https://example.com/fallback.png)\n\n![oversized](${oversized})`,
        workspaceRoot,
      ),
    ).toBe("https://example.com/fallback.png");
  });
});
