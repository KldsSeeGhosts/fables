import {
  CaptainId,
  isProviderAvailable,
  resolveProjectProviderInstanceEnabled,
  type FleetChorusStatus,
  type ThreadId,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as CaptainService from "./CaptainService.ts";
import * as CaptainStore from "./CaptainStore.ts";
import { chorusHomeTool, ChorusHomeResult } from "./chorusFleet.ts";

const HOME_CAPTAIN_ID = CaptainId.make("chorus");
const PEER_LOOKUP_TIMEOUT = "5 seconds";

type HomeClaim = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly threadId: ThreadId | null;
  readonly reachability: "ready" | "offline" | "too_old";
};

const sameStatus = (a: FleetChorusStatus, b: FleetChorusStatus) =>
  JSON.stringify({ ...a, updatedAt: "" }) === JSON.stringify({ ...b, updatedAt: "" });

export class FleetChorusService extends Context.Service<
  FleetChorusService,
  {
    /** Ensures this machine's Chorus exists while its home setting is on. */
    readonly ensureHome: Effect.Effect<void>;
    /** The fleet home as this environment currently knows it. */
    readonly status: Effect.Effect<FleetChorusStatus>;
    /** Status updates, beginning with the current one. */
    readonly subscribe: Stream.Stream<FleetChorusStatus>;
    /** Re-reads linked machines now and publishes a changed status. */
    readonly refresh: Effect.Effect<FleetChorusStatus>;
  }
