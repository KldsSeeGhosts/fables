import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabelsCopy";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";
import { linkedThreadTitle } from "../linkedThreadSurface";

import type { LayoutPageContent } from "./layoutModel";
import type { RightPanelSurface } from "../rightPanelStore";

const pageTabTitles = {
  settings: msg("Settings"),
  usage: msg("Usage"),
  issues: msg("Issues", { $context: "sidebar link to the list of issues" }),
  workflows: msg("Workflows"),
  "pull-requests": msg("Pull requests"),
  captains: msg("Everything", { $context: "the Captains home page" }),
} satisfies Record<LayoutPageContent["kind"], ReturnType<typeof msg>>;

export function layoutPageTabTitle(kind: LayoutPageContent["kind"], resolve: MessageResolver) {
  return resolve(pageTabTitles[kind]);
}

/** Tabs show the command; the tooltip retains the complete terminal label. */
export function terminalTabTitle(
  terminalId: string,
  label: string | undefined,
  resolve: MessageResolver = m,
): string {
  const command = label?.split(" · ").at(-1)?.trim();
  return command && label !== getTerminalLabel(terminalId, resolve)
    ? command
    : resolve(msg("Terminal"));
}

/** Active headers and parked tabs name the same resource, without its linked thread. */
export function surfaceTabTitle(
  surface: RightPanelSurface,
  snapshot: PreviewSessionSnapshot | null | undefined,
  terminalLabel?: string,
  resolve: MessageResolver = m,
): string {
  switch (surface.kind) {
    case "captain-brief":
      return resolve(msg("Captain Brief"));
    case "diff":
      return resolve(msg("Diff"));
    case "files":
      return resolve(msg("Files"));
    case "file":
      return surface.relativePath.slice(
        Math.max(surface.relativePath.lastIndexOf("/"), surface.relativePath.lastIndexOf("\\")) + 1,
      );
    case "terminal":
      return terminalTabTitle(surface.activeTerminalId, terminalLabel, resolve);
    case "pull-request":
      return `#${surface.number}`;
    case "pull-requests":
      return resolve(msg("Linked items"));
    case "issue":
      // A git host numbers its issues; a tracker with keys of its own, such as Linear, names them.
      return /^\d+$/.test(surface.key) ? `#${surface.key}` : surface.key;
    case "device":
      return surface.title ?? surface.target?.name ?? resolve(msg("Device"));
    case "thread":
      // Until the thread's own title loads.
      return resolve(msg("Thread"));
    case "linked-thread":
      return linkedThreadTitle(
        surface,
        resolve(msg("Thread on {label}", { label: surface.label })),
      );
    case "preview": {
      const navigation = snapshot?.navStatus;
      if (navigation && navigation._tag !== "Idle" && navigation.title.trim()) {
        return navigation.title;
      }
      const url =
        navigation && navigation._tag !== "Idle"
          ? navigation.url
          : surface.resourceId
            ? surface.url
            : undefined;
      if (!url) return resolve(msg("Browser"));
      try {
        return new URL(url).host || resolve(msg("Browser"));
      } catch {
        return resolve(msg("Browser"));
      }
    }
  }
}
