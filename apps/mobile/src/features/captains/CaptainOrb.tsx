import { captainCreatures } from "@t3tools/client-runtime/state/captain-creatures";
import {
  captainEmblemOf,
  captainPaletteOf,
  DUET_PALETTE_SWATCH,
} from "@t3tools/client-runtime/state/captain-palette";
import type { Captain } from "@t3tools/contracts";
import { useId } from "react";
import { View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { useControlTheme } from "../../components/ui/useControlTheme";

const CREATURE_OFFSET = 7.5;
const CREATURE_SCALE = 0.25;
const LINE_PERIOD_WIDTH = 22;
const LINE_PERIOD_HEIGHT = 14;

/**
 * A Captain's creature in its palette, with a dashed ring while its crew works and a count of the
 * requests waiting on the user. Static on purpose: a spinning ring repaints every frame.
 */
export function CaptainOrb(props: {
  readonly captain: Pick<Captain, "id" | "avatar">;
  readonly size?: number;
  readonly working?: boolean;
  readonly attention?: number;
}) {
  const size = props.size ?? 36;
  const palette = captainPaletteOf(props.captain.avatar);
  const swatch = DUET_PALETTE_SWATCH[palette];
  const design = captainCreatures[captainEmblemOf(props.captain.avatar)];
  const line = "line" in design ? design.line : null;
  const halo = "halo" in design ? design.halo : null;
  const instanceId = useId().replace(/[^A-Za-z0-9_-]/g, "-");
  const assetId = `captain-orb-${props.captain.id.replace(/[^A-Za-z0-9_-]/g, "-")}-${instanceId}`;
  const gradientId = `${assetId}-gradient`;
  const lineClipId = `${assetId}-line-clip`;
  const lineColor = useControlTheme().colorScheme === "dark" ? "#ececec" : "#141413";
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
          {line ? (
            <ClipPath id={lineClipId}>
              <Rect
                x={CREATURE_OFFSET + line.window.x * CREATURE_SCALE}
                y={CREATURE_OFFSET + line.window.y * CREATURE_SCALE}
                width={line.window.w * CREATURE_SCALE}
                height={line.window.h * CREATURE_SCALE}
              />
            </ClipPath>
          ) : null}
        </Defs>
        <Circle cx="20" cy="20" r={props.working ? 15.5 : 18} fill={`url(#${gradientId})`} />
        <G transform={`translate(${CREATURE_OFFSET}, ${CREATURE_OFFSET}) scale(${CREATURE_SCALE})`}>
          {halo ? (
            <Path
              d={halo.path}
              fill="none"
              stroke={halo.tone === "ink" ? swatch.ink : lineColor}
              strokeOpacity={halo.tone === "ink" ? 0.42 : 1}
              strokeWidth={halo.tone === "ink" ? 6 : 7}
              transform={halo.motion === "turn" ? "rotate(-24, 52, 52)" : undefined}
            />
          ) : null}
          <Path d={design.body} fill={swatch.ink} />
        </G>
        {line ? (
          <G clipPath={`url(#${lineClipId})`}>
            <G
              transform={`translate(${CREATURE_OFFSET}, ${CREATURE_OFFSET}) scale(${CREATURE_SCALE})`}
            >
              <G
                transform={`translate(${line.window.x}, ${line.window.y}) scale(${line.window.w / LINE_PERIOD_WIDTH}, ${line.window.h / LINE_PERIOD_HEIGHT})`}
              >
                <Path
                  d={line.path}
                  fill="none"
                  stroke={lineColor}
                  strokeWidth={line.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </G>
            </G>
          </G>
        ) : null}
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
      {attention > 0 ? (
        <View className="absolute -right-1 -top-1 min-w-4 items-center justify-center rounded-full bg-warning px-1">
          <Text className="font-t3-bold text-3xs text-warning-foreground">{attention}</Text>
        </View>
      ) : null}
    </View>
  );
}
