import { describe, expect, it } from "vite-plus/test";

import {
  advanceDuetLiveStatus,
  DUET_LIVE_CELEBRATE_MS,
  DUET_LIVE_FADE_MS,
  DUET_LIVE_HIDE_DELAY_MS,
  DUET_LIVE_LABEL_HOLD_MS,
  initialDuetLiveStatusMachine,
  resolveDuetActivityStatus,
  resolveDuetOrbState,
  type DuetLiveStatusInput,
  type DuetLiveStatusMachine,
} from "./duetStatus.logic";

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

describe("resolveDuetActivityStatus", () => {
  const base = {
    state: "working",
    runtimePhase: "running",
    activeTurnItem: null,
    activeChildren: 0,
    backgroundTasks: [],
  } as const;

  it.each([
    {
      name: "reads one file",
      item: { type: "dynamic_tool", toolName: "Read", input: { filePath: "a.ts" } },
      activity: "reading",
      label: "Reading a file",
    },
    {
      name: "reads several files",
      item: {
        type: "dynamic_tool",
        toolName: "Read",
        input: { filePath: "a.ts", locations: [{ filePath: "b.ts" }] },
      },
      activity: "reading",
      label: "Reading files",
    },
    {
      name: "edits files",
      item: { type: "file_change" },
      activity: "editing",
      label: "Editing files",
    },
    {
      name: "runs a command",
      item: { type: "command_execution", input: "pnpm test" },
      activity: "command",
      label: "Running a command",
    },
    {
      name: "searches the codebase",
      item: { type: "file_search" },
      activity: "searching",
      label: "Searching the codebase",
    },
    {
      name: "searches the web",
      item: { type: "web_search" },
      activity: "searching",
      label: "Searching the web",
    },
    {
      name: "browses a browser surface",
      item: { type: "dynamic_tool", toolName: "browser", toolSurface: "browser" },
      activity: "browsing",
      label: "Browsing",
    },
    {
      name: "writes a response",
      item: { type: "assistant_message" },
      activity: "writing",
      label: "Writing a response",
    },
    {
      name: "delegates a task item",
      item: { type: "subagent" },
      activity: "delegating",
      label: "Delegating a task",
    },
    {
      name: "compacts context",
      item: { type: "compaction" },
      activity: "thinking",
      label: "Compacting context",
    },
    {
      name: "thinks during reasoning",
      item: { type: "reasoning" },
      activity: "thinking",
      label: "Thinking",
    },
  ])("maps $name", ({ item, activity, label }) => {
    expect(resolveDuetActivityStatus({ ...base, activeTurnItem: item })).toEqual({
      activity,
      label,
    });
  });

  it("counts active delegated tasks before turn items", () => {
    expect(
      resolveDuetActivityStatus({
        ...base,
        activeChildren: 3,
        activeTurnItem: { type: "command_execution", input: "pnpm test" },
      }),
    ).toEqual({ activity: "delegating", label: "Working on 3 tasks" });
  });

  it.each([
    { runtimePhase: "starting", label: "Starting" },
    { runtimePhase: "preparing", label: "Starting" },
    { runtimePhase: "queued", label: "Queued" },
    { runtimePhase: "running", label: "Thinking" },
  ])("uses the $runtimePhase runtime fallback", ({ runtimePhase, label }) => {
    expect(resolveDuetActivityStatus({ ...base, runtimePhase })).toEqual({
      activity: "thinking",
      label,
    });
  });

  it("maps waiting, offline, and idle states", () => {
    expect(resolveDuetActivityStatus({ ...base, state: "waiting" })).toEqual({
      activity: "waiting",
      label: "Waiting for you",
    });
    expect(resolveDuetActivityStatus({ ...base, state: "offline" })).toEqual({
      activity: "offline",
      label: "Offline",
    });
    expect(resolveDuetActivityStatus({ ...base, state: "idle" })).toEqual({
      activity: "idle",
      label: "Idle",
    });
  });
});

