import { CaptainId, EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { captainsSearchFromUrl } from "./captainsSearch.logic";

it.each(["brief", "tasks", "docs", "memory"])("preserves the %s deep link", (view) => {
  expect(captainsSearchFromUrl({ env: "home", captain: "maria", view, extra: "ignored" })).toEqual({
    env: EnvironmentId.make("home"),
    captain: CaptainId.make("maria"),
    view,
  });
});

it("discards malformed fields without dropping valid fields", () => {
  expect(captainsSearchFromUrl({ env: ["home"], captain: "x".repeat(129), view: "tasks" })).toEqual(
    {
      view: "tasks",
    },
  );
  expect(captainsSearchFromUrl({ env: " ", captain: "", view: "settings" })).toEqual({});
});
