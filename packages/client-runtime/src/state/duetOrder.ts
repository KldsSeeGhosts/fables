export type DuetMoveDirection = "up" | "down";

export interface DuetOrderEntry {
  readonly key: string;
  readonly archived: boolean;
}

/**
 * Applies the device order without letting it capture membership: saved keys order only Duets
 * that still exist, new Duets go after them, and archived Duets never leave the bottom.
 */
export function orderDuets<T extends DuetOrderEntry>(
  entries: ReadonlyArray<T>,
  preferredOrder: ReadonlyArray<string>,
): Array<T> {
  const positionByKey = new Map<string, number>();
  preferredOrder.forEach((key, index) => {
    if (!positionByKey.has(key)) positionByKey.set(key, index);
  });
  const compare = (left: { entry: T; index: number }, right: { entry: T; index: number }) => {
    const leftPosition = positionByKey.get(left.entry.key);
    const rightPosition = positionByKey.get(right.entry.key);
    if (leftPosition !== undefined && rightPosition !== undefined) {
      return leftPosition - rightPosition || left.index - right.index;
    }
    if (leftPosition !== undefined) return -1;
    if (rightPosition !== undefined) return 1;
    return left.index - right.index;
  };
  const indexed = entries.map((entry, index) => ({ entry, index }));
  const active = indexed.filter(({ entry }) => !entry.archived).sort(compare);
  const archived = indexed.filter(({ entry }) => entry.archived).sort(compare);
  return [...active, ...archived].map(({ entry }) => entry);
}

/** Moves one active Duet within the active section and returns the full key order to persist. */
export function moveDuet<T extends DuetOrderEntry>(
  entries: ReadonlyArray<T>,
  preferredOrder: ReadonlyArray<string>,
  key: string,
  direction: DuetMoveDirection,
): Array<string> | null {
  const ordered = orderDuets(entries, preferredOrder);
  const firstArchivedIndex = ordered.findIndex((entry) => entry.archived);
  const activeCount = firstArchivedIndex === -1 ? ordered.length : firstArchivedIndex;
  const index = ordered.findIndex((entry) => entry.key === key);
  if (index === -1 || index >= activeCount) return null;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= activeCount) return null;

  const keys = ordered.map((entry) => entry.key);
  const moved = keys[index]!;
  keys.splice(index, 1);
  keys.splice(targetIndex, 0, moved);
  return keys;
}
