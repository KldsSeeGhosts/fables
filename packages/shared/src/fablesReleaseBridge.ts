const upstreamVersion = "0.1.13-nightly.20261126.5305";

export const fablesBridgeUpstreamTag = `v${upstreamVersion}`;
export const fablesBridgeVersion = `${upstreamVersion}05`;

export function isFablesBridgeVersion(version: string): boolean {
  return version === fablesBridgeVersion;
}
