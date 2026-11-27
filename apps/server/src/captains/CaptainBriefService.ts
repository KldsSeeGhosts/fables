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
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { resolveBriefModelSelection } from "../serverSettings.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as CaptainHandoff from "./captainHandoff.ts";
import * as CaptainStore from "./CaptainStore.ts";
import {
  BRIEF_OPEN_ITEM_LIMIT,
  CHORUS_DUET_LIMIT,
  ChorusMachineActivity,
  chorusActivityTool,
  makeReadChorusFleet,
} from "./chorusFleet.ts";

const missing = () => new CaptainError({ code: "not_found", message: "Duet not found." });
const isDocumentContent = Schema.is(CaptainDocumentContent);
const BRIEF_DOCUMENT_CONTEXT_LIMIT = 4_000;
const BRIEF_ACTIVITY_LIMIT = 4_000;
const CHORUS_RECAP_PEER_LIMIT = 8;

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
  limit <= 0 ? "" : value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;

interface BriefActivity {
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
}

const captainDigestNewSection = (content: string) => {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => /^##\s+New\s*$/i.test(line.trim()));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line.trim()));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
};

const formatActivity = (activity: BriefActivity) => {
  const lines: string[] = [];
  for (const request of activity.pendingRequests.slice(0, BRIEF_OPEN_ITEM_LIMIT)) {
    lines.push(`- pending ${request.kind}: ${compactLine(request.detail) ?? "Needs an answer"}`);
  }
  for (const task of activity.activeTasks.slice(0, BRIEF_OPEN_ITEM_LIMIT)) {
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

const formatChorusActivity = (machines: ReadonlyArray<ChorusMachineActivity>, omitted: boolean) => {
  const omittedMachines = omitted ? "- Additional linked machines omitted." : "";
  const machineLimit =
    Math.floor((BRIEF_ACTIVITY_LIMIT - omittedMachines.length) / Math.max(machines.length, 1)) - 2;
  const machineSections = machines.map((machine) => {
    const heading = `## Machine: ${compactLine(machine.label)}`;
    if (machine.unreachableReason !== undefined) {
      const reason = compactLine(machine.unreachableReason) || "No response";
      return excerpt(`${heading}\n\n- Machine unreachable: ${reason}`, machineLimit);
    }
    if (machine.duets.length === 0) return `${heading}\n\n- No active Duets.`;

    const footer = "- Additional active Duets omitted.";
    const room = machineLimit - heading.length - footer.length - 4;
    const duets = machine.duets.slice(0, Math.max(1, Math.floor(room / 150)));
    const duetLimit = Math.floor(room / duets.length) - 2;
    const duetSections = duets.map((activity) => {
      const name = `### Duet: ${excerpt(compactLine(activity.name) ?? "", 100)}\n\nDIGEST.md New:\n`;
      const openHeading = "\n\nOpen activity:\n";
      const contentLimit = Math.max(0, duetLimit - name.length - openHeading.length);
      const digest = activity.digestNew || "(empty)";
      const open = formatActivity({ ...activity, completedTasks: [] });
      const digestLimit = Math.max(Math.floor(contentLimit / 2), contentLimit - open.length);
      const digestExcerpt = excerpt(digest, digestLimit);
      return excerpt(
        name + digestExcerpt + openHeading + excerpt(open, contentLimit - digestExcerpt.length),
        duetLimit,
      );
    });
    const moreDuets = machine.omittedDuets || duets.length < machine.duets.length;
    return [heading, ...duetSections, ...(moreDuets ? [footer] : [])].join("\n\n");
  });
  return [...machineSections, ...(omitted ? [omittedMachines] : [])].join("\n\n");
};

interface BriefPromptInput {
  readonly captain: Captain;
  readonly notes: string;
  readonly digest: string;
  readonly activity: string;
}

const duetBriefPrompt = (
  input: BriefPromptInput,
) => `Write the next "## New" section of ${input.captain.name}'s DIGEST.md recap.

The recap should contain up to 8 Markdown bullets, one line per item that needs the user's attention or decision. Leave out the "## New" heading, code fences, and commentary. Use plain language. Cover progress, open work, blockers, and decisions that need the user. Use the existing digest for continuity. If nothing needs attention, leave the recap empty.

## NOTES.md
${excerpt(input.notes.trim(), BRIEF_DOCUMENT_CONTEXT_LIMIT) || "(empty)"}

## Current DIGEST.md
${excerpt(input.digest.trim(), BRIEF_DOCUMENT_CONTEXT_LIMIT) || "(empty)"}

## Recent activity
${excerpt(input.activity, BRIEF_ACTIVITY_LIMIT)}`;

const chorusBriefPrompt = (
  input: BriefPromptInput,
) => `Write the next "## New" section of ${input.captain.name}'s DIGEST.md recap.

${input.captain.name} is a Chorus covering the user's fleet of Duets. The recap should contain up to 8 Markdown bullets, one line per item that needs the user's attention or decision. Group items by Duet; when the activity includes multiple machines, group first by machine and then by Duet. Put items with the nearest deadline first. Include a line for each unreachable machine. Keep every item on one bullet line and use bold labels instead of section headings. Leave out the "## New" heading, code fences, and commentary. Use plain language. Use the existing digest for continuity. If nothing needs attention, leave the recap empty.

## NOTES.md
${excerpt(input.notes.trim(), BRIEF_DOCUMENT_CONTEXT_LIMIT) || "(empty)"}

## Current DIGEST.md
${excerpt(input.digest.trim(), BRIEF_DOCUMENT_CONTEXT_LIMIT) || "(empty)"}

## Duet activity by machine
${excerpt(input.activity, BRIEF_ACTIVITY_LIMIT)}`;

const briefPrompt = (input: BriefPromptInput) =>
  input.captain.kind === "chorus" ? chorusBriefPrompt(input) : duetBriefPrompt(input);

export class CaptainBriefService extends Context.Service<
  CaptainBriefService,
  {
    readonly readLocalChorusMachineActivity: () => Effect.Effect<
      ChorusMachineActivity,
      CaptainError
    >;
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
  const environment = yield* Effect.serviceOption(ServerEnvironment.ServerEnvironment);
  const readFleet = yield* makeReadChorusFleet;

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

  const readOpenLoops = Effect.fn("CaptainBriefService.readOpenLoops")(
    function* (captain: Captain) {
      return yield* CaptainHandoff.readOpenLoops({
        captain,
        threadId: captain.primaryThreadId,
      }).pipe(Effect.provideService(SqlClient.SqlClient, sql));
    },
    Effect.mapError(
      () =>
        new CaptainError({
          code: "unavailable",
          message: "Could not read open Duet work.",
        }),
    ),
  );

  const readChorusDuetActivity = Effect.fn("CaptainBriefService.readChorusDuetActivity")(
    function* (duet: { readonly id: string; readonly name: string }) {
      const conversations = sql`
        WITH conversations(thread_id) AS (
          SELECT primary_thread_id FROM captains WHERE id = ${duet.id}
          UNION
          SELECT earlier.value FROM captains, json_each(earlier_thread_ids) AS earlier
          WHERE captains.id = ${duet.id}
        )
      `;
      const activeSolos = sql`
        FROM orchestration_v2_projection_subagents
        WHERE thread_id IN (SELECT thread_id FROM conversations)
          AND origin = 'app_owned'
          AND status IN ('idle', 'pending', 'running', 'waiting')
      `;
      const activeTaskRows = yield* sql<{
        readonly title: string;
        readonly status: string;
        readonly progress: string | null;
      }>`
        ${conversations}
        SELECT COALESCE(substr(json_extract(payload_json, '$.title'), 1, 100), substr(subagent_id, 1, 100)) AS title,
          status, substr(json_extract(payload_json, '$.progress'), 1, 120) AS progress
        ${activeSolos}
        ORDER BY COALESCE(started_at, updated_at), subagent_id
        LIMIT ${BRIEF_OPEN_ITEM_LIMIT}
      `;
      // An approval can belong to a Solo outside the displayed task list.
      const pendingRequestRows = yield* sql<{
        readonly kind: string;
        readonly detail: string | null;
      }>`
        ${conversations},
        request_threads(thread_id) AS (
          SELECT thread_id FROM conversations
          UNION
          SELECT child_thread_id ${activeSolos} AND child_thread_id IS NOT NULL
        )
        SELECT requests.kind, (
          SELECT COALESCE(
            substr(json_extract(item.payload_json, '$.prompt'), 1, 140),
            substr(json_extract(item.payload_json, '$.questions[0].question'), 1, 140),
            substr(json_extract(item.payload_json, '$.reason'), 1, 140)
          )
          FROM orchestration_v2_projection_turn_items AS item
          WHERE item.thread_id = requests.thread_id
            AND item.type IN ('approval_request', 'user_input_request')
            AND json_extract(item.payload_json, '$.requestId') = requests.runtime_request_id
          ORDER BY item.ordinal DESC, item.turn_item_id
          LIMIT 1
        ) AS detail
        FROM orchestration_v2_projection_runtime_requests AS requests
        WHERE requests.thread_id IN (SELECT thread_id FROM request_threads)
          AND requests.status = 'pending'
          AND requests.kind IN ('command', 'file-read', 'file-change', 'mcp-elicitation', 'permission', 'user_input')
        ORDER BY requests.created_at, requests.runtime_request_id
        LIMIT ${BRIEF_OPEN_ITEM_LIMIT}
      `;
      const [digest] = yield* sql<{ readonly content: string }>`
        SELECT content FROM captain_documents WHERE captain_id = ${duet.id} AND name = 'DIGEST.md'
      `;
      return {
        name: excerpt(duet.name, 120),
        digestNew: excerpt(captainDigestNewSection(digest?.content ?? ""), 700),
        activeTasks: activeTaskRows.map(({ title, status, progress }) => ({
          title,
          status,
          progress: progress ?? undefined,
        })),
        pendingRequests: pendingRequestRows.map(({ kind, detail }) => ({
          kind,
          detail: detail ?? undefined,
        })),
      } satisfies ChorusMachineActivity["duets"][number];
    },
  );

  const readLocalChorusMachineActivity = Effect.fn(
    "CaptainBriefService.readLocalChorusMachineActivity",
  )(
    function* () {
      const duets = yield* sql<{ readonly id: string; readonly name: string }>`
        SELECT id, name FROM captains
        WHERE kind = 'duet' AND archived_at IS NULL
        ORDER BY id
        LIMIT ${CHORUS_DUET_LIMIT + 1}
      `;
      return {
        label: "This machine",
        duets: yield* Effect.forEach(duets.slice(0, CHORUS_DUET_LIMIT), readChorusDuetActivity),
        omittedDuets: duets.length > CHORUS_DUET_LIMIT,
      } satisfies ChorusMachineActivity;
    },
    sql.withTransaction,
    Effect.catchTags({ SqlError: CaptainStore.captainUnavailable }),
  );

  const readChorusActivity = Effect.fn("CaptainBriefService.readChorusActivity")(function* (
    captain: Captain,
  ) {
    const local = yield* readLocalChorusMachineActivity();
    if (Option.isNone(environment) || captain.archivedAt !== null) {
      return formatChorusActivity([local], false);
    }
    const environmentId = yield* environment.value.getEnvironmentId;
    const { machines, omitted } = yield* readFleet({
      tool: chorusActivityTool,
      success: ChorusMachineActivity,
      limit: CHORUS_RECAP_PEER_LIMIT,
      sender: { environmentId, threadId: captain.primaryThreadId, title: captain.name },
    }).pipe(Effect.catch(CaptainStore.captainUnavailable));
    return formatChorusActivity(
      [
        local,
        ...machines.map(({ label, reply }) => {
          const boundedLabel = excerpt(label, 120);
          return reply._tag === "Success"
            ? { ...reply.success, label: boundedLabel }
            : {
                label: boundedLabel,
                duets: [],
                unreachableReason: excerpt(reply.failure.message, 200),
              };
        }),
      ],
      omitted,
    );
  });

  const generateForCaptain = Effect.fn("CaptainBriefService.generate")(function* (input: {
    readonly captain: Captain;
    readonly projectId?: ProjectId | undefined;
    readonly cwd?: string | undefined;
  }) {
    const { captain } = input;
    const notes = yield* store.document(captain, "NOTES.md");
    const digestBeforeGeneration = yield* store.document(captain, "DIGEST.md");
    const activity =
      captain.kind === "chorus"
        ? yield* readChorusActivity(captain)
        : yield* Effect.gen(function* () {
            const openLoops = yield* readOpenLoops(captain);
            const completedTasks = yield* recentCompletedTasks(captain);
            return formatActivity({ ...openLoops, completedTasks });
          });
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        () =>
          new CaptainError({
            code: "unavailable",
            message: "Could not read recap model settings.",
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
        activity,
      }),
    });
    const section = generated.text
      .trim()
      .replace(/^##\s+New\s*\n+/i, "")
      .trim();
    if (/^\s*(?:#{1,2}(?:\s|$)|`{3,}|~{3,}|=+[ \t]*$)/m.test(section)) {
      return yield* new TextGenerationError({
        operation: "generateBriefText",
        detail: "The recap model returned headings or code fences instead of a recap.",
      });
    }

    const writeOnce = Effect.gen(function* () {
      const digest = yield* store.document(captain, "DIGEST.md");
      const content = replaceCaptainDigestNewSection(digest.content, section);
      if (content === digest.content) return digest;
      if (!isDocumentContent(content)) {
        return yield* new CaptainError({
          code: "invalid_request",
          message: "The generated recap would exceed the DIGEST.md size limit.",
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

  return CaptainBriefService.of({ generate, generateForThread, readLocalChorusMachineActivity });
});

export const layer = Layer.effect(CaptainBriefService, make);
