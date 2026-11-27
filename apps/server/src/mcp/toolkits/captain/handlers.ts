import {
  CaptainMemoryId,
  OrchestratorMcpFailure,
  type CaptainError,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { captainDigestNewLines } from "../../../captains/captainDigest.ts";
import * as CaptainHonchoMemory from "../../../captains/CaptainHonchoMemory.ts";
import * as CaptainStore from "../../../captains/CaptainStore.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as PeerLinks from "../../../peer/PeerLinks.ts";
import { CaptainToolkit } from "./tools.ts";

const isMcpFailure = Schema.is(OrchestratorMcpFailure);

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

const requireChorusReadAccess = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (
    !McpInvocationContext.chorusOnly(scope) &&
    McpInvocationContext.forwardedChorus(scope) === undefined
  ) {
    return yield* chorusDenied();
  }
});

const DUET_READ_CONTENT_LIMIT = 16_000;
const DUET_READ_TRUNCATION_MARKER = "\n\n[truncated: content exceeds 16,000 characters]";
const DUET_MEMORY_SEARCH_TEXT_LIMIT = 16_000;
const HONCHO_RECALL_NOTE = "Honcho recall unavailable; showing local memories only.";
const FLEET_PEER_TIMEOUT = Duration.seconds(5);
const FLEET_MACHINE_RESULT_LIMIT = 50;
const FLEET_PEER_CONCURRENCY = 8;

