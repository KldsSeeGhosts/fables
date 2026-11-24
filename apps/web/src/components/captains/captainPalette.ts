/* oxlint-disable t3code/no-sparkles-icon -- "sparkle" is the stored avatar schema literal for the sunburst emblem, not a Sparkles icon. */
import type {
  CaptainAvatar,
  CaptainAvatarPickerColor,
  CaptainAvatarPickerShape,
} from "@t3tools/contracts";

export type DuetPalette =
  | "terracotta"
  | "rose"
  | "cobalt"
  | "sage"
  | "ochre"
  | "plum"
  | "coral"
  | "slate";
export type DuetEmblem =
  | "orb"
  | "sunburst"
  | "twin-arcs"
  | "heart-wave"
  | "terminal"
  | "prism"
  | "orbit"
  | "horizon";

export const DUET_EMBLEM_ORDER = [
  "orb",
  "sunburst",
  "twin-arcs",
  "heart-wave",
  "terminal",
  "prism",
  "orbit",
  "horizon",
] as const satisfies ReadonlyArray<DuetEmblem>;

export const DUET_PALETTE_ORDER = [
  "terracotta",
  "rose",
  "cobalt",
  "sage",
  "ochre",
  "plum",
  "coral",
  "slate",
] as const satisfies ReadonlyArray<DuetPalette>;

export const DUET_PALETTE_SWATCH = {
  terracotta: { ink: "#c15f3c", tint: "#fbe4da", bubble: "#fdceba" },
  rose: { ink: "#c84a78", tint: "#fce4ec", bubble: "#f6c3d6" },
  cobalt: { ink: "#2f67b3", tint: "#e1ecf9", bubble: "#b5d3f6" },
  sage: { ink: "#3f7d4e", tint: "#e2efe4", bubble: "#c6e4cc" },
  ochre: { ink: "#a8761d", tint: "#f7edd6", bubble: "#f3dca8" },
  plum: { ink: "#7e4fae", tint: "#eee4f7", bubble: "#dccbf2" },
  coral: { ink: "#d2503f", tint: "#fde3df", bubble: "#f8c5bd" },
  slate: { ink: "#5b6472", tint: "#e8eaee", bubble: "#d8dde4" },
} as const satisfies Record<DuetPalette, { ink: string; tint: string; bubble: string }>;

const paletteByStoredColor = {
  black: "slate",
  brown: "terracotta",
  red: "coral",
  tangerine: "terracotta",
  orange: "ochre",
  green: "sage",
  teal: "sage",
  blue: "cobalt",
  purple: "plum",
  pink: "rose",
  gray: "slate",
  ink: "slate",
  violet: "plum",
  emerald: "sage",
  amber: "ochre",
  rose: "rose",
} as const satisfies Record<CaptainAvatar["color"], DuetPalette>;

const emblemByStoredPreset = {
  circle: "orb",
  cloud: "orb",
  diamond: "terminal",
  sparkle: "sunburst",
  clover: "twin-arcs",
  pebble: "orb",
  flower: "heart-wave",
  drop: "heart-wave",
  pill: "twin-arcs",
  triangle: "prism",
  pentagon: "horizon",
  gear: "sunburst",
  hexagon: "orbit",
  squircle: "terminal",
  compass: "orb",
  mountain: "horizon",
  terminal: "terminal",
  flag: "orbit",
} as const satisfies Record<CaptainAvatar["preset"], DuetEmblem>;

export function captainPaletteOf(avatar: CaptainAvatar): DuetPalette {
  return paletteByStoredColor[avatar.color] ?? "terracotta";
}

export function captainEmblemOf(avatar: CaptainAvatar): DuetEmblem {
  return emblemByStoredPreset[avatar.preset] ?? "orb";
}

export const DUET_PICKER: {
  emblems: Record<DuetEmblem, CaptainAvatarPickerShape>;
  palettes: Record<DuetPalette, CaptainAvatarPickerColor>;
} = {
  emblems: {
    orb: "circle",
    sunburst: "sparkle",
    "twin-arcs": "clover",
    "heart-wave": "flower",
    terminal: "diamond",
    prism: "triangle",
    orbit: "hexagon",
    horizon: "pentagon",
  },
  palettes: {
    terracotta: "tangerine",
    rose: "pink",
    cobalt: "blue",
    sage: "green",
    ochre: "orange",
    plum: "purple",
    coral: "red",
    slate: "gray",
  },
};
