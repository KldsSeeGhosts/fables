import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  CaptainId,
  CaptainMemoryId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type Captain,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpSchema, McpServer } from "effect/ai";

import * as CaptainHonchoMemory from "../../../captains/CaptainHonchoMemory.ts";
import * as CaptainStore from "../../../captains/CaptainStore.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as CaptainHandlers from "./handlers.ts";
import { CaptainToolkit } from "./tools.ts";

const captain = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:0"),
  name: "Maria",
  role: "Coordinator",
  instructions: "",
  reportPolicy: "context",
  coordinatorOnly: false,
  avatar: { preset: "compass", color: "violet" },
  earlierThreadIds: [],
  scopedProjectIds: [ProjectId.make("workspace")],
  createdAt: "2026-11-24T12:00:00.000Z",
  updatedAt: "2026-11-24T12:00:00.000Z",
  archivedAt: null,
} satisfies Captain;

const createCaller = (threadId?: ThreadId): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment"),
  requestNamespace: "mcp:capture",
  thread:
    threadId === undefined
      ? undefined
      : {
          threadId,
          providerSessionId: `session:${threadId}`,
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
  captain: threadId === captain.primaryThreadId,
});

const clientInfo = { name: "captain-test", version: "1" };
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo,
  initializePayload: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo },
  getClient: Effect.die("unused"),
});

const layers = McpHttpServer.toolkitRegistration(CaptainToolkit, CaptainHandlers.layer).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provideMerge(
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
    }),
  ),
  Layer.provideMerge(CaptainStore.layer),
  Layer.provideMerge(
    Layer.mock(CaptainHonchoMemory.CaptainHonchoMemory)({
      enabled: true,
      mirrorTurnItem: () => Effect.void,
      longTermMemory: () => Effect.succeed(Option.none()),
      search: () => Effect.succeed(["Uses pnpm"]),
      drain: Effect.void,
    }),
  ),
  Layer.provide(Sqlite.layerMemory),
  Layer.provide(NodeCrypto.layer),
);

it.effect(
  "enforces calling-thread ownership and rejects agent changes to user-controlled memory",
  () =>
    Effect.gen(function* () {
      const store = yield* CaptainStore.CaptainStore;
      const mcp = yield* McpServer.McpServer;
      yield* store.save(captain);
      const locked = yield* store.upsertMemory({
        captainId: captain.id,
        id: CaptainMemoryId.make("locked"),
        text: "Owner note",
        essential: true,
      });
      const owner = createCaller(captain.primaryThreadId);
      const call = (name: string, args: Record<string, unknown>, scope = owner) =>
        mcp
          .callTool({
            name,
            arguments: args,
          })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
      const read = yield* call("captain_read", {});
      assert.notOk(read.isError);
      assert.include(
        read.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
        "Maria",
      );
      const document = yield* call("captain_document_write", {
        name: "NOTES.md",
        content: "Owned",
        expectedRevision: 0,
      });
      assert.notOk(document.isError);
      assert.equal((yield* store.document(captain, "NOTES.md")).content, "Owned");
      const ordinary = createCaller(ThreadId.make("other-thread"));
      for (const scope of [ordinary, createCaller()]) {
        const denied = yield* call(
          "captain_document_read",
          { captainId: captain.id, name: "NOTES.md" },
          scope,
        ).pipe(Effect.result);
        assert.isTrue(denied._tag === "Failure" || denied.success.isError === true);
      }
      const blockedWrite = yield* call("captain_memory_remember", {
        id: locked.id,
        text: "Replacement",
      });
      const blockedDelete = yield* call("captain_memory_forget", { id: locked.id });
      assert.isTrue(blockedWrite.isError);
      assert.isTrue(blockedDelete.isError);
      assert.deepStrictEqual(yield* store.listMemories(captain.id, { limit: 10 }), [locked]);
      const remembered = yield* call("captain_memory_remember", {
        text: "Agent note",
        essential: true,
      });
      assert.notOk(remembered.isError);
      const search = yield* call("captain_memory_search", { query: "agent" });
      assert.include(JSON.stringify(search.content), "Agent note");
      assert.include(JSON.stringify(search.content), "Recalled: Uses pnpm");
      assert.notInclude(JSON.stringify(search.content), "Owner note");
    }).pipe(Effect.provide(layers)),
);