>()("t3/captains/FleetChorusService") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const captains = yield* CaptainService.CaptainService;
  const store = yield* CaptainStore.CaptainStore;
  const links = yield* PeerLinks.PeerLinks;
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const changes = yield* PubSub.unbounded<FleetChorusStatus>();
  const current = yield* Ref.make<FleetChorusStatus | null>(null);
  const reconcileLock = yield* Semaphore.make(1);
  const refreshLock = yield* Semaphore.make(1);

  const publish = Effect.fn("FleetChorusService.publish")(function* (status: FleetChorusStatus) {
    const previous = yield* Ref.get(current);
    if (previous !== null && sameStatus(previous, status)) return previous;
    yield* Ref.set(current, status);
    yield* PubSub.publish(changes, status);
    return status;
  });

  const ensureHome = Effect.fn("FleetChorusService.ensureHome")(
    function* () {
      const server = yield* settings.getSettings;
      const existing = yield* store.findChorus();
      if (!server.chorusHome) {
        if (existing?.archivedAt === null) {
          yield* captains.archive({ captainId: existing.id }, true);
        }
        return;
      }
      if (existing?.archivedAt === null) return;
      if (existing !== undefined) {
        yield* captains.unarchive({ captainId: existing.id }, true);
        return;
      }
      const available = (yield* providers.getProviders).find(
        (provider) =>
          provider.enabled &&
          provider.installed &&
          isProviderAvailable(provider) &&
          provider.auth.status !== "unauthenticated" &&
          provider.models.length > 0 &&
          resolveProjectProviderInstanceEnabled(server, null, provider.instanceId),
      );
      const model =
        available?.models.find((candidate) => candidate.isDefault && !candidate.isCustom) ??
        available?.models[0];
      const modelSelection =
        server.defaultModelSelection ??
        server.fallbackModelSelection ??
        (available && model ? { instanceId: available.instanceId, model: model.slug } : null);
      if (modelSelection === null) return;
      yield* captains.create(
        {
          captainId: HOME_CAPTAIN_ID,
          kind: "chorus",
          name: "Chorus",
          role: "",
          instructions: "",
          avatar: { preset: "circle", color: "orange" },
          scopedProjectIds: [],
          reportPolicy: "react",
          coordinatorOnly: true,
          modelSelection,
          runtimeMode: server.defaultRuntimeMode,
          interactionMode: "default",
          creationSource: "server",
        },
        true,
      );
    },
    Effect.catch((error) =>
      Effect.logWarning("Could not reconcile the local Chorus home.", { error }),
    ),
    reconcileLock.withPermits(1),
  );

  const computeStatus = Effect.fn("FleetChorusService.computeStatus")(function* () {
    yield* ensureHome();
    const now = DateTime.formatIso(yield* DateTime.now);
    const server = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null));
    const localHome = server?.chorusHome === true;
    const descriptor = yield* environment.getDescriptor;
    const claims: HomeClaim[] = [];

    if (localHome) {
      const active = yield* store.findActiveChorus().pipe(Effect.orElseSucceed(() => undefined));
      claims.push({
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        threadId: active?.primaryThreadId ?? null,
        reachability: "ready",
      });
    }

    if (yield* links.enabled.pipe(Effect.orElseSucceed(() => false))) {
      const [names, learned] = yield* Effect.all([links.names(), links.chorusHomeRecords], {
        concurrency: 2,
      }).pipe(Effect.orElseSucceed(() => [[], []] as const));
      const learnedByEnvironment = new Map(learned.map((row) => [row.environmentId, row]));
      const checked = yield* Effect.forEach(
        names,
        (link) =>
          Effect.gen(function* () {
            const stored = learnedByEnvironment.get(link.environmentId);
            const resolved = yield* links
              .resolve(link.environmentId)
              .pipe(Effect.timeout(PEER_LOOKUP_TIMEOUT), Effect.result);
            const unavailable = (reachability: "offline" | "too_old"): HomeClaim | null =>
              stored === undefined
                ? null
                : {
                    environmentId: link.environmentId,
                    label: link.label,
                    threadId: stored.threadId,
                    reachability,
                  };
            if (Result.isFailure(resolved)) {
              return unavailable(
                "_tag" in resolved.failure &&
                  resolved.failure._tag === "PeerLinkError" &&
                  resolved.failure.reason === "incompatible"
                  ? "too_old"
                  : "offline",
              );
            }
            if (resolved.success.capabilities.fleetChorus !== true) return unavailable("too_old");
            const answer = yield* peers
              .call({
                environmentId: link.environmentId,
                tool: chorusHomeTool,
                arguments: {},
                limits: { runtimeMode: "approval-required", interactionMode: "default" },
                success: ChorusHomeResult,
              })
              .pipe(Effect.timeout(PEER_LOOKUP_TIMEOUT), Effect.option);
            if (answer._tag === "None") return unavailable("offline");
            const claim = answer.value.home ? { threadId: answer.value.threadId } : null;
            if (
              (stored !== undefined) !== (claim !== null) ||
              stored?.threadId !== claim?.threadId
            ) {
              yield* links.recordChorusHome(link.environmentId, claim);
            }
            return claim !== null
              ? {
                  environmentId: link.environmentId,
                  label: link.label,
                  threadId: claim.threadId,
                  reachability: "ready" as const,
                }
              : null;
          }).pipe(Effect.orElseSucceed(() => null)),
        { concurrency: 4 },
      );
      claims.push(...checked.filter((claim) => claim !== null));
    }

    const preferred =
      claims.find((claim) => claim.reachability === "ready" && claim.threadId !== null) ??
      claims.find((claim) => claim.reachability === "ready") ??
      claims.find((claim) => claim.reachability === "offline") ??
      claims.find((claim) => claim.reachability === "too_old") ??
      null;
    return {
      state:
        claims.length > 1
          ? "conflict"
          : preferred === null
            ? "unconfigured"
            : preferred.reachability === "ready" && preferred.threadId === null
              ? "setting_up"
              : preferred.reachability,
      home:
        preferred === null
          ? null
          : {
              environmentId: preferred.environmentId,
              label: preferred.label,
              threadId: preferred.threadId,
            },
      localHome,
      conflictingHomes: claims.length > 1 ? claims.map((claim) => claim.label) : [],
      updatedAt: now,
    } satisfies FleetChorusStatus;
  });

  const refresh = Effect.fn("FleetChorusService.refresh")(function* () {
    return yield* computeStatus().pipe(Effect.flatMap((status) => publish(status)));
  }, refreshLock.withPermits(1));

  const status = Effect.gen(function* () {
    const existing = yield* Ref.get(current);
    return existing ?? (yield* refresh());
  });

  const subscribe = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const first = yield* refresh();
      return Stream.concat(
        Stream.succeed(first),
        Stream.fromSubscription(subscription).pipe(
          Stream.mapEffect(() => Ref.get(current).pipe(Effect.map((latest) => latest ?? first))),
        ),
      ).pipe(Stream.changesWith(sameStatus));
    }),
  );

  return FleetChorusService.of({
    ensureHome: ensureHome(),
    status,
    subscribe,
    refresh: refresh(),
  });
});

export const layer = Layer.effect(FleetChorusService, make);

export const worker = Layer.effectDiscard(
  Effect.gen(function* () {
    const service = yield* FleetChorusService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const store = yield* CaptainStore.CaptainStore;
    const links = yield* PeerLinks.PeerLinks;
    const settingsChanges = yield* settings.subscribeChanges;
    const profileChanges = yield* store.subscribeChorusThreadChanges;
    const linkChanges = yield* links.subscribeChanges;
    yield* service.ensureHome;
    yield* Stream.runForEach(
      Stream.mergeAll(
        [
          settingsChanges.pipe(Stream.as(undefined)),
          profileChanges.pipe(Stream.as(undefined)),
          linkChanges,
        ],
        { concurrency: "unbounded" },
      ).pipe(Stream.buffer({ capacity: 1, strategy: "sliding" })),
      () => service.refresh,
    ).pipe(Effect.forkScoped);
    yield* Stream.runForEach(providers.streamChanges, () => service.ensureHome).pipe(
      Effect.forkScoped,
    );
  }),
);
