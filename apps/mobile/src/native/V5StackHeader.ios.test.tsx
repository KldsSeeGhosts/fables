import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { StackHeaderConfigProps } from "react-native-screens";
import { expect, it, vi } from "vite-plus/test";
import type { DeviceType } from "../lib/device-type";

const bridge = vi.hoisted(() => ({
  ios: undefined as StackHeaderConfigProps["ios"],
  deviceType: "phone" as DeviceType,
  metrics: null as { width: number; height: number } | null,
}));

vi.mock("react-native", () => ({ StyleSheet: { flatten: (style: unknown) => style } }));
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardController: { dismiss: vi.fn() },
  useKeyboardState: () => false,
}));
vi.mock("../lib/useMobileNavigationTheme", () => ({
  useMobileNavigationTheme: () => ({ colors: { card: "white" } }),
}));
vi.mock("./native-layout-metrics", () => ({
  useDeviceType: () => bridge.deviceType,
  useNativeLayoutMetrics: () => bridge.metrics,
}));
vi.mock("react-native-screens", () => ({
  Stack: {
    HeaderConfig: ({ ios }: StackHeaderConfigProps) => {
      bridge.ios = ios;
      return null;
    },
  },
}));

import { V5StackHeader } from "./V5StackHeader.ios";

it.each([
  ["duo-unfolded", { width: 951, height: 669 }, "onScrollUp", "onScrollUp"],
  ["duo-unfolded", { width: 669, height: 951 }, "onScrollUp", "never"],
  ["duo-folded", { width: 393, height: 852 }, "onScrollUp", "onScrollUp"],
  ["phone", null, "onScrollUp", undefined],
] as const)("configures %s on %j with %s", (deviceType, metrics, behavior, expected) => {
  bridge.deviceType = deviceType;
  bridge.metrics = metrics;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  try {
    act(() =>
      root.render(
        <V5StackHeader
          canGoBack={false}
          options={{ unstable_headerMinimizationBehavior: behavior }}
        />,
      ),
    );
    expect(bridge.ios?.minimizationBehavior).toBe(expected);
  } finally {
    act(() => root.unmount());
    bridge.deviceType = "phone";
    bridge.metrics = null;
    vi.unstubAllGlobals();
  }
});

it.each(["leadingItems", "trailingItems", "toolbarItems"] as const)(
  "updates native enabled state after permissions change in %s",
  (placement) => {
    bridge.ios = undefined;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(document.createElement("div"));
    const onPress = () => {};
    try {
      for (const disabled of [true, false, undefined, true]) {
        const items: NativeStackHeaderItem[] = [
          { type: "button", label: "Files", disabled, onPress },
          {
            type: "menu",
            label: "Terminal",
            disabled,
            menu: { items: [{ type: "action", label: "Open terminal", onPress }] },
          },
        ];
        act(() =>
          root.render(
            <V5StackHeader
              canGoBack={false}
              options={{
                unstable_headerLeftItems: () => (placement === "leadingItems" ? items : []),
                unstable_headerRightItems: () => (placement === "trailingItems" ? items : []),
                unstable_headerToolbarItems: () => (placement === "toolbarItems" ? items : []),
              }}
            />,
          ),
        );
        const nativeItems = (bridge.ios as StackHeaderConfigProps["ios"])?.[placement];
        expect(nativeItems).toHaveLength(2);
        for (const item of nativeItems ?? []) {
          if (item.type !== "item" || "render" in item)
            throw new Error("Expected a native bar item");
          // RNSHeaderContentFactory sets UIBarButtonItem.enabled to !item.disabled.
          expect(!item.disabled).toBe(!disabled);
        }
      }
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);

it("keeps a submenu's icon and an inline group's empty title", () => {
  bridge.ios = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const onPress = () => {};
  const items: NativeStackHeaderItem[] = [
    {
      type: "menu",
      label: "More actions",
      menu: {
        items: [
          {
            type: "submenu",
            label: "",
            inline: true,
            items: [
              {
                type: "submenu",
                label: "Terminal",
                icon: { type: "sfSymbol", name: "terminal" },
                items: [{ type: "action", label: "Open new terminal", onPress }],
              },
            ],
          },
        ],
      },
    },
  ];
  try {
    act(() =>
      root.render(
        <V5StackHeader canGoBack={false} options={{ unstable_headerRightItems: () => items }} />,
      ),
    );
    const [item] = (bridge.ios as StackHeaderConfigProps["ios"])?.trailingItems ?? [];
    if (item?.type !== "item" || "render" in item || !item.menu)
      throw new Error("Expected a native menu item");
    const [group] = item.menu.children;
    if (group?.type !== "menu") throw new Error("Expected the inline group");
    expect(group).toMatchObject({ title: "", displayInline: true });
    expect(group.children[0]).toMatchObject({
      type: "menu",
      title: "Terminal",
      icon: { type: "sfSymbol", name: "terminal" },
    });
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
