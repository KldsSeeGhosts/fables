import { msg } from "gt-react";
import {
  classifyToolActivity,
  collectToolFilePaths,
  dynamicToolSurface,
} from "@t3tools/shared/toolActivity";

import { m, type MessageResolver } from "../../i18n/messages";

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

export interface DuetStatusTurnItem {
  readonly type: string;
  readonly title?: string | null;
  readonly input?: unknown;
  readonly toolName?: string | null;
  readonly toolSurface?: string | undefined;
  readonly requestKind?: string | null | undefined;
  readonly changes?: readonly unknown[] | undefined;
}

export interface DuetActivityStatus {
  readonly activity: DuetActivity;
  readonly label: string;
}

function activityStatus(activity: DuetActivity, label: string): DuetActivityStatus {
  return { activity, label };
}

function readStatus(item: DuetStatusTurnItem, resolve: MessageResolver): DuetActivityStatus {
  const paths = collectToolFilePaths({ rawInput: item.input, input: item.input });
  return paths.length > 1
    ? activityStatus("reading", resolve(msg("Reading files")))
    : activityStatus("reading", resolve(msg("Reading a file")));
}

function dynamicToolStatus(item: DuetStatusTurnItem, resolve: MessageResolver): DuetActivityStatus {
  if (item.toolSurface === "browser" || item.toolSurface === "computer") {
    return activityStatus("browsing", resolve(msg("Browsing")));
  }
  if (dynamicToolSurface(item.toolName, item.input) === "computer") {
    return activityStatus("browsing", resolve(msg("Browsing")));
  }
  const action = classifyToolActivity({
    itemType: item.type,
    requestKind: item.requestKind,
    title: item.title ?? undefined,
    data: {
      toolName: item.toolName ?? undefined,
      rawInput: item.input,
      input: item.input,
    },
  });
  switch (action) {
    case "command":
      return activityStatus("command", resolve(msg("Running a command")));
    case "read":
      return readStatus(item, resolve);
    case "file_change":
      return activityStatus("editing", resolve(msg("Editing files")));
    case "search":
      return activityStatus("searching", resolve(msg("Searching the codebase")));
    case "other":
      return activityStatus("thinking", resolve(msg("Thinking")));
  }
}

function turnItemStatus(item: DuetStatusTurnItem, resolve: MessageResolver): DuetActivityStatus {
  switch (item.type) {
    case "assistant_message":
      return activityStatus("writing", resolve(msg("Writing a response")));
    case "file_change":
      return activityStatus("editing", resolve(msg("Editing files")));
    case "command_execution":
      return activityStatus("command", resolve(msg("Running a command")));
    case "file_search":
      return activityStatus("searching", resolve(msg("Searching the codebase")));
    case "web_search":
      return activityStatus("searching", resolve(msg("Searching the web")));
    case "subagent":
      return activityStatus("delegating", resolve(msg("Delegating a task")));
    case "compaction":
      return activityStatus("thinking", resolve(msg("Compacting context")));
    case "dynamic_tool":
      return dynamicToolStatus(item, resolve);
    case "reasoning":
    case "proposed_plan":
    case "todo_list":
      return activityStatus("thinking", resolve(msg("Thinking")));
    default:
      return activityStatus("thinking", resolve(msg("Thinking")));
  }
}

/** The plain-language activity shown by the hero pill and mirrored in the creature's motion. */
export function resolveDuetActivityStatus(
  input: {
    readonly state: DuetOrbState;
    readonly runtimePhase: string | null;
    readonly activeTurnItem: DuetStatusTurnItem | null;
    readonly activeChildren: number;
    readonly backgroundTasks: ReadonlyArray<{ readonly kind: string }>;
  },
  resolve: MessageResolver = m,
): DuetActivityStatus {
  if (input.state === "offline") return activityStatus("offline", resolve(msg("Offline")));
  if (input.state === "waiting") return activityStatus("waiting", resolve(msg("Waiting for you")));
  if (input.state === "idle") return activityStatus("idle", resolve(msg("Idle")));

  if (input.activeChildren === 1) {
    return activityStatus("delegating", resolve(msg("Delegating a task")));
  }
  if (input.activeChildren > 1) {
    return activityStatus(
      "delegating",
      resolve(
        msg("{count, plural, one {Working on {count} task} other {Working on {count} tasks}}", {
          count: input.activeChildren,
        }),
      ),
    );
  }
  if (input.activeTurnItem !== null) return turnItemStatus(input.activeTurnItem, resolve);

  const backgroundTask = input.backgroundTasks[0];
  if (backgroundTask?.kind === "subagent") {
    return activityStatus("delegating", resolve(msg("Delegating a task")));
  }
  if (backgroundTask?.kind === "command" || backgroundTask?.kind === "monitor") {
    return activityStatus("command", resolve(msg("Running a command")));
  }

  if (input.runtimePhase === "queued") return activityStatus("thinking", resolve(msg("Queued")));
  if (input.runtimePhase === "starting" || input.runtimePhase === "preparing") {
    return activityStatus("thinking", resolve(msg("Starting")));
  }
  return activityStatus("thinking", resolve(msg("Thinking")));
}

