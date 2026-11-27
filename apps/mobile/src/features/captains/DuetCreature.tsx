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
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Animated, Easing, useAnimatedValue, View } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing as WorkletEasing,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { ClipPath, Defs, G, Path, Rect } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { useAppActive, useReduceMotionEnabled } from "../../lib/appState";
import {
  statusMotionEase,
  useRepeatingStatusProgress,
  useStatusMotionAllowed,
} from "../../lib/status-motion";
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

export function DuetCreature(props: {
  readonly captain: CreatureCaptain;
  readonly size: number;
  readonly disc?: boolean;
  readonly state?: DuetCreatureState;
  readonly visible?: boolean;
  readonly animateOnMount?: boolean;
  readonly glance?: number;
  readonly attention?: boolean;
  readonly completedRunId?: string | undefined;
  readonly archived?: boolean;
}) {
  const state = props.state ?? "idle";
  const allowed = useStatusMotionAllowed();
  const visible = allowed && (props.visible ?? true) && !props.archived;
  const stage = props.disc ? props.size * (1 - 2 * DISC_STAGE_INSET) : props.size;
  const working = visible && state === "working";
  const glance = visible && state === "idle" ? (props.glance ?? 0) : 0;
  const layers =
    working || glance > 0 ? (
      <StatusCreatureLayers
        captain={props.captain}
        size={stage}
        working={working}
        glance={glance}
      />
    ) : (
      <StaticCreature captain={props.captain} size={stage} />
    );
  const creature =
    props.state === undefined ? (
      layers
    ) : (
      <CreatureReaction
        state={state}
        visible={visible}
        attention={props.attention ?? false}
        size={stage}
        completedRunId={props.completedRunId}
      >
        {layers}
      </CreatureReaction>
    );

  const framed = props.disc ? (
    <Disc size={props.size} state={state}>
      {creature}
    </Disc>
  ) : (
    creature
  );
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={props.archived ? { opacity: 0.5 } : undefined}
    >
      {props.animateOnMount ? (
        <CreatureEntrance animate={visible}>{framed}</CreatureEntrance>
      ) : (
        framed
      )}
    </View>
  );
}

function CreatureEntrance(props: { readonly animate: boolean; readonly children: ReactNode }) {
  const progress = useSharedValue(props.animate ? 0 : 1);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the scale-in on the UI thread and cancels it when motion is disabled
  useEffect(() => {
    if (!props.animate) {
      progress.set(1);
      return;
    }
    progress.set(
      withTiming(1, { duration: 320, easing: statusMotionEase, reduceMotion: ReduceMotion.Never }),
    );
    return () => cancelAnimation(progress);
  }, [progress, props.animate]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [0.4, 1]),
    transform: [{ scale: interpolate(progress.get(), [0, 1], [0.82, 1]) }],
  }));
  return <Reanimated.View style={style}>{props.children}</Reanimated.View>;
}

type Reaction = "none" | "nudge" | "attention" | "celebrate";

const WAITING_MS = 1600;
const ATTENTION_STOPS = [0, 0.14, 0.28, 0.4, 0.56, 1];
const ATTENTION_LIFT = [0, -0.08, 0.01, -0.05, 0, 0];
const ATTENTION_SCALE = [1, 1.04, 0.99, 1.025, 1, 1];
const calmEase = WorkletEasing.bezier(0.45, 0, 0.55, 1).factory();

function easeAttentionPhase(phase: number) {
  "worklet";
  for (let index = 1; index < ATTENTION_STOPS.length; index++) {
    const end = ATTENTION_STOPS[index]!;
    if (phase <= end) {
      const start = ATTENTION_STOPS[index - 1]!;
      return start + (end - start) * calmEase((phase - start) / (end - start));
    }
  }
  return 1;
}

function CreatureReaction(props: {
  readonly state: DuetCreatureState;
  readonly visible: boolean;
  readonly attention: boolean;
  readonly completedRunId: string | undefined;
  readonly size: number;
  readonly children: ReactNode;
}) {
  const { state, visible, attention, size, completedRunId } = props;
  const previous = useRef<{ state: DuetCreatureState; completedRunId: string | undefined } | null>(
    null,
  );
  const reaction = useSharedValue<Reaction>("none");
  const progress = useSharedValue(1);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reflects state changes in one-shot UI-thread animations
  useEffect(() => {
    const before = previous.current;
    if (visible || before !== null) previous.current = { state, completedRunId };
    const next =
      visible && before?.state !== state && state === "waiting"
        ? attention
          ? "attention"
          : "nudge"
        : visible &&
            before?.state === "working" &&
            state === "idle" &&
            completedRunId !== undefined &&
            completedRunId !== before.completedRunId
          ? "celebrate"
          : "none";
    if (next === "none") return;
    reaction.set(next);
    progress.set(0);
    progress.set(
      withTiming(1, {
        duration: next === "celebrate" ? 620 : WAITING_MS,
        reduceMotion: ReduceMotion.Never,
        easing: WorkletEasing.linear,
      }),
    );
    return () => {
      cancelAnimation(progress);
      progress.set(1);
    };
  }, [attention, completedRunId, progress, reaction, state, visible]);
  const style = useAnimatedStyle(() => {
    const phase = progress.get();
    let lift = 0;
    let scale = 1;
    switch (reaction.get()) {
      case "nudge": {
        const cycle = phase >= 0.56 ? 1 : ((phase / 0.56) * 2) % 1;
        const amount = statusMotionEase.factory()(interpolate(cycle, [0, 0.4, 1], [0, 1, 0]));
        lift = -0.08 * amount;
        scale += 0.06 * amount;
        break;
      }
      case "attention": {
        const eased = easeAttentionPhase(phase);
        lift = interpolate(eased, ATTENTION_STOPS, ATTENTION_LIFT);
        scale = interpolate(eased, ATTENTION_STOPS, ATTENTION_SCALE);
        break;
      }
      case "celebrate": {
        const eased = statusMotionEase.factory()(phase);
        lift = interpolate(eased, [0, 0.38, 0.68, 1], [0, -0.12, 0.01, 0]);
        scale = interpolate(eased, [0, 0.38, 0.68, 1], [1, 1.08, 0.98, 1]);
        break;
      }
    }
    return { transform: [{ translateY: lift * size }, { scale }] };
  });
  return <Reanimated.View style={style}>{props.children}</Reanimated.View>;
}

