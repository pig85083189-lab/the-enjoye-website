/**
 * Inventory movement chronological order.
 *
 * Storage is newest-first: appendMovement prepends (`[entry, ...readAll()]`).
 * That prepend position is the existing creation sequence — not `id`,
 * which includes a random suffix and cannot break createdAt ties.
 */
import type { InventoryMovement } from "./domain";

export function compareInventoryMovementsChronological(
  a: InventoryMovement,
  b: InventoryMovement,
  newestFirstSource?: readonly InventoryMovement[],
): number {
  const byTime = a.createdAt.localeCompare(b.createdAt);
  if (byTime !== 0) return byTime;
  if (!newestFirstSource) return 0;
  return newestFirstSource.indexOf(b) - newestFirstSource.indexOf(a);
}

export function sortInventoryMovementsChronologically(
  movements: InventoryMovement[],
  newestFirstSource?: readonly InventoryMovement[],
): InventoryMovement[] {
  return [...movements].sort((a, b) =>
    compareInventoryMovementsChronological(a, b, newestFirstSource),
  );
}
