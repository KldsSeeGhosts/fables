import {
  CaptainAvatarPickerColor,
  CaptainAvatarPickerShape,
  type CaptainAvatar as Avatar,
} from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { captainAvatarEyes, captainAvatarPaths } from "./captainAvatarData";
import "./CaptainAvatar.css";

const shapeOf = {
  circle: "circle",
  cloud: "cloud",
  diamond: "diamond",
  // oxlint-disable-next-line t3code/no-sparkles-icon -- Grok Bot shape name, not an icon choice.
  sparkle: "sparkle",
  clover: "clover",
  pebble: "pebble",
  flower: "flower",
  drop: "drop",
  pill: "pill",
  triangle: "triangle",
  pentagon: "pentagon",
  gear: "gear",
  hexagon: "hexagon",
  squircle: "diamond",
  compass: "circle",
  mountain: "drop",
  terminal: "diamond",
  flag: "hexagon",
} satisfies Record<Avatar["preset"], CaptainAvatarPickerShape>;

const colorOf = {
  black: "black",
  brown: "brown",
  red: "red",
  tangerine: "tangerine",
  orange: "orange",
  green: "green",
  teal: "teal",
  blue: "blue",
  purple: "purple",
  pink: "pink",
  gray: "gray",
  ink: "black",
  violet: "purple",
  emerald: "green",
  amber: "orange",
  rose: "pink",
} satisfies Record<Avatar["color"], CaptainAvatarPickerColor>;

const bodyColors = {
  black: "text-[#111111] dark:text-zinc-100",
  brown: "text-[#8E5B34]",
  red: "text-[#FF263C]",
  tangerine: "text-[#FF6A00]",
  orange: "text-[#FF9800]",
  green: "text-[#00C972]",
  teal: "text-[#00B5A6]",
  blue: "text-[#1084FE]",
  purple: "text-[#9159FE]",
  pink: "text-[#FF2F9A]",
  gray: "text-[#7A7A7A]",
} satisfies Record<CaptainAvatarPickerColor, string>;

export const captainAvatarShapes = CaptainAvatarPickerShape.literals;
export const captainAvatarColors = CaptainAvatarPickerColor.literals;

export const captainAvatarSwatches = {
  black: "bg-[#111111]",
  brown: "bg-[#8E5B34]",
  red: "bg-[#FF263C]",
  tangerine: "bg-[#FF6A00]",
  orange: "bg-[#FF9800]",
  green: "bg-[#00C972]",
  teal: "bg-[#00B5A6]",
  blue: "bg-[#1084FE]",
  purple: "bg-[#9159FE]",
  pink: "bg-[#FF2F9A]",
  gray: "bg-[#7A7A7A]",
} satisfies Record<CaptainAvatarPickerColor, string>;

export type CaptainAvatarState = "archived" | "idle" | "waiting" | "working";

export function normalizeCaptainAvatar(avatar: Avatar): Avatar {
  return {
    preset: shapeOf[avatar.preset],
    color: colorOf[avatar.color],
  };
}

export function randomCaptainAvatar(): Avatar {
  const pick = <T,>(values: ReadonlyArray<T>) => values[Math.floor(Math.random() * values.length)]!;
  return { preset: pick(captainAvatarShapes), color: pick(captainAvatarColors) };
}

export function CaptainAvatar({
  avatar,
  size = "row",
  state = "idle",
  animateOnMount = false,
}: {
  avatar: Avatar;
  size?: "picker" | "row" | "header" | "large" | "profile";
  state?: CaptainAvatarState;
  animateOnMount?: boolean;
}) {
  const shape = shapeOf[avatar.preset];
  const color = colorOf[avatar.color];
  const [eyeX, eyeY, eyeScale] = captainAvatarEyes[shape];
  const lookOffset = 0.35 * 0.34 * eyeScale;
  const gap = 0.36 * eyeScale;
  const width = 0.15 * eyeScale;
  const height = 0.4 * eyeScale;

  return (
    <svg
      aria-hidden
      viewBox="-1.12 -1.12 2.24 2.24"
      className={cn(
        "shrink-0 overflow-visible",
        {
          picker: "size-5",
          row: "size-6",
          header: "size-8",
          large: "size-10",
          profile: "size-14",
        }[size],
        bodyColors[color],
        state === "archived" && "opacity-50 grayscale",
      )}
      data-captain-avatar=""
      data-captain-state={state}
      data-captain-animate-on-mount={animateOnMount ? "true" : undefined}
    >
      <path data-captain-avatar-body="" d={captainAvatarPaths[shape]} fill="currentColor" />
      <g transform={`translate(${eyeX + lookOffset} ${eyeY - lookOffset})`}>
        <g data-captain-avatar-eyes="">
          {[-1, 1].map((side) => (
            <g
              key={side}
              data-captain-avatar-eye=""
              transform={`translate(${(side * gap) / 2} 0) rotate(-18)`}
            >
              <rect
                x={-width / 2}
                y={-height / 2}
                width={width}
                height={height}
                rx={width / 2}
                className={color === "black" ? "fill-white dark:fill-background" : "fill-white"}
              />
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}
