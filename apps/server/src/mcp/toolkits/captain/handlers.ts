import {
  CaptainMemoryId,
  OrchestratorMcpFailure,
  type CaptainError,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { captainDigestNewLines } from "../../../captains/captainDigest.ts";
import * as CaptainHonchoMemory from "../../../captains/CaptainHonchoMemory.ts";
import * as CaptainStore from "../../../captains/CaptainStore.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import { CaptainToolkit } from "./tools.ts";

const failed = (error: CaptainError) =>
  new OrchestratorMcpFailure({
    code: error.code === "unavailable" ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

const denied = () =>
  new OrchestratorMcpFailure({
    code: "capability_denied",
    message: "This tool belongs to the active primary thread of a Duet.",
  });

const chorusDenied = () =>
  new OrchestratorMcpFailure({
    code: "capability_denied",
    message: "This tool belongs to the active primary thread of the Chorus.",
  });

const duetStateUnavailable = () =>
  new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: "Duet state is unavailable.",
  });

const requireChorus = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (!McpInvocationContext.chorusOnly(scope)) return yield* chorusDenied();
});

const DUET_READ_CONTENT_LIMIT = 16_000;
const DUET_READ_TRUNCATION_MARKER = "\n\n[truncated: content exceeds 16,000 characters]";
const DUET_MEMORY_SEARCH_TEXT_LIMIT = 16_000;
const HONCHO_RECALL_NOTE = "Honcho recall unavailable; showing local memories only.";

const normalizeMemoryText = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const capDuetReadContent = <Document extends { readonly content: string }>(document: Document) => {
  if (document.content.length <= DUET_READ_CONTENT_LIMIT) return { document, truncated: false };
  const bodyLength = DUET_READ_CONTENT_LIMIT - DUET_READ_TRUNCATION_MARKER.length;
  const body = document.content.slice(0, bodyLength).replace(/[\uD800-\uDBFF]$/u, "");
  return {
    document: {
      ...document,
      content: `${body}${DUET_READ_TRUNCATION_MARKER}`,
    },
    truncated: true,
  };
};

const callerCaptain = Effect.fn("CaptainService.callerCaptain")(function* (
  store: Option.Option<CaptainStore.CaptainStore["Service"]>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const threadId = scope.thread?.threadId;
  if (threadId === undefined || Option.isNone(store)) return yield* denied();
  const captain = yield* store.value.byThread(threadId).pipe(Effect.mapError(failed));
  if (captain === undefined) return yield* denied();
  return { captain, threadId, store: store.value };
});

