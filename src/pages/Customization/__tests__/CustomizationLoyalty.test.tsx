/* eslint-disable @typescript-eslint/no-explicit-any --
 * Menu-entity / cart-row fixtures mirror the untyped legacy converters and
 * slices. Typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import "../../../i18n";

/**
 * REGRESSION PIN — P7c locked decision 10 / contract §KNOWN BUG TO FIX.
 *
 * The fork's useCustomization commit branches called `redeemItem(payload)` and
 * DROPPED the return, so a CUSTOMIZABLE or VARIANT loyalty reward was priced
 * and then thrown away: the customer confirmed the reward, watched the PDP
 * close, and got an empty bag. Both branches now commit the priced row with
 * `addLoyaltyItemToCart(row, row?.type ?? "ITEM")`.
 *
 * Every assertion below would FAIL on the fork (cartItems would be empty), so
 * this file is the pin that stops the drop from coming back.
 */

/** Optional addon group — nothing is isDefault, so the commit starts bare. */
const SAUCE_GROUP = {
  _id: "lr_sauce",
  name: "Sauces",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "salsa", name: "Salsa", price: 0.5, isActive: true },
  ],
};

/** Half-price CUSTOMIZABLE reward (the coupon fields ride on the entity). */
const LOYALTY_BURGER = {
  id: "5dd10936712f5b622a66aab7",
  name: "Cheese Burger",
  price: 8,
  modifiers: [SAUCE_GROUP._id],
  isLoyaltyItem: true,
  coupon_code: "static8056",
  discount_type: "percentage",
  discount_value: 50,
  extra_fields: [{ name: "Points Value", value: 1000 }],
};

/** Free VARIANT reward — exercises the second dropped-return branch. */
const LOYALTY_DRINK = {
  id: "pepsi",
  name: "Pepsi",
  price: 0,
  hasVariant: true,
  modifiers: ["pepsi_var"],
  variants: [
    { id: "pepsi-l", name: "Large", price: 3, isActive: true, modifiers: [] },
  ],
  isLoyaltyItem: true,
  coupon_code: "static6562",
  discount_type: "percentage",
  discount_value: 100,
  extra_fields: [{ name: "Points Value", value: 3000 }],
};

/** Same shape WITHOUT the loyalty marker — the paid-row control. */
const PAID_BURGER = {
  id: "5dd10936712f5b622a66aab7",
  name: "Cheese Burger",
  price: 8,
  modifiers: [SAUCE_GROUP._id],
};

const seedAddSession = (entity: any, type = "customizableItem") => {
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: { lr_sauce: SAUCE_GROUP } }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: {
        isOpen: true,
        status: "",
        type,
        // "new", NOT "edit" — the dropped-return branches live in the ADD leg.
        openType: "new",
        editCustomizationContent: {},
      },
      selectedEntity: entity,
    })
  );
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
      </MemoryRouter>
    </Provider>
  );

const cartItems = () => (store.getState() as any).cart.cartItems;

describe("Customization commit — loyalty reward branches (P7c decision 10)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the hook's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("CUSTOMIZABLE reward: the commit LANDS a discounted cart row (fork dropped it)", async () => {
    seedAddSession(LOYALTY_BURGER);
    renderPdp();
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("pdp-add-to-bag"));

    // THE pin: one row, not zero.
    expect(cartItems()).toHaveLength(1);
    const row = cartItems()[0];
    expect(row.isLoyaltyItem).toBe(true);
    expect(row.coupon_code).toBe("static8056");
    expect(row.type).toBe("CUSTOMIZABLE");
    expect(row.quantity).toBe(1);
    // redeemItem ran on the way in: 50 % off £8.00, undiscounted preserved.
    expect(row.isRedeemed).toBe(true);
    expect(row.undiscounted_total_price).toBeCloseTo(8, 2);
    expect(row.total_price).toBeCloseTo(4, 2);
    // The coupon's cost survives onto the row — the bag refunds off it.
    expect(row.extra_fields?.[0]?.value).toBe(1000);
    expect((store.getState() as any).cart.totalQuantity).toBe(1);
  });

  it("CUSTOMIZABLE reward: the customer's addon choices are priced INTO the discounted line", async () => {
    seedAddSession(LOYALTY_BURGER);
    renderPdp();

    await userEvent.click(screen.getByTestId("pdp-option-salsa"));
    await userEvent.click(screen.getByTestId("pdp-add-to-bag"));

    expect(cartItems()).toHaveLength(1);
    const row = cartItems()[0];
    // 8.00 + 0.50 = 8.50, halved → 4.25.
    expect(row.undiscounted_total_price).toBeCloseTo(8.5, 2);
    expect(row.total_price).toBeCloseTo(4.25, 2);
    const picked = Object.values(row.customizations ?? {}).flat() as any[];
    expect(picked.map((item) => item?.id)).toContain("salsa");
  });

  it("VARIANT reward: picking a size then committing LANDS the row too (second dropped branch)", async () => {
    seedAddSession(LOYALTY_DRINK, "variant");
    renderPdp();

    expect(screen.getByTestId("pdp-variant-picker")).toBeInTheDocument();
    // The CTA is inert until a size is confirmed (kiosk flow guard).
    expect(screen.getByTestId("pdp-add-to-bag")).toBeDisabled();

    await userEvent.click(screen.getByTestId("pdp-variant-pepsi-l"));
    await userEvent.click(screen.getByTestId("pdp-add-to-bag"));

    expect(cartItems()).toHaveLength(1);
    const row = cartItems()[0];
    expect(row.isLoyaltyItem).toBe(true);
    expect(row.isRedeemed).toBe(true);
    expect(row.type).toBe("VARIANT");
    expect(row.coupon_code).toBe("static6562");
    // 100 % off a £3.00 Large: struck £3.00 over a £0.00 line.
    expect(row.undiscounted_total_price).toBeCloseTo(3, 2);
    expect(row.total_price).toBeCloseTo(0, 2);
  });

  it("a NON-loyalty entity is unaffected: a plain paid row, no discount stamps", async () => {
    seedAddSession(PAID_BURGER);
    renderPdp();

    await userEvent.click(screen.getByTestId("pdp-add-to-bag"));

    expect(cartItems()).toHaveLength(1);
    const row = cartItems()[0];
    expect(row.isLoyaltyItem).toBeUndefined();
    expect(row.isRedeemed).toBeUndefined();
    expect(row.total_price).toBeCloseTo(8, 2);
    expect(row.undiscounted_total_price).toBeUndefined();
  });
});
