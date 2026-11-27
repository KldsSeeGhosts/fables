import {
  CaptainId,
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
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as CaptainService from "./CaptainService.ts";
import * as CaptainStore from "./CaptainStore.ts";
import { chorusHomeTool, ChorusHomeResult } from "./chorusFleet.ts";

const HOME_CAPTAIN_ID = CaptainId.make("chorus");
const REFRESH_INTERVAL = Schedule.spaced("15 seconds");

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
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const changes = yield* PubSub.unbounded<FleetChorusStatus>();
  const current = yield* Ref.make<FleetChorusStatus | null>(null);

  const publish = Effect.fn("FleetChorusService.publish")(function* (status: FleetChorusStatus) {
    const previous = yield* Ref.get(current);
    if (previous !== null && sameStatus(previous, status)) return status;
    yield* Ref.set(current, status);
    yield* PubSub.publish(changes, status);
    return status;
  });

  const ensureHome = Effect.fn("FleetChorusService.ensureHome")(function* () {
    const server = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null));
    if (server?.chorusHome !== true) return;
    const existing = yield* store.findChorus().pipe(Effect.orElseSucceed(() => undefined));
    if (existing?.archivedAt === null) return;
    if (existing !== undefined) {
      yield* captains
        .unarchive({ captainId: existing.id })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not restore the fleet Chorus home.", { error }),
          ),
        );
      return;
    }
    if (server.defaultModelSelection === null && server.textGenerationModelSelection === null) {
      yield* Effect.logWarning(
        "The Chorus home is on, but no model is configured for its first conversation.",
      );
      return;
    }
    yield* captains
      .create({
        captainId: HOME_CAPTAIN_ID,
        kind: "chorus",
        name: "Chorus",
        role: "",
        instructions: "",
        avatar: { preset: "circle", color: "orange" },
        scopedProjectIds: [],
        reportPolicy: "react",
        coordinatorOnly: true,
        modelSelection: server.defaultModelSelection ?? server.textGenerationModelSelection,
        runtimeMode: server.defaultRuntimeMode,
        interactionMode: "default",
        creationSource: "server",
      })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not create the fleet Chorus home.", { error }),
        ),
      );
  });

  const computeStatus = Effect.fn("FleetChorusService.computeStatus")(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const server = yield* settings.getSettings.pipe(Effect.orElseSucceed(() => null));
    const localHome = server?.chorusHome === true;
    const descriptor = yield* environment.getDescriptor;
    const claims: HomeClaim[] = [];
    const conflicts = new Set<string>();

    if (localHome) {
      yield* ensureHome();
      const active = yield* store.findActiveChorus().pipe(Effect.orElseSucceed(() => undefined));
      claims.push({
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        threadId: active?.primaryThreadId ?? null,
        reachability: "ready",
      });
    }

    if ((yield* links.enabled.pipe(Effect.orElseSucceed(() => false))) && !localHome) {
      const [names, learned] = yield* Effect.all([links.names(), links.chorusHomeRecords], {
        concurrency: 2,
      }).pipe(Effect.orElseSucceed(() => [[], []] as const));
      const learnedByEnvironment = new Map(learned.map((row) => [row.environmentId, row]));
      const checked = yield* Effect.forEach(
        names,
        (link) =>
          Effect.gen(function* () {
            const stored = learnedByEnvironment.get(link.environmentId);
            const resolved = yield* links.resolve(link.environmentId).pipe(Effect.option);
            if (resolved._tag === "None") {
              return stored?.threadId != null
                ? {
                    environmentId: link.environmentId,
                    label: link.label,
                    threadId: stored.threadId,
                    reachability: "offline" as const,
                  }
                : null;
            }
            if (resolved.value.capabilities.fleetChorus !== true) {
              yield* links.recordChorusHome(link.environmentId, {
                threadId: stored?.threadId ?? null,
                capable: false,
              });
              return stored?.threadId != null
                ? {
                    environmentId: link.environmentId,
                    label: link.label,
                    threadId: stored.threadId,
                    reachability: "too_old" as const,
                  }
                : null;
            }
            const answer = yield* peers
              .call({
                environmentId: link.environmentId,
                tool: chorusHomeTool,
                arguments: {},
                limits: { runtimeMode: "approval-required", interactionMode: "default" },
                success: ChorusHomeResult,
              })
              .pipe(Effect.timeout("4 seconds"), Effect.option);
            if (answer._tag === "None") {
              return stored?.threadId != null
                ? {
                    environmentId: link.environmentId,
                    label: link.label,
                    threadId: stored.threadId,
                    reachability: "offline" as const,
                  }
                : null;
            }
            const threadId = answer.value.home ? answer.value.threadId : null;
            yield* links.recordChorusHome(link.environmentId, { threadId, capable: true });
            return threadId !== null
              ? {
                  environmentId: link.environmentId,
                  label: link.label,
                  threadId,
                  reachability: "ready" as const,
                }
              : null;
          }).pipe(Effect.orElseSucceed(() => null)),
        { concurrency: 4 },
      );
      claims.push(...checked.filter((claim) => claim !== null));
    }

    for (const claim of claims.slice(1)) conflicts.add(claim.label);
    if (claims.length > 1 && claims[0]) conflicts.add(claims[0].label);
    const preferred =
      claims.find((claim) => claim.reachability === "ready" && claim.threadId !== null) ??
      claims.find((claim) => claim.reachability === "offline") ??
      claims.find((claim) => claim.reachability === "too_old") ??
      null;
    return {
      state:
        claims.length > 1
          ? "conflict"
          : preferred === null
            ? "unconfigured"
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
      conflictingHomes: claims.length > 1 ? [...conflicts] : [],
      updatedAt: now,
    } satisfies FleetChorusStatus;
  });

  const refresh = Effect.fn("FleetChorusService.refresh")(function* () {
    return yield* computeStatus().pipe(Effect.flatMap((status) => publish(status)));
  });

  const status = Effect.gen(function* () {
    const existing = yield* Ref.get(current);
    return existing ?? (yield* computeStatus());
  });

  const subscribe = Stream.unwrap(
    Effect.gen(function* () {
      const first = yield* refresh();
      const subscription = yield* PubSub.subscribe(changes);
      return Stream.concat(Stream.succeed(first), Stream.fromSubscription(subscription));
    }),
  );

  yield* ensureHome();
  yield* refresh().pipe(Effect.repeat(REFRESH_INTERVAL), Effect.forkScoped);

  return FleetChorusService.of({
    ensureHome: ensureHome(),
    status,
    subscribe,
    refresh: refresh(),
  });
});

export const layer = Layer.effect(FleetChorusService, make);
