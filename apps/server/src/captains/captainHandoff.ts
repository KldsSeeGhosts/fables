import type { Captain, ThreadId } from "@t3tools/contracts";
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
// NOTES.md is freeform; the marker keeps replacement from treating unheaded notes as handoff body.
const HANDOFF_END_MARKER = "<!-- end captain handoff -->";

export interface CaptainHandoffTask {
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

export interface CaptainHandoffFacts {
  readonly generatedAt: string;
  readonly activeTasks: ReadonlyArray<CaptainHandoffTask>;
  readonly pendingRequests: ReadonlyArray<CaptainHandoffRequest>;
  readonly lastUserMessage?: string | undefined;
  readonly lastAssistantMessage?: string | undefined;
  readonly scheduledTaskCount?: number | undefined;
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

const capHandoff = (section: string) => {
  const budget = CAPTAIN_HANDOFF_MAX_LENGTH - OMITTED_LINE.length - HANDOFF_END_MARKER.length - 3;
  const lineEnd = section.lastIndexOf("\n", budget);
  const end = lineEnd > 0 ? lineEnd : budget;
  return `${section.slice(0, end).trimEnd()}\n${OMITTED_LINE}\n\n${HANDOFF_END_MARKER}`;
};

export const formatCaptainHandoff = (facts: CaptainHandoffFacts) => {
  const parts = [`${HANDOFF_HEADING} (${facts.generatedAt})`];

  const activeTasks = facts.activeTasks.map((task) => {
    const title = truncate(singleLine(task.title) || singleLine(task.followId), 90);
    const followId = truncate(singleLine(task.followId), 120);
    const progress = truncate(firstLine(task.progress ?? ""), 120);
    return `- ${title} (${singleLine(task.status)}, follow: ${followId})${progress === "" ? "" : `: ${progress}`}`;
  });
  if (activeTasks.length > 0) {
    parts.push(`### Active delegated tasks\n${activeTasks.join("\n")}`);
  }

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

  const lastUserMessage = quoteBlock(facts.lastUserMessage ?? "", 500);
  if (lastUserMessage !== "") {
    parts.push(`### Last user message\n${lastUserMessage}`);
  }

  const lastAssistantMessage = quoteBlock(facts.lastAssistantMessage ?? "", 1_000);
  if (lastAssistantMessage !== "") {
    parts.push(`### Captain's last reply\n${lastAssistantMessage}`);
  }

  const scheduledTaskCount = facts.scheduledTaskCount ?? 0;
  if (scheduledTaskCount > 0) {
    parts.push(
      `### Scheduled tasks\n- ${scheduledTaskCount} scheduled ${scheduledTaskCount === 1 ? "task" : "tasks"} moved to the new conversation.`,
    );
  }

  const body = parts.join("\n\n");
  if (body.length + HANDOFF_END_MARKER.length + 2 <= CAPTAIN_HANDOFF_MAX_LENGTH) {
    return `${body}\n\n${HANDOFF_END_MARKER}`;
  }
  return capHandoff(body);
};

const removeEarlierHandoff = (content: string) => {
  const match = HANDOFF_HEADING_PATTERN.exec(content);
  if (match?.index === undefined) return content;
  const afterHeading = match.index + match[0].length;
  const remainder = content.slice(afterHeading);
  const marker = remainder.indexOf(HANDOFF_END_MARKER);
  const nextSection = remainder.search(NEXT_SECTION_PATTERN);
  let end: number;
  if (marker !== -1 && (nextSection === -1 || marker < nextSection)) {
    end = afterHeading + marker + HANDOFF_END_MARKER.length;
    if (content.slice(end, end + 2) === "\n\n") end += 2;
  } else {
    end = nextSection === -1 ? content.length : afterHeading + nextSection + 1;
  }
  return content.slice(0, match.index) + content.slice(end);
};

export const upsertCaptainHandoffSection = (content: string, section: string) => {
  const rest = removeEarlierHandoff(content);
  const merged = rest === "" ? section : `${section}\n\n${rest}`;
  return merged.length <= CAPTAIN_DOCUMENT_MAX_LENGTH
    ? merged
    : merged.slice(0, CAPTAIN_DOCUMENT_MAX_LENGTH);
};

export const write = Effect.fn("CaptainHandoff.write")(function* (input: {
  readonly captain: Captain;
  readonly previousThreadId: ThreadId;
}) {
  const { captain, previousThreadId } = input;
  const sql = yield* SqlClient.SqlClient;
  const store = yield* CaptainStore.CaptainStore;

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
    WHERE thread_id = ${previousThreadId}
      AND origin = 'app_owned'
      AND status IN ('idle', 'pending', 'running', 'waiting')
    ORDER BY COALESCE(started_at, updated_at), subagent_id
  `;

  const requestThreadIds = [
    previousThreadId,
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

  const section = formatCaptainHandoff({
    generatedAt: DateTime.formatIso(yield* DateTime.now),
    activeTasks: activeTaskRows.map((row) => ({
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
    lastUserMessage: lastUserRow?.text ?? undefined,
    lastAssistantMessage: lastAssistantRow?.text ?? undefined,
    scheduledTaskCount: scheduledTasks?.count ?? 0,
  });

  const writeOnce = Effect.gen(function* () {
    const notes = yield* store.document(captain, "NOTES.md");
    return yield* store.updateDocument({
      captainId: captain.id,
      name: "NOTES.md",
      content: upsertCaptainHandoffSection(notes.content, section),
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
