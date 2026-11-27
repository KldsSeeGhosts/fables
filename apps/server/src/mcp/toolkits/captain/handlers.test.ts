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
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/ai";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as CaptainHonchoMemory from "../../../captains/CaptainHonchoMemory.ts";
import * as CaptainStore from "../../../captains/CaptainStore.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as CaptainHandlers from "./handlers.ts";
import { CaptainToolkit } from "./tools.ts";

const decodeMemorySearch = Schema.decodeUnknownEffect(
  CaptainToolkit.tools.captain_memory_search.successSchema,
);

const captain = {
  id: CaptainId.make("maria"),
  primaryThreadId: ThreadId.make("captain:maria:0"),
  name: "Maria",
  role: "Coordinator",
  instructions: "",
  reportPolicy: "context",
  coordinatorOnly: false,
  kind: "duet",
  avatar: { preset: "compass", color: "violet" },
  earlierThreadIds: [],
  scopedProjectIds: [ProjectId.make("workspace")],
  createdAt: "2026-11-24T12:00:00.000Z",
  updatedAt: "2026-11-24T12:00:00.000Z",
  archivedAt: null,
} satisfies Captain;

const chorus = {
  ...captain,
  id: CaptainId.make("chorus"),
  primaryThreadId: ThreadId.make("captain:chorus:0"),
  name: "Chorus",
  role: "Fleet",
  kind: "chorus",
  coordinatorOnly: true,
  reportPolicy: "react",
  scopedProjectIds: [],
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
  captain: threadId === captain.primaryThreadId || threadId === chorus.primaryThreadId,
  chorus: threadId === chorus.primaryThreadId,
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

const honchoRecall = Layer.mock(CaptainHonchoMemory.CaptainHonchoMemory)({
  enabled: true,
  longTermMemory: () => Effect.succeedNone,
  search: () => Effect.succeed(["Uses pnpm"]),
  drain: Effect.void,
});

const layers = (honcho: Layer.Layer<CaptainHonchoMemory.CaptainHonchoMemory> = honchoRecall) =>
  McpHttpServer.toolkitRegistration(CaptainToolkit, CaptainHandlers.layer).pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provideMerge(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
      }),
    ),
    Layer.provideMerge(CaptainStore.layer),
    Layer.provideMerge(
      Layer.mock(ProjectService.ProjectService)({
        getById: (id) => Effect.succeed(Option.some({ id, title: "Workspace" } as never)),
      }),
    ),
    Layer.provideMerge(honcho),
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
    }).pipe(Effect.provide(layers())),
);

it.effect(
  "keeps local search results with Honcho off or failing and caps merged results at 20",
  () => {
    let status = 500;
    let requests = 0;
    const recall = Array.from({ length: 5 }, (_, index) => ({
      content: `Recall ${index}`,
      session_id: "conversation_captain_3amaria_3a0",
    }));
    const configPath = "/captain-toolkit-test/honcho.json";
    const tokenFile = "/captain-toolkit-test/token";
    const token = [
      Buffer.from('{"alg":"HS256"}').toString("base64url"),
      Buffer.from("{}").toString("base64url"),
      Buffer.alloc(32).toString("base64url"),
    ].join(".");
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        requests++;
        return HttpClientResponse.fromWeb(request, Response.json(recall, { status }));
      }),
    );
    const configuredHoncho = CaptainHonchoMemory.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          FileSystem.layerNoop({
            readFileString: (path) =>
              Effect.succeed(
                path === tokenFile
                  ? token
                  : JSON.stringify({
                      baseUrl: "http://honcho.test",
                      workspaceId: "duets",
                      tokenFile,
                    }),
              ),
          }),
          Path.layer,
          Layer.succeed(HostProcess.Environment, { T3CODE_HONCHO_CONFIG: configPath }),
          Layer.succeed(HttpClient.HttpClient, http),
        ),
      ),
    );
    const offHoncho = Layer.succeed(CaptainHonchoMemory.CaptainHonchoMemory, {
      enabled: false,
      longTermMemory: () => Effect.die("Honcho is disabled"),
      search: () => Effect.die("Honcho is disabled"),
      drain: Effect.void,
    });

    return Effect.forEach(
      [offHoncho, configuredHoncho],
      (honcho) =>
        Effect.gen(function* () {
          const store = yield* CaptainStore.CaptainStore;
          const mcp = yield* McpServer.McpServer;
          yield* store.save(captain);
          for (let index = 0; index < 18; index++) {
            yield* store.upsertMemory({
              captainId: captain.id,
              id: CaptainMemoryId.make(`fact-${index}`),
              text: `Local fact ${index}`,
              essential: false,
            });
          }
          const search = mcp
            .callTool({ name: "captain_memory_search", arguments: { query: "fact" } })
            .pipe(
              Effect.provideService(
                McpInvocationContext.McpInvocationContext,
                createCaller(captain.primaryThreadId),
              ),
              Effect.provideService(McpSchema.McpServerClient, client),
            );
          const local = yield* store.listMemories(captain.id, { query: "fact", limit: 20 });
          assert.deepStrictEqual((yield* search).structuredContent, { memories: local });
          if (honcho === offHoncho) {
            assert.equal(requests, 0);
            return;
          }
          assert.equal(requests, 1);
          status = 200;
          const { memories: merged } = yield* decodeMemorySearch((yield* search).structuredContent);
          assert.lengthOf(merged, 20);
          assert.deepStrictEqual(merged.slice(0, 18), local);
          assert.deepStrictEqual(
            merged.slice(18).map(({ text }) => text),
            ["Recalled: Recall 0", "Recalled: Recall 1"],
          );
        }).pipe(Effect.provide(layers(honcho))),
      { discard: true },
    );
  },
);
