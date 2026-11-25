/* oxlint-disable shadcn/no-raw-colors, shadcn/no-arbitrary-values -- The V3 Duet spec fixes these exact static status-ring colors. */
import { useGT } from "gt-react";
import { CircleCheck, CircleSlash, CircleX } from "lucide-react";

import { cn } from "../../lib/utils";
import type { CaptainTaskStatus } from "./captainTaskStatus.logic";

export function useCaptainTaskStatusLabel(status: CaptainTaskStatus): string {
  const gt = useGT();
  switch (status) {
    case "needs-input":
      return gt("Needs input", { $context: "delegated task status" });
    case "working":
      return gt("Working", { $context: "delegated task status" });
    case "ready":
      return gt("Ready for review", { $context: "delegated task status" });
    case "failed":
      return gt("Failed", { $context: "delegated task status" });
    case "stopped":
      return gt("Stopped", { $context: "delegated task status" });
    case "scheduled":
      return gt("Scheduled", { $context: "delegated task status" });
    case "done":
      return gt("Done", { $context: "delegated task status" });
    case "unknown":
      return gt("Status unavailable", { $context: "delegated task status" });
  }
}

/** The Duet task state glyph. Every ring is static SVG; scanning never repaints it. */
export function CaptainTaskRing({
  status,
  className,
}: {
  readonly status: CaptainTaskStatus;
  readonly className?: string;
}) {
  if (status === "done") {
    return (
      <CircleCheck aria-hidden className={cn("size-3.5 shrink-0 text-[#838383]", className)} />
    );
  }
  if (status === "failed") {
    return (
      <CircleX
        aria-hidden
        className={cn("size-3.5 shrink-0 text-destructive-foreground", className)}
      />
    );
  }
  if (status === "stopped" || status === "unknown") {
    return (
      <CircleSlash aria-hidden className={cn("size-3.5 shrink-0 text-[#838383]", className)} />
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 14 14" className={cn("size-3.5 shrink-0", className)} fill="none">
      {status === "needs-input" ? (
        <>
          <circle cx="7" cy="7" r="5.5" stroke="#a98546" strokeWidth="1.5" />
          <path d="M7 1.5A5.5 5.5 0 0 0 7 12.5Z" fill="#a98546" />
        </>
      ) : status === "working" ? (
        <path
          d="M7 1.5a5.5 5.5 0 1 1-3.89 1.61"
          stroke="#d97757"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : status === "ready" ? (
        <>
          <circle cx="7" cy="7" r="5.5" stroke="#1e7d2c" strokeWidth="1.5" />
          <circle cx="7" cy="7" r="1.75" fill="#1e7d2c" />
        </>
      ) : (
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="#a3a3a3"
          strokeWidth="1.5"
          strokeDasharray="2.5 2.5"
        />
      )}
    </svg>
  );
}
