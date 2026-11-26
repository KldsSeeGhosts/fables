import {
  CaptainError,
  CaptainDocumentContent,
  type Captain,
  type CaptainDocument,
  type CaptainId,
  type ProjectId,
  type ThreadId,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { resolveBriefModelSelection } from "../serverSettings.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as CaptainHandoff from "./captainHandoff.ts";
import * as CaptainStore from "./CaptainStore.ts";

const missing = () => new CaptainError({ code: "not_found", message: "Duet not found." });
const isDocumentContent = Schema.is(CaptainDocumentContent);
const BRIEF_DOCUMENT_CONTEXT_LIMIT = 4_000;
const BRIEF_ACTIVITY_LIMIT = 4_000;

/** Replaces only DIGEST.md's `## New` section, or adds it after the title when the digest has none. */
export const replaceCaptainDigestNewSection = (content: string, section: string): string => {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => /^##\s+New\s*$/i.test(line.trim()));
  const body = section.trim();
  const replacement = ["## New", "", ...(body === "" ? [] : body.split("\n")), ""];
  if (start !== -1) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,2}\s/.test(line.trim()));
    return [...lines.slice(0, start), ...replacement, ...(end === -1 ? [] : rest.slice(end))].join(
      "\n",
    );
  }
  const firstContent = lines.findIndex((line) => line.trim() !== "");
  const insertAt = firstContent !== -1 && /^#\s/.test(lines[firstContent]!) ? firstContent + 1 : 0;
  const afterTitle = insertAt > 0;
  const following = lines.slice(insertAt);
  if (following[0]?.trim() === "") replacement.pop();
  return [
    ...lines.slice(0, insertAt),
    ...(afterTitle ? [""] : []),
    ...replacement,
    ...following,
  ].join("\n");
};

const compactLine = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim();
const excerpt = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;

const formatActivity = (activity: {
  readonly activeTasks: ReadonlyArray<{
    readonly title: string;
    readonly status: string;
    readonly progress?: string | undefined;
  }>;
  readonly pendingRequests: ReadonlyArray<{
    readonly kind: string;
    readonly detail?: string | undefined;
  }>;
  readonly completedTasks: ReadonlyArray<{
    readonly title: string;
    readonly status: string;
    readonly result?: string | undefined;
    readonly completedAt: string;
  }>;
}) => {
  const lines: string[] = [];
  for (const request of activity.pendingRequests.slice(0, 8)) {
    lines.push(`- pending ${request.kind}: ${compactLine(request.detail) ?? "Needs an answer"}`);
  }
  for (const task of activity.activeTasks.slice(0, 8)) {
    lines.push(
      `- active ${task.status}: ${excerpt(compactLine(task.title) ?? "", 100)}${task.progress ? `, ${compactLine(task.progress)}` : ""}`,
    );
  }
  for (const task of activity.completedTasks) {
    lines.push(
      `- finished ${task.status} at ${task.completedAt}: ${task.title}${task.result ? `, ${compactLine(task.result)}` : ""}`,
    );
  }
  return lines.length === 0 ? "- No recent delegated activity." : lines.join("\n");
};

const briefPrompt = (input: {
  readonly captain: Captain;
  readonly notes: string;
  readonly digest: string;
  readonly activity: string;
}) => `Write the next "## New" section of ${input.captain.name}'s DIGEST.md morning brief.

The brief should contain up to 8 Markdown bullets, one line per item that needs the user's attention or decision. Leave out the "## New" heading, code fences, and commentary. Use plain language. Cover progress, open work, blockers, and decisions that need the user. Use the existing digest for continuity. If nothing needs attention, leave the brief empty.

## NOTES.md
${excerpt(input.notes.trim(), BRIEF_DOCUMENT_CONTEXT_LIMIT) || "(empty)"}

## Current DIGEST.md
${excerpt(input.digest.trim(), BRIEF_DOCUMENT_CONTEXT_LIMIT) || "(empty)"}

## Recent activity
${excerpt(input.activity, BRIEF_ACTIVITY_LIMIT)}`;

export class CaptainBriefService extends Context.Service<
  CaptainBriefService,
  {
    readonly generate: (input: {
      readonly captainId: CaptainId;
      readonly projectId?: ProjectId | undefined;
      readonly cwd?: string | undefined;
    }) => Effect.Effect<CaptainDocument, CaptainError | TextGenerationError>;
    readonly generateForThread: (input: {
      readonly threadId: ThreadId;
      readonly projectId?: ProjectId | undefined;
      readonly cwd?: string | undefined;
    }) => Effect.Effect<CaptainDocument, CaptainError | TextGenerationError>;
  }
