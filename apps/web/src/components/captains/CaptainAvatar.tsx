import type { CaptainAvatar as Avatar } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import type { DuetActivity } from "../chat/duetStatus.logic";
import { captainCreatures } from "@t3tools/client-runtime/state/captain-creatures";
import { captainAvatarSizes, type CaptainAvatarSize } from "./captainAvatarData";
import {
  captainEmblemOf,
  captainPaletteOf,
  DUET_EMBLEM_ORDER,
  DUET_PALETTE_ORDER,
  DUET_PALETTE_SWATCH,
  duetAvatar,
  type DuetEmblem,
  type DuetPalette,
} from "@t3tools/client-runtime/state/captain-palette";
import "./CaptainAvatar.css";

export type CaptainAvatarState = "archived" | "idle" | "waiting" | "working";

export function randomCaptainAvatar(): Avatar {
  const pick = <T,>(values: ReadonlyArray<T>) => values[Math.floor(Math.random() * values.length)]!;
  return duetAvatar(pick(DUET_EMBLEM_ORDER), pick(DUET_PALETTE_ORDER));
}

const percent = (value: number) => `${value}%`;

/**
 * A Captain's Duet creature: its emblem's ink body crossed by a contrasting line, the same
 * recipe as the Duet orb. Body, line and halo are separate HTML layers so every state animates
 * by transform alone (CaptainAvatar.css).
 */
function CaptainCreature({ emblem, palette }: { emblem: DuetEmblem; palette: DuetPalette }) {
  const design = captainCreatures[emblem];
  const ink = DUET_PALETTE_SWATCH[palette].ink;
  const [originX, originY] = design.origin;
  const line = "line" in design ? design.line : null;
  const halo = "halo" in design ? design.halo : null;
  return (
    <span data-captain-creature={emblem} className="absolute inset-0">
      {halo ? (
        <span
          data-captain-creature-halo={halo.motion}
          className="absolute inset-0"
          style={{ transformOrigin: `${percent(originX)} ${percent(originY)}` }}
        >
          <svg aria-hidden viewBox="0 0 100 100" className="size-full overflow-visible">
            <path
              d={halo.path}
              fill="none"
              stroke={halo.tone === "ink" ? ink : "var(--duet-creature-line, currentColor)"}
              strokeOpacity={halo.tone === "ink" ? 0.42 : 1}
              strokeWidth={halo.tone === "ink" ? 6 : 7}
              transform={halo.motion === "turn" ? "rotate(-24 52 52)" : undefined}
            />
          </svg>
        </span>
      ) : null}
      <span
        data-captain-creature-body=""
        className="absolute inset-0"
        style={{ transformOrigin: `${percent(originX)} ${percent(originY)}` }}
      >
        <svg aria-hidden viewBox="0 0 100 100" className="size-full overflow-visible">
          <path d={design.body} fill={ink} />
        </svg>
      </span>
      {line ? (
        <span
          data-captain-creature-line-window=""
          className="absolute overflow-hidden"
          style={{
            left: percent(line.window.x),
            top: percent(line.window.y),
            width: percent(line.window.w),
            height: percent(line.window.h),
          }}
        >
          <svg
            aria-hidden
            data-captain-creature-line=""
            viewBox="0 0 44 14"
            preserveAspectRatio="none"
            className="block h-full w-[200%]"
          >
            <path
              d={line.path}
              fill="none"
              stroke="var(--duet-creature-line, currentColor)"
              strokeWidth={line.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}
    </span>
  );
}

export function CaptainAvatar({
  avatar,
  size = "row",
  state = "idle",
  activity,
  celebrate = false,
  animateOnMount = false,
}: {
  avatar: Avatar;
  size?: CaptainAvatarSize;
  state?: CaptainAvatarState;
  /** A finer motion for the state, such as reading or running a command. */
  activity?: DuetActivity | undefined;
  /** Plays one completion hop while settling back to idle. */
  celebrate?: boolean;
  animateOnMount?: boolean;
}) {
  const palette = captainPaletteOf(avatar);
  const emblem = captainEmblemOf(avatar);
  const { frame, disc } = captainAvatarSizes[size];

  return (
    <span
      aria-hidden
      data-captain-avatar=""
      data-captain-state={state}
      data-captain-activity={activity}
      data-captain-celebrate={celebrate ? "true" : undefined}
      data-captain-animate-on-mount={animateOnMount ? "true" : undefined}
      data-captain-disc={disc ? "" : undefined}
      data-duet-palette={palette}
      className={cn(
        "relative inline-flex shrink-0 overflow-visible rounded-full",
        frame,
        state === "archived" && "opacity-50 grayscale",
      )}
    >
      {disc ? (
        <span data-captain-creature-stage="">
          <CaptainCreature emblem={emblem} palette={palette} />
        </span>
      ) : (
        <CaptainCreature emblem={emblem} palette={palette} />
      )}
    </span>
  );
}
