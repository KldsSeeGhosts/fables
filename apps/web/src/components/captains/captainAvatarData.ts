/** `disc` sizes sit the creature on the Duet orb's subtle disc; the rest draw it bare. */
export const captainAvatarSizes = {
  row: { frame: "size-4", disc: false },
  header: { frame: "size-[18px]", disc: false },
  channel: { frame: "size-[18px]", disc: false },
  sidebar: { frame: "size-7", disc: false },
  picker: { frame: "size-5", disc: false },
  orb: { frame: "size-7", disc: true },
  hero: { frame: "size-11", disc: true },
  profile: { frame: "size-14", disc: true },
} as const satisfies Record<string, { frame: string; disc: boolean }>;

export type CaptainAvatarSize = keyof typeof captainAvatarSizes;
