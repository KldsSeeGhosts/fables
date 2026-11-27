import { orderDuets } from "@t3tools/client-runtime/state/duet-order";
import type { Captain, EnvironmentId } from "@t3tools/contracts";

const homeRowKey = (environmentId: EnvironmentId, captain: Pick<Captain, "id">) =>
  `${environmentId}:${captain.id}`;

/** Mobile has no device order, so it uses the shared ordering desktop starts from. */
export function orderCaptainHomeRows<
  T extends {
    readonly environment: { readonly environmentId: EnvironmentId };
    readonly captain: Pick<Captain, "id" | "archivedAt" | "kind">;
  },
>(rows: ReadonlyArray<T>): Array<T> {
  const choruses = rows.filter((row) => row.captain.kind === "chorus");
  const duets = rows.filter((row) => row.captain.kind !== "chorus");
  return [
    ...choruses.filter(({ captain }) => captain.archivedAt === null),
    ...orderDuets(
      duets.map((row) => ({
        key: homeRowKey(row.environment.environmentId, row.captain),
        archived: row.captain.archivedAt !== null,
        row,
      })),
      [],
    ).map(({ row }) => row),
    ...choruses.filter(({ captain }) => captain.archivedAt !== null),
  ];
}
