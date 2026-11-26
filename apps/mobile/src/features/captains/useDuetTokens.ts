import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { duetTokensForAppearance, type DuetTokens } from "./duetTokens";

export function useDuetTokens(): DuetTokens {
  return duetTokensForAppearance(useAppearancePreferences().themeAppearance);
}
