import type { Captain, CaptainSnapshot, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import type { CachedCaptains } from "./captainsCache";

/** Loading and failed environments are not empty ones, so lists say which they are. */
export type CaptainEnvironmentStatus = "loading" | "failed" | "ready";

export interface CaptainEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: CaptainEnvironmentStatus;
  readonly snapshot: CaptainSnapshot | null;
  readonly captains: ReadonlyArray<Captain>;
}

export interface CaptainEnvironmentCandidate {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** The host's Captains capability, or undefined before its config is known. */
  readonly captainsCapability: boolean | undefined;
}

type LiveCaptains = ReadonlyArray<{
  readonly environmentId: EnvironmentId;
  readonly result: AsyncResult.AsyncResult<CaptainSnapshot, unknown>;
}>;

function environmentStatus(result: AsyncResult.AsyncResult<CaptainSnapshot, unknown> | undefined): {
  readonly status: CaptainEnvironmentStatus;
  readonly snapshot: CaptainSnapshot | null;
} {
  const snapshot = result === undefined ? null : Option.getOrNull(AsyncResult.value(result));
  // A failed refresh keeps showing what was loaded before it.
  if (snapshot !== null) return { status: "ready", snapshot };
  return {
    status: result !== undefined && AsyncResult.isFailure(result) ? "failed" : "loading",
    snapshot,
  };
}

/** Environments whose live Captains to subscribe to: readable hosts that run Captains. */
export function liveCaptainEnvironments(
  candidates: ReadonlyArray<CaptainEnvironmentCandidate>,
  readable: ReadonlySet<EnvironmentId>,
): ReadonlyArray<CaptainEnvironmentCandidate> {
  return candidates.filter(
    (candidate) => readable.has(candidate.environmentId) && candidate.captainsCapability === true,
  );
}

/**
 * Live Captains per environment. Until an environment's live list arrives, including before
 * its host has answered at all, its cached list from the last launch stands in so the first
 * frame already draws the Captains section.
 */
export function resolveCaptainEnvironments(input: {
  readonly candidates: ReadonlyArray<CaptainEnvironmentCandidate>;
  readonly readable: ReadonlySet<EnvironmentId>;
  readonly denied: ReadonlySet<EnvironmentId>;
  readonly live: LiveCaptains;
  readonly cached: CachedCaptains;
}): ReadonlyArray<CaptainEnvironment> {
  return input.candidates.flatMap((candidate): CaptainEnvironment[] => {
    const id = candidate.environmentId;
    const cached = input.cached.get(id);
    const supported = input.readable.has(id) && candidate.captainsCapability === true;
    const awaitingHost =
      !input.readable.has(id) &&
      !input.denied.has(id) &&
      candidate.captainsCapability !== false &&
      cached !== undefined;
    if (!supported && !awaitingHost) return [];
    const { status, snapshot } = supported
      ? environmentStatus(input.live.find((entry) => entry.environmentId === id)?.result)
      : { status: "loading" as const, snapshot: null };
    return [
      {
        environmentId: id,
        label: candidate.label,
        status,
        snapshot,
        captains: (snapshot?.captains ?? cached ?? []).filter(
          (captain) => captain.archivedAt === null || captain.kind === "chorus",
        ),
      },
    ];
  });
}
