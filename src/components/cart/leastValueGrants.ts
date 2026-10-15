import {
  getLeastValueFreebieDistribution,
  resolveLockToAllocations,
} from "@cx-sdk/ordering/offer/leastValueOfferUtils";

type Offer = Parameters<typeof getLeastValueFreebieDistribution>[0];
type CartRow = NonNullable<Parameters<typeof getLeastValueFreebieDistribution>[1]>[number];

/** The slice of the cart the grants read (BagSheet passes the live cart). */
interface BagCart {
  cartOffer?: Offer;
  cartItems?: CartRow[];
  lockedFreebieAllocation?: Record<string, number>;
}

/** The slice of the billCalculation bill the grants read. */
interface PricedBill {
  _items?: Array<{ discounts?: Array<{ value?: unknown }> }>;
  decimal_places?: unknown;
  roundNumber: (value: number, decimals: unknown) => number;
}

/** The applied least-value offer on one paid bag row: posistKiosk's ribbon inputs. */
export interface LeastValueGrant {
  /** Units of the row the offer holds. */
  units: number;
  /** The offer's getDiscount — 100 when unset (the SDK's rule). */
  percent: number;
  /** What the bill takes off the row's line, rounded as the bill rounds it. */
  saving: number;
}

/**
 * Lane bag-ribbon (user 2026-10-15): the applied least-value offer's grant on
 * each bag row, by itemId — read off the bill the bag shows, never re-priced.
 * The units are the allocation the bill prices (orderBuilder's annotation:
 * the cart's lock once set, else the live cheapest-first distribution — the
 * same SDK calls); the saving is the discount the bill booked on the row's
 * own line (convertCart maps the rows in order; a paid row's only one is
 * this offer's fixed amount), so the rows add up to the bill's Discounts.
 * Freebie and reward rows never match the offer's buy side, so they never
 * get one; nor does a row the bill saves nothing on.
 */
export function leastValueGrants(
  cart: BagCart | null | undefined,
  bill: PricedBill | null | undefined,
): Map<string, LeastValueGrant> {
  const grants = new Map<string, LeastValueGrant>();
  if (!cart || !bill) return grants;
  const { cartOffer: offer, cartItems: rows = [], lockedFreebieAllocation: lock } = cart;
  const allocations =
    lock && Object.keys(lock).length > 0
      ? resolveLockToAllocations(offer, rows, lock)
      : getLeastValueFreebieDistribution(offer, rows);
  const percent = Number(offer?.leastItemValueCount?.getDiscount ?? 100);
  for (const { cartItem, units } of allocations) {
    const saving = (bill._items?.[rows.indexOf(cartItem)]?.discounts ?? []).reduce(
      (sum, discount) => sum + bill.roundNumber(parseFloat(String(discount.value)), bill.decimal_places),
      0,
    );
    const itemId = (cartItem as { itemId?: string }).itemId;
    if (itemId && saving > 0) grants.set(itemId, { units, percent, saving });
  }
  return grants;
}
