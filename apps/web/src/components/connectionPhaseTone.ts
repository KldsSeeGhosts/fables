import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

import type { StatusDotTone } from "~/components/ui/status-dot";

/** Canonical connection-phase → status tone mapping shared by every connection dot. */
export function connectionPhaseTone(phase: EnvironmentConnectionPhase): StatusDotTone {
  switch (phase) {
    case "connected":
      return "success";
    case "connecting":
    case "reconnecting":
      return "warning";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

/** Transitional phases ring their dot. */
export function connectionPhasePings(phase: EnvironmentConnectionPhase): boolean {
  return phase === "connecting" || phase === "reconnecting";
}

/** The same mapping for call sites that only need the dot's class. */
export function connectionPhaseDotClassName(phase: EnvironmentConnectionPhase): string {
  const toneClassName: Record<StatusDotTone, string> = {
    neutral: "bg-dim-foreground",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
    info: "bg-info",
    merged: "bg-merged",
    foreground: "bg-foreground",
  };
  return toneClassName[connectionPhaseTone(phase)];
}
