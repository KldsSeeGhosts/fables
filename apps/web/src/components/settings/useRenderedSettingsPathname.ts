import { useMatches } from "@tanstack/react-router";
import { use } from "react";
import { LayoutPageLocationContext } from "../../layout/pageNavigation";

// useLocation switches as soon as a navigation starts, while <Outlet> keeps the old page until
// the next route's lazy chunk loads. Chrome that frames the page must follow the committed match.
export function useRenderedSettingsPathname(): string {
  const match = useMatches({ select: (matches) => matches.at(-1)?.pathname ?? "" });
  return use(LayoutPageLocationContext)?.pathname ?? match;
}
