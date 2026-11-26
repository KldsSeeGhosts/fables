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
import { useId, type ReactNode } from "react";
import { View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import Svg, { ClipPath, Defs, G, Path, Rect } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
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

/**
 * The creature in layers so Reanimated can move each by transform and opacity on the UI thread,
 * the way desktop's CSS does. Only the open conversation's floating orb uses it.
 */
function MovingCreature(props: {
  readonly captain: CreatureCaptain;
  readonly size: number;
  readonly state: DuetCreatureState;
}) {
  const tokens = useDuetTokens();
  const { design, ink } = creatureOf(props.captain);
  const { size, state } = props;
  const unit = size / 100;
  const origin = `${design.origin[0]}% ${design.origin[1]}%`;
  const working = state === "working";
  const { line, halo } = design;
  const lineWindow = line
    ? {
        left: line.window.x * unit,
        top: line.window.y * unit,
        width: line.window.w * unit,
        height: line.window.h * unit,
      }
    : null;
  return (
    <Animated.View
      style={[
        layer(size),
        state === "waiting"
          ? {
              animationName: {
                "0%": { transform: [{ translateY: 0 }, { scale: 1 }] },
                "50%": { transform: [{ translateY: -0.04 * size }, { scale: 1.025 }] },
                "100%": { transform: [{ translateY: 0 }, { scale: 1 }] },
              },
              animationDuration: "2.4s",
              animationIterationCount: "infinite",
              animationTimingFunction: "ease-in-out",
            }
          : null,
      ]}
    >
      {halo ? (
        <Animated.View
          style={[
            layer(size),
            { transformOrigin: origin },
            halo.motion === "turn"
              ? {
                  transform: [{ rotate: "-24deg" }],
                  ...(working
                    ? {
                        animationName: {
                          from: { transform: [{ rotate: "-24deg" }] },
                          to: { transform: [{ rotate: "336deg" }] },
                        },
                        animationDuration: "3.2s",
                        animationIterationCount: "infinite",
                        animationTimingFunction: "linear",
                      }
                    : null),
                }
              : working
                ? {
                    animationName: {
                      from: { opacity: 0.5, transform: [{ scale: 0.92 }] },
                      to: { opacity: 1, transform: [{ scale: 1.06 }] },
                    },
                    animationDuration: "1.2s",
                    animationIterationCount: "infinite",
                    animationDirection: "alternate",
                    animationTimingFunction: "ease-in-out",
                  }
                : null,
          ]}
        >
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Path d={halo.path} fill="none" {...haloStroke(design, ink, tokens)} />
          </Svg>
        </Animated.View>
      ) : null}
      <Animated.View
        style={[
          layer(size),
          { transformOrigin: origin },
          working
            ? {
                animationName: {
                  from: { transform: [{ scale: 1 }] },
                  to: { transform: [{ scale: 1.07 }] },
                },
                animationDuration: "1.2s",
                animationIterationCount: "infinite",
                animationDirection: "alternate",
                animationTimingFunction: "ease-in-out",
              }
            : null,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path d={design.body} fill={ink} />
        </Svg>
      </Animated.View>
      {line && lineWindow ? (
        <View style={{ position: "absolute", overflow: "hidden", ...lineWindow }}>
          <Animated.View
            style={[
              { width: lineWindow.width * 2, height: lineWindow.height },
              working
                ? {
                    animationName: {
                      from: { transform: [{ translateX: 0 }] },
                      to: { transform: [{ translateX: -lineWindow.width }] },
                    },
                    animationDuration: "1.4s",
                    animationIterationCount: "infinite",
                    animationTimingFunction: "linear",
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
 * while the Duet works. The one creature that moves, and only while this screen is focused and
 * Reduce Motion is off; AGENTS.md forbids continuous animation anywhere else.
 */
export function DuetFloatingOrb(props: {
  readonly captain: CreatureCaptain;
  readonly state: DuetCreatureState;
  readonly live: string | null;
}) {
  const tokens = useDuetTokens();
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const moving = focused && !reduceMotion && props.state !== "idle";
  const stage = FLOATING_ORB_SIZE * (1 - 2 * DISC_STAGE_INSET);
  return (
    <View pointerEvents="none" className="items-center">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Disc size={FLOATING_ORB_SIZE} state={props.state === "waiting" ? "waiting" : "idle"}>
          {moving ? (
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
