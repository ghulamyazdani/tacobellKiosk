/**
 * What an `itemCriteria` offer is actually scoped TO — as data, never as prose.
 *
 * WHY THIS EXISTS
 * `applicable.on === "itemCriteria"` offers rendered as "{{value}}% off selected
 * items" (`offer.mechPercentItems`) and, when locked, "Needs specific items in
 * your order" (`offer.lockedItemCriteria`). Neither line ever read
 * `applicable.rawItems`, so the customer was never told WHICH items — and for an
 * `isExclude` offer the locked line is worse than vague, it is backwards: the
 * offer applies to everything EXCEPT the listed scope, and it only locks when the
 * cart is nothing but excluded items.
 *
 * This returns the scope as `{ mode, names, overflow }` and leaves every string
 * to the caller, so the two surfaces that render it (OffersSheet and
 * SavingsLine) stay the only places that touch i18n. No React, no Redux — the
 * matching rules below are unit-testable in isolation.
 *
 * THE RULES ARE THE ENGINE'S, NOT THE PAYLOAD'S
 * Everything here mirrors `useOfferHook.isItemWiseOfferApplicable`, which is what
 * actually decides eligibility. Three of its behaviours are load-bearing and are
 * the reason this file is conservative in places the payload looks permissive:
 *
 *   1. `isInclude` is tested BEFORE `isExclude`, so an offer with both flags set
 *      behaves as an include. Same precedence here.
 *   2. Neither branch reads `rawItems[].relation` — the `"and"` handler is
 *      commented out and the live include path ORs every entry. So no copy built
 *      from this may ever say "and"/"all of"; the caller joins with a neutral
 *      separator.
 *   3. Neither branch reads `rawItems[].quantity` on the exclude path, and the
 *      include path compares it against a SINGLE cart line. So quantities are
 *      deliberately not surfaced at all.
 */

import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";

/** `"only"` = the offer applies to this scope. `"except"` = to everything else. */
export type OfferScopeMode = "only" | "except";

export interface OfferScope {
  mode: OfferScopeMode;
  /** Names to render, already capped at `MAX_SCOPE_NAMES`. Never empty. */
  names: string[];
  /** Names dropped by the cap; `0` when the whole list is shown. */
  overflow: number;
}

/**
 * Two, not three.
 *
 * The binding surface is the cart's SavingsLine, whose description is a single
 * `truncate` line ~460px wide — and in the locked state it renders semibold,
 * which costs another ~5%. That is roughly 42 characters for the WHOLE string.
 * "Not valid on " already spends 13 of them. Two names plus a "+N more" token
 * fits; three does not, and a clipped exclusion line reads as the opposite of
 * what the offer does.
 */
const MAX_SCOPE_NAMES = 2;

type RawItem = NonNullable<
  NonNullable<SavingsOffer["applicable"]>["rawItems"]
>[number];

/** An entry names either a single item or a whole category — never both. */
const nameOf = (entry: RawItem): string =>
  (entry?.item?.name || entry?.category?.categoryName || "").trim();

const isCategoryEntry = (entry: RawItem): boolean =>
  Boolean(!entry?.item && entry?.category?._id);

/**
 * The scope of `offer`, or `null` when it cannot be described HONESTLY — in
 * which case the caller keeps its existing generic copy.
 *
 * Returns null for: any non-itemCriteria offer; an empty or nameless
 * `rawItems`; an offer with neither `isInclude` nor `isExclude` (the engine
 * falls off the end of its own if/else and returns `undefined`, so such an
 * offer is permanently locked and there is no true scope to state); and the
 * mixed exclude list described below.
 *
 * `isRawItemAvailable` is deliberately NOT used as a filter. It is absent from
 * most payloads — the offer that prompted this has no such field on its single
 * entry — so filtering on it would empty the list for exactly the offers this
 * is meant to describe.
 */
export const getOfferScope = (
  offer: SavingsOffer | null | undefined,
): OfferScope | null => {
  if (offer?.applicable?.on !== "itemCriteria") return null;

  const rawItems = offer?.applicable?.rawItems;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;

  const mode: OfferScopeMode | null = offer.applicable.isInclude
    ? "only"
    : offer.applicable.isExclude
      ? "except"
      : null;
  if (!mode) return null;

  /**
   * A mixed item+category EXCLUDE list is not describable, because the engine
   * does not honour it. `isItemWiseOfferApplicable`'s exclude branch declares
   * `cartItemId` in the filter scope and then REBINDS it to `subCategoryId`
   * inside the nested `.some()` when it hits a category entry — so every item
   * entry evaluated after a category entry compares a subCategoryId against a
   * baseItemId and never matches. Those items are not actually excluded.
   * Naming them would print a restriction the bill will not apply, so fall back
   * to the generic line until that capture bug is fixed.
   */
  if (
    mode === "except" &&
    rawItems.some((entry) => isCategoryEntry(entry)) &&
    rawItems.some((entry) => !isCategoryEntry(entry) && nameOf(entry))
  ) {
    return null;
  }

  const names = rawItems.map(nameOf).filter((name) => name.length > 0);
  if (names.length === 0) return null;

  return {
    mode,
    names: names.slice(0, MAX_SCOPE_NAMES),
    overflow: Math.max(0, names.length - MAX_SCOPE_NAMES),
  };
};
