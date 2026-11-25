import type { CaptainAvatar as Avatar } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { captainAvatarSizes, captainMascotEyes, captainMascotPaths } from "./captainAvatarData";
import {
  captainEmblemOf,
  captainPaletteOf,
  DUET_EMBLEM_ORDER,
  DUET_PALETTE_ORDER,
  DUET_PALETTE_SWATCH,
  DUET_PICKER,
  type DuetEmblem,
  type DuetPalette,
} from "./captainPalette";
import "./CaptainAvatar.css";

export type CaptainAvatarState = "archived" | "idle" | "waiting" | "working";

/** The 28px bare mascot the channel hero leads with. */
const heroSize = { frame: "size-7", glyph: "size-7", tile: false } as const;

const canonicalShapes = DUET_EMBLEM_ORDER.map((emblem) => DUET_PICKER.emblems[emblem]);
const canonicalColors = DUET_PALETTE_ORDER.map((palette) => DUET_PICKER.palettes[palette]);

export function normalizeCaptainAvatar(avatar: Avatar): Avatar {
  return {
    preset: DUET_PICKER.emblems[captainEmblemOf(avatar)],
    color: DUET_PICKER.palettes[captainPaletteOf(avatar)],
  };
}

export function randomCaptainAvatar(): Avatar {
  const pick = <T,>(values: ReadonlyArray<T>) => values[Math.floor(Math.random() * values.length)]!;
  return normalizeCaptainAvatar({ preset: pick(canonicalShapes), color: pick(canonicalColors) });
}

const MASCOT_VIEW_BOX = "-1.12 -1.12 2.24 2.24";

/** A share of the mascot's box, as a CSS percentage, for a point in its view box. */
const mascotPercent = (unit: number) => `${(((unit + 1.12) / 2.24) * 100).toFixed(2)}%`;

/**
 * The Captain's mascot: its emblem's silhouette in the palette ink, with two eyes. Body and eyes
 * are separate HTML layers so every state animates by transform alone (CaptainAvatar.css).
 */
function CaptainMascot({
  emblem,
  palette,
  className,
}: {
  emblem: DuetEmblem;
  palette: DuetPalette;
  className?: string;
}) {
  const [eyeX, eyeY, eyeScale] = captainMascotEyes[emblem];
  const look = 0.35 * 0.34 * eyeScale;
  const centerX = eyeX + look;
  const centerY = eyeY - look;
  const gap = 0.36 * eyeScale;
  const width = 0.15 * eyeScale;
  const height = 0.4 * eyeScale;
  return (
    <span
      data-captain-mascot-body=""
      data-captain-emblem={emblem}
      className={cn("relative block shrink-0", className)}
    >
      <svg
        aria-hidden
        viewBox={MASCOT_VIEW_BOX}
        className="absolute inset-0 size-full overflow-visible"
      >
        <path
          d={captainMascotPaths[emblem]}
          fill={`var(--duet-ink, ${DUET_PALETTE_SWATCH[palette].ink})`}
        />
      </svg>
      <span
        data-captain-mascot-eyes=""
        className="absolute inset-0"
        style={{ transformOrigin: `${mascotPercent(centerX)} ${mascotPercent(centerY)}` }}
      >
        <svg aria-hidden viewBox={MASCOT_VIEW_BOX} className="size-full overflow-visible">
          <g transform={`translate(${centerX} ${centerY})`} fill="var(--duet-mascot-eye, #ffffff)">
            {[-1, 1].map((side) => (
              <rect
                key={side}
                transform={`translate(${(side * gap) / 2} 0) rotate(-18)`}
                x={-width / 2}
                y={-height / 2}
                width={width}
                height={height}
                rx={width / 2}
              />
            ))}
          </g>
        </svg>
      </span>
    </span>
  );
}

/** A waiting tile wears a ring 3px outside its edge, sized for the 30px box around a 24px tile. */
function CaptainAvatarAttentionRing() {
  return (
    <>
      <span aria-hidden data-captain-avatar-ping="" />
      <svg
        aria-hidden
        viewBox="0 0 38 38"
        fill="none"
        strokeWidth={1.9}
        data-captain-avatar-ring=""
        className="pointer-events-none absolute -inset-0.75"
      >
        <circle cx="19" cy="19" r="18.05" stroke="var(--duet-needs-input-ring, currentColor)" />
      </svg>
    </>
  );
}

export function CaptainAvatar({
  avatar,
  size = "row",
  state = "idle",
  attention = false,
  animateOnMount = false,
}: {
  avatar: Avatar;
  size?: keyof typeof captainAvatarSizes | "hero";
  state?: CaptainAvatarState;
  /** Rings a tile while the Captain waits on the user. */
  attention?: boolean;
  animateOnMount?: boolean;
}) {
  const palette = captainPaletteOf(avatar);
  const emblem = captainEmblemOf(avatar);
  const sizeData = size === "hero" ? heroSize : captainAvatarSizes[size];
  const swatch = DUET_PALETTE_SWATCH[palette];

  return (
    <span
      aria-hidden
      data-captain-avatar=""
      data-captain-state={state}
      data-captain-animate-on-mount={animateOnMount ? "true" : undefined}
      data-duet-palette={palette}
      data-captain-tile={sizeData.tile ? "" : undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-visible",
        sizeData.frame,
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- the Duet tile radius scales with the tile.
        sizeData.tile && "rounded-[28%]",
        state === "archived" && "opacity-50 grayscale",
      )}
      style={
        sizeData.tile
          ? { backgroundColor: `var(--duet-tile-fill, var(--duet-tint, ${swatch.tint}))` }
          : undefined
      }
    >
      <CaptainMascot emblem={emblem} palette={palette} className={sizeData.glyph} />
      {attention && sizeData.tile ? <CaptainAvatarAttentionRing /> : null}
    </span>
  );
}
