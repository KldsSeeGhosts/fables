import { createFileRoute } from "@tanstack/react-router";

import { captainsSearchFromUrl } from "../components/captains/captainsSearch.logic";

export const Route = createFileRoute("/_chat/captains")({
  validateSearch: captainsSearchFromUrl,
});
