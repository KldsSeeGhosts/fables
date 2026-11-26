import type { CaptainTaskStatus } from "@t3tools/client-runtime/state/captain-tasks";
import type { CaptainInboxItem } from "@t3tools/client-runtime/state/captains";
import { msg } from "gt-react-native";

export const CAPTAIN_TASK_STATUS_LABELS: Readonly<Record<CaptainTaskStatus, string>> = {
  "needs-input": msg("Needs input", { $context: "delegated task status" }),
  working: msg("Working", { $context: "delegated task status" }),
  ready: msg("Ready for you", { $context: "delegated task status" }),
  failed: msg("Failed", { $context: "delegated task status" }),
  stopped: msg("Stopped", { $context: "delegated task status" }),
  scheduled: msg("Scheduled", { $context: "delegated task status" }),
  done: msg("Resolved", { $context: "delegated task status" }),
  unknown: msg("Status unavailable", { $context: "delegated task status" }),
};

export const CAPTAIN_INBOX_KIND_LABELS: Readonly<Record<CaptainInboxItem["kind"], string>> = {
  approval: msg("Approval requested"),
  input: msg("Question waiting"),
  "subagent-request": msg("Delegation request"),
};

/** What a Duet row says it waits on, in place of its time. */
export const DUET_WAITING_LABELS: Readonly<Record<CaptainInboxItem["kind"], string>> = {
  approval: msg("Approval", { $context: "a Duet waits on the user's approval" }),
  input: msg("Question", { $context: "a Duet waits on the user's answer" }),
  "subagent-request": msg("Delegation", { $context: "a Duet waits on a delegation request" }),
};

export const DUET_WAITING_ICONS = {
  approval: "exclamationmark.shield",
  input: "questionmark.bubble",
  "subagent-request": "arrow.triangle.branch",
} as const satisfies Record<CaptainInboxItem["kind"], string>;