const fleetReason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);

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
    const forwarding = yield* Effect.serviceOption(PeerForwarding.PeerForwarding);
    const links = yield* Effect.serviceOption(PeerLinks.PeerLinks);
    const owner = callerCaptain(store);
    const localEnvironment = environment.getDescriptor.pipe(
      Effect.map(({ environmentId, label }) => ({ environmentId, environmentLabel: label })),
    );

    const chorusStore = Effect.gen(function* () {
      yield* requireChorusReadAccess;
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
        Effect.fn("CaptainToolkit.duetList")(function* ({ environmentId }) {
          const store = yield* chorusStore;
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const machine = yield* localEnvironment;
          const readLocal = Effect.gen(function* () {
            const { captains } = yield* store.snapshot({}).pipe(Effect.mapError(failed));
            const duets = yield* Effect.forEach(
              captains.slice(0, FLEET_MACHINE_RESULT_LIMIT),
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
            return duets;
          });
          if (
            McpInvocationContext.forwardedChorus(scope) !== undefined ||
            environmentId === scope.environmentId
          )
            return { duets: yield* readLocal };
          const names = Option.isSome(links)
            ? yield* links.value.names().pipe(Effect.orElseSucceed(() => []))
            : [];
          const targets =
            environmentId === undefined
              ? names
              : [
                  {
                    environmentId,
                    label:
                      names.find((link) => link.environmentId === environmentId)?.label ??
                      String(environmentId),
                  },
                ];
          const readRemote = Effect.fn("CaptainToolkit.duetList.readRemote")(function* (target: {
            environmentId: EnvironmentId;
            label: string;
          }) {
            if (Option.isNone(forwarding)) {
              return {
                duets: [],
                unreachable: {
                  environmentId: target.environmentId,
                  environmentLabel: target.label,
                  reason: "Linked environments are unavailable on this machine.",
                },
              };
            }
            const result = yield* Effect.result(
              forwarding.value
                .call(scope, CaptainToolkit.tools.duet_list, target.environmentId, {
                  environmentId: target.environmentId,
                })
                .pipe(Effect.timeout(FLEET_PEER_TIMEOUT)),
            );
            return result._tag === "Success"
              ? {
                  duets: result.success.duets.slice(0, FLEET_MACHINE_RESULT_LIMIT),
                  unreachable: undefined,
                }
              : {
                  duets: [],
                  unreachable: {
                    environmentId: target.environmentId,
                    environmentLabel: target.label,
                    reason: fleetReason(result.failure),
                  },
                };
          });
          if (environmentId !== undefined) {
            const remote = yield* readRemote(targets[0]!);
            return {
              duets: remote.duets,
              ...(remote.unreachable === undefined
                ? {}
                : { unreachableMachines: [remote.unreachable] }),
            };
          }
          const [localDuets, remotes] = yield* Effect.all(
            [
              readLocal,
              Effect.forEach(targets, readRemote, { concurrency: FLEET_PEER_CONCURRENCY }),
            ],
            { concurrency: 2 },
          );
          const unreachableMachines = remotes.flatMap((remote) =>
            remote.unreachable === undefined ? [] : [remote.unreachable],
          );
          return {
            duets: [...localDuets, ...remotes.flatMap((remote) => remote.duets)],
            ...(unreachableMachines.length === 0 ? {} : { unreachableMachines }),
          };
        }),
      ),
      duet_read: McpToolAccess.reads(
        Effect.fn("CaptainToolkit.duetRead")(function* ({ duetId, environmentId, document: name }) {
          const store = yield* chorusStore;
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const machine = yield* localEnvironment;
          const readLocal = Effect.gen(function* () {
            const captain = yield* store.requireCaptain(duetId);
            if (name === undefined) return { profile: captain };
            const document = yield* store.document(captain, name);
            return capDuetReadContent(document);
          }).pipe(Effect.mapError(failed));
          if (
            McpInvocationContext.forwardedChorus(scope) !== undefined ||
            environmentId === scope.environmentId
          )
            return yield* readLocal;
          const names = Option.isSome(links)
            ? yield* links.value.names().pipe(Effect.orElseSucceed(() => []))
            : [];
          const targets =
            environmentId === undefined
              ? names
              : [
                  {
                    environmentId,
                    label:
                      names.find((link) => link.environmentId === environmentId)?.label ??
                      String(environmentId),
                  },
                ];
          const readRemote = Effect.fn("CaptainToolkit.duetRead.readRemote")(function* (target: {
            environmentId: EnvironmentId;
            label: string;
          }) {
            if (Option.isNone(forwarding)) {
              return {
                payload: undefined,
                unreachable: {
                  environmentId: target.environmentId,
                  environmentLabel: target.label,
                  reason: "Linked environments are unavailable on this machine.",
                },
              };
            }
            const result = yield* Effect.result(
              forwarding.value
                .call(scope, CaptainToolkit.tools.duet_read, target.environmentId, {
                  duetId,
                  environmentId: target.environmentId,
                  ...(name === undefined ? {} : { document: name }),
                })
                .pipe(Effect.timeout(FLEET_PEER_TIMEOUT)),
            );
            if (result._tag === "Success") {
              return {
                payload: "results" in result.success ? undefined : result.success,
                unreachable: undefined,
              };
            }
            if (
              isMcpFailure(result.failure) &&
              result.failure.code === "invalid_request" &&
              result.failure.message === "Duet not found."
            ) {
              return { payload: undefined, unreachable: undefined };
            }
            return {
              payload: undefined,
              unreachable: {
                environmentId: target.environmentId,
                environmentLabel: target.label,
                reason: fleetReason(result.failure),
              },
            };
          });
          if (environmentId !== undefined) {
            const target = targets[0]!;
            const remote = yield* readRemote(target);
            return {
              results:
                remote.payload === undefined
                  ? []
                  : [
                      {
                        environmentId: target.environmentId,
                        environmentLabel: target.label,
                        result: remote.payload,
                      },
                    ],
              ...(remote.unreachable === undefined
                ? {}
                : { unreachableMachines: [remote.unreachable] }),
            };
          }
          if (targets.length === 0) return yield* readLocal;
          const [local, remotes] = yield* Effect.all(
            [
              Effect.result(readLocal),
              Effect.forEach(targets, readRemote, { concurrency: FLEET_PEER_CONCURRENCY }),
            ],
            { concurrency: 2 },
          );
          const results = [
            ...(local._tag === "Success" ? [{ ...machine, result: local.success }] : []),
            ...remotes.flatMap((remote, index) =>
              remote.payload === undefined
                ? []
                : [
                    {
                      environmentId: targets[index]!.environmentId,
                      environmentLabel: targets[index]!.label,
                      result: remote.payload,
                    },
                  ],
            ),
          ];
          const unreachableMachines = remotes.flatMap((remote) =>
            remote.unreachable === undefined ? [] : [remote.unreachable],
          );
          if (results.length === 0 && unreachableMachines.length === 0) {
            return yield* new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "Duet not found.",
            });
          }
          return {
            results,
            ...(unreachableMachines.length === 0 ? {} : { unreachableMachines }),
          };
        }),
      ),
      duet_memory_search: McpToolAccess.reads(
        Effect.fn("CaptainToolkit.duetMemorySearch")(function* ({ query, duetId, environmentId }) {
          const store = yield* chorusStore;
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const searchLocal = Effect.gen(function* () {
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
          });
          if (
            McpInvocationContext.forwardedChorus(scope) !== undefined ||
            environmentId === scope.environmentId
          )
            return yield* searchLocal;
          const names = Option.isSome(links)
            ? yield* links.value.names().pipe(Effect.orElseSucceed(() => []))
            : [];
          const targets =
            environmentId === undefined
              ? names
              : [
                  {
                    environmentId,
                    label:
                      names.find((link) => link.environmentId === environmentId)?.label ??
                      String(environmentId),
                  },
                ];
          const searchRemote = Effect.fn("CaptainToolkit.duetMemorySearch.searchRemote")(
            function* (target: { environmentId: EnvironmentId; label: string }) {
              if (Option.isNone(forwarding)) {
                return {
                  result: undefined,
                  unreachable: {
                    environmentId: target.environmentId,
                    environmentLabel: target.label,
                    reason: "Linked environments are unavailable on this machine.",
                  },
                };
              }
              const remote = yield* Effect.result(
                forwarding.value
                  .call(scope, CaptainToolkit.tools.duet_memory_search, target.environmentId, {
                    ...(query === undefined ? {} : { query }),
                    ...(duetId === undefined ? {} : { duetId }),
                    environmentId: target.environmentId,
                  })
                  .pipe(Effect.timeout(FLEET_PEER_TIMEOUT)),
              );
              return remote._tag === "Success"
                ? { result: remote.success, unreachable: undefined }
                : {
                    result: undefined,
                    unreachable: {
                      environmentId: target.environmentId,
                      environmentLabel: target.label,
                      reason: fleetReason(remote.failure),
                    },
                  };
            },
          );
          if (environmentId === undefined && targets.length === 0) return yield* searchLocal;
          const remotes = yield* Effect.forEach(targets, searchRemote, {
            concurrency: FLEET_PEER_CONCURRENCY,
          });
          const local = environmentId === undefined ? yield* searchLocal : { matches: [] };
          const machine = yield* localEnvironment;
          const unreachableMachines = remotes.flatMap((remote) =>
            remote.unreachable === undefined ? [] : [remote.unreachable],
          );
          const notes = [
            ...("note" in local && local.note !== undefined
              ? [`${machine.environmentLabel}: ${local.note}`]
              : []),
            ...remotes.flatMap((remote, index) =>
              remote.result?.note === undefined
                ? []
                : [`${targets[index]!.label}: ${remote.result.note}`],
            ),
          ];
          const note = notes.join(" ").slice(0, 160);
          return {
            matches: [
              ...local.matches,
              ...remotes.flatMap((remote) => (remote.result?.matches ?? []).slice(0, 20)),
            ],
            ...(unreachableMachines.length === 0 ? {} : { unreachableMachines }),
            ...(note === "" ? {} : { note }),
          };
        }),
      ),
      duet_send: McpToolAccess.writesThreads(
        () => [],
        (input) =>
          Effect.gen(function* () {
            const scope = yield* McpInvocationContext.McpInvocationContext;
            const service = yield* OrchestratorMcpService.OrchestratorMcpService;
            const target = PeerForwarding.remoteTarget(scope, input.environmentId);
            if (target === undefined) return yield* service.sendToDuet(scope, input);
            const { captain, store } = yield* owner;
            if (captain.kind !== "chorus" || !McpInvocationContext.chorusOnly(scope)) {
              return yield* chorusDenied();
            }
            if (Option.isNone(forwarding)) return yield* duetStateUnavailable();
            const peer = forwarding.value;
            return yield* Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const sent = yield* restore(
                  peer
                    .call(scope, CaptainToolkit.tools.duet_send, target, {
                      ...input,
                      environmentId: target,
                    })
                    .pipe(
                      Effect.timeout(FLEET_PEER_TIMEOUT),
                      Effect.mapError((error) =>
                        isMcpFailure(error)
                          ? error
                          : new OrchestratorMcpFailure({
                              code: "orchestration_error",
                              message: "The linked machine did not confirm the route in time.",
                            }),
                      ),
                    ),
                );
                if (sent.environmentId !== target || sent.duetId !== input.duetId) {
                  return yield* new OrchestratorMcpFailure({
                    code: "orchestration_error",
                    message: "The linked machine returned a receipt for a different destination.",
                  });
                }
                yield* store
                  .recordRemoteChorusRoute(captain.id, {
                    ...sent,
                    duetName: sent.duetName ?? sent.duetId,
                  })
                  .pipe(Effect.mapError(failed));
                return sent;
              }),
            );
          }),
      ),
      chorus_route_status: McpToolAccess.reads(({ messageId }) =>
        Effect.gen(function* () {
          const { client } = yield* McpInvocationContext.McpInvocationContext;
          if (client?.linked !== true) return yield* chorusDenied();
          if (Option.isNone(store)) return yield* duetStateUnavailable();
          const route = yield* store.value
            .readIncomingChorusRoute(client.sessionId, messageId)
            .pipe(Effect.mapError(failed));
          return { route };
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
