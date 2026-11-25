import { getThemeDefinition, resolveThemeHalf } from "../themePalette";
import { useTheme } from "./useTheme";

export function useDuetShell(): boolean {
  const { theme, themeHalves, resolvedTheme } = useTheme();
  return (
    getThemeDefinition(resolveThemeHalf(theme, themeHalves, resolvedTheme))?.id === "ksg-salon"
  );
}
