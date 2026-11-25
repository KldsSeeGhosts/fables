import { useTheme } from "./useTheme";

export function useDuetShell(): boolean {
  return useTheme().theme === "ksg-salon";
}
