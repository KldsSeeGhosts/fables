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
  const active = indexed.filter(({ entry }) => !entry.archived).toSorted(compare);
  const archived = indexed.filter(({ entry }) => entry.archived).toSorted(compare);
  return [...active, ...archived].map(({ entry }) => entry);
}
