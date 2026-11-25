export type DuetOrbState = "idle" | "working" | "waiting" | "offline";

/** What a Duet is doing right now, finer than its orb state; the creature and live pill follow it. */
export type DuetActivity =
  | "idle"
  | "thinking"
  | "reading"
  | "editing"
  | "command"
  | "searching"
  | "browsing"
  | "writing"
  | "delegating"
  | "waiting"
  | "offline";

/** The header orb's precedence: connection first, then user attention, then active work. */
export function resolveDuetOrbState(input: {
  connected: boolean;
  runtimeActive: boolean;
  backgroundTasks: number;
  attention: number;
  activeChildren: number;
}): DuetOrbState {
  if (!input.connected) return "offline";
  if (input.attention > 0) return "waiting";
  if (input.runtimeActive || input.backgroundTasks > 0 || input.activeChildren > 0) {
    return "working";
  }
  return "idle";
}
