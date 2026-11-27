import { expect, it, vi } from "vite-plus/test";

import { createScrollVisibility } from "./scroll-visibility";

it("tracks rows against an inset, scrolled and resized viewport", () => {
  const viewport = createScrollVisibility();
  const listener = vi.fn();
  const stop = viewport.subscribe(listener);
  expect(viewport.isVisible(0, 60)).toBe(false);

  viewport.layout(260, -40);
  expect(viewport.isVisible(0, 60)).toBe(true);
  expect(viewport.isVisible(220, 280)).toBe(false);

  viewport.update(60, 260);
  expect(viewport.isVisible(0, 60)).toBe(false);
  expect(viewport.isVisible(220, 280)).toBe(true);

  viewport.layout(160, -40);
  expect(viewport.isVisible(220, 280)).toBe(false);
  expect(viewport.isVisible(60, 120)).toBe(true);
  viewport.update(60, 160);
  expect(listener).toHaveBeenCalledTimes(3);

  stop();
  viewport.update(0, 160);
  expect(listener).toHaveBeenCalledTimes(3);
});
