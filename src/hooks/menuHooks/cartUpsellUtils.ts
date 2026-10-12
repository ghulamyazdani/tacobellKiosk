/*
  Port of posistKiosk's src/hooks/menuHooks/cartUpsellUtils.ts (P7a).

  The selection/eligibility logic (isOneTapAddable, collectCartUpsellEntities)
  lives in @cx-sdk/catalog/upsell/cartUpsellEngine — pure and viewport-blind.
  This file keeps the layout geometry: the px constants of the Figma
  "Menu-Item" card as it appears on the bag's Complete-Your-Meal rail (mybag
  1:3171 / node I1:3196;6618:5020 — 240×277, name+price+cal above a 172px
  image, ⊕ top-right). ForYouCard, the suggestion rails, the rewards sheet and
  the buy stage apply them as inline styles read from here rather than as
  Tailwind classes precisely so they cannot drift apart.
*/
export {
  MIN_CART_UPSELL_ITEMS,
  isOneTapAddable,
  collectCartUpsellEntities,
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
 * 277px). Set on the card box itself (ForYouCard.tsx), so every card in a
 * rail is the same size by construction.
 */
export const CART_UPSELL_CARD_HEIGHT_PX =
  CART_UPSELL_IMAGE_HEIGHT_PX + CART_UPSELL_TEXT_BLOCK_HEIGHT_PX;
/** Row and column gap (Figma rail `gap-[24px]`). Also applied inline. */
export const CART_UPSELL_GRID_GAP_PX = 24;
/** Mirrors `px-[24px]` on the rail/page container. */
export const CART_UPSELL_PAGE_PADDING_X_PX = 24;
