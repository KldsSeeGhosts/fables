import {
  captainPaletteOf,
  DUET_PALETTE_SWATCH,
} from "@t3tools/client-runtime/state/captain-palette";
import type { Captain } from "@t3tools/contracts";
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { SpinningStatusRing } from "./CaptainTaskRing";
import { DuetCreature } from "./DuetCreature";

export function CaptainOrb(props: {
  readonly captain: Pick<Captain, "id" | "avatar">;
  readonly size?: number;
  readonly working?: boolean;
  readonly attention?: number;
  readonly motion?: {
    readonly visible: boolean;
    readonly glance: number;
    readonly completedRunId: string | undefined;
  };
}) {
  const size = props.size ?? 36;
  const swatch = DUET_PALETTE_SWATCH[captainPaletteOf(props.captain.avatar)];
  const gradientId = `captain-orb-${useId().replace(/[^A-Za-z0-9_-]/g, "-")}-gradient`;
  const attention = props.attention ?? 0;
  const state = attention > 0 ? "waiting" : props.working ? "working" : "idle";
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <View style={StyleSheet.absoluteFill}>
        <Svg width={size} height={size} viewBox="0 0 40 40">
          <Defs>
            <RadialGradient id={gradientId} cx="35%" cy="30%" r="75%">
              <Stop offset="0" stopColor={swatch.tint} />
              <Stop offset="1" stopColor={swatch.bubble} />
            </RadialGradient>
          </Defs>
          <Circle cx="20" cy="20" r={props.working ? 15.5 : 18} fill={`url(#${gradientId})`} />
        </Svg>
      </View>
      <DuetCreature
        captain={props.captain}
        size={size * 0.625}
        {...(props.motion === undefined
          ? {}
          : {
              state,
              visible: props.motion.visible,
              glance: props.motion.glance,
              completedRunId: props.motion.completedRunId,
              attention: true,
            })}
      />
      {props.working ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <SpinningStatusRing visible={props.motion?.visible === true && state === "working"}>
            <Svg width={size} height={size} viewBox="0 0 40 40">
              <Circle
                cx="20"
                cy="20"
                r="18.5"
                fill="none"
                stroke={swatch.ink}
                strokeWidth="1.6"
                strokeDasharray="4 3"
                strokeLinecap="round"
              />
            </Svg>
          </SpinningStatusRing>
        </View>
      ) : null}
      {attention > 0 ? (
        <View className="absolute -right-1 -top-1 min-w-4 items-center justify-center rounded-full bg-warning px-1">
          <Text className="font-t3-bold text-3xs text-warning-foreground">{attention}</Text>
        </View>
      ) : null}
    </View>
  );
}