describe("advanceDuetLiveStatus", () => {
  const input = (overrides: Partial<DuetLiveStatusInput> = {}): DuetLiveStatusInput => ({
    visible: true,
    retainOnHide: false,
    label: "Thinking",
    activity: "thinking",
    ...overrides,
  });
  const advance = (machine: DuetLiveStatusMachine, desired: DuetLiveStatusInput, now: number) =>
    advanceDuetLiveStatus(machine, desired, now);

  it("shows the first label immediately", () => {
    const step = advance(initialDuetLiveStatusMachine, input(), 1_000);
    expect(step.output).toEqual({
      visible: true,
      label: "Thinking",
      activity: "thinking",
      outgoing: null,
      celebrating: false,
    });
    expect(step.wakeAt).toBeNull();
  });

  it("holds a young label instead of flashing a replacement", () => {
    const first = advance(initialDuetLiveStatusMachine, input(), 1_000);
    const held = advance(
      first.machine,
      input({ label: "Reading a file", activity: "reading" }),
      1_999,
    );
    expect(held.output.label).toBe("Thinking");
    expect(held.wakeAt).toBe(1_000 + DUET_LIVE_LABEL_HOLD_MS);
  });

  it("cross-fades a replacement after the hold", () => {
    const first = advance(initialDuetLiveStatusMachine, input(), 1_000);
    const replaced = advance(
      first.machine,
      input({ label: "Reading a file", activity: "reading" }),
      1_000 + DUET_LIVE_LABEL_HOLD_MS,
    );
    expect(replaced.output.label).toBe("Reading a file");
    expect(replaced.output.outgoing).toEqual({ label: "Thinking", activity: "thinking" });
    expect(replaced.wakeAt).toBe(2_000 + DUET_LIVE_FADE_MS);

    const settled = advance(
      replaced.machine,
      input({ label: "Reading a file", activity: "reading" }),
      2_000 + DUET_LIVE_FADE_MS,
    );
    expect(settled.output.outgoing).toBeNull();
    expect(settled.wakeAt).toBeNull();
  });

  it("waits before hiding after work finishes and celebrates once", () => {
    const working = advance(initialDuetLiveStatusMachine, input(), 1_000);
    const idle = input({ visible: false, retainOnHide: true, label: "Idle", activity: "idle" });
    const held = advance(working.machine, idle, 2_000);
    expect(held.output.visible).toBe(true);
    expect(held.output.label).toBe("Thinking");
    expect(held.output.celebrating).toBe(true);
    expect(held.wakeAt).toBe(2_000 + DUET_LIVE_CELEBRATE_MS);

    const celebrationEnds = advance(held.machine, idle, held.wakeAt!);
    expect(celebrationEnds.output.visible).toBe(true);
    expect(celebrationEnds.output.celebrating).toBe(false);
    expect(celebrationEnds.wakeAt).toBe(2_000 + DUET_LIVE_HIDE_DELAY_MS);

    const hidden = advance(celebrationEnds.machine, idle, celebrationEnds.wakeAt!);
    expect(hidden.output.visible).toBe(false);
    expect(hidden.output.label).toBe("Idle");
    expect(hidden.machine.celebrateUntil).toBeNull();
    expect(hidden.wakeAt).toBeNull();
  });

  it("does not celebrate when waiting resolves without work", () => {
    let machine = initialDuetLiveStatusMachine;
    machine = advanceDuetLiveStatus(
      machine,
      { visible: true, retainOnHide: false, label: "Waiting for you", activity: "waiting" },
      1_000,
    ).machine;
    machine = advanceDuetLiveStatus(
      machine,
      { visible: false, retainOnHide: true, label: "Idle", activity: "idle" },
      1_100,
    ).machine;
    const later = advanceDuetLiveStatus(
      machine,
      { visible: false, retainOnHide: true, label: "Idle", activity: "idle" },
      1_200,
    );
    expect(later.output.celebrating).toBe(false);
  });

  it("hides immediately for states without an idle hold", () => {
    const working = advance(initialDuetLiveStatusMachine, input(), 1_000);
    const offline = advance(
      working.machine,
      input({ visible: false, retainOnHide: false, label: "Offline", activity: "offline" }),
      2_000,
    );
    expect(offline.output.visible).toBe(false);
    expect(offline.output.celebrating).toBe(false);
  });
});
