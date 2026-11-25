import type { CaptainTaskStatus } from "@t3tools/client-runtime/state/captain-tasks";
import Svg, { Circle, Path } from "react-native-svg";

const RING_COLOR: Record<CaptainTaskStatus, string> = {
  "needs-input": "#a98546",
  working: "#d97757",
  ready: "#1e7d2c",
  failed: "#c4473a",
  stopped: "#838383",
  scheduled: "#838383",
  done: "#838383",
  unknown: "#838383",
};

/** The Duet task state ring the desktop drawer uses, drawn static. */
export function CaptainTaskRing(props: {
  readonly status: CaptainTaskStatus;
  readonly size?: number;
}) {
  const color = RING_COLOR[props.status];
  const size = props.size ?? 16;
  return (
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
}
