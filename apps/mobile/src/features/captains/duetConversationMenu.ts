import { msg } from "gt-react-native";

import type { AppBarMenu, AppBarMenuItem } from "../../components/ui/AppBar.types";
import { m, type MessageResolver } from "../../i18n/messages";

/**
 * The folded Duet conversation's ⋯ menu: where it runs first, then Terminal, Browser and Diff,
 * as the desktop details panel groups them. Each tool is left out where the thread has none.
 */
export function duetOverflowMenu(
  input: {
    readonly environmentLabel: string | null;
    readonly terminal: AppBarMenu | null;
    readonly onOpenBrowser: (() => void) | null;
    readonly diff: AppBarMenuItem | null;
    readonly files: AppBarMenuItem | null;
  },
  resolve: MessageResolver = m,
): AppBarMenu {
  const items: AppBarMenuItem[] = [
    ...(input.environmentLabel === null
      ? []
      : [
          {
            id: "run-on",
            title: resolve(msg("Run on", { $context: "the machine a Duet runs on" })),
            subtitle: input.environmentLabel,
            icon: "desktopcomputer",
            disabled: true,
            onPress: () => {},
          },
        ]),
    ...(input.terminal === null
      ? []
      : [
          {
            id: "terminal",
            title: input.terminal.title,
            icon: "terminal",
            items: input.terminal.items,
          },
        ]),
    ...(input.onOpenBrowser === null
      ? []
      : [
          {
            id: "browser",
            title: resolve(msg("Browser")),
            icon: "safari",
            onPress: input.onOpenBrowser,
          },
        ]),
    ...(input.diff === null
      ? []
      : [{ ...input.diff, id: "diff", title: resolve(msg("Diff")), icon: "file.diff" }]),
    ...(input.files === null ? [] : [input.files]),
  ];
  return {
    title: resolve(msg("More actions")),
    icon: "ellipsis",
    separateBackground: false,
    inlineWhenGrouped: true,
    items,
  };
}
