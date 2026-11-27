import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, expect, it } from "@effect/vitest";
import {
  CaptainId,
  CaptainMemoryId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type Captain,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/ai";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as CaptainHonchoMemory from "../../../captains/CaptainHonchoMemory.ts";
import * as CaptainStore from "../../../captains/CaptainStore.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestratorMcp from "../../OrchestratorMcpService.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as PeerLinks from "../../../peer/PeerLinks.ts";
import * as CaptainHandlers from "./handlers.ts";
import { CaptainToolkit } from "./tools.ts";

const decodeMemorySearch = Schema.decodeUnknownEffect(
  CaptainToolkit.tools.captain_memory_search.successSchema,
);
const decodeDuetMemorySearch = Schema.decodeUnknownEffect(
  CaptainToolkit.tools.duet_memory_search.successSchema,
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

const environmentId = EnvironmentId.make("environment");
const createCaller = (threadId?: ThreadId): McpInvocationContext.McpInvocationScope => ({
  environmentId,
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
  searchAcrossDuets: () => Effect.succeed({ status: "ok" as const, results: [] }),
  drain: Effect.void,
});

const remoteEnvironmentId = EnvironmentId.make("remote-mac");
const fleetState = {
  names: [] as Array<{ environmentId: EnvironmentId; label: string }>,
  call: ((_input: unknown) =>
    Effect.fail(
      new OrchestratorMcpFailure({ code: "orchestration_error", message: "unreachable" }),
    )) as (input: unknown) => Effect.Effect<unknown, OrchestratorMcpFailure>,
};

const fleetLayers = Layer.mergeAll(
  Layer.mock(PeerLinks.PeerLinks)({
    names: () => Effect.succeed(fleetState.names),
  }),
  Layer.mock(PeerForwarding.PeerForwarding)({
    call: ((...input: Array<unknown>) => fleetState.call(input)) as never,
  }),
);

const layers = (honcho: Layer.Layer<CaptainHonchoMemory.CaptainHonchoMemory> = honchoRecall) =>
  McpHttpServer.toolkitRegistration(CaptainToolkit, CaptainHandlers.layer).pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provide(Layer.mock(OrchestratorMcp.OrchestratorMcpService)({})),
    Layer.provideMerge(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
      }),
    ),
    Layer.provideMerge(CaptainStore.layer),
    Layer.provideMerge(
      Layer.mock(ProjectService.ProjectService)({
        getById: (id) =>
          Effect.succeedSome({
            id,
            title: "Workspace",
            workspaceRoot: "/home/user/workspace",
            defaultModelSelection: null,
            scripts: [],
            createdAt: captain.createdAt,
            updatedAt: captain.updatedAt,
            deletedAt: null,
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getDescriptor: Effect.succeed({
          environmentId,
          label: "Local Mac",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0",
          capabilities: { repositoryIdentity: false },
        }),
      }),
    ),
    Layer.provideMerge(honcho),
    Layer.provideMerge(fleetLayers),
    Layer.provide(Sqlite.layerMemory),
    Layer.provide(NodeCrypto.layer),
  );

const callAs =
  (mcp: McpServer.McpServer["Service"], scope: McpInvocationContext.McpInvocationScope) =>
  (name: string, args: Record<string, unknown> = {}) =>
    mcp
      .callTool({ name, arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );

it.effect("lets only the Chorus use the local cross-Duet read tools", () =>
  Effect.gen(function* () {
    const store = yield* CaptainStore.CaptainStore;
    const mcp = yield* McpServer.McpServer;
    const archived = {
      ...captain,
      id: CaptainId.make("lee"),
      primaryThreadId: ThreadId.make("captain:lee:0"),
      name: "Lee",
      archivedAt: captain.createdAt,
    } satisfies Captain;
    for (const profile of [captain, chorus, archived]) yield* store.save(profile);
    const marker = "\n\n[truncated: content exceeds 16,000 characters]";
    const content = "a".repeat(16_000 - marker.length - 1) + "🎵" + "z".repeat(100);
    yield* store.updateDocument({
      captainId: captain.id,
      name: "NOTES.md",
      content,
      expectedRevision: 0,
    });
    const digest = yield* store.updateDocument({
      captainId: archived.id,
      name: "DIGEST.md",
      content: "# Digest\n\n## New\n\n- Recently shipped\n\n## History\n- Older entry",
      expectedRevision: 0,
    });
    const memoryFor = (captainId: CaptainId, text: string) =>
      store.upsertMemory({ captainId, id: CaptainMemoryId.make("deploy"), text, essential: true });
    const mariaMemory = yield* memoryFor(captain.id, "Deploy via staging");
    const leeMemory = yield* memoryFor(archived.id, "Deploy from main");
    yield* memoryFor(chorus.id, "Prefer short summaries");
    const call = callAs(mcp, createCaller(chorus.primaryThreadId));
    const machine = { environmentId, environmentLabel: "Local Mac" };

    expect((yield* call("duet_list")).structuredContent).toMatchObject({
      duets: [
        { ...machine, id: chorus.id, kind: "chorus", archived: false },
        { ...machine, id: archived.id, archived: true, digestNew: ["- Recently shipped"] },
        {
          ...machine,
          id: captain.id,
          name: captain.name,
          role: captain.role,
          kind: "duet",
          scopedProjectTitles: ["Workspace"],
          archived: false,
          primaryThreadId: captain.primaryThreadId,
        },
      ],
    });
    expect((yield* call("duet_read", { duetId: archived.id })).structuredContent).toMatchObject({
      profile: { id: archived.id, primaryThreadId: archived.primaryThreadId },
    });
    expect(
      (yield* call("duet_read", { duetId: archived.id, document: "DIGEST.md" })).structuredContent,
    ).toEqual({ document: digest, truncated: false });
    expect(
      (yield* call("duet_read", { duetId: captain.id, document: "NOTES.md" })).structuredContent,
    ).toEqual({
      document: {
        ...(yield* store.document(captain, "NOTES.md")),
        content: "a".repeat(16_000 - marker.length - 1) + marker,
      },
      truncated: true,
    });
    expect((yield* call("duet_memory_search", { query: "deploy" })).structuredContent).toEqual({
      matches: expect.arrayContaining([
        {
          ...machine,
          source: "local",
          duet: { id: captain.id, name: captain.name },
          memory: mariaMemory,
        },
        {
          ...machine,
          source: "local",
          duet: { id: archived.id, name: archived.name },
          memory: leeMemory,
        },
      ]),
    });
    expect((yield* call("duet_memory_search", { duetId: archived.id })).structuredContent).toEqual({
      matches: [
        {
          ...machine,
          source: "local",
          duet: { id: archived.id, name: archived.name },
          memory: leeMemory,
        },
      ],
    });
    for (let index = 0; index < 20; index++) {
      yield* store.upsertMemory({
        captainId: archived.id,
        id: CaptainMemoryId.make(`extra-${index}`),
        text: `Deploy after CI ${index}`,
        essential: false,
      });
    }
    const search = yield* decodeDuetMemorySearch(
      (yield* call("duet_memory_search")).structuredContent,
    );
    expect(search.matches).toHaveLength(20);

    for (const scope of [
      createCaller(captain.primaryThreadId),
      createCaller(ThreadId.make("ordinary")),
      createCaller(),
      {
        ...createCaller(),
        client: { sessionId: "peer", label: "Peer", access: "read-only", linked: true },
      } as const,
    ]) {
      const denied = callAs(mcp, scope);
      for (const [tool, args] of [
        ["duet_list", {}],
        ["duet_read", { duetId: captain.id }],
        ["duet_memory_search", {}],
      ] as const) {
        const result = yield* denied(tool, args);
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain("capability_denied");
      }
    }
  }).pipe(Effect.provide(layers())),
);


it.effect("fans Chorus reads out in parallel, merges machine labels, and reports unreachable peers", () =>
  Effect.gen(function* () {
    const store = yield* CaptainStore.CaptainStore;
    const mcp = yield* McpServer.McpServer;
    yield* store.save(chorus);
    yield* store.save(captain);
    const reachable = remoteEnvironmentId;
    const unreachable = EnvironmentId.make("away-mac");
    fleetState.names = [
      { environmentId: reachable, label: "Remote Mac" },
      { environmentId: unreachable, label: "Away Mac" },
    ];
    const remoteDuet = {
      ...captain,
      id: CaptainId.make("remote-duet"),
      primaryThreadId: ThreadId.make("captain:remote-duet:0"),
      name: "Remote Duet",
    } satisfies Captain;
    const remoteMemory = {
      id: CaptainMemoryId.make("remote-memory"),
      captainId: remoteDuet.id,
      text: "Remote deploy fact",
      essential: false,
      userControlled: false,
      createdAt: captain.createdAt,
      updatedAt: captain.updatedAt,
    };
    fleetState.call = (input) => {
      const [, tool, target, params] = input as Array<never>;
      if (target === unreachable) {
        return Effect.fail(
          new OrchestratorMcpFailure({ code: "orchestration_error", message: "did not answer" }),
        );
      }
      if (tool === CaptainToolkit.tools.duet_list) {
        return Effect.succeed({
          duets: [
            {
              environmentId: reachable,
              environmentLabel: "Remote Mac",
              id: remoteDuet.id,
              name: remoteDuet.name,
              role: remoteDuet.role,
              kind: remoteDuet.kind,
              scopedProjectTitles: [],
              archived: false,
              primaryThreadId: remoteDuet.primaryThreadId,
              digestNew: [],
            },
          ],
        });
      }
      if (tool === CaptainToolkit.tools.duet_read) {
        return Effect.succeed({ profile: remoteDuet });
      }
      if (tool === CaptainToolkit.tools.duet_memory_search) {
        return Effect.succeed({
          matches: [
            {
              environmentId: reachable,
              environmentLabel: "Remote Mac",
              source: "local",
              duet: { id: remoteDuet.id, name: remoteDuet.name },
              memory: remoteMemory,
            },
          ],
        });
      }
      return Effect.fail(
        new OrchestratorMcpFailure({ code: "invalid_request", message: `unexpected ${String(params)}` }),
      );
    };
    const call = callAs(mcp, createCaller(chorus.primaryThreadId));

    const listed = (yield* call("duet_list")).structuredContent as {
      duets: Array<{ environmentLabel: string; id: CaptainId }>;
      unreachableMachines: Array<{ environmentId: EnvironmentId; environmentLabel: string }>;
    };
    expect(listed.duets.some((duet) => duet.environmentLabel === "Local Mac" && duet.id === captain.id)).toBe(true);
    expect(listed.duets.some((duet) => duet.environmentLabel === "Remote Mac" && duet.id === remoteDuet.id)).toBe(true);
    expect(listed.unreachableMachines).toEqual([
      { environmentId: unreachable, environmentLabel: "Away Mac", reason: "did not answer" },
    ]);

    const read = (yield* call("duet_read", { duetId: remoteDuet.id })).structuredContent;
    expect(read).toMatchObject({
      results: [
        {
          environmentId: reachable,
          environmentLabel: "Remote Mac",
          result: { profile: { id: remoteDuet.id } },
        },
      ],
      unreachableMachines: [{ environmentId: unreachable }],
    });

    const memories = (yield* call("duet_memory_search", { query: "deploy" })).structuredContent as {
      matches: Array<{ environmentLabel: string; memory: { text: string } }>;
      unreachableMachines?: Array<{ environmentId: EnvironmentId }>;
    };
    expect(
      memories.matches.some(
        (match) => match.environmentLabel === "Remote Mac" && match.memory.text === "Remote deploy fact",
      ),
    ).toBe(true);
    expect(memories.unreachableMachines?.some((machine) => machine.environmentId === unreachable)).toBe(true);
    fleetState.names = [];
  }).pipe(Effect.provide(layers())),
);

it.effect("accepts only attested forwarded Chorus reads without local Chorus write authority", () =>
  Effect.gen(function* () {
    const store = yield* CaptainStore.CaptainStore;
    const mcp = yield* McpServer.McpServer;
    yield* store.save(chorus);
    yield* store.save(captain);
    const forwarded = {
      ...createCaller(),
      client: {
        sessionId: "peer",
        label: "Peer",
        access: "read-only",
        linked: true,
        senderThread: {
          environmentId: EnvironmentId.make("origin"),
          threadId: chorus.primaryThreadId,
          title: "Chorus",
        },
        senderCaptainKind: "chorus",
      },
    } as const;
    const result = yield* callAs(mcp, forwarded)("duet_list");
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ duets: expect.any(Array) });

    const write = yield* Effect.result(
      callAs(mcp, forwarded)("duet_send", {
        duetId: captain.id,
        message: "write",
      }),
    );
    expect(write._tag).toBe("Failure");
    if (write._tag === "Failure") expect(String(write.failure)).toContain("Tool 'duet_send' not found");
  }).pipe(Effect.provide(layers())),
);

