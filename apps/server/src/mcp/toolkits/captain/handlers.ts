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
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
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
  if (scope.chorus !== true) return yield* chorusDenied();
});

const DUET_READ_CONTENT_LIMIT = 16_000;
const DUET_READ_TRUNCATION_MARKER = "\n\n[truncated: content exceeds 16,000 characters]";

const capDuetReadContent = <Document extends { readonly content: string }>(document: Document) => {
  if (document.content.length <= DUET_READ_CONTENT_LIMIT) return { document, truncated: false };
  const bodyLength = DUET_READ_CONTENT_LIMIT - DUET_READ_TRUNCATION_MARKER.length;
  return {
    document: {
      ...document,
      content: `${document.content.slice(0, bodyLength)}${DUET_READ_TRUNCATION_MARKER}`,
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
    const owner = callerCaptain(store);

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
    const captains = Effect.fnUntraced(function* (store: CaptainStore.CaptainStore["Service"]) {
      const snapshot = yield* store.snapshot({}).pipe(Effect.mapError(failed));
      return snapshot.captains;
    });
    return {
      duet_list: McpToolAccess.reads(() =>
        chorusStore.pipe(
          Effect.flatMap((store) =>
            Effect.gen(function* () {
              const all = yield* captains(store);
              return {
                duets: yield* Effect.forEach(
                  all,
                  (captain) =>
                    Effect.gen(function* () {
                      const digest = yield* store
                        .document(captain, "DIGEST.md")
                        .pipe(Effect.mapError(failed));
                      return {
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
                ),
              };
            }),
          ),
        ),
      ),
      duet_read: McpToolAccess.reads(({ duetId, document: name }) =>
        chorusStore.pipe(
          Effect.flatMap((store) =>
            Effect.gen(function* () {
              const captain = yield* store.requireCaptain(duetId).pipe(Effect.mapError(failed));
              if (name === undefined) return { profile: captain };
              const document = yield* store.document(captain, name).pipe(Effect.mapError(failed));
              return capDuetReadContent(document);
            }),
          ),
        ),
      ),
      duet_memory_search: McpToolAccess.reads(({ query, duetId }) =>
        chorusStore.pipe(
          Effect.flatMap((store) =>
            Effect.gen(function* () {
              const all = yield* captains(store);
              const byId = new Map(all.map((captain) => [captain.id, captain]));
              if (duetId !== undefined && !byId.has(duetId)) {
                return yield* new OrchestratorMcpFailure({
                  code: "invalid_request",
                  message: "Duet not found.",
                });
              }
              const memories = yield* store
                .listMemories(duetId, {
                  ...(query === undefined ? {} : { query }),
                  limit: 20,
                })
                .pipe(Effect.mapError(failed));
              return {
                matches: memories.flatMap((memory) => {
                  const captain = byId.get(memory.captainId);
                  return captain === undefined
                    ? []
                    : [
                        {
                          source: "local" as const,
                          duet: { id: captain.id, name: captain.name },
                          memory,
                        },
                      ];
                }),
              };
            }),
          ),
        ),
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
