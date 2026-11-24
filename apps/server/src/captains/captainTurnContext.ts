import { isCaptainThreadId, type Captain, type CaptainMemory } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectService from "../project/ProjectService.ts";
import * as CaptainStore from "./CaptainStore.ts";

const prefix = (text: string, length: number) =>
  text.length <= length ? text : `${text.slice(0, length)}…`;

const formatCaptainContext = (input: {
  readonly captain: Captain;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly memories: ReadonlyArray<CaptainMemory>;
  readonly agents: string;
  readonly notes: string;
  readonly reports: ReadonlyArray<{
    readonly id: string;
    readonly title: string | null;
    readonly result: string;
  }>;
}) => {
  const { captain, projects, memories, agents, notes, reports } = input;
  return [
    `Captain profile: ${captain.name}${captain.role ? ` (${captain.role})` : ""}`,
    captain.instructions && `Instructions:\n${prefix(captain.instructions, 4_000)}`,
    projects.length > 0
      ? `Scoped local projects:\n${projects.map(({ id, title }) => `- ${prefix(title, 100)} [${prefix(id, 100)}]`).join("\n")}${captain.scopedProjectIds.length > projects.length ? "\n- Additional projects are listed in captain_read." : ""}`
      : "Workspace scope: No projects selected.",
    memories.length > 0 &&
      `Essential memories:\n${memories.map(({ text }) => `- ${prefix(text, 500)}`).join("\n")}`,
    agents && `AGENTS.md:\n${prefix(agents, 2_000)}`,
    notes && `NOTES.md:\n${prefix(notes, 2_000)}`,
    "Use captain_document_read and captain_memory_search to look up more Captain context.",
    reports.length > 0 &&
      `Recent delegated task reports:\n${reports.map(({ id, title, result }) => `- ${prefix(title ?? id, 140)} [${id}]: ${prefix(result, 700)}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const makeReadCaptainTurnContext = Effect.gen(function* () {
  const store = yield* Effect.serviceOption(CaptainStore.CaptainStore);
  const sql = yield* Effect.serviceOption(SqlClient.SqlClient);
  const projects = yield* ProjectService.ProjectService;

  return Effect.fn("CaptainService.turnContext")(
    function* (threadId: Captain["primaryThreadId"]) {
      if (!isCaptainThreadId(threadId) || Option.isNone(store)) return "";
      const captain = yield* store.value.byThread(threadId);
      if (captain === undefined) return "";
      const { document, listMemories } = store.value;
      const agents = yield* document(captain, "AGENTS.md");
      const notes = yield* document(captain, "NOTES.md");
      const memories = yield* listMemories(captain.id, { essential: true, limit: 8 });
      const scopedProjects = yield* Effect.forEach(captain.scopedProjectIds.slice(0, 12), (id) =>
        projects.getById(id).pipe(
          Effect.map(
            Option.match({
              onNone: () => ({ id, title: "Unavailable project" }),
              onSome: (project) => ({ id, title: project.title }),
            }),
          ),
        ),
      );
      const reports =
        captain.reportPolicy === "context" && Option.isSome(sql)
          ? yield* sql.value<{
              readonly id: string;
              readonly title: string | null;
              readonly result: string;
            }>`
          SELECT subagent_id AS id, json_extract(payload_json, '$.title') AS title,
            substr(json_extract(payload_json, '$.result'), 1, 701) AS result
          FROM orchestration_v2_projection_subagents
          WHERE thread_id = ${threadId} AND origin = 'app_owned'
            AND status IN ('completed', 'failed', 'cancelled', 'interrupted')
            AND json_extract(payload_json, '$.result') IS NOT NULL
          ORDER BY completed_at DESC, subagent_id DESC LIMIT 4
        `
          : [];
      return formatCaptainContext({
        captain,
        projects: scopedProjects,
        memories,
        agents: agents.content,
        notes: notes.content,
        reports,
      });
    },
    Effect.catch((cause) =>
      Effect.logWarning("Could not read Captain turn context.", { cause }).pipe(Effect.as("")),
    ),
  );
});
