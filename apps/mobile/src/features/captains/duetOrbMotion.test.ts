import { expect, it } from "vite-plus/test";

import { orbMoves, swayEasing } from "./duetOrbMotion";

it("sways there and back, eased at both ends", () => {
  expect(swayEasing(0)).toBeCloseTo(0, 4);
  expect(swayEasing(0.5)).toBeCloseTo(1, 4);
  expect(swayEasing(1)).toBeCloseTo(0, 4);
  expect(swayEasing(0.25)).toBeCloseTo(0.5, 4);
  expect(swayEasing(0.2)).toBeCloseTo(swayEasing(0.8), 6);
  // Ease-in: the first tenth of the way covers well under a tenth of the travel.
  expect(swayEasing(0.05)).toBeLessThan(0.05);
});

it("moves only while working or waiting on a focused screen in an active app", () => {
  const moving = { state: "working", focused: true, appActive: true, reduceMotion: false } as const;
  expect(orbMoves(moving)).toBe(true);
  expect(orbMoves({ ...moving, state: "waiting" })).toBe(true);
  expect(orbMoves({ ...moving, state: "idle" })).toBe(false);
  expect(orbMoves({ ...moving, focused: false })).toBe(false);
  expect(orbMoves({ ...moving, appActive: false })).toBe(false);
  expect(orbMoves({ ...moving, reduceMotion: true })).toBe(false);
});
