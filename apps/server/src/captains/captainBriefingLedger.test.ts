import { describe, expect, it } from "vite-plus/test";

import { makeCaptainBriefingLedger } from "./captainBriefingLedger.ts";

const turn = (providerThreadId: string, usedTokens: number | null = null) => ({
  providerThreadId,
  usedTokens,
});

describe("makeCaptainBriefingLedger", () => {
  it("sends the briefing once per provider thread, then only after it changes", () => {
    const ledger = makeCaptainBriefingLedger();
    const first = ledger.plan(turn("a"), "profile v1");
    expect(first.full).toBe(true);
    first.commit();

    expect(ledger.plan(turn("a"), "profile v1").full).toBe(false);
    expect(ledger.plan(turn("a"), "profile v2").full).toBe(true);
    expect(ledger.plan(turn("b"), "profile v1").full).toBe(true);
  });

  it("does not treat a turn that never started as delivered", () => {
    const ledger = makeCaptainBriefingLedger();
    expect(ledger.plan(turn("a"), "profile").full).toBe(true);
    expect(ledger.plan(turn("a"), "profile").full).toBe(true);
  });

  it("sends it again after the provider compacts its context", () => {
    const ledger = makeCaptainBriefingLedger();
    ledger.plan(turn("a", 50_000), "profile").commit();
    ledger.plan(turn("a", 60_000), "profile").commit();
    expect(ledger.plan(turn("a", 9_000), "profile").full).toBe(true);
  });

  it("refreshes the full briefing every few turns", () => {
    const ledger = makeCaptainBriefingLedger(3);
    const plans = Array.from({ length: 6 }, () => {
      const plan = ledger.plan(turn("a"), "profile");
      plan.commit();
      return plan.full;
    });
    expect(plans).toEqual([true, false, false, true, false, false]);
  });
});
