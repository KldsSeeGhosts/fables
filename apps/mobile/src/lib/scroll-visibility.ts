import { useState, useSyncExternalStore } from "react";
import type { LayoutChangeEvent } from "react-native";

export function createScrollVisibility() {
  let scroll = 0;
  let height = 0;
  let initialized = false;
  const listeners = new Set<() => void>();
  return {
    update(nextScroll: number, nextHeight: number) {
      initialized = true;
      if (nextScroll === scroll && nextHeight === height) return;
      scroll = nextScroll;
      height = nextHeight;
      for (const listener of listeners) listener();
    },
    layout(nextHeight: number, initialScroll: number) {
      if (initialized && nextHeight === height) return;
      height = nextHeight;
      if (!initialized) scroll = initialScroll;
      initialized = true;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isVisible(top: number, bottom: number) {
      return height > 0 && top < scroll + height && bottom > scroll;
    },
  };
}

export type ScrollVisibility = ReturnType<typeof createScrollVisibility>;

const subscribeNever = () => () => undefined;

export function useScrollRowVisibility(
  viewport: ScrollVisibility,
  offset: number,
  enabled: boolean,
) {
  const [layout, setLayout] = useState<{ y: number; height: number } | null>(null);
  const visible = useSyncExternalStore(
    enabled ? viewport.subscribe : subscribeNever,
    () =>
      enabled &&
      layout !== null &&
      viewport.isVisible(offset + layout.y, offset + layout.y + layout.height),
  );
  return {
    visible,
    onLayout: (event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      setLayout((old) => (old?.y === y && old.height === height ? old : { y, height }));
    },
  };
}

export function useScrollSectionOffset(parentOffset = 0) {
  const [y, setY] = useState(0);
  return {
    offset: parentOffset + y,
    onLayout: (event: LayoutChangeEvent) => setY(event.nativeEvent.layout.y),
  };
}
