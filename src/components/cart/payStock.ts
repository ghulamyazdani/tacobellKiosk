/**
 * PAY's stock write-back (audit-fixes A1 + lane walk-oos) — loaded at PAY
 * with the sweep, through bagLazyParts (never a boot module: the boot path
 * has no budget left for it, P9f).
 */
import { dropOutOfStockPicks, flaggedPicks } from "@cx-sdk/catalog/oos/optionStock";
import { keepSweptPicksFlagged } from "@cx-sdk/catalog/oos/sweptPicks";
import { getTotalValueWithApplyAddonPrice } from "@cx-sdk/ordering/customization/pricing";
import { isRowUnavailable } from "./BagItemRow";

type StockRow = {
  itemId?: unknown;
  outOfStock?: unknown;
  selectedVariant?: Record<string, unknown> | null;
  customizations?: unknown;
} | null;

/**
 * A PAY whose stock check flagged nothing: every row is in stock and on
 * schedule, so a stale flag from an earlier PAY clears — on the LIVE row,
 * everything else as the bill priced it. walk-oos: a pick's flag too (the
 * picks PAY kept, flagged — back in stock).
 */
export const clearStockFlags = (row: unknown): unknown => {
  const flagged = row as StockRow;
  const picks = dropOutOfStockPicks(flagged?.customizations, () => false).selections;
  const unavailable = isRowUnavailable(row);
  if (!flagged || (!unavailable && picks === flagged.customizations)) return row;
  return {
    ...flagged,
    ...(unavailable ? { outOfStock: false, isAvailable: true } : {}),
    ...(unavailable && flagged.selectedVariant
      ? { selectedVariant: { ...flagged.selectedVariant, outOfStock: false } }
      : {}),
    ...(picks !== flagged.customizations ? { customizations: picks } : {}),
  };
};

/**
 * The ONE write a PAY makes (one dispatch + one Dexie replace — D-A1-3), or
 * null for none. Flagged (something out of stock, a broken group or the
 * scheduler's unavailable item) = a blocked PAY: the swept rows land, each
 * pick the sweep dropped kept in its row flagged (walk-oos: the row names
 * it and the next PAY stays blocked until the guest edits or removes it).
 * Stale flags alone: this PAY proceeds on the bill it rendered, so only the
 * flags clear — the swept rows would also land the scheduler's silent drops
 * (an add-on out of its window) under an order priced and charged with them.
 */
export function planStockWrite(input: {
  flagged: boolean;
  /** The sweep's rows. */
  swept: readonly unknown[];
  /** The rows the sweep was given (the scheduler's copies). */
  given: unknown;
  /** The cart now. */
  live: unknown;
}): unknown[] | null {
  if (input.flagged) {
    const given = (Array.isArray(input.given) ? input.given : []) as StockRow[];
    return input.swept.map((row) =>
      keepSweptPicksFlagged(
        given.find((before) => before?.itemId === (row as StockRow)?.itemId),
        row,
        getTotalValueWithApplyAddonPrice,
      ),
    );
  }
  const live = Array.isArray(input.live) ? input.live : [];
  return live.some((row) => clearStockFlags(row) !== row) ? live.map(clearStockFlags) : null;
}

/**
 * What PAY found out of stock in the rows it blocked on (`ids`), named for
 * its notice: the item, the item (its size), or each pick the row flags.
 */
export const soldOutNames = (
  rows: readonly unknown[],
  ids: readonly unknown[],
  name: (entity: unknown) => string,
): string[] =>
  rows.flatMap((entry) => {
    const row = entry as StockRow;
    if (!row || !ids.includes(row.itemId)) return [];
    if (row.outOfStock) return [name(row)];
    if (row.selectedVariant?.outOfStock) return [`${name(row)} (${name(row.selectedVariant)})`];
    return flaggedPicks(row.customizations).map((pick) => name(pick));
  });
