/* oxlint-disable t3code/no-sparkles-icon -- tests cover the stored avatar schema literal for the sunburst emblem. */
import { expect, it } from "vite-plus/test";

import {
  captainEmblemOf,
  captainPaletteOf,
  DUET_PALETTE_SWATCH,
  DUET_PICKER,
} from "./captainPalette";

it("maps legacy presets and colors onto the Duet system", () => {
  expect(captainEmblemOf({ preset: "compass", color: "violet" })).toBe("orb");
  expect(captainPaletteOf({ preset: "compass", color: "violet" })).toBe("plum");
  expect(captainEmblemOf({ preset: "squircle", color: "ink" })).toBe("terminal");
  expect(captainPaletteOf({ preset: "squircle", color: "ink" })).toBe("slate");
  expect(captainEmblemOf({ preset: "mountain", color: "amber" })).toBe("horizon");
  expect(captainPaletteOf({ preset: "mountain", color: "amber" })).toBe("ochre");
});

it("writes the canonical picker value for every Duet emblem and palette", () => {
  expect(DUET_PICKER.emblems).toEqual({
    orb: "circle",
    sunburst: "sparkle",
    "twin-arcs": "clover",
    "heart-wave": "flower",
    terminal: "diamond",
    prism: "triangle",
    orbit: "hexagon",
    horizon: "pentagon",
  });
  expect(DUET_PICKER.palettes).toEqual({
    terracotta: "tangerine",
    rose: "pink",
    cobalt: "blue",
    sage: "green",
    ochre: "orange",
    plum: "purple",
    coral: "red",
    slate: "gray",
  });
});

it("keeps the Anthropic palette values available without theme CSS", () => {
  expect(DUET_PALETTE_SWATCH.terracotta).toEqual({
    ink: "#c15f3c",
    tint: "#fbe4da",
    bubble: "#fdceba",
  });
  expect(DUET_PALETTE_SWATCH.cobalt).toEqual({
    ink: "#2f67b3",
    tint: "#e1ecf9",
    bubble: "#b5d3f6",
  });
  expect(DUET_PALETTE_SWATCH.slate).toEqual({
    ink: "#5b6472",
    tint: "#e8eaee",
    bubble: "#d8dde4",
  });
});
