import {
  buildCartUpsellBreakdown as buildCartUpsellBreakdownEngine,
  explainCartUpsellExclusions as explainCartUpsellExclusionsEngine,
  type CartUpsellBreakdown,
  type CartUpsellExclusionReason,
} from "@cx-sdk/catalog/upsell/cartUpsellEngine";
import type {
  EntityMap,
  OutOfStockMap,
} from "@cx-sdk/catalog/recommendation/recommendationUtils";

/*
  Port of posistKiosk's src/hooks/menuHooks/cartUpsellUtils.ts (P7a).

  The selection/eligibility logic (isOneTapAddable, collectCartUpsellEntities,
  the telemetry breakdown/explanations) lives in
  @cx-sdk/catalog/upsell/cartUpsellEngine — pure, viewport-blind, and reusable.
  This file keeps everything whose OUTPUT is layout geometry: the px constants,
  cartUpsellGridCapacity, and the reference capacity derived from them. The
  engine functions that need a capacity take it as a plain NUMBER; the two
  wrappers at the bottom bind CART_UPSELL_REFERENCE_CAPACITY so every caller
  ported from the fork keeps its original signature.

  TB tuning: the constants describe the Figma "Menu-Item" card as it appears
  on the bag's Complete-Your-Meal rail (mybag 1:3171 / node I1:3196;6618:5020
  — 240×277, name+price+cal above a 172px image, ⊕ top-right), not the fork's
  224px /forYou card. CompleteYourMealRail.tsx applies the card width/height
  and the gap as inline styles read from here rather than as Tailwind classes
  precisely so the two cannot drift apart.
*/
export {
  MIN_CART_UPSELL_ITEMS,
  isOneTapAddable,
  collectCartUpsellEntities,
} from "@cx-sdk/catalog/upsell/cartUpsellEngine";
export type {
  CartUpsellBreakdown,
  CartUpsellExclusionReason,
} from "@cx-sdk/catalog/upsell/cartUpsellEngine";

/** Card width — Figma Menu-Item on the bag rail. Also set inline on the card. */
export const CART_UPSELL_CARD_WIDTH_PX = 240;
/**
 * The name box: ALWAYS two lines tall, whether the name needs one or two.
 *
 * Reserved in pixels with an explicit line-height rather than left to a
 * min-height + leading class, which is what shipped first in the fork and did
 * not hold — a two-line name grew its card past its neighbours and the row
 * lost its baseline. A card's height must be a function of the layout, never
 * of the text inside it.
 */
export const CART_UPSELL_TITLE_LINE_HEIGHT_PX = 24;
export const CART_UPSELL_TITLE_HEIGHT_PX = 2 * CART_UPSELL_TITLE_LINE_HEIGHT_PX;
/** Price/cal line box (`text-[18px] leading-[20px]`). */
export const CART_UPSELL_PRICE_HEIGHT_PX = 20;
/**
 * `pt-[24px]` + name + `gap-[4px]` + price + 9px justify-between slack (the
 * Figma card is a fixed 277px box whose image measures 171.663px, so the text
 * block owns the remaining 105px — 24+48+4+20 content plus the slack).
 */
export const CART_UPSELL_TEXT_BLOCK_HEIGHT_PX =
  24 + CART_UPSELL_TITLE_HEIGHT_PX + 4 + CART_UPSELL_PRICE_HEIGHT_PX + 9;
/** Image band height. The TB card image is a 172px strip, not the fork's square. */
export const CART_UPSELL_IMAGE_HEIGHT_PX = 172;
/**
 * Card height: the image band plus that fixed text block (= the Figma card's
 * 277px). Set on the card box itself in CompleteYourMealRail.tsx, so every
 * card in the rail is the same size by construction.
 */
export const CART_UPSELL_CARD_HEIGHT_PX =
  CART_UPSELL_IMAGE_HEIGHT_PX + CART_UPSELL_TEXT_BLOCK_HEIGHT_PX;
