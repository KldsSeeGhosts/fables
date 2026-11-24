import {
  CaptainAvatarColor,
  CaptainAvatarShape,
  type CaptainAvatar as Avatar,
} from "@t3tools/contracts";

import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

const shapeOf = {
  circle: "circle",
  squircle: "squircle",
  drop: "drop",
  hexagon: "hexagon",
  cloud: "cloud",
  diamond: "diamond",
  compass: "circle",
  mountain: "drop",
  terminal: "squircle",
  flag: "hexagon",
} satisfies Record<Avatar["preset"], CaptainAvatarShape>;

const bodies = {
  circle: <circle cx="16" cy="16" r="15" />,
  squircle: <rect x="1" y="1" width="30" height="30" rx="10" />,
  drop: <path d="M16 1.5S28.5 12.4 28.5 19a12.5 12.5 0 0 1-25 0C3.5 12.4 16 1.5 16 1.5Z" />,
  hexagon: (
    <polygon
      points="16,3 27.5,9.5 27.5,22.5 16,29 4.5,22.5 4.5,9.5"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinejoin="round"
    />
  ),
  cloud: (
    <>
      <circle cx="10" cy="19" r="8" />
      <circle cx="22" cy="19" r="8" />
      <circle cx="16" cy="12.5" r="9.5" />
      <rect x="10" y="17" width="12" height="10" />
    </>
  ),
  diamond: <rect x="6" y="6" width="20" height="20" rx="5" transform="rotate(45 16 16)" />,
} satisfies Record<CaptainAvatarShape, ReactNode>;

const bodyColors = {
  ink: "text-zinc-900 dark:text-zinc-100",
  violet: "text-violet-500",
  blue: "text-sky-500",
  emerald: "text-emerald-500",
  amber: "text-amber-400",
  rose: "text-rose-500",
} satisfies Record<Avatar["color"], string>;

const eyeColors: Partial<Record<Avatar["color"], string>> = {
  ink: "fill-white dark:fill-zinc-900",
  amber: "fill-zinc-900",
};

export const captainAvatarShapes = CaptainAvatarShape.literals;

export const captainAvatarSwatches = {
  ink: "bg-zinc-900 dark:bg-zinc-100",
  violet: "bg-violet-500",
  blue: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-400",
  rose: "bg-rose-500",
} satisfies Record<Avatar["color"], string>;

export function randomCaptainAvatar(): Avatar {
  const pick = <T,>(values: ReadonlyArray<T>) => values[Math.floor(Math.random() * values.length)]!;
  return { preset: pick(captainAvatarShapes), color: pick(CaptainAvatarColor.literals) };
}

export function CaptainAvatar({
  avatar,
  size = "row",
}: {
  avatar: Avatar;
  size?: "picker" | "row" | "header" | "large";
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      fill="currentColor"
      className={cn(
        "shrink-0",
        { picker: "size-4", row: "size-6", header: "size-8", large: "size-10" }[size],
        bodyColors[avatar.color],
      )}
    >
      {bodies[shapeOf[avatar.preset]]}
      <g className={eyeColors[avatar.color] ?? "fill-white"}>
        <rect x="14" y="9.5" width="3.4" height="8" rx="1.7" transform="rotate(14 15.7 13.5)" />
        <rect x="20" y="9.5" width="3.4" height="8" rx="1.7" transform="rotate(14 21.7 13.5)" />
      </g>
    </svg>
  );
}