it.effect("merges Chorus local and Honcho memories with labels, dedupe, and the result cap", () => {
  const jordan = {
    ...captain,
    id: CaptainId.make("jordan"),
    primaryThreadId: ThreadId.make("captain:jordan:0"),
    name: "Jordan",
  } satisfies Captain;
  const calls: Array<{
    readonly captainIds: ReadonlyArray<CaptainId>;
    readonly query: string | undefined;
  }> = [];
  const honcho = Layer.mock(CaptainHonchoMemory.CaptainHonchoMemory)({
    enabled: true,
    longTermMemory: () => Effect.succeedNone,
    search: () => Effect.succeed([]),
    searchAcrossDuets: (captains, query) =>
      Effect.sync(() => {
        calls.push({ captainIds: captains.map(({ id }) => id), query });
        return {
          status: "ok" as const,
          results: [
            { captainId: captain.id, text: " shared DEPLOYMENT  fact " },
            { captainId: captain.id, text: "Recall beyond local" },
            { captainId: jordan.id, text: "Jordan recall" },
            ...Array.from({ length: 7 }, (_, index) => ({
              captainId: jordan.id,
              text: `Extra recall ${index}`,
            })),
          ].map((hit, index) => ({
            ...hit,
            id: `message-${index}`,
            createdAt: "2026-11-24T12:00:00Z",
          })),
        };
      }),
    drain: Effect.void,
  });
  return Effect.gen(function* () {
    const store = yield* CaptainStore.CaptainStore;
    const mcp = yield* McpServer.McpServer;
    for (const profile of [captain, chorus, jordan]) yield* store.save(profile);
    for (let index = 0; index < 18; index++) {
      yield* store.upsertMemory({
        captainId: captain.id,
        id: CaptainMemoryId.make(`fact-${index}`),
        text: index === 0 ? "Shared deployment fact" : `Local fact ${index}`,
        essential: false,
      });
    }
    const call = callAs(mcp, createCaller(chorus.primaryThreadId));
    const search = yield* decodeDuetMemorySearch(
      (yield* call("duet_memory_search", { query: "fact" })).structuredContent,
    );

    assert.lengthOf(search.matches, 20);
    assert.isFalse("note" in search);
    const shared = search.matches.filter(({ memory }) => memory.text === "Shared deployment fact");
    assert.lengthOf(shared, 1);
    assert.equal(shared[0]?.source, "local");
    const recalled = search.matches.filter(({ source }) => source === "honcho");
    assert.deepStrictEqual(
      recalled.map(({ memory }) => memory.text),
      ["Recalled: Recall beyond local", "Recalled: Jordan recall"],
    );
    assert.deepStrictEqual(
      recalled.map(({ duet }) => [duet.id, duet.name]),
      [
        [captain.id, captain.name],
        [jordan.id, jordan.name],
      ],
    );
    assert.equal(recalled[0]?.memory.id, "honcho-message-1");
    assert.equal(recalled[0]?.memory.createdAt, "2026-11-24T12:00:00Z");
    assert.deepStrictEqual(calls[0]?.query, "fact");
    assert.deepStrictEqual(calls[0]?.captainIds.slice().sort(), [chorus.id, jordan.id, captain.id]);

    for (let index = 0; index < 5; index++) {
      yield* store.upsertMemory({
        captainId: captain.id,
        id: CaptainMemoryId.make(`long-${index}`),
        text: `Long ${index} ${"😀".repeat(1_996)}`,
        essential: false,
      });
    }
    const long = yield* decodeDuetMemorySearch(
      (yield* call("duet_memory_search", { query: "long", duetId: captain.id })).structuredContent,
    );
    assert.lengthOf(long.matches, 4);
    assert.isAtMost(
      long.matches.reduce((size, { memory }) => size + memory.text.length, 0),
      16_000,
    );
    assert.lengthOf(calls, 2);
    assert.deepStrictEqual(calls[1]?.captainIds, [captain.id]);
  }).pipe(Effect.provide(layers(honcho)));
});

