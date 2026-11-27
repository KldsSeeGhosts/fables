import type { CaptainTaskStatus } from "@t3tools/client-runtime/state/captain-tasks";
import type { ReactNode } from "react";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";

import { useRepeatingStatusProgress, useStatusMotionAllowed } from "../../lib/status-motion";
import { useDuetTokens } from "./useDuetTokens";

export function CaptainTaskRing(props: {
  readonly status: CaptainTaskStatus;
  readonly size?: number;
  readonly visible?: boolean;
}) {
  const tokens = useDuetTokens();
  const color = {
    "needs-input": tokens.needsInputRing,
    working: tokens.working,
    ready: tokens.ready,
    failed: tokens.failed,
    stopped: tokens.meta,
    scheduled: tokens.meta,
    done: tokens.meta,
    unknown: tokens.meta,
  }[props.status];
  const size = props.size ?? 16;
  const ring = (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Circle
        cx="8"
        cy="8"
        r="6.25"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={props.status === "working" ? "3 2.4" : undefined}
        strokeLinecap="round"
      />
      {props.status === "needs-input" ? <Circle cx="8" cy="8" r="2" fill={color} /> : null}
      {props.status === "ready" ? <Circle cx="8" cy="8" r="2.25" fill={color} /> : null}
      {props.status === "failed" ? (
        <Path
          d="M5.75 5.75l4.5 4.5m0-4.5l-4.5 4.5"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ) : null}
      {props.status === "done" ? (
        <Path
          d="M5.4 8.2l1.8 1.8 3.6-4"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {props.status === "stopped" || props.status === "unknown" || props.status === "scheduled" ? (
        <Path d="M5.7 10.3l4.6-4.6" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      ) : null}
    </Svg>
  );
  return props.status === "working" ? (
    <SpinningStatusRing visible={props.visible ?? true}>{ring}</SpinningStatusRing>
  ) : (
    ring
  );
}

export function SpinningStatusRing(props: {
  readonly visible: boolean;
  readonly children: ReactNode;
}) {
  const allowed = useStatusMotionAllowed();
  return allowed && props.visible ? (
    <StatusRingSpin>{props.children}</StatusRingSpin>
  ) : (
    props.children
  );
}

function StatusRingSpin({ children }: { readonly children: ReactNode }) {
  const progress = useRepeatingStatusProgress(true, 1000);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.get() * 360}deg` }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
