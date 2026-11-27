import { assert, it } from "@effect/vitest";
import {
  CaptainId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderInstanceId,
  captainPrimaryThreadId,
  type Captain,
  type CaptainCreateInput,
  type EnvironmentId as EnvironmentIdType,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as CaptainService from "./CaptainService.ts";
import * as CaptainStore from "./CaptainStore.ts";
import * as FleetChorusService from "./FleetChorusService.ts";

const localEnvironmentId = EnvironmentId.make("local");
const homeEnvironmentId = EnvironmentId.make("home");
const chorusThreadId = captainPrimaryThreadId(CaptainId.make("chorus"), 0);
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };

const chorus: Captain = {
  id: CaptainId.make("chorus"),
  name: "Chorus",
  role: "",
  instructions: "",
  avatar: { preset: "circle", color: "orange" },
  scopedProjectIds: [],
  reportPolicy: "react",
  coordinatorOnly: true,
  kind: "chorus",
  primaryThreadId: chorusThreadId,
  earlierThreadIds: [],
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
  archivedAt: null,
};

const descriptor = {
  environmentId: localEnvironmentId,
  label: "Local",
  platform: { os: "darwin" as const, arch: "arm64" as const, libc: null },
  serverVersion: "test",
  protocolVersion: 1,
  capabilities: {},
};

function fixture(input: {
  readonly chorusHome: boolean;
  readonly storedChorus?: Captain | undefined;
  readonly linksEnabled?: boolean;
  readonly peerClaimsHome?: boolean;
  readonly learnedThreadId?: ThreadId | null;
  readonly capable?: boolean;
  readonly peerThreadId?: ThreadId | null;
  readonly modelConfigured?: boolean;
}) {
  const creates: CaptainCreateInput[] = [];
  const archives: CaptainId[] = [];
  const unarchives: CaptainId[] = [];
  const recorded: Array<{ environmentId: EnvironmentIdType; threadId: ThreadId | null }> = [];
  let storedChorus = input.storedChorus;
  let peerFailure = false;
  let settings = {
    ...DEFAULT_SERVER_SETTINGS,
    chorusHome: input.chorusHome,
    defaultModelSelection: input.modelConfigured === false ? null : modelSelection,
  };
  const dependencies = Layer.mergeAll(
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.sync(() => settings),
      streamChanges: Stream.empty,
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
    Layer.mock(CaptainService.CaptainService)({
      create: (createInput) =>
        Effect.sync(() => {
          creates.push(createInput);
          storedChorus = chorus;
          return chorus;
        }),
      archive: ({ captainId }) =>
        Effect.sync(() => {
          archives.push(captainId);
          storedChorus = { ...chorus, archivedAt: "2026-11-27T00:01:00.000Z" };
          return storedChorus;
        }),
      unarchive: ({ captainId }) =>
        Effect.sync(() => {
          unarchives.push(captainId);
          storedChorus = chorus;
          return chorus;
        }),
    }),
    Layer.mock(CaptainStore.CaptainStore)({
      findChorus: () => Effect.sync(() => storedChorus),
      findActiveChorus: () =>
        Effect.sync(() => (storedChorus?.archivedAt === null ? storedChorus : undefined)),
    }),
    Layer.mock(PeerLinks.PeerLinks)({
      enabled: Effect.succeed(input.linksEnabled ?? false),
      names: () =>
        Effect.succeed(
          input.linksEnabled === true
            ? [{ environmentId: homeEnvironmentId, label: "Studio" }]
            : [],
        ),
      chorusHomeRecords: Effect.succeed(
        input.learnedThreadId !== undefined
          ? [
              {
                environmentId: homeEnvironmentId,
                threadId: input.learnedThreadId,
              },
            ]
          : [],
      ),
      resolve: () =>
        Effect.succeed({
          capabilities: { fleetChorus: input.capable ?? true },
        } as never),
      recordChorusHome: (environmentId, update) =>
        Effect.sync(() => {
          recorded.push({ environmentId, threadId: update?.threadId ?? null });
        }),
    }),
    Layer.mock(PeerMcpClient.PeerMcpClient)({
      call: () =>
        Effect.suspend(() =>
          peerFailure
            ? Effect.fail(new Error("unreachable") as never)
            : Effect.succeed({
                home: input.peerClaimsHome ?? true,
                threadId: input.peerThreadId === undefined ? chorusThreadId : input.peerThreadId,
              }),
        ),
    }),
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(localEnvironmentId),
      getDescriptor: Effect.succeed(descriptor as never),
    }),
  );
  return {
    layer: FleetChorusService.layer.pipe(Layer.provide(dependencies)),
    creates,
    archives,
    unarchives,
    recorded,
    setHome: (chorusHome: boolean) =>
      Effect.sync(() => {
        settings = { ...settings, chorusHome };
      }),
    setPeerOffline: (offline: boolean) =>
      Effect.sync(() => {
        peerFailure = offline;
      }),
  };
}

