import { CaptainMemoryId, OrchestratorMcpFailure, type CaptainError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as CaptainHonchoMemory from "../../../captains/CaptainHonchoMemory.ts";
import * as CaptainStore from "../../../captains/CaptainStore.ts";
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
    message: "This tool belongs to the active primary thread of a Captain.",
  });

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
    const owner = callerCaptain(store);
    return {
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
