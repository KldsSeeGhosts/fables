import { useGT } from "gt-react";

import type { DuetEmblem, DuetPalette } from "@t3tools/client-runtime/state/captain-palette";

/** Names for the Captain icon picker's creatures and colours. */
export function useCaptainAvatarLabels(): {
  emblems: Record<DuetEmblem, string>;
  palettes: Record<DuetPalette, string>;
} {
  const gt = useGT();
  return {
    emblems: {
      orb: gt("Wave orb", { $context: "Duet avatar emblem" }),
      sunburst: gt("Ripple", { $context: "Duet avatar emblem" }),
      "twin-arcs": gt("Twin wave", { $context: "Duet avatar emblem" }),
      "heart-wave": gt("Heart wave", { $context: "Duet avatar emblem" }),
      terminal: gt("Zigzag", { $context: "Duet avatar emblem" }),
      prism: gt("Prism", { $context: "Duet avatar emblem" }),
      orbit: gt("Orbit", { $context: "Duet avatar emblem" }),
      horizon: gt("Horizon", { $context: "Duet avatar emblem" }),
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