it.effect("returns local Chorus memories with a note when Honcho fails or is unconfigured", () => {
  const failingHoncho = Layer.mock(CaptainHonchoMemory.CaptainHonchoMemory)({
    enabled: true,
    longTermMemory: () => Effect.succeedNone,
    search: () => Effect.succeed([]),
    searchAcrossDuets: () => Effect.succeed({ status: "failed" as const, results: [] }),
    drain: Effect.void,
  });
  let disabledCrossCalls = 0;
  const disabledHoncho = Layer.mock(CaptainHonchoMemory.CaptainHonchoMemory)({
    enabled: false,
    longTermMemory: () => Effect.die("Honcho is disabled"),
    search: () => Effect.die("Honcho is disabled"),
    searchAcrossDuets: () =>
      Effect.sync(() => {
        disabledCrossCalls++;
        return { status: "disabled" as const, results: [] };
      }),
    drain: Effect.void,
  });
  return Effect.forEach(
    [
      { honcho: failingHoncho, note: "Honcho recall unavailable; showing local memories only." },
      { honcho: disabledHoncho, note: undefined },
    ],
    ({ honcho, note }) =>
      Effect.gen(function* () {
        const store = yield* CaptainStore.CaptainStore;
        const mcp = yield* McpServer.McpServer;
        yield* store.save(chorus);
        yield* store.upsertMemory({
          captainId: chorus.id,
          id: CaptainMemoryId.make("local-only"),
          text: "Local only fact",
          essential: false,
        });
        const result = yield* callAs(mcp, createCaller(chorus.primaryThreadId))(
          "duet_memory_search",
          { query: "local" },
        );
        assert.isFalse(result.isError);
        const search = yield* decodeDuetMemorySearch(result.structuredContent);
        assert.lengthOf(search.matches, 1);
        assert.equal(search.matches[0]?.source, "local");
        assert.equal(search.matches[0]?.memory.text, "Local only fact");
        if (note === undefined) assert.isFalse("note" in search);
        else assert.equal(search.note, note);
      }).pipe(Effect.provide(layers(honcho))),
    { discard: true },
  ).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        assert.equal(disabledCrossCalls, 0);
      }),
    ),
  );
});

