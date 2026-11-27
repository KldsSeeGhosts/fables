import {
  isCaptainThreadId,
  type Captain,
  type CaptainMemory,
  type OrchestrationV2AppThreadLineage,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as PeerLinks from "../peer/PeerLinks.ts";
import * as ProjectService from "../project/ProjectService.ts";
import {
  makeCaptainBriefingLedger,
  type CaptainBriefingDelivery,
} from "./captainBriefingLedger.ts";
import * as CaptainHonchoMemory from "./CaptainHonchoMemory.ts";
import * as CaptainStore from "./CaptainStore.ts";
import { captainDigestSummary } from "./captainDigest.ts";
import {
  CAPTAIN_HANDOFF_MAX_LENGTH,
  formatCaptainCompactionOpenLoops,
  readOpenLoops,
  splitCaptainHandoffSection,
} from "./captainHandoff.ts";

const prefix = (text: string, length: number) =>
  text.length <= length ? text : `${text.slice(0, length)}…`;

// The report policy decides whether finished crew wakes the Captain, so the waiting rule follows it.
const crewWaitRule: Record<Captain["reportPolicy"], string> = {
  react: "While Solos work, end your turn and let completion wake you. Do not poll.",
  context:
    "While Solos work, end your turn. Finished reports arrive with the user's next message, not as a wake-up. Do not poll.",
  ignore:
    "While Solos work, end your turn. You are not told when a Solo finishes; check a task with `task_status` only when the user asks about it. Do not poll.",
};

const coordinatorBriefing = (captain: Captain) => `How you work:
- Answer quick questions and lookups yourself.
- Delegate anything that edits code with \`delegate_task\` and \`isolation: "worktree"\`. In a project that tracks several repositories, pass \`repositories\` with the ones the Solo edits.
- A Solo in a worktree gets its own copy of each repository. In the brief, name a repository by its folder name and files by their path inside it, never by your checkout's absolute paths.
- Choose how many Solos the task needs: one Solo for one change, two to four for independent parallel work, none for a lookup.
- Every brief states the objective, the expected output, boundaries (files or areas it owns and must not touch), and a done-check (the command or observation that proves it is done).
- ${crewWaitRule[captain.reportPolicy]}
- Relay each result to the user as one line plus the task link. Do not paste Solo output.
- Questions a Solo asks the user stay in that Solo's thread.
- When a Solo opens a PR you are responsible for, watch it with \`watch_pull_request\`.
- Settle or archive finished task threads with \`t3_thread_organize\` once relayed.
- At the end of a substantial turn, keep NOTES.md current (plan, open loops, next step) with \`captain_document_write\`.
- After reacting to Solo results, rewrite the \`## New\` section of DIGEST.md with one line per result that needs the user.`;

const chorusBriefing = (captain: Captain) => `How you work:
- You are the Chorus, the fleet-level Duet. Answer cross-project and cross-Duet questions yourself from \`duet_list\`, \`duet_read\`, \`duet_memory_search\`, \`t3_thread_list\` and \`t3_thread_read\`.
- Route project work to the Duet whose scope covers it with \`duet_send\`. Never ask a Duet to do something the user didn't ask for.
- Start a Solo only for a one-off in a project no Duet covers.
- Relay each result to the user as one line plus the thread link. Do not paste Duet or Solo output.
- While work runs, end your turn. Do not poll.
- Keep no project plans or implementation state in NOTES.md. NOTES.md is only for what the user asked of Chorus itself.
- ${crewWaitRule[captain.reportPolicy]}`;

const CHORUS_ROSTER_DUET_LIMIT = 12;
const CHORUS_ROSTER_LENGTH = 2_000;

const formatChorusRoster = (input: {
  readonly duets: ReadonlyArray<{
    readonly name: string;
    readonly role: string;
    readonly scopeTitles: ReadonlyArray<string>;
    readonly digestSummary: string;
  }>;
  readonly omittedDuets?: number;
  readonly linkedMachineLabels: ReadonlyArray<string>;
}) => {
  const duets = input.duets.slice(0, CHORUS_ROSTER_DUET_LIMIT);
  const lines =
    duets.length === 0
      ? ["- No active Duets on this machine."]
      : duets.map(
          (duet) =>
            `- ${prefix(duet.name, 80)}${duet.role ? ` (${prefix(duet.role, 80)})` : ""}. Scope: ${
              duet.scopeTitles.length === 0
                ? "No projects selected"
                : duet.scopeTitles.map((title) => prefix(title, 80)).join(", ")
            }. Digest: ${prefix(duet.digestSummary, 140)}`,
        );
  const omitted = Math.max(input.omittedDuets ?? 0, input.duets.length - duets.length);
  if (omitted > 0)
    lines.push(`- ${omitted} more active Duets. Use \`duet_list\` for the full roster.`);
  const linked =
    input.linkedMachineLabels.length === 0
      ? "Linked machines: none linked."
      : `Linked machines: ${input.linkedMachineLabels.map((label) => prefix(label, 80)).join(", ")}. Use \`duet_list\` for their Duets.`;
  return prefix(["Duets on this machine:", ...lines, linked].join("\n"), CHORUS_ROSTER_LENGTH - 1);
};

export const formatCaptainBriefing = (input: {
  readonly captain: Captain;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly memories: ReadonlyArray<CaptainMemory>;
  readonly agents: string;
  readonly notes: string;
  readonly fleetRoster?: string;
}) => {
  const { captain, projects, memories, agents, notes } = input;
  const handoffSplit = splitCaptainHandoffSection(notes);
  const notesBody = handoffSplit.rest.trim();
  return [
    `Duet profile: ${captain.name}${captain.role ? ` (${captain.role})` : ""}`,
    captain.instructions && `Instructions:\n${prefix(captain.instructions, 4_000)}`,
    captain.kind === "chorus"
      ? chorusBriefing(captain)
      : captain.coordinatorOnly && coordinatorBriefing(captain),
    captain.kind === "chorus" && input.fleetRoster !== undefined
      ? input.fleetRoster
      : projects.length > 0
        ? `Scoped local projects:\n${projects.map(({ id, title }) => `- ${prefix(title, 100)} [${prefix(id, 100)}]`).join("\n")}${captain.scopedProjectIds.length > projects.length ? "\n- Additional projects are listed in captain_read." : ""}`
        : "Workspace scope: No projects selected.",
    memories.length > 0 &&
      `Essential memories:\n${memories.map(({ text }) => `- ${prefix(text, 500)}`).join("\n")}`,
    agents && `AGENTS.md:\n${prefix(agents, 2_000)}`,
    handoffSplit.handoff &&
      `Conversation handoff:\n${prefix(handoffSplit.handoff, CAPTAIN_HANDOFF_MAX_LENGTH)}`,
    notesBody && `NOTES.md:\n${prefix(notesBody, 6_000)}`,
    "Use captain_document_read and captain_memory_search to look up more Duet context.",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const formatCaptainLongTermMemoryBlock = (text: string) =>
  text.trim() === ""
    ? ""
    : `Long-term memory:
${prefix(text, 4_000)}`;

const firstParagraph = (result: string) => {
  const [paragraph = ""] = result.trim().split(/\r?\n\s*\r?\n/, 1);
  return prefix(paragraph.replace(/\s+/g, " ").trim(), 280);
};

// task_status only finds tasks of the calling conversation, so earlier ones point at their thread.
const fullReportPointer = (
  report: {
    readonly id: string;
    readonly threadId?: string;
    readonly childThreadId?: string | null;
  },
  currentThreadId: string | undefined,
) =>
  report.threadId === undefined || report.threadId === currentThreadId
    ? ` Read the full report with task_status(taskId: "${report.id}").`
    : report.childThreadId
      ? ` It ran from an earlier conversation; read the full report with t3_thread_read(threadId: "${report.childThreadId}").`
      : "";

export const formatCaptainReports = (
  reports: ReadonlyArray<{
    readonly id: string;
    readonly title: string | null;
    readonly result: string;
    readonly threadId?: string;
    readonly childThreadId?: string | null;
  }>,
  currentThreadId?: string,
) =>
  reports.length === 0
    ? ""
    : `Recent delegated task reports:\n${reports
        .slice(0, 6)
        .map((report) => {
          const summary = firstParagraph(report.result);
          const label = `${prefix(report.title ?? report.id, 140)} [${report.id}]`;
          return `- ${summary === "" ? label : `${label}: ${summary}`}${fullReportPointer(report, currentThreadId)}`;
        })
        .join("\n")}`;

export const formatCaptainCrewRules = (captain: Captain, crew: string) =>
  [
    `Rules for Solos from Duet ${captain.name}:\n- Work only in your own working directory and the folders listed with it. If the brief gives a path in another checkout, use the matching folder in yours.\n- For multi-step work, keep a progress note in your worktree and commit after each step.\n- Run the focused tests or checks that prove the change, and report the evidence.\n- Do not report done until the done-check from your brief passes.\n- End your final message with a 2 to 4 sentence summary first, then details.\n- If you took a screenshot or made an image of the result, put the clearest one in that final message as a markdown image with its absolute path.`,
    crew.trim() === "" ? "" : `CREW.md:\n${prefix(crew, 2_000)}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");

/** Share of the context limit at which a Captain is told to save its durable state. */
const CAPTAIN_CONTEXT_PRESSURE_RATIO = 0.75;

// Provider compaction owns the context window; NOTES.md is the durable plan that survives it.
export const formatCaptainContextPressure = (usage: {
  readonly usedTokens: number | null;
  readonly maxTokens: number | null;
  readonly autoCompactThreshold: number | null;
}) => {
  const limit = usage.autoCompactThreshold ?? usage.maxTokens;
  if (usage.usedTokens === null || limit === null || limit <= 0) return "";
  const ratio = usage.usedTokens / limit;
  if (ratio < CAPTAIN_CONTEXT_PRESSURE_RATIO) return "";
  const percent = Math.min(100, Math.round(ratio * 100));
  const measure =
    usage.autoCompactThreshold === null ? "full" : "of the way to automatic compaction";
  return `Context check: this conversation is ${percent}% ${measure}. Keep NOTES.md current now (plan, open loops, next step) with \`captain_document_write\`; it is the durable plan when the provider compacts this conversation.`;
};

const unchangedBriefing = (captain: Captain) =>
  `Duet ${captain.name}: your profile, instructions, scope, essential memories, AGENTS.md, NOTES.md and how you work are unchanged since they were last given in this conversation. Use captain_read, captain_document_read and captain_memory_search if you need them again.`;

const unchangedCrewRules = (captain: Captain) =>
  `Duet ${captain.name}'s rules for Solos are unchanged since they were last given in this conversation.`;

export interface CaptainTurnContext {
  readonly text: string;
  /** Records that the provider accepted this turn's briefing; run it only once the turn started. */
  readonly delivered: Effect.Effect<void>;
}

const NO_CONTEXT: CaptainTurnContext = { text: "", delivered: Effect.void };

type CaptainContextThread = {
  readonly id: ThreadId;
  readonly lineage: Pick<
    OrchestrationV2AppThreadLineage,
    "parentThreadId" | "relationshipToParent"
  >;
};

/** Whether a turn on this thread may carry a Captain briefing or crew rules. Reads no state. */
export const mayCarryCaptainContext = ({ id, lineage }: CaptainContextThread) =>
  isCaptainThreadId(id) ||
  (lineage.relationshipToParent === "subagent" &&
    lineage.parentThreadId !== null &&
    isCaptainThreadId(lineage.parentThreadId));

export const makeReadCaptainTurnContext = Effect.gen(function* () {
  const store = yield* Effect.serviceOption(CaptainStore.CaptainStore);
  const sql = yield* Effect.serviceOption(SqlClient.SqlClient);
  const projects = yield* ProjectService.ProjectService;
  const peerLinks = yield* Effect.serviceOption(PeerLinks.PeerLinks);
  const briefings = makeCaptainBriefingLedger();
  const crewBriefings = makeCaptainBriefingLedger();
  const longTermMemoryBriefings = makeCaptainBriefingLedger();
  const honcho = yield* Effect.serviceOption(CaptainHonchoMemory.CaptainHonchoMemory);

  const projectEntries = Effect.fnUntraced(function* (projectIds: Captain["scopedProjectIds"]) {
    return yield* Effect.forEach(projectIds.slice(0, CHORUS_ROSTER_DUET_LIMIT), (id) =>
      projects.getById(id).pipe(
        Effect.map(
          Option.match({
            onNone: () => ({ id, title: "Unavailable project" }),
            onSome: (project) => ({ id, title: project.title }),
          }),
        ),
      ),
    );
  });

  // A delegated child gets the Captain's crew rules only, never its private profile or memories.
  const readCrewContext = Effect.fn("CaptainService.crewContext")(function* (
    parentThreadId: ThreadId,
    delivery?: CaptainBriefingDelivery,
  ) {
    if (Option.isNone(store)) return NO_CONTEXT;
    const captain = yield* store.value.findByConversation(parentThreadId);
    if (captain === undefined || captain.archivedAt !== null) return NO_CONTEXT;
    const crew = yield* store.value.document(captain, "CREW.md");
    const rules = formatCaptainCrewRules(captain, crew.content);
    const plan = delivery === undefined ? undefined : crewBriefings.plan(delivery, rules);
    return {
      text: plan?.full === false ? unchangedCrewRules(captain) : rules,
      delivered: plan === undefined ? Effect.void : Effect.sync(plan.commit),
    };
  });

  return Effect.fn("CaptainService.turnContext")(
    function* (thread: CaptainContextThread, delivery?: CaptainBriefingDelivery) {
      const threadId = thread.id;
      if (Option.isNone(store)) return NO_CONTEXT;
      if (!isCaptainThreadId(threadId)) {
        const { parentThreadId, relationshipToParent } = thread.lineage;
        return relationshipToParent === "subagent" &&
          parentThreadId !== null &&
          isCaptainThreadId(parentThreadId)
          ? yield* readCrewContext(parentThreadId, delivery)
          : NO_CONTEXT;
      }
      const captain = yield* store.value.byThread(threadId);
      if (captain === undefined) return NO_CONTEXT;
      const { document, listMemories } = store.value;
      const agents = yield* document(captain, "AGENTS.md");
      const notes = yield* document(captain, "NOTES.md");
      const memories = yield* listMemories(captain.id, { essential: true, limit: 8 });
      const scopedProjects = yield* projectEntries(captain.scopedProjectIds);
      // Earlier conversations can't be woken, so their late reports surface here under react too.
      const reportThreadIds =
        captain.reportPolicy === "context"
          ? [threadId, ...captain.earlierThreadIds]
          : captain.reportPolicy === "react"
            ? captain.earlierThreadIds
            : [];
      const onlySinceLastTurn = captain.reportPolicy === "react";
      const reports =
        reportThreadIds.length > 0 && Option.isSome(sql)
          ? yield* sql.value<{
              readonly id: string;
              readonly title: string | null;
              readonly result: string;
              readonly threadId: string;
              readonly childThreadId: string | null;
            }>`
          SELECT subagent_id AS id, json_extract(payload_json, '$.title') AS title,
            substr(json_extract(payload_json, '$.result'), 1, 281) AS result,
            thread_id AS threadId, child_thread_id AS childThreadId
          FROM orchestration_v2_projection_subagents
          WHERE ${sql.value.in("thread_id", reportThreadIds)}
            AND origin = 'app_owned'
            AND status IN ('completed', 'failed', 'cancelled', 'interrupted')
            AND json_extract(payload_json, '$.result') IS NOT NULL
            AND (${onlySinceLastTurn ? 1 : 0} = 0 OR completed_at > COALESCE(
              (SELECT max(requested_at) FROM orchestration_v2_projection_runs
                WHERE thread_id = ${threadId} AND completed_at IS NOT NULL),
              (SELECT created_at FROM orchestration_v2_projection_threads
                WHERE thread_id = ${threadId}),
              ''))
          ORDER BY completed_at DESC, subagent_id DESC LIMIT 6
        `
          : [];
      const fleetRoster =
        captain.kind === "chorus"
          ? yield* Effect.gen(function* () {
              const snapshot = yield* store.value.snapshot({});
              const active = snapshot.captains.filter((entry) => entry.archivedAt === null);
              const shown = active.slice(0, CHORUS_ROSTER_DUET_LIMIT);
              const duets = yield* Effect.forEach(
                shown,
                (entry) =>
                  Effect.gen(function* () {
                    const digest = yield* store.value.document(entry, "DIGEST.md");
                    const scope = yield* projectEntries(entry.scopedProjectIds);
                    return {
                      name: entry.name,
                      role: entry.role,
                      scopeTitles: scope.map((project) => project.title),
                      digestSummary: captainDigestSummary(digest.content),
                    };
                  }),
                { concurrency: 4 },
              );
              return formatChorusRoster({
                duets,
                omittedDuets: active.length - shown.length,
                linkedMachineLabels: Option.isSome(peerLinks)
                  ? (yield* peerLinks.value.names).map((machine) => machine.label)
                  : [],
              });
            })
          : undefined;
      const briefing = formatCaptainBriefing({
        captain,
        projects: scopedProjects,
        memories,
        agents: agents.content,
        notes: notes.content,
        ...(fleetRoster === undefined ? {} : { fleetRoster }),
      });
      const longTermMemory =
        Option.isSome(honcho) && honcho.value.enabled
          ? yield* honcho.value.longTermMemory(captain)
          : Option.none<string>();
      const longTermMemoryBlock = Option.isSome(longTermMemory)
        ? formatCaptainLongTermMemoryBlock(longTermMemory.value)
        : "";
      const plan = delivery === undefined ? undefined : briefings.plan(delivery, briefing);
      const longTermMemoryPlan =
        delivery === undefined || (longTermMemoryBlock === "" && plan?.compacted !== true)
          ? undefined
          : longTermMemoryBriefings.plan(delivery, longTermMemoryBlock);
      const compactionOpenLoops =
        plan?.compacted === true && Option.isSome(sql)
          ? formatCaptainCompactionOpenLoops(
              yield* readOpenLoops({ captain, threadId }).pipe(
                Effect.provideService(SqlClient.SqlClient, sql.value),
              ),
            )
          : "";
      return {
        text: [
          plan?.full === false ? unchangedBriefing(captain) : briefing,
          compactionOpenLoops,
          delivery === undefined || plan?.compacted === true || longTermMemoryPlan?.full === true
            ? longTermMemoryBlock
            : "",
          formatCaptainReports(reports, threadId),
          delivery === undefined
            ? ""
            : formatCaptainContextPressure({
                usedTokens: delivery.usedTokens,
                maxTokens: delivery.maxTokens ?? null,
                autoCompactThreshold: delivery.autoCompactThreshold ?? null,
              }),
        ]
          .filter((part) => part !== "")
          .join("\n\n"),
        delivered:
          plan === undefined
            ? Effect.void
            : Effect.sync(() => {
                plan.commit();
                longTermMemoryPlan?.commit();
              }),
      };
    },
    Effect.catch((cause) =>
      Effect.logWarning("Could not read Duet turn context.", { cause }).pipe(Effect.as(NO_CONTEXT)),
    ),
  );
});
