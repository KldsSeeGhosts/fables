export const captainAvatarSizes = {
  picker: { frame: "size-5", glyph: "size-5", tile: false },
  row: { frame: "size-4", glyph: "size-4", tile: false },
  header: { frame: "size-[18px]", glyph: "size-[18px]", tile: false },
  channel: { frame: "size-6", glyph: "size-3.5", tile: true },
  profile: { frame: "size-14", glyph: "size-[33.6px]", tile: true },
} as const satisfies Record<
  "picker" | "row" | "header" | "channel" | "profile",
  { frame: string; glyph: string; tile: boolean }
>;
