import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import type { MobileThemeAppearance } from "../../lib/mobileTheme";

/**
 * The mobile mirror of web's ksg-salon Duet tokens. Components read this one set rather than
 * inventing local values; keep it in step with apps/web/src/themes/ksg-salon.css.
 */
export const DUET_TOKENS = {
  light: {
    background: "#ffffff",
    sidebar: "#ffffff",
    sheet: "#ffffff",
    foreground: "#242424",
    muted: "#737373",
    placeholder: "#9a9a9a",
    meta: "#838383",
    hairline: "#ebebeb",
    row: "#ededed",
    sidebarBorder: "#f1f1f1",
    icon: "#8a8a8a",
    bubble: "#f2f2f2",
    ready: "#1e7d2c",
    needsInput: "#9f7832",
    needsInputRing: "#a98546",
    working: "#d97757",
    workingText: "#b85a3c",
    needsInputText: "#8f6a26",
    failed: "#bf4d43",
    link: "#2f67b3",
    pillForeground: "#555555",
    pillFill: "#f5f5f5",
    panel: "#f9f9f9",
    panelBorder: "#e6e6e6",
    composer: "#ffffff",
    overview: "#fafafa",
    codeBackground: "#f5f5f5",
    line: "#141413",
    badgeForeground: "#ffffff",
    scrim: "rgba(0, 0, 0, 0.22)",
    disc: "#ffffff",
    rim: "#ebebeb",
    shadow: "rgba(0, 0, 0, 0.14)",
  },
  dark: {
    background: "#191919",
    sidebar: "#1f1f1f",
    sheet: "#1f1f1f",
    foreground: "#e3e3e3",
    muted: "#8a8a8a",
    placeholder: "#7d7d7d",
    meta: "#838383",
    hairline: "#262626",
    row: "#2b2b2b",
    sidebarBorder: "#262626",
    icon: "#8a8a8a",
    bubble: "#252525",
    ready: "#57b565",
    needsInput: "#e3b866",
    needsInputRing: "#d6a34a",
    working: "#d97757",
    workingText: "#e8957a",
    needsInputText: "#e3b866",
    failed: "#e0695e",
    link: "#6aa2e8",
    pillForeground: "#a3a3a3",
    pillFill: "#252525",
    panel: "#262626",
    panelBorder: "#333333",
    composer: "#282828",
    overview: "#242424",
    codeBackground: "#141414",
    line: "#ececec",
    badgeForeground: "#141413",
    scrim: "rgba(0, 0, 0, 0.5)",
    disc: "#262626",
    rim: "#333333",
    shadow: "rgba(0, 0, 0, 0.55)",
  },
} as const;

export type DuetTokens = (typeof DUET_TOKENS)["light"];

export function duetTokensForAppearance(appearance: MobileThemeAppearance): DuetTokens {
  return DUET_TOKENS[appearance];
}

export function useDuetTokens(): DuetTokens {
  return duetTokensForAppearance(useAppearancePreferences().themeAppearance);
}
