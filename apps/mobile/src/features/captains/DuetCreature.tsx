import {
  captainCreatures,
  type CreatureDesign,
} from "@t3tools/client-runtime/state/captain-creatures";
import {
  captainEmblemOf,
  captainPaletteOf,
  DUET_PALETTE_SWATCH,
} from "@t3tools/client-runtime/state/captain-palette";
import type { Captain } from "@t3tools/contracts";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useId, type ReactNode } from "react";
import { Animated, Easing, useAnimatedValue, View } from "react-native";
import Svg, { ClipPath, Defs, G, Path, Rect } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { useAppActive, useReduceMotionEnabled } from "../../lib/appState";
import { ORB_DRIFT_MS, ORB_SWAY_MS, ORB_TURN_MS, orbMoves, swayEasing } from "./duetOrbMotion";
import type { DuetTokens } from "./duetTokens";
import { useDuetTokens } from "./useDuetTokens";

/** Idle, working, or waiting on the user, as desktop's creature shows it. */
export type DuetCreatureState = "idle" | "working" | "waiting";

type CreatureCaptain = Pick<Captain, "id" | "avatar">;

const LINE_PERIOD_WIDTH = 22;
const LINE_PERIOD_HEIGHT = 14;
const LINE_VIEW_WIDTH = 44;
/** A disc's creature sits on the middle 62.5%, as on desktop. */
const DISC_STAGE_INSET = 0.1875;

function creatureOf(captain: CreatureCaptain) {
  const design: CreatureDesign = captainCreatures[captainEmblemOf(captain.avatar)];
  return { design, ink: DUET_PALETTE_SWATCH[captainPaletteOf(captain.avatar)].ink };
}

function haloStroke(design: CreatureDesign, ink: string, tokens: DuetTokens) {
  return design.halo?.tone === "line"
    ? { stroke: tokens.line, strokeOpacity: 1, strokeWidth: 7 }
    : { stroke: ink, strokeOpacity: 0.42, strokeWidth: 6 };
}

/** The creature drawn in one static SVG, for rows, headers and sheets. */
function StaticCreature(props: { readonly captain: CreatureCaptain; readonly size: number }) {
  const tokens = useDuetTokens();
  const { design, ink } = creatureOf(props.captain);
  const clipId = `duet-creature-${useId().replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const { line, halo } = design;
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 100 100">
      {line ? (
        <Defs>
          <ClipPath id={clipId}>
            <Rect
              x={line.window.x}
              y={line.window.y}
              width={line.window.w}
              height={line.window.h}
            />
          </ClipPath>
        </Defs>
      ) : null}
      {halo ? (
        <Path
          d={halo.path}
          fill="none"
          {...haloStroke(design, ink, tokens)}
          transform={halo.motion === "turn" ? "rotate(-24, 52, 52)" : undefined}
        />
      ) : null}
      <Path d={design.body} fill={ink} />
      {line ? (
        <G clipPath={`url(#${clipId})`}>
          <G
            transform={`translate(${line.window.x}, ${line.window.y}) scale(${line.window.w / LINE_PERIOD_WIDTH}, ${line.window.h / LINE_PERIOD_HEIGHT})`}
          >
            <Path
              d={line.path}
              fill="none"
              stroke={tokens.line}
              strokeWidth={line.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </G>
        </G>
      ) : null}
    </Svg>
  );
}

function Disc(props: {
  readonly size: number;
  readonly state: DuetCreatureState;
  readonly children: ReactNode;
}) {
  const tokens = useDuetTokens();
  const inset = props.size * DISC_STAGE_INSET;
  return (
    <View
      style={{
        width: props.size,
        height: props.size,
        borderRadius: props.size / 2,
        borderWidth: 1,
        borderColor: tokens.rim,
        backgroundColor: tokens.disc,
        boxShadow: tokens.discShadow,
      }}
    >
      <View style={{ position: "absolute", top: inset - 1, left: inset - 1 }}>
        {props.children}
      </View>
      {props.state === "idle" ? null : (
        <View
          style={{
            position: "absolute",
            inset: 1,
            borderRadius: props.size / 2,
            borderWidth: 1.5,
            borderStyle: props.state === "working" ? "dashed" : "solid",
            borderColor: props.state === "working" ? tokens.working : tokens.needsInputRing,
          }}
        />
      )}
    </View>
  );
}

/**
 * A Duet's creature, static. Bare in rows and headers; on a disc for the Brief. A disc shows
 * working with a dashed ring and waiting with the amber ring; bare rows say it in text.
 */
export function DuetCreature(props: {
  readonly captain: CreatureCaptain;
  readonly size: number;
  readonly disc?: boolean;
  readonly state?: DuetCreatureState;
}) {
  const stage = props.disc ? props.size * (1 - 2 * DISC_STAGE_INSET) : props.size;
  const creature = <StaticCreature captain={props.captain} size={stage} />;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {props.disc ? (
        <Disc size={props.size} state={props.state ?? "idle"}>
          {creature}
        </Disc>
      ) : (
        creature
      )}
    </View>
  );
}

function layer(size: number) {
  return { position: "absolute", top: 0, left: 0, width: size, height: size } as const;
}

function nativeLoop(value: Animated.Value, duration: number, easing: (t: number) => number) {
  return Animated.loop(
    Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true }),
  );
}

/**
 * The creature in layers moved by transform and opacity, the way desktop's CSS does. React
 * Native's native driver loops them on the UI thread and writes each frame straight to the view.
 * Reanimated would commit a shadow tree every frame on iOS here (IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS
 * is off) and drag any list scrolled beside it; see docs/internals/16_performance-regressions.md.
 */