it.effect("keeps a normal Duet on its scoped Honcho search", () => {
  let crossCalls = 0;
  let scopedCalls = 0;
  const honcho = Layer.mock(CaptainHonchoMemory.CaptainHonchoMemory)({
    enabled: true,
    longTermMemory: () => Effect.succeedNone,
    search: (duet, query) =>
      Effect.sync(() => {
        scopedCalls++;
        assert.equal(duet.id, captain.id);
        assert.equal(query, "fact");
        return ["Uses pnpm"];
      }),
    searchAcrossDuets: () =>
      Effect.sync(() => {
        crossCalls++;
        return { status: "ok" as const, results: [] };
      }),
    drain: Effect.void,
  });
  return Effect.gen(function* () {
    const store = yield* CaptainStore.CaptainStore;
    const mcp = yield* McpServer.McpServer;
    yield* store.save(captain);
    const search = yield* callAs(mcp, createCaller(captain.primaryThreadId))(
      "captain_memory_search",
      { query: "fact" },
    );
    assert.isFalse(search.isError);
    assert.include(JSON.stringify(search.structuredContent), "Recalled: Uses pnpm");
    assert.equal(scopedCalls, 1);
    assert.equal(crossCalls, 0);
  }).pipe(Effect.provide(layers(honcho)));
});

