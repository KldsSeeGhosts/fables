import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ThreadId } from "@t3tools/contracts";
import { resolveThreadToolCallVisibility } from "@t3tools/client-runtime/tool-call-visibility";
import { vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import * as MobileDatabase from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";
import * as MobileSecureStorage from "./mobile-secure-storage";

function makeStores(initialPayload: string | null) {
  let preferencesJson = initialPayload;
  const secureValues = new Map<string, string>();
  const database = MobileDatabase.MobileDatabase.of({
    loadCache: () => Effect.die("unused"),
    listCache: () => Effect.die("unused"),
    saveCache: () => Effect.die("unused"),
    removeCache: () => Effect.die("unused"),
    clearCacheKind: () => Effect.die("unused"),
    clearEnvironmentCache: () => Effect.die("unused"),
    clearAllCaches: Effect.die("unused"),
    inspectCaches: Effect.die("unused"),
    loadPreferencesJson: Effect.sync(() =>
      preferencesJson === null
        ? Option.none()
        : Option.some({ payload: preferencesJson, updatedAt: 1 }),
    ),
    savePreferencesJson: (payload) =>
      Effect.sync(() => {
        preferencesJson = payload;
      }),
  });
  const secureStorage = MobileSecureStorage.MobileSecureStorage.of({
    getItem: (key) => Effect.sync(() => secureValues.get(key) ?? null),
    setItem: (key, value) =>
      Effect.sync(() => {
        secureValues.set(key, value);
      }),
    removeItem: (key) =>
      Effect.sync(() => {
        secureValues.delete(key);
      }),
  });
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(MobilePreferences.layer),
      Effect.provideService(MobileDatabase.MobileDatabase, database),
      Effect.provideService(MobileSecureStorage.MobileSecureStorage, secureStorage),
    );
  return { provide, readPayload: () => preferencesJson };
}

describe("mobile preferences tool-call visibility", () => {
  it.effect("parses, saves, and applies the Duet visibility to Captain threads only", () =>
    Effect.gen(function* () {
      const memory = makeStores(
        JSON.stringify({ toolCallVisibility: "showAll", duetToolCallVisibility: "zen" }),
      );
      const store = yield* MobilePreferences.MobilePreferencesStore.pipe(memory.provide);

      expect(yield* store.load.pipe(memory.provide)).toMatchObject({
        toolCallVisibility: "showAll",
        duetToolCallVisibility: "zen",
      });

      const saved = yield* store
        .savePatch({ duetToolCallVisibility: "hideAll" })
        .pipe(memory.provide);
      expect(saved.duetToolCallVisibility).toBe("hideAll");
      expect(JSON.parse(memory.readPayload() ?? "{}")).toMatchObject({
        toolCallVisibility: "showAll",
        duetToolCallVisibility: "hideAll",
      });

      for (const [threadId, expected] of [
        [ThreadId.make("captain:example:0"), "hideAll"],
        [ThreadId.make("ordinary-thread"), "showAll"],
      ] as const) {
        expect(
          resolveThreadToolCallVisibility({
            threadId,
            toolCallVisibility: saved.toolCallVisibility ?? "showAll",
            duetToolCallVisibility: saved.duetToolCallVisibility,
          }),
        ).toBe(expected);
      }
    }),
  );

  it.effect("drops an invalid stored Duet visibility", () =>
    Effect.gen(function* () {
      const memory = makeStores(
        JSON.stringify({ toolCallVisibility: "showAll", duetToolCallVisibility: "hidden" }),
      );
      const store = yield* MobilePreferences.MobilePreferencesStore.pipe(memory.provide);
      expect(yield* store.load.pipe(memory.provide)).toEqual({ toolCallVisibility: "showAll" });
    }),
  );
});