>()("t3/captains/CaptainBriefService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* CaptainStore.CaptainStore;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;

  const recentCompletedTasks = Effect.fn("CaptainBriefService.recentCompletedTasks")(
    function* (captain: Captain) {
      const now = yield* DateTime.now;
      const cutoff = DateTime.formatIso(DateTime.toUtc(DateTime.subtract(now, { hours: 24 })));
      const conversationIds = [captain.primaryThreadId, ...captain.earlierThreadIds];
      const rows = yield* sql<{
        readonly title: string | null;
        readonly status: string;
        readonly result: string | null;
        readonly progress: string | null;
        readonly completedAt: string;
      }>`
      SELECT substr(json_extract(payload_json, '$.title'), 1, 121) AS title,
        status,
        substr(json_extract(payload_json, '$.result'), 1, 501) AS result,
        substr(json_extract(payload_json, '$.progress'), 1, 241) AS progress,
        COALESCE(completed_at, updated_at) AS completedAt
      FROM orchestration_v2_projection_subagents
      WHERE thread_id IN ${sql.in(conversationIds)}
        AND origin = 'app_owned'
        AND status IN ('completed', 'failed', 'cancelled', 'interrupted')
        AND COALESCE(completed_at, updated_at) >= ${cutoff}
      ORDER BY completedAt DESC
      LIMIT 12
    `;
      return rows.map((row) => ({
        title: row.title ?? "Delegated task",
        status: row.status,
        result: row.result ?? row.progress ?? undefined,
        completedAt: row.completedAt,
      }));
    },
    Effect.mapError(
      () =>
        new CaptainError({
          code: "unavailable",
          message: "Could not read recent Duet activity.",
        }),
    ),
  );

  const generateForCaptain = Effect.fn("CaptainBriefService.generate")(function* (input: {
    readonly captain: Captain;
    readonly projectId?: ProjectId | undefined;
    readonly cwd?: string | undefined;
  }) {
    const { captain } = input;
    const notes = yield* store.document(captain, "NOTES.md");
    const digestBeforeGeneration = yield* store.document(captain, "DIGEST.md");
    const openLoops = yield* CaptainHandoff.readOpenLoops({
      captain,
      threadId: captain.primaryThreadId,
    }).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.mapError(
        () =>
          new CaptainError({
            code: "unavailable",
            message: "Could not read open Duet work.",
          }),
      ),
    );
    const completedTasks = yield* recentCompletedTasks(captain);
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        () =>
          new CaptainError({
            code: "unavailable",
            message: "Could not read brief model settings.",
          }),
      ),
    );
    const generated = yield* textGeneration.generateBriefText({
      cwd: input.cwd ?? process.cwd(),
      projectId: input.projectId ?? captain.scopedProjectIds[0] ?? null,
      modelSelection: resolveBriefModelSelection(settings),
      prompt: briefPrompt({
        captain,
        notes: notes.content,
        digest: digestBeforeGeneration.content,
        activity: formatActivity({ ...openLoops, completedTasks }),
      }),
    });
    const section = generated.text
      .trim()
      .replace(/^##\s+New\s*\n+/i, "")
      .trim();
    if (/^\s*(?:#{1,2}(?:\s|$)|`{3,}|~{3,}|=+[ \t]*$)/m.test(section)) {
      return yield* new TextGenerationError({
        operation: "generateBriefText",
        detail: "The brief model returned headings or code fences instead of a brief.",
      });
    }

    const writeOnce = Effect.gen(function* () {
      const digest = yield* store.document(captain, "DIGEST.md");
      const content = replaceCaptainDigestNewSection(digest.content, section);
      if (content === digest.content) return digest;
      if (!isDocumentContent(content)) {
        return yield* new CaptainError({
          code: "invalid_request",
          message: "The generated brief would exceed the DIGEST.md size limit.",
        });
      }
      return yield* store.updateDocument({
        captainId: captain.id,
        name: "DIGEST.md",
        content,
        expectedRevision: digest.revision,
      });
    });
    const first = yield* Effect.result(writeOnce);
    if (first._tag === "Success") return first.success;
    if (first.failure.code === "conflict") {
      const second = yield* Effect.result(writeOnce);
      if (second._tag === "Success") return second.success;
      return yield* second.failure;
    }
    return yield* first.failure;
  });

  const generate = Effect.fn("CaptainBriefService.generateForId")(function* (
    input: Parameters<CaptainBriefService["Service"]["generate"]>[0],
  ) {
    const captain = yield* store.find(input.captainId);
    if (captain === undefined) return yield* missing();
    return yield* generateForCaptain({ ...input, captain });
  });

  const generateForThread = Effect.fn("CaptainBriefService.generateForThread")(function* (
    input: Parameters<CaptainBriefService["Service"]["generateForThread"]>[0],
  ) {
    const captain = yield* store.findByConversation(input.threadId);
    if (captain === undefined) return yield* missing();
    return yield* generateForCaptain({
      captain,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    });
  });

  return CaptainBriefService.of({ generate, generateForThread });
});

export const layer = Layer.effect(CaptainBriefService, make);
