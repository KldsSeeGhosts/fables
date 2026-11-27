import { useEffect, useSyncExternalStore } from "react";
import { Easing, makeMutable, useDerivedValue, useReducedMotion } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";

import { readReduceMotionEnabled, subscribeReduceMotion, useAppActive } from "./appState";

export function useStatusMotionAllowed(): boolean {
  const initialPreference = useReducedMotion();
  // Reanimated's hook reads the startup value. Listen for changes while the app is open.
  const reduced = useSyncExternalStore(subscribeReduceMotion, () =>
    readReduceMotionEnabled(initialPreference),
  );
  const active = useAppActive();
  return active && !reduced;
}

export const statusMotionEase = Easing.bezier(0.2, 0.8, 0.2, 1);
const breatheEase = Easing.bezier(0.42, 0, 0.58, 1);

const workingFrameMs = 1000 / 30;
const workingTime = makeMutable(0);
const workingGeneration = makeMutable(0);
let workingConsumers = 0;

function startWorkingClock() {
  "worklet";
  const generation = workingGeneration.get() + 1;
  workingGeneration.set(generation);
  let lastFrame: number | undefined;
  const tick = (timestamp: number) => {
    if (workingGeneration.get() !== generation) return;
    const frame = Math.floor(timestamp / workingFrameMs);
    if (lastFrame !== undefined && frame > lastFrame) {
      workingTime.set(workingTime.get() + (frame - lastFrame) * workingFrameMs);
    }
    lastFrame = frame;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopWorkingClock() {
  "worklet";
  workingGeneration.set(workingGeneration.get() + 1);
}

function subscribeWorkingClock() {
  if (workingConsumers++ === 0) scheduleOnUI(startWorkingClock);
  return () => {
    if (--workingConsumers === 0) scheduleOnUI(stopWorkingClock);
  };
}

export function useRepeatingStatusProgress(enabled: boolean, duration: number, alternate = false) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the UI clock for visible working views and stops it after the last one leaves
  useEffect(() => (enabled ? subscribeWorkingClock() : undefined), [enabled]);

  // Batch updates across rows at 30 Hz to limit Fabric commits while the list scrolls.
  return useDerivedValue(() => {
    if (!enabled) return 0;
    const phase = workingTime.get() / duration;
    if (!alternate) return phase % 1;
    const cycle = phase % 2;
    return breatheEase.factory()(cycle <= 1 ? cycle : 2 - cycle);
  });
}