it.effect("keeps Chorus document writes and memory operations in its own rows", () =>
  Effect.gen(function* () {
    const store = yield* CaptainStore.CaptainStore;
    const mcp = yield* McpServer.McpServer;
    yield* store.save(captain);
    yield* store.save(chorus);
    const duetDocument = yield* store.updateDocument({
      captainId: captain.id,
      name: "NOTES.md",
      content: "Duet notes",
      expectedRevision: 0,
    });
    const sharedId = CaptainMemoryId.make("shared");
    const duetMemory = yield* store.upsertMemory({
      captainId: captain.id,
      id: sharedId,
      text: "Duet memory",
      essential: false,
    });
    const call = callAs(mcp, createCaller(chorus.primaryThreadId));
    const attemptedWrite = yield* call("captain_document_write", {
      captainId: captain.id,
      name: "NOTES.md",
      content: "Wrong owner",
      expectedRevision: 1,
    }).pipe(Effect.flip);
    expect(attemptedWrite.message).toContain('Unknown argument "captainId"');
    const write = yield* call("captain_document_write", {
      name: "NOTES.md",
      content: "Chorus notes",
      expectedRevision: 0,
    });
    expect(write.structuredContent).toMatchObject({
      captainId: chorus.id,
      content: "Chorus notes",
    });
    expect(yield* store.document(captain, "NOTES.md")).toEqual(duetDocument);
    expect(yield* store.document(chorus, "NOTES.md")).toMatchObject({
      revision: 1,
      content: "Chorus notes",
    });

    const remember = yield* call("captain_memory_remember", {
      id: sharedId,
      text: "Chorus memory",
    });
    expect(remember.structuredContent).toMatchObject({
      captainId: chorus.id,
      id: sharedId,
      text: "Chorus memory",
    });
    const search = yield* call("captain_memory_search", { query: "memory" });
    expect(JSON.stringify(search.structuredContent)).not.toContain(duetMemory.text);
    expect(JSON.stringify(search.structuredContent)).toContain("Chorus memory");
    const forget = yield* call("captain_memory_forget", { id: sharedId });
    expect(forget.isError).toBe(false);
    expect(yield* store.listMemories(chorus.id, { limit: 10 })).toEqual([]);
    expect(yield* store.listMemories(captain.id, { limit: 10 })).toEqual([duetMemory]);
  }).pipe(Effect.provide(layers())),
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
      searchAcrossDuets: () => Effect.die("Honcho is disabled"),
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
