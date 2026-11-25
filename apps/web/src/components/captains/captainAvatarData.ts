import type { DuetEmblem } from "./captainPalette";

/** `disc` sizes sit the creature on the Duet orb's subtle disc; the rest draw it bare. */
export const captainAvatarSizes = {
  row: { frame: "size-4", disc: false },
  header: { frame: "size-[18px]", disc: false },
  channel: { frame: "size-[18px]", disc: false },
  picker: { frame: "size-5", disc: false },
  orb: { frame: "size-7", disc: true },
  hero: { frame: "size-11", disc: true },
  profile: { frame: "size-14", disc: true },
} as const satisfies Record<string, { frame: string; disc: boolean }>;

export type CaptainAvatarSize = keyof typeof captainAvatarSizes;

/** A box in the creature's 0-100 stage, in percent. */
export interface CreatureWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Line motifs are two periods of a 22-unit tile in a 44x14 view box, so rolling the strip left by
 * half its width loops seamlessly.
 */
const SINE = "M0 7C3.67 3.2 7.33 3.2 11 7S18.33 10.8 22 7S29.67 3.2 33 7S40.33 10.8 44 7";
const TWIN_SINE =
  "M0 4.6C3.67 2 7.33 2 11 4.6S18.33 7.2 22 4.6S29.67 2 33 4.6S40.33 7.2 44 4.6M0 10C3.67 7.4 7.33 7.4 11 10S18.33 12.6 22 10S29.67 7.4 33 10S40.33 12.6 44 10";
const ZIGZAG = "M0 7L5.5 3.6L11 7L16.5 10.4L22 7L27.5 3.6L33 7L38.5 10.4L44 7";

const WAVE_WINDOW: CreatureWindow = { x: 4, y: 18, w: 88, h: 56 };

export interface CreatureDesign {
  /** The body silhouette in the 0-100 stage, filled with the palette ink. */
  readonly body: string;
  /** Where the body breathes from, in percent of the stage. */
  readonly origin: readonly [number, number];
  /** The rolling line drawn across the body. */
  readonly line?: {
    readonly path: string;
    readonly window: CreatureWindow;
    readonly width: number;
  };
  /** A static outline that turns or pulses while the Captain works. */
  readonly halo?: {
    readonly path: string;
    readonly motion: "pulse" | "turn";
    /** `ink` draws a soft palette ripple; `line` draws in the contrasting line colour. */
    readonly tone: "ink" | "line";
  };
}

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** Every emblem is the Duet orb's recipe: an organic ink body crossed by a contrasting line. */
export const captainCreatures = {
  orb: {
    body: circle(52, 52, 34),
    origin: [52, 52],
    line: { path: SINE, window: WAVE_WINDOW, width: 2.1 },
  },
  "twin-arcs": {
    body: "M14 54a38 29 0 1 0 76 0a38 29 0 1 0 -76 0Z",
    origin: [52, 54],
    line: { path: TWIN_SINE, window: { x: 4, y: 26, w: 88, h: 56 }, width: 1.7 },
  },
  sunburst: {
    body: circle(52, 52, 26),
    origin: [52, 52],
    line: { path: SINE, window: { x: 14, y: 24, w: 76, h: 48 }, width: 2.3 },
    halo: { path: circle(52, 52, 44), motion: "pulse", tone: "ink" },
  },
  "heart-wave": {
    body: "M52 86C30 72 16 60 16 42C16 30 25 21 36 21C43 21 49 25 52 31C55 25 61 21 68 21C79 21 88 30 88 42C88 60 74 72 52 86Z",
    origin: [52, 54],
    line: { path: SINE, window: { x: 4, y: 22, w: 88, h: 56 }, width: 2.1 },
  },
  terminal: {
    body: "M38 20H66C79 20 86 27 86 40V64C86 77 79 84 66 84H38C25 84 18 77 18 64V40C18 27 25 20 38 20Z",
    origin: [52, 52],
    line: { path: ZIGZAG, window: { x: 4, y: 24, w: 88, h: 56 }, width: 2.1 },
  },
  prism: {
    body: "M45 22C48.5 16 55.5 16 59 22L87 70C90.5 76 87 83 80 83H24C17 83 13.5 76 17 70Z",
    origin: [52, 60],
    line: { path: SINE, window: { x: 4, y: 32, w: 88, h: 56 }, width: 2.1 },
  },
  orbit: {
    body: circle(52, 52, 25),
    origin: [52, 52],
    halo: {
      path: "M7 52a45 15 0 1 0 90 0a45 15 0 1 0 -90 0",
      motion: "turn",
      tone: "line",
    },
  },
  horizon: {
    body: "M18 64A34 34 0 0 1 86 64Z",
    origin: [52, 64],
    line: { path: SINE, window: { x: 4, y: 36, w: 88, h: 56 }, width: 2.1 },
  },
} as const satisfies Record<DuetEmblem, CreatureDesign>;
