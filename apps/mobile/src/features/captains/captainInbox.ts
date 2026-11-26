import type { CaptainInboxItem } from "@t3tools/client-runtime/state/captains";

export interface DuetInboxGroup {
  readonly key: string;
  readonly environmentId: CaptainInboxItem["environmentId"];
  readonly captainId: CaptainInboxItem["captainId"];
  readonly items: ReadonlyArray<CaptainInboxItem>;
}

/**
 * The Duet shell's Inbox: only approvals and questions, grouped by Duet in the order their
 * newest request arrived. Delegation requests stay in the Duet's own conversation.
 */
export function duetInboxGroups(
  items: ReadonlyArray<CaptainInboxItem>,
): ReadonlyArray<DuetInboxGroup> {
  const groups = new Map<string, DuetInboxGroup & { items: CaptainInboxItem[] }>();
  for (const item of items) {
    if (item.kind !== "approval" && item.kind !== "input") continue;
    const key = `${item.environmentId}:${item.captainId}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else
      groups.set(key, {
        key,
        environmentId: item.environmentId,
        captainId: item.captainId,
        items: [item],
      });
  }
  // `captainInboxItems` sorts newest first, so each group's first item is its newest.
  return [...groups.values()];
}
