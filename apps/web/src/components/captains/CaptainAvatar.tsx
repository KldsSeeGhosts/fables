import type { CaptainAvatar as Avatar } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { captainAvatarSizes } from "./captainAvatarData";
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

/** The 28px bare emblem the channel hero leads with. */
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

function DuetEmblemGlyph({
  emblem,
  palette,
  className,
}: {
  emblem: DuetEmblem;
  palette: DuetPalette;
  className?: string;
}) {
  const swatch = DUET_PALETTE_SWATCH[palette];
  const ink = `var(--duet-ink, ${swatch.ink})`;
  const tint = `var(--duet-tint, ${swatch.tint})`;
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke={ink}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0 text-foreground", className)}
      data-captain-emblem={emblem}
    >
      {emblem === "orb" ? (
        <>
          <circle cx="12.5" cy="13" r="6.5" fill={ink} stroke="none" />
          <path
            d="M3.5 12.6c2.2-2.6 4.4-2.6 6.6 0s4.4 2.6 6.6 0c1.3-1.5 2.6-2.1 3.8-1.8"
            stroke="currentColor"
            fill="none"
          />
        </>
      ) : null}
      {emblem === "sunburst" ? (
        <>
          <path
            d="M12 3v4.5M12 16.5V21M3 12h4.5M16.5 12H21M5.6 5.6l3.2 3.2M15.2 15.2l3.2 3.2M18.4 5.6l-3.2 3.2M8.8 15.2l-3.2 3.2"
            fill="none"
          />
          <circle cx="12" cy="12" r="2" fill={ink} stroke="none" />
        </>
      ) : null}
      {emblem === "twin-arcs" ? (
        <>
          <circle cx="12" cy="12" r="8.5" fill={tint} stroke="none" />
          <path d="M4 17.5a8 8 0 0 1 8-8" fill="none" />
          <path d="M12 14.5a8 8 0 0 0 8-8" fill="none" />
        </>
      ) : null}
      {emblem === "heart-wave" ? (
        <>
          <path
            d="M12 19.5s-7.5-4.4-7.5-9.7A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.2c0 5.3-7.5 9.7-7.5 9.7Z"
            fill={tint}
          />
          <path d="M8.6 12.3c1.1-1.1 2.3-1.1 3.4 0s2.3 1.1 3.4 0" fill="none" />
        </>
      ) : null}
      {emblem === "terminal" ? (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="3.5" fill={tint} />
          <path d="M7.5 10l2.5 2-2.5 2M12.5 14.25h4" fill="none" />
        </>
      ) : null}
      {emblem === "prism" ? (
        <>
          <path d="M12 4.5 20 18.5H4Z" fill={tint} />
          <path d="M12 4.5v14" fill="none" />
        </>
      ) : null}
      {emblem === "orbit" ? (
        <>
          <ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-30 12 12)" fill="none" />
          <circle cx="12" cy="12" r="3.25" fill={ink} stroke="none" />
          <circle cx="19.4" cy="7.6" r="1.3" fill={ink} stroke="none" />
        </>
      ) : null}
      {emblem === "horizon" ? (
        <>
          <path d="M6 15.5a6 6 0 0 1 12 0Z" fill={tint} />
          <path d="M3.5 15.5h17M7 19h10" fill="none" />
        </>
      ) : null}
    </svg>
  );
}

export function CaptainAvatar({
  avatar,
  size = "row",
  state = "idle",
  animateOnMount = false,
}: {
  avatar: Avatar;
  size?: keyof typeof captainAvatarSizes | "hero";
  state?: CaptainAvatarState;
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
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-visible",
        sizeData.frame,
        // oxlint-disable-next-line shadcn/no-arbitrary-values -- the Duet tile radius scales with the tile.
        sizeData.tile && "rounded-[28%]",
        state === "archived" && "opacity-50 grayscale",
      )}
      style={sizeData.tile ? { backgroundColor: `var(--duet-tint, ${swatch.tint})` } : undefined}
    >
      <DuetEmblemGlyph emblem={emblem} palette={palette} className={sizeData.glyph} />
    </span>
  );
}
