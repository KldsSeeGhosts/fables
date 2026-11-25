import {
  captainPaletteOf,
  DUET_PALETTE_SWATCH,
} from "@t3tools/client-runtime/state/captain-palette";
import type { Captain } from "@t3tools/contracts";
import { View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";

/**
 * A Captain's orb in its palette, with a dashed ring while its crew works and a count of the
 * requests waiting on the user. Static on purpose: a spinning ring repaints every frame.
 */
export function CaptainOrb(props: {
  readonly captain: Pick<Captain, "id" | "name" | "avatar">;
  readonly size?: number;
  readonly working?: boolean;
  readonly attention?: number;
}) {
  const size = props.size ?? 36;
  const swatch = DUET_PALETTE_SWATCH[captainPaletteOf(props.captain.avatar)];
  const gradientId = `captain-orb-${props.captain.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const initial = Array.from(props.captain.name.trim())[0]?.toUpperCase() ?? "";
  const attention = props.attention ?? 0;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Defs>
          <RadialGradient id={gradientId} cx="35%" cy="30%" r="75%">
            <Stop offset="0" stopColor={swatch.tint} />
            <Stop offset="1" stopColor={swatch.bubble} />
          </RadialGradient>
        </Defs>
        <Circle cx="20" cy="20" r={props.working ? 15.5 : 18} fill={`url(#${gradientId})`} />
        {props.working ? (
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
        ) : null}
      </Svg>
      <View className="absolute inset-0 items-center justify-center">
        <Text
          className="font-t3-bold"
          style={{ color: swatch.ink, fontSize: Math.round(size * 0.4) }}
        >
          {initial}
        </Text>
      </View>
      {attention > 0 ? (
        <View className="absolute -right-1 -top-1 min-w-4 items-center justify-center rounded-full bg-warning px-1">
          <Text className="font-t3-bold text-3xs text-warning-foreground">{attention}</Text>
        </View>
      ) : null}
    </View>
  );
}