it.effect("creates the fleet Chorus automatically and idempotently on its home machine", () =>
  Effect.gen(function* () {
    const missing = fixture({ chorusHome: true });
    yield* Effect.gen(function* () {
      const service = yield* FleetChorusService.FleetChorusService;
      const [, first, second] = yield* Effect.all(
        [service.ensureHome, service.refresh, service.status],
        { concurrency: "unbounded" },
      );
      assert.equal(first.home?.threadId, chorusThreadId);
      assert.equal(second.home?.threadId, chorusThreadId);
    }).pipe(Effect.provide(missing.layer));
    assert.equal(missing.creates.length, 1);
    assert.equal(missing.creates[0]?.kind, "chorus");
    assert.equal(missing.creates[0]?.creationSource, "server");
    assert.equal(missing.creates[0]?.coordinatorOnly, true);

    const existing = fixture({ chorusHome: true, storedChorus: chorus });
    yield* Effect.gen(function* () {
      const service = yield* FleetChorusService.FleetChorusService;
      yield* service.ensureHome;
    }).pipe(Effect.provide(existing.layer));
    assert.equal(existing.creates.length, 0);
  }),
);

it.effect("archives and restores the same Chorus when the home setting is toggled", () =>
  Effect.gen(function* () {
    const off = fixture({ chorusHome: true, storedChorus: chorus });
    yield* Effect.gen(function* () {
      const service = yield* FleetChorusService.FleetChorusService;
      assert.equal((yield* service.refresh).state, "ready");
      yield* off.setHome(false);
      assert.equal((yield* service.refresh).state, "unconfigured");
      yield* off.setHome(true);
      assert.equal((yield* service.refresh).home?.threadId, chorusThreadId);
    }).pipe(Effect.provide(off.layer));
    assert.deepEqual(off.archives, [chorus.id]);
    assert.deepEqual(off.unarchives, [chorus.id]);
    assert.deepEqual(off.creates, []);
  }),
);

it.effect("reports the learned home as ready and visible from a non-home machine", () =>
  Effect.gen(function* () {
    const remote = fixture({ chorusHome: false, linksEnabled: true, peerClaimsHome: true });
    const status = yield* Effect.gen(function* () {
      const service = yield* FleetChorusService.FleetChorusService;
      return yield* service.refresh;
    }).pipe(Effect.provide(remote.layer));
    assert.equal(status.state, "ready");
    assert.deepEqual(status.home, {
      environmentId: homeEnvironmentId,
      label: "Studio",
      threadId: chorusThreadId,
    });
    assert.deepEqual(remote.recorded.at(-1), {
      environmentId: homeEnvironmentId,
      threadId: chorusThreadId,
    });
  }),
);

it.effect("rechecks a learned home when the client reconnects or refreshes", () =>
  Effect.gen(function* () {
    const remote = fixture({
      chorusHome: false,
      linksEnabled: true,
      learnedThreadId: chorusThreadId,
    });
    yield* Effect.gen(function* () {
      const service = yield* FleetChorusService.FleetChorusService;
      const open = service.subscribe.pipe(Stream.runHead, Effect.flatMap(Effect.fromOption));
      assert.equal((yield* open).state, "ready");
      yield* remote.setPeerOffline(true);
      const offline = yield* open;
      assert.equal(offline.state, "offline");
      assert.equal(offline.home?.threadId, chorusThreadId);
      yield* remote.setPeerOffline(false);
      assert.equal((yield* open).state, "ready");
    }).pipe(Effect.provide(remote.layer));
  }),
);

it.effect("distinguishes an unknown home, an old home, and a home still setting up", () =>
  Effect.gen(function* () {
    const scenarios = [
      { peerClaimsHome: false, expected: "unconfigured", threadId: null },
      {
        learnedThreadId: chorusThreadId,
        capable: false,
        expected: "too_old",
        threadId: chorusThreadId,
      },
      { peerThreadId: null, expected: "setting_up", threadId: null },
    ];
    for (const scenario of scenarios) {
      const remote = fixture({ chorusHome: false, linksEnabled: true, ...scenario });
      const status = yield* Effect.gen(function* () {
        const service = yield* FleetChorusService.FleetChorusService;
        return yield* service.refresh;
      }).pipe(Effect.provide(remote.layer));
      assert.equal(status.state, scenario.expected);
      assert.equal(status.home?.threadId ?? null, scenario.threadId);
    }
  }),
);

it.effect("warns about both home claims even before either Chorus exists", () =>
  Effect.gen(function* () {
    const conflict = fixture({
      chorusHome: true,
      modelConfigured: false,
      linksEnabled: true,
      peerThreadId: null,
    });
    yield* Effect.gen(function* () {
      const service = yield* FleetChorusService.FleetChorusService;
      const status = yield* service.refresh;
      assert.equal(status.state, "conflict");
      assert.deepEqual(status.conflictingHomes, ["Local", "Studio"]);
      yield* conflict.setHome(false);
      const resolved = yield* service.refresh;
      assert.equal(resolved.state, "setting_up");
      assert.deepEqual(resolved.conflictingHomes, []);
    }).pipe(Effect.provide(conflict.layer));
  }),
);