function MovingCreature(props: {
  readonly captain: CreatureCaptain;
  readonly size: number;
  readonly state: "working" | "waiting";
}) {
  const tokens = useDuetTokens();
  const { design, ink } = creatureOf(props.captain);
  const { size, state } = props;
  const unit = size / 100;
  const origin = `${design.origin[0]}% ${design.origin[1]}%`;
  const working = state === "working";
  const { line, halo } = design;
  const turns = working && halo?.motion === "turn";
  const drifts = working && line !== undefined;
  const lineWindow = line
    ? {
        left: line.window.x * unit,
        top: line.window.y * unit,
        width: line.window.w * unit,
        height: line.window.h * unit,
      }
    : null;
  const sway = useAnimatedValue(0, { useNativeDriver: true });
  const turn = useAnimatedValue(0, { useNativeDriver: true });
  const drift = useAnimatedValue(0, { useNativeDriver: true });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the native-driver loops for this state and stops them on cleanup
  useEffect(() => {
    const loops = [nativeLoop(sway, ORB_SWAY_MS, swayEasing)];
    if (turns) loops.push(nativeLoop(turn, ORB_TURN_MS, Easing.linear));
    if (drifts) loops.push(nativeLoop(drift, ORB_DRIFT_MS, Easing.linear));
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
      sway.setValue(0);
      turn.setValue(0);
      drift.setValue(0);
    };
  }, [drift, drifts, sway, turn, turns]);

  const between = (from: number, to: number) =>
    sway.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  return (
    <Animated.View
      renderToHardwareTextureAndroid
      style={[
        layer(size),
        working
          ? null
          : { transform: [{ translateY: between(0, -0.04 * size) }, { scale: between(1, 1.025) }] },
      ]}
    >
      {halo ? (
        <Animated.View
          renderToHardwareTextureAndroid
          style={[
            layer(size),
            { transformOrigin: origin },
            halo.motion === "turn"
              ? {
                  transform: [
                    {
                      rotate: turns
                        ? turn.interpolate({
                            inputRange: [0, 1],
                            outputRange: ["-24deg", "336deg"],
                          })
                        : "-24deg",
                    },
                  ],
                }
              : working
                ? { opacity: between(0.5, 1), transform: [{ scale: between(0.92, 1.06) }] }
                : null,
          ]}
        >
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Path d={halo.path} fill="none" {...haloStroke(design, ink, tokens)} />
          </Svg>
        </Animated.View>
      ) : null}
      <Animated.View
        renderToHardwareTextureAndroid
        style={[
          layer(size),
          { transformOrigin: origin },
          working ? { transform: [{ scale: between(1, 1.07) }] } : null,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path d={design.body} fill={ink} />
        </Svg>
      </Animated.View>
      {line && lineWindow ? (
        <View style={{ position: "absolute", overflow: "hidden", ...lineWindow }}>
          <Animated.View
            renderToHardwareTextureAndroid
            style={[
              { width: lineWindow.width * 2, height: lineWindow.height },
              drifts
                ? {
                    transform: [
                      {
                        translateX: drift.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, -lineWindow.width],
                        }),
                      },
                    ],
                  }
                : null,
            ]}
          >
            <Svg
              width={lineWindow.width * 2}
              height={lineWindow.height}
              viewBox={`0 0 ${LINE_VIEW_WIDTH} ${LINE_PERIOD_HEIGHT}`}
              preserveAspectRatio="none"
            >
              <Path
                d={line.path}
                fill="none"
                stroke={tokens.line}
                strokeWidth={line.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>
        </View>
      ) : null}
    </Animated.View>
  );
}

const FLOATING_ORB_SIZE = 44;
const LIVE_PILL_HEIGHT = 28;
const LIVE_PILL_OVERLAP = 10;
/** The floating orb's height with its live pill, whether or not the pill shows. */
export const DUET_FLOATING_ORB_HEIGHT = FLOATING_ORB_SIZE + LIVE_PILL_HEIGHT - LIVE_PILL_OVERLAP;

/**
 * The floating orb over an open Duet conversation: the creature on its disc, and the live pill
 * while the Duet works. The one creature that moves, and only while this screen is focused, the
 * app is active and Reduce Motion is off; AGENTS.md forbids continuous animation anywhere else.
 */
export function DuetFloatingOrb(props: {
  readonly captain: CreatureCaptain;
  readonly state: DuetCreatureState;
  readonly live: string | null;
}) {
  const tokens = useDuetTokens();
  const focused = useIsFocused();
  const appActive = useAppActive();
  const reduceMotion = useReduceMotionEnabled();
  const moving = orbMoves({ state: props.state, focused, appActive, reduceMotion });
  const stage = FLOATING_ORB_SIZE * (1 - 2 * DISC_STAGE_INSET);
  return (
    <View pointerEvents="none" className="items-center">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/* Moving, the creature shows working; static, the dashed ring says it. */}
        <Disc
          size={FLOATING_ORB_SIZE}
          state={moving && props.state === "working" ? "idle" : props.state}
        >
          {moving && props.state !== "idle" ? (
            <View style={{ width: stage, height: stage }}>
              <MovingCreature captain={props.captain} size={stage} state={props.state} />
            </View>
          ) : (
            <StaticCreature captain={props.captain} size={stage} />
          )}
        </Disc>
      </View>
      {props.live ? (
        <View
          className="justify-center rounded-full px-3"
          style={{
            height: LIVE_PILL_HEIGHT,
            marginTop: -LIVE_PILL_OVERLAP,
            borderWidth: 1,
            borderColor: tokens.panelBorder,
            backgroundColor: tokens.panel,
            boxShadow: tokens.panelShadow,
          }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 13 }} numberOfLines={1}>
            {props.live}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
