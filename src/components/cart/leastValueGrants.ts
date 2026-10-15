import { getLeastValueAllocations } from "@cx-sdk/ordering/order/orderBuilder";

/** The slice of the cart the grants read (BagSheet passes the live cart). */
type BagCart = NonNullable<Parameters<typeof getLeastValueAllocations>[0]>;

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
  /** The row's share of the bill's Discounts figure (see leastValueGrants). */
  saving: number;
}

/**
 * Lane bag-ribbon (user 2026-10-15): the applied least-value offer's grant on
 * each bag row, by itemId — read off the bill the bag shows, never re-priced.
 * The units are the SDK's getLeastValueAllocations, the very slices
 * orderBuilder's annotation hands the bill. The money is the amount the bill
 * booked on each row's own line (convertCart maps the rows in order; a paid
 * row's only discount is this offer's). The bill adds those amounts unrounded
 * and rounds the SUM once (getTotalDiscount), so a row's saving is its step
 * in that running total, rounded: the rows add up to the Discounts line and
 * their prices to the Total, to the penny. Freebie and reward rows never
 * match the offer's buy side, so they never get one; nor does a row the bill
 * saves nothing on.
 */
export function leastValueGrants(
  cart: BagCart | null | undefined,
  bill: PricedBill | null | undefined,
): Map<string, LeastValueGrant> {
  const grants = new Map<string, LeastValueGrant>();
  if (!cart || !bill) return grants;
  const held = new Map(getLeastValueAllocations(cart).map(({ cartItem, units }) => [cartItem, units]));
  const percent = Number(cart.cartOffer?.leastItemValueCount?.getDiscount ?? 100);
  const round = (value: number) => bill.roundNumber(value, bill.decimal_places);
  let booked = 0;
  (cart.cartItems ?? []).forEach((row, index) => {
    const units = held.get(row);
    if (!units) return;
    const before = round(booked);
    booked += (bill._items?.[index]?.discounts ?? []).reduce(
      (sum, discount) => sum + parseFloat(String(discount.value)),
      0,
    );
    const saving = round(round(booked) - before);
    const itemId = (row as { itemId?: string }).itemId;
    if (itemId && saving > 0) grants.set(itemId, { units, percent, saving });
  });
  return grants;
}
