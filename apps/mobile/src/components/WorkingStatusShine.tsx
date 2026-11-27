import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";

import { useRepeatingStatusProgress, useStatusMotionAllowed } from "../lib/status-motion";
import { AppText, type AppTextProps } from "./ui/AppText";

const SWEEP_WIDTH = 18;

type LabelProps = AppTextProps & { readonly children: string };

export function WorkingStatusShine({
  visible,
  ...label
}: LabelProps & { readonly visible: boolean }) {
  const allowed = useStatusMotionAllowed();
  return allowed && visible ? <SweepingLabel {...label} /> : <AppText {...label} />;
}

function SweepingLabel(label: LabelProps) {
  const [width, setWidth] = useState(0);
  const progress = useRepeatingStatusProgress(width > 0, 2200);
  const bandStyle = useAnimatedStyle(() => {
    // Desktop steps through the sweep at 30 positions.
    const step = Math.floor(progress.get() * 30) / 30;
    return {
      opacity: interpolate(step, [0, 0.25, 0.75, 1], [0, 1, 1, 0]),
      transform: [{ translateX: -SWEEP_WIDTH + step * (width + SWEEP_WIDTH) }],
    };
  });
  const glyphStyle = useAnimatedStyle(() => {
    const step = Math.floor(progress.get() * 30) / 30;
    return { transform: [{ translateX: SWEEP_WIDTH - step * (width + SWEEP_WIDTH) }] };
  });
  return (
    <View style={styles.label} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <AppText {...label} />
      {width > 0 ? (
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.band, bandStyle]}
        >
          <Animated.View style={[{ width }, glyphStyle]}>
            <AppText
              {...label}
              onLayout={undefined}
              style={[label.style, { color: "rgba(255, 255, 255, 0.38)" }]}
            />
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { overflow: "hidden" },
  band: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: SWEEP_WIDTH,
    overflow: "hidden",
  },
});
