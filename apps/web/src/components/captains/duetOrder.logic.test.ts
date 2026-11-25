import { expect, it } from "vite-plus/test";

import { moveDuet, orderDuets } from "./duetOrder.logic";

const entry = (key: string, archived = false) => ({ key, archived });
const keys = (entries: ReadonlyArray<{ key: string }>) => entries.map(({ key }) => key);

it("orders known Duets by the saved keys and appends new Duets after them", () => {
  const ordered = orderDuets(
    [entry("local:new"), entry("local:ada"), entry("local:maria")],
    ["local:maria", "local:ada", "local:missing"],
  );

  expect(keys(ordered)).toEqual(["local:maria", "local:ada", "local:new"]);
});

it("keeps archived Duets at the bottom even when their keys are earlier in the saved order", () => {
  const ordered = orderDuets(
    [entry("local:archived", true), entry("local:new"), entry("local:ada")],
    ["local:archived", "local:ada"],
  );

  expect(keys(ordered)).toEqual(["local:ada", "local:new", "local:archived"]);
});

it("preserves the source order of unknown active and archived Duets", () => {
  const ordered = orderDuets(
    [
      entry("local:first-new"),
      entry("local:first-archived", true),
      entry("local:known"),
      entry("local:second-new"),
      entry("local:second-archived", true),
    ],
    ["local:known"],
  );

  expect(keys(ordered)).toEqual([
    "local:known",
    "local:first-new",
    "local:second-new",
    "local:first-archived",
    "local:second-archived",
  ]);
});

it("moves an active Duet one step in the saved order", () => {
  const entries = [entry("local:maria"), entry("local:ada"), entry("local:archived", true)];
  const preferred = ["local:ada", "local:maria", "local:archived"];

  expect(moveDuet(entries, preferred, "local:ada", "down")).toEqual([
    "local:maria",
    "local:ada",
    "local:archived",
  ]);
  expect(moveDuet(entries, preferred, "local:maria", "up")).toEqual([
    "local:maria",
    "local:ada",
    "local:archived",
  ]);
});

it("does not move archived Duets or move active Duets into the archived section", () => {
  const entries = [entry("local:ada"), entry("local:maria"), entry("local:archived", true)];
  const preferred = ["local:ada", "local:maria", "local:archived"];

  expect(moveDuet(entries, preferred, "local:ada", "up")).toBeNull();
  expect(moveDuet(entries, preferred, "local:maria", "down")).toBeNull();
  expect(moveDuet(entries, preferred, "local:archived", "up")).toBeNull();
  expect(moveDuet(entries, preferred, "local:missing", "down")).toBeNull();
});