export const DUET_LIVE_LABEL_HOLD_MS = 1_000;
export const DUET_LIVE_HIDE_DELAY_MS = 1_500;
export const DUET_LIVE_FADE_MS = 180;
export const DUET_LIVE_CELEBRATE_MS = 620;

export interface DuetLiveStatusInput {
  readonly visible: boolean;
  /** Idle uses a hold so the pill does not flash out and back between runs. */
  readonly retainOnHide: boolean;
  readonly label: string;
  readonly activity: DuetActivity;
}

interface LiveSnapshot {
  readonly label: string;
  readonly activity: DuetActivity;
  readonly shownAt: number;
}

interface OutgoingSnapshot {
  readonly label: string;
  readonly activity: DuetActivity;
  readonly until: number;
}

export interface DuetLiveStatusMachine {
  readonly current: LiveSnapshot | null;
  readonly outgoing: OutgoingSnapshot | null;
  readonly hideRequestedAt: number | null;
  readonly celebrateUntil: number | null;
}

export const initialDuetLiveStatusMachine: DuetLiveStatusMachine = {
  current: null,
  outgoing: null,
  hideRequestedAt: null,
  celebrateUntil: null,
};

export interface DuetLiveStatusOutput {
  readonly visible: boolean;
  readonly label: string;
  readonly activity: DuetActivity;
  readonly outgoing: { readonly label: string; readonly activity: DuetActivity } | null;
  readonly celebrating: boolean;
}

export interface DuetLiveStatusStep {
  readonly machine: DuetLiveStatusMachine;
  readonly output: DuetLiveStatusOutput;
  /** The next timestamp at which the machine must be advanced, or null when settled. */
  readonly wakeAt: number | null;
}

const sameDisplayedSnapshot = (left: LiveSnapshot, label: string, activity: DuetActivity) =>
  left.label === label && left.activity === activity;

/**
 * Advances the pill's hold/cross-fade state. Labels younger than one second stay on screen, hiding
 * after work waits 1.5 seconds, and replacement text fades out over `DUET_LIVE_FADE_MS`.
 */
export function advanceDuetLiveStatus(
  machine: DuetLiveStatusMachine,
  desired: DuetLiveStatusInput,
  now: number,
): DuetLiveStatusStep {
  let outgoing =
    machine.outgoing !== null && machine.outgoing.until > now ? machine.outgoing : null;
  let current = machine.current;
  let hideRequestedAt = machine.hideRequestedAt;
  let celebrateUntil =
    machine.celebrateUntil !== null && machine.celebrateUntil > now ? machine.celebrateUntil : null;

  if (desired.visible) {
    hideRequestedAt = null;
    celebrateUntil = null;
    if (current === null) {
      current = { label: desired.label, activity: desired.activity, shownAt: now };
    } else if (!sameDisplayedSnapshot(current, desired.label, desired.activity)) {
      if (current.label === desired.label) {
        current = { ...current, activity: desired.activity };
      } else if (now - current.shownAt >= DUET_LIVE_LABEL_HOLD_MS) {
        outgoing = {
          label: current.label,
          activity: current.activity,
          until: now + DUET_LIVE_FADE_MS,
        };
        current = { label: desired.label, activity: desired.activity, shownAt: now };
      }
    }
  } else if (current !== null) {
    if (!desired.retainOnHide) {
      current = null;
      outgoing = null;
      hideRequestedAt = null;
    } else {
      const enteringHideHold = hideRequestedAt === null;
      hideRequestedAt ??= now;
      if (enteringHideHold && current.activity !== "waiting") {
        celebrateUntil ??= now + DUET_LIVE_CELEBRATE_MS;
      }
      if (now - hideRequestedAt >= DUET_LIVE_HIDE_DELAY_MS) {
        current = null;
        outgoing = null;
        hideRequestedAt = null;
      }
    }
  }

  const wakeTimes = [
    outgoing?.until ?? null,
    current !== null && desired.visible && current.label !== desired.label
      ? current.shownAt + DUET_LIVE_LABEL_HOLD_MS
      : null,
    current !== null && !desired.visible && hideRequestedAt !== null
      ? hideRequestedAt + DUET_LIVE_HIDE_DELAY_MS
      : null,
    celebrateUntil,
  ].filter((time): time is number => time !== null && time > now);
  const wakeAt = wakeTimes.length > 0 ? Math.min(...wakeTimes) : null;
  const visible = current !== null;

  return {
    machine: { current, outgoing, hideRequestedAt, celebrateUntil },
    output: {
      visible,
      label: current?.label ?? desired.label,
      activity: current?.activity ?? desired.activity,
      outgoing:
        visible && outgoing !== null
          ? { label: outgoing.label, activity: outgoing.activity }
          : null,
      celebrating: celebrateUntil !== null,
    },
    wakeAt,
  };
}
