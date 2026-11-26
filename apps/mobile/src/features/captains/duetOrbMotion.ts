import type { DuetCreatureState } from "./DuetCreature";

/** One there-and-back of the halo pulse, breathing and waiting bob (desktop: 1.2s alternate). */
export const ORB_SWAY_MS = 2_400;
export const ORB_TURN_MS = 3_200;
export const ORB_DRIFT_MS = 1_400;

/** CSS `ease-in-out`, as desktop's keyframes use. */
function cssEaseInOut(x: number): number {
  // cubic-bezier(0.42, 0, 0.58, 1): solve for the curve parameter by bisection, then read y.
  let low = 0;
  let high = 1;
  let t = x;
  for (let i = 0; i < 20; i++) {
    const bx = 3 * (1 - t) * (1 - t) * t * 0.42 + 3 * (1 - t) * t * t * 0.58 + t * t * t;
    if (bx < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return 3 * (1 - t) * t * t + t * t * t;
}

/**
 * Goes 0 → 1 → 0 over one timing, eased each way. The native driver samples a timing's easing
 * into frames but not an interpolation's, so a back-and-forth motion is one native loop this way.
 */
export function swayEasing(t: number): number {
  return cssEaseInOut(t < 0.5 ? t * 2 : 2 - t * 2);
}

export function orbMoves(input: {
  readonly state: DuetCreatureState;
  readonly focused: boolean;
  readonly appActive: boolean;
  readonly reduceMotion: boolean;
}): boolean {
  return input.state !== "idle" && input.focused && input.appActive && !input.reduceMotion;
}
