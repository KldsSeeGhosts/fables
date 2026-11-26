import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({
    APP_VARIANT: process.env.APP_VARIANT,
    T3CODE_MOBILE_UPDATES_ENABLED: process.env.T3CODE_MOBILE_UPDATES_ENABLED,
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined, updatesEnabled?: string) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", updatesEnabled);
  vi.stubEnv("MOBILE_VERSION_POLICY", undefined);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while app.t3.codes lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host, pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
});

it.each([
  ["development", "appVersion"],
  ["preview", "fingerprint"],
  ["production", "fingerprint"],
  [undefined, "fingerprint"],
])("routes APP_VARIANT=%j updates to the KSG project", async (value, policy) => {
  const config = await loadConfig(value);
  expect(config.owner).toBe("kidsseeghosts");
  expect(config.slug).toBe("ksg-code");
  expect(config.extra?.eas?.projectId).toBe("0db5bfe2-75db-4fa0-a957-e2ef19fac1d8");
  expect(config.updates).toMatchObject({
    enabled: true,
    url: "https://u.expo.dev/0db5bfe2-75db-4fa0-a957-e2ef19fac1d8",
    requestHeaders: { "expo-channel-name": value ?? "production" },
  });
  expect(config.runtimeVersion).toEqual({ policy });
});

it("disables updates when T3CODE_MOBILE_UPDATES_ENABLED is 0", async () => {
  const config = await loadConfig("preview", "0");
  expect(config.updates?.enabled).toBe(false);
});
