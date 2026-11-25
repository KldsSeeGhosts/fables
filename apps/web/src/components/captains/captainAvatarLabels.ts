import { useGT } from "gt-react";

import type { DuetEmblem, DuetPalette } from "./captainPalette";

/** Names for the Captain icon picker's creatures and colours. */
export function useCaptainAvatarLabels(): {
  emblems: Record<DuetEmblem, string>;
  palettes: Record<DuetPalette, string>;
} {
  const gt = useGT();
  return {
    emblems: {
      orb: gt("Wave orb", { $context: "Captain avatar emblem" }),
      sunburst: gt("Ripple", { $context: "Captain avatar emblem" }),
      "twin-arcs": gt("Twin wave", { $context: "Captain avatar emblem" }),
      "heart-wave": gt("Heart wave", { $context: "Captain avatar emblem" }),
      terminal: gt("Zigzag", { $context: "Captain avatar emblem" }),
      prism: gt("Prism", { $context: "Captain avatar emblem" }),
      orbit: gt("Orbit", { $context: "Captain avatar emblem" }),
      horizon: gt("Horizon", { $context: "Captain avatar emblem" }),
    },
    palettes: {
      terracotta: gt("Terracotta", { $context: "color" }),
      rose: gt("Rose", { $context: "color" }),
      cobalt: gt("Cobalt", { $context: "color" }),
      sage: gt("Sage", { $context: "color" }),
      ochre: gt("Ochre", { $context: "color" }),
      plum: gt("Plum", { $context: "color" }),
      coral: gt("Coral", { $context: "color" }),
      slate: gt("Slate", { $context: "color" }),
    },
  };
}
