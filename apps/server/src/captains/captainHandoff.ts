import type { Captain, CaptainConversationEndReason, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as CaptainStore from "./CaptainStore.ts";

export const CAPTAIN_HANDOFF_MAX_LENGTH = 1_800;
export const CAPTAIN_DOCUMENT_MAX_LENGTH = 64_000;

const HANDOFF_HEADING = "## Handoff from the previous conversation";
const HANDOFF_HEADING_PATTERN = /^## Handoff from the previous conversation[^\n]*/m;
const NEXT_SECTION_PATTERN = /\n## /;
const OMITTED_LINE = "- Additional handoff details were omitted to keep this section short.";
const OPEN_LOOPS_OMITTED_LINE = "- Additional open loops were omitted to keep this section short.";
// NOTES.md is freeform; the marker keeps replacement from treating unheaded notes as handoff body.
const HANDOFF_END_MARKER = "<!-- end captain handoff -->";
// Only a marker on its own line ends the section; a quoted message that mentions it stays body text.
const HANDOFF_END_MARKER_LINE = /^<!-- end captain handoff -->$/m;

export interface CaptainHandoffTask {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly progress?: string | undefined;
  readonly followId: string;
}

export interface CaptainHandoffRequest {
  readonly kind: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly detail?: string | undefined;
}

export interface CaptainOpenLoops {
  readonly activeTasks: ReadonlyArray<CaptainHandoffTask>;
  readonly pendingRequests: ReadonlyArray<CaptainHandoffRequest>;
}

export interface CaptainHandoffFacts extends CaptainOpenLoops {
  readonly generatedAt: string;
  readonly lastUserMessage?: string | undefined;
  readonly lastAssistantMessage?: string | undefined;
  readonly scheduledTaskCount?: number | undefined;
  readonly resetReason?: CaptainConversationEndReason | undefined;
}

const truncate = (text: string, length: number) =>
  text.length <= length ? text : `${text.slice(0, length)}…`;

const singleLine = (text: string) => text.replace(/\s+/g, " ").trim();

const firstLine = (text: string) => singleLine(text.trim().split(/\r?\n/, 1)[0] ?? "");

const quoteBlock = (text: string, length: number) => {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  return truncate(trimmed, length)
    .split(/\r?\n/)
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
};

const capSection = (section: string, endMarker: string, omittedLine: string) => {
  const footer = endMarker === "" ? omittedLine : `${omittedLine}\n\n${endMarker}`;
  const budget = CAPTAIN_HANDOFF_MAX_LENGTH - footer.length - 1;
  const lineEnd = section.lastIndexOf("\n", budget);
  const end = lineEnd > 0 ? lineEnd : budget;
  return `${section.slice(0, end).trimEnd()}\n${footer}`;
};

const openLoopParts = (facts: CaptainOpenLoops) => {
  const parts: string[] = [];
  const activeTasks = facts.activeTasks.map((task) => {
    const title = truncate(singleLine(task.title) || singleLine(task.followId), 90);
    const id = truncate(singleLine(task.id), 120);
    const followId = truncate(singleLine(task.followId), 120);
    const progress = truncate(firstLine(task.progress ?? ""), 120);
    return `- ${title} [${id}] (${singleLine(task.status)}, follow: ${followId})${progress === "" ? "" : `: ${progress}`}`;
  });
  const pendingRequests = facts.pendingRequests.map((request) => {
    const kind = request.kind === "user_input" ? "user input" : `${request.kind} approval`;
    const threadId = truncate(singleLine(request.threadId), 120);
    const requestId = truncate(singleLine(request.requestId), 120);
    const detail = truncate(singleLine(request.detail ?? ""), 140);
    return `- ${kind} on ${threadId}${detail === "" ? "" : `: ${detail}`} [request: ${requestId}]`;
  });
  if (pendingRequests.length > 0) {
    parts.push(`### Waiting on the user\n${pendingRequests.join("\n")}`);
  }
  if (activeTasks.length > 0) {
    parts.push(`### Active delegated tasks\n${activeTasks.join("\n")}`);
  }
  return parts;
};

const resetReasonText = (reason: CaptainConversationEndReason | undefined) => {
  switch (reason) {
    case "context_overflow":
      return "This conversation ended because the context window overflowed. The new conversation continues from this handoff.";
    case "compaction_failed":
      return "This conversation ended because context compaction failed. The new conversation continues from this handoff.";
    case "threshold":
      return "This conversation ended because it reached the context rollover threshold. The new conversation continues from this handoff.";
    default:
      return undefined;
  }
};

const formatLoopSection = (input: {
  readonly heading: string;
  readonly facts: CaptainOpenLoops;
  readonly endMarker?: string;
  readonly lastUserMessage?: string | undefined;
  readonly lastAssistantMessage?: string | undefined;
  readonly scheduledTaskCount?: number | undefined;
  readonly resetReason?: CaptainConversationEndReason | undefined;
  readonly omittedLine?: string;
}) => {
  const parts = [input.heading, ...openLoopParts(input.facts)];
  const resetReason = resetReasonText(input.resetReason);
  if (resetReason !== undefined) parts.push(`### Reset reason\n- ${resetReason}`);
  const lastUserMessage = quoteBlock(input.lastUserMessage ?? "", 500);
  if (lastUserMessage !== "") {
    parts.push(`### Last user message\n${lastUserMessage}`);
  }

  const lastAssistantMessage = quoteBlock(input.lastAssistantMessage ?? "", 1_000);
  if (lastAssistantMessage !== "") {
    parts.push(`### Captain's last reply\n${lastAssistantMessage}`);
  }

  const scheduledTaskCount = input.scheduledTaskCount ?? 0;
  if (scheduledTaskCount > 0) {
    parts.push(
      `### Scheduled tasks\n- ${scheduledTaskCount} scheduled ${scheduledTaskCount === 1 ? "task" : "tasks"} moved to the new conversation.`,
    );
  }

  const endMarker = input.endMarker ?? "";
  const suffix = endMarker === "" ? "" : `\n\n${endMarker}`;
  const body = parts.join("\n\n");
  if (body.length + suffix.length <= CAPTAIN_HANDOFF_MAX_LENGTH) {
    return `${body}${suffix}`;
  }
  return capSection(body, endMarker, input.omittedLine ?? OMITTED_LINE);
};

export const formatCaptainHandoff = (facts: CaptainHandoffFacts) =>
  formatLoopSection({
    heading: `${HANDOFF_HEADING} (${facts.generatedAt})`,
    facts,
    endMarker: HANDOFF_END_MARKER,
    lastUserMessage: facts.lastUserMessage,
    lastAssistantMessage: facts.lastAssistantMessage,
    scheduledTaskCount: facts.scheduledTaskCount,
    resetReason: facts.resetReason,
  });

export const formatCaptainCompactionOpenLoops = (facts: CaptainOpenLoops) =>
  facts.activeTasks.length === 0 && facts.pendingRequests.length === 0
    ? ""
    : formatLoopSection({
        heading: "## This conversation was just compacted: open loops",
        facts,
        omittedLine: OPEN_LOOPS_OMITTED_LINE,
      });

export const splitCaptainHandoffSection = (content: string) => {
  const match = HANDOFF_HEADING_PATTERN.exec(content);
  if (match?.index === undefined) return { handoff: "", rest: content };
  const afterHeading = match.index + match[0].length;
  const remainder = content.slice(afterHeading);
  const marker = HANDOFF_END_MARKER_LINE.exec(remainder)?.index ?? -1;
  const nextSection = remainder.search(NEXT_SECTION_PATTERN);
  let end: number;
  if (marker !== -1 && (nextSection === -1 || marker < nextSection)) {
    end = afterHeading + marker + HANDOFF_END_MARKER.length;
    if (content.slice(end, end + 2) === "\n\n") end += 2;
  } else {
    end = nextSection === -1 ? content.length : afterHeading + nextSection + 1;
  }
  return {
    handoff: content.slice(match.index, end).trimEnd(),
    rest: content.slice(0, match.index) + content.slice(end),
  };
};

const removeEarlierHandoff = (content: string) => splitCaptainHandoffSection(content).rest;

/**
 * Puts the new handoff first and drops any earlier one. The user's own notes are never cut, so a
 * handoff that does not fit is left out and only the stale one is removed.
 */
export const upsertCaptainHandoffSection = (content: string, section: string) => {
  const rest = removeEarlierHandoff(content);
  if (rest === "") return { content: section, included: true };
  const merged = `${section}\n\n${rest}`;
  return merged.length <= CAPTAIN_DOCUMENT_MAX_LENGTH
    ? { content: merged, included: true }
    : { content: rest, included: false };
};

/** Reads active crew and unanswered requests across a Captain's current and earlier conversations. */
export const readOpenLoops = Effect.fn("CaptainHandoff.readOpenLoops")(function* (input: {
  readonly captain: Captain;
  readonly threadId: ThreadId;
}) {
  const { captain, threadId } = input;
  const sql = yield* SqlClient.SqlClient;
  // Work started in an earlier conversation can still be running; its line would otherwise be lost.
  const conversationIds = [threadId, ...captain.earlierThreadIds];

  const activeTaskRows = yield* sql<{
    readonly id: string;
    readonly status: string;
    readonly childThreadId: string | null;
    readonly remoteLabel: string | null;
    readonly title: string | null;
    readonly progress: string | null;
  }>`
    SELECT subagent_id AS id, status, child_thread_id AS childThreadId,
      substr(json_extract(payload_json, '$.remoteChild.label'), 1, 121) AS remoteLabel,
      substr(json_extract(payload_json, '$.title'), 1, 91) AS title,
      substr(json_extract(payload_json, '$.progress'), 1, 121) AS progress
    FROM orchestration_v2_projection_subagents
    WHERE thread_id IN ${sql.in(conversationIds)}
      AND origin = 'app_owned'
      AND status IN ('idle', 'pending', 'running', 'waiting')
    ORDER BY COALESCE(started_at, updated_at), subagent_id
  `;

  const requestThreadIds = [
    ...conversationIds,
    ...new Set(
      activeTaskRows.flatMap((row) => (row.childThreadId === null ? [] : [row.childThreadId])),
    ),
  ];
  const pendingRequestRows = yield* sql<{
    readonly id: string;
    readonly threadId: string;
    readonly kind: string;
    readonly detail: string | null;
  }>`
    SELECT DISTINCT requests.runtime_request_id AS id, requests.thread_id AS threadId,
      requests.kind,
      COALESCE(
        substr(json_extract(item.payload_json, '$.prompt'), 1, 141),
        substr(json_extract(item.payload_json, '$.questions[0].question'), 1, 141),
        substr(json_extract(item.payload_json, '$.reason'), 1, 141)
      ) AS detail
    FROM orchestration_v2_projection_runtime_requests AS requests
    LEFT JOIN orchestration_v2_projection_turn_items AS item
      ON item.thread_id = requests.thread_id
      AND item.type IN ('approval_request', 'user_input_request')
      AND json_extract(item.payload_json, '$.requestId') = requests.runtime_request_id
    WHERE requests.thread_id IN ${sql.in(requestThreadIds)}
      AND requests.status = 'pending'
      AND requests.kind IN ('command', 'file-read', 'file-change', 'mcp-elicitation', 'permission', 'user_input')
    ORDER BY requests.created_at, requests.runtime_request_id
  `;

  return {
    activeTasks: activeTaskRows.map((row) => ({
      id: row.id,
      title: row.title ?? row.id,
      status: row.status,
      progress: row.progress ?? undefined,
      followId: row.childThreadId ?? row.remoteLabel ?? row.id,
    })),
    pendingRequests: pendingRequestRows.map((row) => ({
      kind: row.kind,
      threadId: row.threadId,
      requestId: row.id,
      detail: row.detail ?? undefined,
    })),
  } satisfies CaptainOpenLoops;
});

/** Reads the open loops of a Captain conversation before a reset moves its scheduled tasks. */
export const prepare = Effect.fn("CaptainHandoff.prepare")(function* (input: {
  readonly captain: Captain;
  readonly previousThreadId: ThreadId;
  readonly resetReason?: CaptainConversationEndReason | undefined;
}) {
  const { captain, previousThreadId } = input;
  const sql = yield* SqlClient.SqlClient;
  const openLoops = yield* readOpenLoops({ captain, threadId: previousThreadId }).pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
  );
  const [lastUserRow] = yield* sql<{ readonly text: string | null }>`
    SELECT substr(json_extract(payload_json, '$.text'), 1, 501) AS text
    FROM orchestration_v2_projection_messages
    WHERE thread_id = ${previousThreadId} AND role = 'user'
    ORDER BY created_at DESC, message_id DESC LIMIT 1
  `;
  const [lastAssistantRow] = yield* sql<{ readonly text: string | null }>`
    SELECT substr(json_extract(payload_json, '$.text'), 1, 1001) AS text
    FROM orchestration_v2_projection_messages
    WHERE thread_id = ${previousThreadId} AND role = 'assistant'
    ORDER BY created_at DESC, message_id DESC LIMIT 1
  `;
  const [scheduledTasks] = yield* sql<{ readonly count: number }>`
    SELECT count(*) AS count FROM scheduled_tasks WHERE thread_id = ${previousThreadId}
  `;

  return formatCaptainHandoff({
    generatedAt: DateTime.formatIso(yield* DateTime.now),
    ...openLoops,
    lastUserMessage: lastUserRow?.text ?? undefined,
    lastAssistantMessage: lastAssistantRow?.text ?? undefined,
    scheduledTaskCount: scheduledTasks?.count ?? 0,
    resetReason: input.resetReason,
  });
});

/** Writes a prepared handoff into NOTES.md, retrying once when the Captain edits it meanwhile. */
export const save = Effect.fn("CaptainHandoff.save")(function* (input: {
  readonly captain: Captain;
  readonly section: string;
}) {
  const { captain, section } = input;
  const store = yield* CaptainStore.CaptainStore;

  const writeOnce = Effect.gen(function* () {
    const notes = yield* store.document(captain, "NOTES.md");
    const next = upsertCaptainHandoffSection(notes.content, section);
    if (!next.included) {
      yield* Effect.logWarning("NOTES.md has no room for the Captain handoff.");
    }
    if (next.content === notes.content) return notes;
    return yield* store.updateDocument({
      captainId: captain.id,
      name: "NOTES.md",
      content: next.content,
      expectedRevision: notes.revision,
    });
  });
  const first = yield* Effect.result(writeOnce);
  if (first._tag === "Success") return first.success;
  if (first.failure.code !== "conflict") return yield* first.failure;
  const second = yield* Effect.result(writeOnce);
  if (second._tag === "Success") return second.success;
  return yield* second.failure;
});
