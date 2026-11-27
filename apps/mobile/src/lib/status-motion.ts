import { useEffect, useSyncExternalStore } from "react";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

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
const breatheEase = Easing.inOut(Easing.ease);

export function useRepeatingStatusProgress(enabled: boolean, duration: number, alternate = false) {
  const progress = useSharedValue(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives and cancels a UI-thread animation
  useEffect(() => {
    if (!enabled) return;
    progress.set(
      withRepeat(
        withTiming(1, { duration, easing: alternate ? breatheEase : Easing.linear }),
        -1,
        alternate,
        undefined,
        ReduceMotion.System,
      ),
    );
    return () => {
      cancelAnimation(progress);
      progress.set(0);
    };
  }, [alternate, duration, enabled, progress]);
  return progress;
}
