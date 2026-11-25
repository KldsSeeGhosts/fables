import type { PreviewMiniPlayerFrame } from "../preview/previewMiniPlayerLayout";
import { DETAILS_CARD_CLEARANCE } from "./chatCanvasLayout";

export const THREAD_DETAILS_CARD_GAP = 12;
// The docked card is fixed; popovers and find bars use --thread-details-panel-width.
const THREAD_DETAILS_CARD_WIDTH = 272;
const THREAD_DETAILS_BOTTOM_GAP = 18;

export interface ThreadDetailsCardMargins {
  /** Distance from the card's right edge to the canvas edge. */
  readonly rightInset: number;
  /** Clearance between the chat lane and the card. */
  readonly laneGap: number;
  /** The docked card's canvas top offset without a find bar. */
  readonly topOffset: number;
  /** Distance below the find bar. */
  readonly findBarGap: number;
}

export const CLASSIC_THREAD_DETAILS_CARD_MARGINS: ThreadDetailsCardMargins = {
  rightInset: THREAD_DETAILS_CARD_GAP,
  laneGap: THREAD_DETAILS_CARD_GAP,
  topOffset: THREAD_DETAILS_CARD_GAP,
  findBarGap: THREAD_DETAILS_CARD_GAP,
};

/** The Duet header controls sit 8px from the edge; the card docks under their pill. */
export const DUET_THREAD_DETAILS_CARD_MARGINS: ThreadDetailsCardMargins = {
  rightInset: 8,
  laneGap: 8,
  topOffset: -4,
  findBarGap: 8,
};

export function resolveThreadDetailsCardDensity(
  height: number,
  content: { full: number; compact: number },
) {
  if (content.full === 0 || content.full <= height) return "full";
  if (content.compact === 0 || content.compact <= height) return "compact";
  return "essential";
}

export function resolveThreadDetailsCardLayout({
  container,
  narrowestWidth = container.width,
  lane,
  frame,
  overlapsDetailsCard = false,
  topInset = 0,
  margins = CLASSIC_THREAD_DETAILS_CARD_MARGINS,
}: {
  container: { width: number; height: number };
  // While a panel animates the container, the card fits only if it fits at both ends.
  narrowestWidth?: number;
  lane: { padding: number; minChatWidth: number };
  frame: PreviewMiniPlayerFrame | null;
  overlapsDetailsCard?: boolean;
  topInset?: number;
  margins?: ThreadDetailsCardMargins;
}) {
  const gap = margins.laneGap;
  const width = THREAD_DETAILS_CARD_WIDTH;
  const x = container.width - width - margins.rightInset;
  // The transition ends are sampled once, so a resize mid-animation can leave them
  // wider than the container is now.
  const fitWidth = Math.min(narrowestWidth, container.width);
  if (fitWidth - width - gap - DETAILS_CARD_CLEARANCE - lane.padding < lane.minChatWidth)
    return null;
  const y = topInset > 0 ? topInset + margins.findBarGap : margins.topOffset;
  const height =
    overlapsDetailsCard && frame && frame.x + frame.width > x - gap && frame.x < x + width + gap
      ? Math.min(container.height - y - THREAD_DETAILS_BOTTOM_GAP, frame.y - y - gap)
      : container.height - y - THREAD_DETAILS_BOTTOM_GAP;
  if (height < 160) return null;
  return {
    x,
    right: margins.rightInset,
    width,
    y,
    height,
  } as const;
}
