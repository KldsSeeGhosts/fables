import { describe, expect, it } from "vite-plus/test";

import { duetOverflowMenu } from "./duetConversationMenu";

const noop = () => {};

describe("duetOverflowMenu", () => {
  it("leads with Run on, then Terminal, Browser and Diff", () => {
    const menu = duetOverflowMenu({
      environmentLabel: "Mac Studio",
      terminal: { title: "Terminal", icon: "terminal", items: [] },
      onOpenBrowser: noop,
      diff: { id: "git-review", title: "Review changes", onPress: noop },
      files: { id: "files", title: "Open files", onPress: noop },
    });
    expect(menu.items.map(({ id }) => id)).toEqual([
      "run-on",
      "terminal",
      "browser",
      "diff",
      "files",
    ]);
    expect(menu.items[0]).toMatchObject({ title: "Run on", subtitle: "Mac Studio" });
  });

  it("leaves out what the thread has none of", () => {
    const menu = duetOverflowMenu({
      environmentLabel: null,
      terminal: null,
      onOpenBrowser: null,
      diff: { id: "git-review", title: "Review changes", onPress: noop },
      files: null,
    });
    expect(menu.items.map(({ id }) => id)).toEqual(["diff"]);
  });
});
