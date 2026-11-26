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
import { useId, type ReactNode } from "react";
import { View } from "react-native";
import Svg, { ClipPath, Defs, G, Path, Rect } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import type { DuetTokens } from "./duetTokens";
import { useDuetTokens } from "./useDuetTokens";

/** Idle, working, or waiting on the user, as desktop's creature shows it. */
export type DuetCreatureState = "idle" | "working" | "waiting";

type CreatureCaptain = Pick<Captain, "id" | "avatar">;

const LINE_PERIOD_WIDTH = 22;
const LINE_PERIOD_HEIGHT = 14;
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

const FLOATING_ORB_SIZE = 44;
const LIVE_PILL_HEIGHT = 28;
const LIVE_PILL_OVERLAP = 10;
/** The floating orb's height with its live pill, whether or not the pill shows. */
export const DUET_FLOATING_ORB_HEIGHT = FLOATING_ORB_SIZE + LIVE_PILL_HEIGHT - LIVE_PILL_OVERLAP;

/**
 * The floating orb over an open Duet conversation: the creature on its disc, and the live pill
 * while the Duet works. Static: an endless Reanimated animation commits every frame on iOS and
 * makes the conversation scrolled under it, and any list beside or over it, drag.
 */
export function DuetFloatingOrb(props: {
  readonly captain: CreatureCaptain;
  readonly state: DuetCreatureState;
  readonly live: string | null;
}) {
  const tokens = useDuetTokens();
  const stage = FLOATING_ORB_SIZE * (1 - 2 * DISC_STAGE_INSET);
  return (
    <View pointerEvents="none" className="items-center">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Disc size={FLOATING_ORB_SIZE} state={props.state}>
          <StaticCreature captain={props.captain} size={stage} />
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
