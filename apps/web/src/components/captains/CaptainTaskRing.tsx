import { useGT } from "gt-react";

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
      return gt("Ready for you", { $context: "delegated task status" });
    case "failed":
      return gt("Failed", { $context: "delegated task status" });
    case "stopped":
      return gt("Stopped", { $context: "delegated task status" });
    case "scheduled":
      return gt("Scheduled", { $context: "delegated task status" });
    case "done":
      return gt("Resolved", { $context: "delegated task status" });
    case "unknown":
      return gt("Status unavailable", { $context: "delegated task status" });
  }
}

const ringColor: Record<CaptainTaskStatus, string> = {
  "needs-input": "#a98546",
  working: "#d97757",
  ready: "#1e7d2c",
  failed: "var(--destructive-foreground)",
  stopped: "#838383",
  scheduled: "#838383",
  done: "#838383",
  unknown: "#838383",
};

/** The Duet task state ring. Only rotation animates, and reduced motion leaves it static. */
export function CaptainTaskRing({
  status,
  className,
}: {
  readonly status: CaptainTaskStatus;
  readonly className?: string;
}) {
  const color = ringColor[status];
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn(
        "size-3.5 shrink-0 duet:size-4",
        status === "working" && "animate-spin motion-reduce:animate-none",
        className,
      )}
      fill="none"
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={status === "working" ? "3 2.4" : undefined}
        strokeLinecap="round"
      />
      {status === "needs-input" ? <circle cx="8" cy="8" r="2" fill={color} /> : null}
      {status === "ready" ? <circle cx="8" cy="8" r="2.25" fill={color} /> : null}
      {status === "failed" ? (
        <path
          d="M5.75 5.75l4.5 4.5m0-4.5l-4.5 4.5"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : null}
      {status === "done" ? (
        <path
          d="M5.4 8.2l1.8 1.8 3.6-4"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {status === "stopped" || status === "unknown" || status === "scheduled" ? (
        <path d="M5.7 10.3l4.6-4.6" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}
