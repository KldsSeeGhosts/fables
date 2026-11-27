const upstreamVersion = "0.1.13-nightly.20261126.5305";

export const fablesBridgeUpstreamTag = `v${upstreamVersion}`;
export const fablesBridgeFirstCounter = 4;

export function isFablesBridgeVersion(version: string): boolean {
  if (!version.startsWith(upstreamVersion)) return false;
  const counter = version.slice(upstreamVersion.length);
  return /^\d{2}$/.test(counter) && Number(counter) >= fablesBridgeFirstCounter;
}
