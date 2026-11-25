/** How many prompted turns may reuse a briefing before it is sent again in full. */
const CAPTAIN_BRIEFING_REFRESH_TURNS = 8;
const MAX_TRACKED_PROVIDER_THREADS = 512;

export interface CaptainBriefingDelivery {
  readonly providerThreadId: string;
  /** The provider thread's last reported context size; a drop means it was compacted. */
  readonly usedTokens: number | null;
  /** The same session's context limits, for the context pressure note. */
  readonly maxTokens?: number | null;
  readonly autoCompactThreshold?: number | null;
}

// FNV-1a; only compares one briefing with the last one sent, so collisions just skip one refresh.
const fingerprint = (text: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return `${text.length}:${hash >>> 0}`;
};

interface SentBriefing {
  readonly hash: string;
  readonly turnsSince: number;
  readonly usedTokens: number | null;
}

/**
 * Tracks which Captain briefing each provider thread already holds, so a long-lived Captain gets
 * its profile once and then only what changed. It lives in memory: after a server restart every
 * provider thread is sent the full briefing again, which is the safe direction to be wrong in.
 */
export function makeCaptainBriefingLedger(refreshTurns = CAPTAIN_BRIEFING_REFRESH_TURNS) {
  const sent = new Map<string, SentBriefing>();

  return {
    /** Whether this turn must carry the full briefing, and how to record that the turn took it. */
    plan(delivery: CaptainBriefingDelivery, briefing: string) {
      const hash = fingerprint(briefing);
      const previous = sent.get(delivery.providerThreadId);
      const compacted =
        previous?.usedTokens != null &&
        delivery.usedTokens !== null &&
        delivery.usedTokens < previous.usedTokens;
      const full =
        previous === undefined ||
        previous.hash !== hash ||
        compacted ||
        previous.turnsSince + 1 >= refreshTurns;
      const commit = () => {
        sent.delete(delivery.providerThreadId);
        sent.set(delivery.providerThreadId, {
          hash,
          turnsSince: full ? 0 : previous!.turnsSince + 1,
          usedTokens: delivery.usedTokens,
        });
        if (sent.size > MAX_TRACKED_PROVIDER_THREADS) {
          sent.delete(sent.keys().next().value!);
        }
      };
      return { full, commit };
    },
  };
}
