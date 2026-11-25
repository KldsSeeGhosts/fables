import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { isDuetShellTheme } from "./duetShell";

export function useDuetShell(): boolean {
  return isDuetShellTheme(useAppearancePreferences().themeId);
}
