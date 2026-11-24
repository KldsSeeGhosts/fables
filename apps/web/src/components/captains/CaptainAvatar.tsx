import type { CaptainAvatar as Avatar } from "@t3tools/contracts";
import { CompassIcon, FlagIcon, MountainIcon, TerminalIcon } from "lucide-react";

import { cn } from "../../lib/utils";

export const captainAvatarIcons = {
  compass: CompassIcon,
  flag: FlagIcon,
  mountain: MountainIcon,
  terminal: TerminalIcon,
};
const colors = {
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  blue: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};
export const captainAvatarSwatches = {
  violet: "bg-violet-500",
  blue: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};

export function CaptainAvatar({
  avatar,
  size = "row",
}: {
  avatar: Avatar;
  size?: "row" | "header" | "large";
}) {
  const Icon = captainAvatarIcons[avatar.preset];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-md",
        size === "large" ? "size-10 rounded-lg" : size === "header" ? "size-8" : "size-6",
        colors[avatar.color],
      )}
    >
      <Icon className={size === "large" ? "size-5" : size === "header" ? "size-4" : "size-3.5"} />
    </span>
  );
}