function StatusCreatureLayers(props: {
  readonly captain: CreatureCaptain;
  readonly size: number;
  readonly working: boolean;
  readonly glance: number;
}) {
  const { size, working, glance } = props;
  const tokens = useDuetTokens();
  const { design, ink } = creatureOf(props.captain);
  const { halo, line } = design;
  const origin = `${design.origin[0]}% ${design.origin[1]}%`;
  const breath = useRepeatingStatusProgress(working, ORB_SWAY_MS / 2, true);
  const roll = useRepeatingStatusProgress(working && line !== undefined, ORB_DRIFT_MS);
  const turn = useRepeatingStatusProgress(working && halo?.motion === "turn", ORB_TURN_MS);
  const glanceProgress = useSharedValue(1);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays one glance when the idle row is pointed at or focused
  useEffect(() => {
    if (glance === 0) return;
    glanceProgress.set(0);
    glanceProgress.set(withTiming(1, { duration: 520, reduceMotion: ReduceMotion.Never }));
    return () => cancelAnimation(glanceProgress);
  }, [glance, glanceProgress]);

  const haloStyle = useAnimatedStyle(() =>
    halo?.motion === "turn"
      ? { transform: [{ rotate: `${turn.get() * 360}deg` }] }
      : {
          opacity: working ? interpolate(breath.get(), [0, 1], [0.45, 1]) : 1,
          transform: [{ scale: working ? interpolate(breath.get(), [0, 1], [0.94, 1.04]) : 1 }],
        },
  );
  const bodyStyle = useAnimatedStyle(() => {
    if (working) {
      return { transform: [{ scale: 1 + 0.05 * breath.get() }] };
    }
    const nudgePhase = Math.min(1, glanceProgress.get() * (520 / 420));
    const nudge = statusMotionEase.factory()(interpolate(nudgePhase, [0, 0.4, 1], [0, 1, 0]));
    return {
      transform: [{ translateY: -0.08 * size * nudge }, { scale: 1 + 0.06 * nudge }],
    };
  });
  const lineWidth = ((line?.window.w ?? 0) * size) / 100;
  const lineStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: working
          ? -lineWidth * roll.get()
          : interpolate(glanceProgress.get(), [0, 0.5, 1], [0, -0.24 * lineWidth, 0]),
      },
    ],
  }));

  return (
    <View style={{ width: size, height: size }}>
      {halo ? (
        <Reanimated.View
          shouldRasterizeIOS
          style={[layer(size), { transformOrigin: origin }, haloStyle]}
        >
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Path
              d={halo.path}
              fill="none"
              {...haloStroke(design, ink, tokens)}
              transform={halo.motion === "turn" ? "rotate(-24, 52, 52)" : undefined}
            />
          </Svg>
        </Reanimated.View>
      ) : null}
      <Reanimated.View
        shouldRasterizeIOS
        style={[layer(size), { transformOrigin: origin }, bodyStyle]}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path d={design.body} fill={ink} />
        </Svg>
      </Reanimated.View>
      {line ? (
        <View
          style={{
            position: "absolute",
            overflow: "hidden",
            width: lineWidth,
            height: (line.window.h * size) / 100,
            left: (line.window.x * size) / 100,
            top: (line.window.y * size) / 100,
          }}
        >
          <Reanimated.View shouldRasterizeIOS style={[{ width: lineWidth * 2 }, lineStyle]}>
            <Svg
              width={lineWidth * 2}
              height={(line.window.h * size) / 100}
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
          </Reanimated.View>
        </View>
      ) : null}
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
function MovingCreature(props: { readonly captain: CreatureCaptain; readonly size: number }) {
  const tokens = useDuetTokens();
  const { design, ink } = creatureOf(props.captain);
  const { size } = props;
  const unit = size / 100;
  const origin = `${design.origin[0]}% ${design.origin[1]}%`;
  const { line, halo } = design;
  const turns = halo?.motion === "turn";
  const drifts = line !== undefined;
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the native-driver loops while working and stops them on cleanup
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
    <View style={layer(size)}>
      {halo ? (
        <Animated.View
          renderToHardwareTextureAndroid
          style={[
            layer(size),
            { transformOrigin: origin },
            turns
              ? {
                  transform: [
                    {
                      rotate: turn.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["-24deg", "336deg"],
                      }),
                    },
                  ],
                }
              : { opacity: between(0.45, 1), transform: [{ scale: between(0.94, 1.04) }] },
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
          { transform: [{ scale: between(1, 1.05) }] },
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
            style={{
              width: lineWindow.width * 2,
              height: lineWindow.height,
              transform: [
                {
                  translateX: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -lineWindow.width],
                  }),
                },
              ],
            }}
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
    </View>
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
          {moving && props.state === "working" ? (
            <MovingCreature captain={props.captain} size={stage} />
          ) : (
            <CreatureReaction
              state={props.state}
              visible={moving}
              attention
              size={stage}
              completedRunId={undefined}
            >
              <StaticCreature captain={props.captain} size={stage} />
            </CreatureReaction>
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
