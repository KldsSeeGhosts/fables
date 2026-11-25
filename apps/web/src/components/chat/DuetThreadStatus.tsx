import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import { isOrchestrationV2WorkActive, type ScopedThreadRef } from "@t3tools/contracts";
import { useMessages } from "gt-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useEnvironment } from "~/state/environments";
import { useQuietThreadProjection, useQuietThreadShell } from "~/state/entities";

import {
  advanceDuetLiveStatus,
  initialDuetLiveStatusMachine,
  resolveDuetActivityStatus,
  resolveDuetOrbState,
  type DuetLiveStatusInput,
  type DuetLiveStatusMachine,
  type DuetLiveStatusOutput,
} from "./duetStatus.logic";

const hiddenLiveOutput: DuetLiveStatusOutput = {
  visible: false,
  label: "",
  activity: "idle",
  outgoing: null,
  celebrating: false,
};

function createDuetLiveStatusStore() {
  let machine: DuetLiveStatusMachine = initialDuetLiveStatusMachine;
  let output = hiddenLiveOutput;
  let input: DuetLiveStatusInput | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const evaluate = () => {
    if (input === null) return;
    clearTimer();
    const step = advanceDuetLiveStatus(machine, input, Date.now());
    machine = step.machine;
    output = step.output;
    if (step.wakeAt !== null) {
      timer = setTimeout(evaluate, Math.max(0, step.wakeAt - Date.now()));
    }
    emit();
  };

  return {
    update(next: DuetLiveStatusInput) {
      input = next;
      evaluate();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return output;
    },
    dispose() {
      clearTimer();
      listeners.clear();
    },
  };
}

type DuetLiveStatusStore = ReturnType<typeof createDuetLiveStatusStore>;

function useDuetLiveStatus(
  visible: boolean,
  retainOnHide: boolean,
  label: string,
  activity: DuetLiveStatusInput["activity"],
): DuetLiveStatusOutput {
  const [store] = useState<DuetLiveStatusStore>(() => createDuetLiveStatusStore());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the timer-backed label machine in step with the thread's status input while mounted
  useEffect(() => {
    store.update({ visible, retainOnHide, label, activity });
  }, [store, visible, retainOnHide, label, activity]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the label machine's timer when the header status unmounts
  useEffect(() => () => store.dispose(), [store]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** What a Duet thread is doing now: orb state, stabilized live label and creature activity. */
export function useDuetThreadStatus(threadRef: ScopedThreadRef) {
  const messages = useMessages();
  const shell = useQuietThreadShell(threadRef);
  const detail = useQuietThreadProjection(threadRef);
  const environment = useEnvironment(threadRef.environmentId);

  const projection = detail?.projection ?? null;
  const activeChildren = (projection?.subagents ?? []).filter((task) =>
    isOrchestrationV2WorkActive(task.status),
  );
  const backgroundTasks = shell?.pendingBackgroundTasks ?? [];
  const attention =
    (shell?.hasPendingApprovals === true ? 1 : 0) +
    (shell?.hasPendingUserInput === true ? 1 : 0) +
    (shell?.pendingSubagentRequest !== null && shell?.pendingSubagentRequest !== undefined
      ? 1
      : 0) +
    activeChildren.filter((task) => task.status === "waiting").length;
  const connected = environment === null || environment.connection.phase === "connected";
  const runtimeActive = shell !== null && threadRuntimeIsActive(shell.runtime);
  const state = resolveDuetOrbState({
    connected,
    runtimeActive,
    backgroundTasks: backgroundTasks.length,
    attention,
    activeChildren: activeChildren.length,
  });
  const activeTurnItem =
    (projection?.visibleTurnItems ?? []).findLast((entry) =>
      isOrchestrationV2WorkActive(entry.item.status),
    )?.item ?? null;
  const runtimePhase = shell?.runtime?.status ?? null;
  const desired = resolveDuetActivityStatus(
    {
      state,
      runtimePhase,
      activeTurnItem,
      activeChildren: activeChildren.length,
      backgroundTasks,
    },
    messages,
  );
  const live = useDuetLiveStatus(
    state === "working" || state === "waiting",
    state === "idle",
    desired.label,
    desired.activity,
  );

  return {
    state,
    // The creature follows the held label so its motion never outpaces the words beside it.
    activity: live.visible ? live.activity : desired.activity,
    liveLabel: live.label,
    liveVisible: live.visible,
    liveOutgoing: live.outgoing,
    celebrating: live.celebrating,
  };
}
