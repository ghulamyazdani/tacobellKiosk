import { describe, expect, it } from "vitest";
import {
  CART_UPSELL_CARD_HEIGHT_PX,
  CART_UPSELL_CARD_WIDTH_PX,
  CART_UPSELL_IMAGE_HEIGHT_PX,
  CART_UPSELL_TEXT_BLOCK_HEIGHT_PX,
} from "../cartUpsellUtils";

/*
  The suggestion card's box. ForYouCard (the bag and PDP rails) and the
  rewards sheet's suggested rail size their cards from these constants
  inline, so the Figma Menu-Item card (mybag 1:3171, 240x277) is pinned here.
*/
describe("the card box", () => {
  it("matches the Figma Menu-Item card the shared tile renders", () => {
    expect(CART_UPSELL_CARD_WIDTH_PX).toBe(240);
    expect(CART_UPSELL_CARD_HEIGHT_PX).toBe(277);
    expect(CART_UPSELL_CARD_HEIGHT_PX).toBe(
      CART_UPSELL_IMAGE_HEIGHT_PX + CART_UPSELL_TEXT_BLOCK_HEIGHT_PX,
    );
  });
});