export const layer = McpToolAccess.toLayer(
  CaptainToolkit,
  Effect.gen(function* () {
    const store = yield* Effect.serviceOption(CaptainStore.CaptainStore);
    const honcho = yield* Effect.serviceOption(CaptainHonchoMemory.CaptainHonchoMemory);
    const random = yield* SecureRandom.SecureRandom;
    const projects = yield* ProjectService.ProjectService;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const owner = callerCaptain(store);
    const localEnvironment = environment.getDescriptor.pipe(
      Effect.map(({ environmentId, label }) => ({ environmentId, environmentLabel: label })),
    );

    const chorusStore = Effect.gen(function* () {
      yield* requireChorus;
      if (Option.isNone(store)) return yield* duetStateUnavailable();
      return store.value;
    });
    const projectTitles = Effect.fnUntraced(function* (projectIds: ReadonlyArray<ProjectId>) {
      return yield* Effect.forEach(
        projectIds,
        (projectId) =>
          projects.getById(projectId).pipe(
            Effect.map(
              Option.match({
                onNone: () => "Unavailable project",
                onSome: (project) => project.title,
              }),
            ),
            Effect.orElseSucceed(() => "Unavailable project"),
          ),
        { concurrency: 4 },
      );
    });
    return {
      duet_list: McpToolAccess.reads(
        Effect.fn("CaptainToolkit.duetList")(function* () {
          const store = yield* chorusStore;
          const { captains } = yield* store.snapshot({}).pipe(Effect.mapError(failed));
          const machine = yield* localEnvironment;
          const duets = yield* Effect.forEach(
            captains,
            (captain) =>
              Effect.gen(function* () {
                const digest = yield* store
                  .document(captain, "DIGEST.md")
                  .pipe(Effect.mapError(failed));
                return {
                  ...machine,
                  id: captain.id,
                  name: captain.name,
                  role: captain.role,
                  kind: captain.kind,
                  scopedProjectTitles: yield* projectTitles(captain.scopedProjectIds),
                  archived: captain.archivedAt !== null,
                  primaryThreadId: captain.primaryThreadId,
                  digestNew: captainDigestNewLines(digest.content),
                };
              }),
            { concurrency: 4 },
          );
          return { duets };
        }),
      ),
      duet_read: McpToolAccess.reads(
        Effect.fn("CaptainToolkit.duetRead")(function* ({ duetId, document: name }) {
          const store = yield* chorusStore;
          const captain = yield* store.requireCaptain(duetId).pipe(Effect.mapError(failed));
          if (name === undefined) return { profile: captain };
          const document = yield* store.document(captain, name).pipe(Effect.mapError(failed));
          return capDuetReadContent(document);
        }),
      ),
      duet_memory_search: McpToolAccess.reads(
        Effect.fn("CaptainToolkit.duetMemorySearch")(function* ({ query, duetId }) {
          const store = yield* chorusStore;
          const captains =
            duetId === undefined
              ? (yield* store.snapshot({}).pipe(Effect.mapError(failed))).captains
              : [yield* store.requireCaptain(duetId).pipe(Effect.mapError(failed))];
          const byId = new Map(captains.map((captain) => [captain.id, captain]));
          const machine = yield* localEnvironment;
          const [memories, recall] = yield* Effect.all(
            [
              store
                .listMemories(duetId, {
                  ...(query === undefined ? {} : { query }),
                  limit: 20,
                })
                .pipe(Effect.mapError(failed)),
              Option.isSome(honcho) && honcho.value.enabled
                ? honcho.value.searchAcrossDuets(captains, query)
                : Effect.succeed({ status: "disabled" as const, results: [] }),
            ],
            { concurrency: 2 },
          );
          const seen = new Set<string>();
          const remember = (text: string) => {
            const key = normalizeMemoryText(text);
            if (key === "" || seen.has(key)) return false;
            seen.add(key);
            return true;
          };
          const localMatches = memories.flatMap((memory) => {
            const captain = byId.get(memory.captainId);
            return captain === undefined || !remember(memory.text)
              ? []
              : [
                  {
                    ...machine,
                    source: "local" as const,
                    duet: { id: captain.id, name: captain.name },
                    memory,
                  },
                ];
          });
          const recalledMatches = recall.results.flatMap((hit) => {
            const captain = byId.get(hit.captainId);
            const text = hit.text.trim();
            return captain === undefined || !remember(text)
              ? []
              : [
                  {
                    ...machine,
                    source: "honcho" as const,
                    duet: { id: captain.id, name: captain.name },
                    memory: {
                      id: CaptainMemoryId.make(`honcho-${hit.id}`),
                      captainId: captain.id,
                      text: `Recalled: ${text}`
                        .slice(0, 4_000)
                        .replace(/[\uD800-\uDBFF]$/u, "")
                        .trimEnd(),
                      essential: false,
                      userControlled: false,
                      createdAt: hit.createdAt,
                      updatedAt: hit.createdAt,
                    },
                  },
                ];
          });
          let remainingText = DUET_MEMORY_SEARCH_TEXT_LIMIT;
          const matches = [];
          for (const match of [...localMatches, ...recalledMatches]) {
            if (matches.length === 20 || remainingText === 0) break;
            if (match.memory.text.length > remainingText) continue;
            remainingText -= match.memory.text.length;
            matches.push(match);
          }
          return {
            matches,
            ...(recall.status === "failed" ? { note: HONCHO_RECALL_NOTE } : {}),
          };
        }),
      ),
      duet_send: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const service = yield* OrchestratorMcpService.OrchestratorMcpService;
          return yield* service.sendToDuet(scope, input);
        }),
      ),
      captain_read: McpToolAccess.readsAsCaller(() =>
        owner.pipe(Effect.map(({ captain }) => captain)),
      ),
      captain_document_read: McpToolAccess.readsAsCaller(({ name }) =>
        owner.pipe(
          Effect.flatMap(({ captain, store }) =>
            store.document(captain, name).pipe(Effect.mapError(failed)),
          ),
        ),
      ),
      captain_document_write: McpToolAccess.actsAsCaller((input) =>
        owner.pipe(
          Effect.flatMap(({ captain, store, threadId }) =>
            store
              .updateDocument({ ...input, captainId: captain.id }, threadId)
              .pipe(Effect.mapError(failed)),
          ),
        ),
      ),
      captain_memory_remember: McpToolAccess.actsAsCaller(({ id, text, essential }) =>
        owner.pipe(
          Effect.flatMap(
            Effect.fnUntraced(function* ({ captain, store, threadId }) {
              return yield* store
                .upsertMemory(
                  {
                    captainId: captain.id,
                    id: id ?? CaptainMemoryId.make(yield* random.uuidV4()),
                    text,
                    essential: essential ?? false,
                  },
                  threadId,
                )
                .pipe(Effect.mapError(failed));
            }),
          ),
        ),
      ),
      captain_memory_forget: McpToolAccess.actsAsCaller(({ id }) =>
        owner.pipe(
          Effect.flatMap(({ captain, store, threadId }) =>
            store
              .deleteMemory({ id, captainId: captain.id }, threadId)
              .pipe(Effect.mapError(failed), Effect.as({ id })),
          ),
        ),
      ),
      captain_memory_search: McpToolAccess.readsAsCaller(({ query }) =>
        owner.pipe(
          Effect.flatMap(
            Effect.fnUntraced(function* ({ captain, store }) {
              const memories = yield* store
                .listMemories(captain.id, { ...(query === undefined ? {} : { query }), limit: 20 })
                .pipe(Effect.mapError(failed));
              const recalled =
                Option.isSome(honcho) && honcho.value.enabled
                  ? yield* honcho.value.search(captain, query)
                  : [];
              return {
                memories: [
                  ...memories,
                  ...recalled.slice(0, Math.max(0, 20 - memories.length)).map((text, index) => ({
                    id: CaptainMemoryId.make(`honcho-recall-${index + 1}`),
                    captainId: captain.id,
                    text: `Recalled: ${text}`.slice(0, 4_000),
                    essential: false,
                    userControlled: false,
                    createdAt: captain.createdAt,
                    updatedAt: captain.createdAt,
                  })),
                ],
              };
            }),
          ),
        ),
      ),
    } satisfies McpToolAccess.Handlers<typeof CaptainToolkit.tools>;
  }),
);
