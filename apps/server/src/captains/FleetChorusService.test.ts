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
}) {
  const creates: CaptainCreateInput[] = [];
  const archives: CaptainId[] = [];
  const unarchives: CaptainId[] = [];
  const recorded: Array<{ environmentId: EnvironmentIdType; threadId: ThreadId | null }> = [];
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    chorusHome: input.chorusHome,
    defaultModelSelection: modelSelection,
    textGenerationModelSelection: modelSelection,
  };
  const dependencies = Layer.mergeAll(
    Layer.mock(ServerSettings.ServerSettingsService)({
      getSettings: Effect.succeed(settings),
      streamChanges: Stream.empty,
    }),
    Layer.mock(CaptainService.CaptainService)({
      create: (createInput) =>
        Effect.sync(() => {
          creates.push(createInput);
          return chorus;
        }),
      archive: ({ captainId }) =>
        Effect.sync(() => {
          archives.push(captainId);
          return { ...chorus, archivedAt: "2026-11-27T00:01:00.000Z" };
        }),
      unarchive: ({ captainId }) =>
        Effect.sync(() => {
          unarchives.push(captainId);
          return chorus;
        }),
    }),
    Layer.mock(CaptainStore.CaptainStore)({
      findChorus: () => Effect.succeed(input.storedChorus),
      findActiveChorus: () =>
        Effect.succeed(input.storedChorus?.archivedAt === null ? input.storedChorus : undefined),
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
                label: "Studio",
                threadId: input.learnedThreadId,
                capable: input.capable ?? null,
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
          recorded.push({ environmentId, threadId: update.threadId });
        }),
    }),
    Layer.mock(PeerMcpClient.PeerMcpClient)({
      call: () =>
        input.peerClaimsHome === false
          ? Effect.fail(new Error("unreachable") as never)
          : Effect.succeed({ home: true, threadId: chorusThreadId }),
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
  };
}

it.effect("creates the fleet Chorus automatically and idempotently on its home machine", () =>
  Effect.gen(function* () {
    const missing = fixture({ chorusHome: true });
    yield* Effect.gen(function* () {
      const service = yield* FleetChorusService.FleetChorusService;
      yield* service.ensureHome;
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

it.effect("archives the local row when the home setting is off", () =>
  Effect.gen(function* () {
    const off = fixture({ chorusHome: false, storedChorus: chorus });
    yield* Effect.gen(function* () {
      const service = yield* FleetChorusService.FleetChorusService;
      yield* service.ensureHome;
    }).pipe(Effect.provide(off.layer));
    assert.deepEqual(off.archives, [chorus.id]);
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

it.effect("keeps a learned home visible as offline when the peer cannot be reached", () =>
  Effect.gen(function* () {
    const remote = fixture({
      chorusHome: false,
      linksEnabled: true,
      peerClaimsHome: false,
      learnedThreadId: chorusThreadId,
    });
    const status = yield* Effect.gen(function* () {
      const service = yield* FleetChorusService.FleetChorusService;
      return yield* service.refresh;
    }).pipe(Effect.provide(remote.layer));
    assert.equal(status.state, "offline");
    assert.equal(status.home?.threadId, chorusThreadId);
  }),
);