/** Row and column gap (Figma rail `gap-[24px]`). Also applied inline. */
export const CART_UPSELL_GRID_GAP_PX = 24;
/** Mirrors `px-[24px]` on the rail/page container. */
export const CART_UPSELL_PAGE_PADDING_X_PX = 24;
/**
 * Everything on a full upsell PAGE that is not the grid: heading + margins +
 * primary button + back link, rounded up so a heading that wraps to two lines
 * in a longer language still cannot push the actions off screen. Kept from
 * the fork for the day the /forYou screen is ported; the rail itself scrolls
 * horizontally and never consumes this.
 */
export const CART_UPSELL_CHROME_HEIGHT_PX = 320;
/** Accessibility mode shrinks every full page to the lower `h-[60vh]`. */
export const CART_UPSELL_ACCESSIBLE_HEIGHT_FRACTION = 0.6;
/**
 * Upper bound on rows, even when the screen could hold more. Purely a
 * merchandising sanity limit — a tenant who flags forty items should get a
 * suggestion grid, not a wall.
 */
export const CART_UPSELL_MAX_ROWS = 4;

/**
 * How many cards fit on screen at once, given the kiosk's own viewport.
 *
 * Pure and viewport-parameterised rather than a hardcoded count: the fleet is
 * not one resolution, and a count tuned for 1080×1920 overflows a shorter
 * screen — which on a non-scrolling page means unreachable buttons, not a
 * scrollbar. Floors at 1×1 so a bad measurement renders one card rather than
 * an empty screen.
 */
export const cartUpsellGridCapacity = (
  viewportWidth: number,
  viewportHeight: number,
  accessibilityMode: boolean,
): number => {
  const width = Number.isFinite(viewportWidth) ? viewportWidth : 0;
  const height = Number.isFinite(viewportHeight) ? viewportHeight : 0;

  const contentWidth = width - 2 * CART_UPSELL_PAGE_PADDING_X_PX;
  // n cards span n*card + (n-1)*gap, hence the +gap on both sides.
  const columns = Math.max(
    1,
    Math.floor(
      (contentWidth + CART_UPSELL_GRID_GAP_PX) /
        (CART_UPSELL_CARD_WIDTH_PX + CART_UPSELL_GRID_GAP_PX),
    ),
  );

  const usableHeight =
    (accessibilityMode
      ? height * CART_UPSELL_ACCESSIBLE_HEIGHT_FRACTION
      : height) - CART_UPSELL_CHROME_HEIGHT_PX;
  const rows = Math.max(
    1,
    Math.min(
      CART_UPSELL_MAX_ROWS,
      Math.floor(
        (usableHeight + CART_UPSELL_GRID_GAP_PX) /
          (CART_UPSELL_CARD_HEIGHT_PX + CART_UPSELL_GRID_GAP_PX),
      ),
    ),
  );

  return columns * rows;
};

/**
 * Capacity of the reference kiosk (1080×1920, standard mode) — 4 across, 4
 * down. Used only where the real viewport is not available: the telemetry
 * helpers below are pure selectors with no DOM to measure.
 */
export const CART_UPSELL_REFERENCE_CAPACITY = cartUpsellGridCapacity(
  1080,
  1920,
  false,
);

/**
 * Same scan as `collectCartUpsellEntities`, counting exclusions by reason —
 * see the engine for the full story. This wrapper only binds the reference
 * capacity (a layout fact) so the call-site signature is unchanged.
 */
export const buildCartUpsellBreakdown = (
  entityMap: EntityMap,
  outOfStock: OutOfStockMap,
  selectedTags: string[] | undefined,
  comboUpsellEnabled: boolean | undefined,
): CartUpsellBreakdown =>
  buildCartUpsellBreakdownEngine(
    entityMap,
    outOfStock,
    selectedTags,
    comboUpsellEnabled,
    CART_UPSELL_REFERENCE_CAPACITY,
  );

/**
 * Explains, per item id, why each flagged entity did or did not reach the
 * screen — see the engine for the full story. This wrapper only binds the
 * reference capacity (a layout fact) so the call-site signature is unchanged.
 */
export const explainCartUpsellExclusions = (
  entityMap: EntityMap,
  outOfStock: OutOfStockMap,
  selectedTags: string[] | undefined,
): Record<string, CartUpsellExclusionReason> =>
  explainCartUpsellExclusionsEngine(
    entityMap,
    outOfStock,
    selectedTags,
    CART_UPSELL_REFERENCE_CAPACITY,
  );
