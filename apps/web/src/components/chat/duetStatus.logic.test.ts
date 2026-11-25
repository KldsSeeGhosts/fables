import { describe, expect, it } from "vite-plus/test";

import { resolveDuetOrbState } from "./duetStatus.logic";

describe("resolveDuetOrbState", () => {
  it("reports offline before attention or work", () => {
    expect(
      resolveDuetOrbState({
        connected: false,
        runtimeActive: true,
        backgroundTasks: 2,
        attention: 3,
        activeChildren: 4,
      }),
    ).toBe("offline");
  });

  it("reports waiting before active work", () => {
    expect(
      resolveDuetOrbState({
        connected: true,
        runtimeActive: true,
        backgroundTasks: 1,
        attention: 1,
        activeChildren: 1,
      }),
    ).toBe("waiting");
  });

  it.each([
    { runtimeActive: true, backgroundTasks: 0, activeChildren: 0 },
    { runtimeActive: false, backgroundTasks: 1, activeChildren: 0 },
    { runtimeActive: false, backgroundTasks: 0, activeChildren: 1 },
  ])("reports working for active input %#", (work) => {
    expect(
      resolveDuetOrbState({
        connected: true,
        attention: 0,
        ...work,
      }),
    ).toBe("working");
  });

  it("reports idle when connected work is settled", () => {
    expect(
      resolveDuetOrbState({
        connected: true,
        runtimeActive: false,
        backgroundTasks: 0,
        attention: 0,
        activeChildren: 0,
      }),
    ).toBe("idle");
  });
});
