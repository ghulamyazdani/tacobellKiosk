/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart-row fixtures and store reads mirror the untyped legacy cart slice;
 * typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setCartItems,
  setCartInstructions,
} from "@cx-sdk/ordering/state/cart.slice";
import {
  closeAccessibilityMode,
  setCurrency,
  setDeploymentInfo,
  setEnableAccessibilityMode,
  setKioskSettings,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../BagSheet";
import "../../../i18n";

/** Paid CUSTOMIZABLE row, £8.60 line (8 base + 0.60 addon), qty 1. */
const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 8.6,
  customizations: {
    sauce_group: [{ id: "onions", name: "Add Onions", price: 0.6, quantity: 1 }],
  },
  baseItem: {
    id: "cheese-burger",
    name: "Cheese Burger",
    price: 8,
    modifiers: ["sauce_group"],
  },
};

/** Second paid row so multi-row totals are exercised (£3 × 2 = £6). */
const DRINK_ROW = {
  id: "pepsi",
  itemId: "pep-1",
  uniqueItemId: "pep-1-u",
  name: "Pepsi",
  quantity: 2,
  type: "VARIANT",
  price: 0,
  // Real VARIANT rows (buildVariantCommitPayload) carry variantPrice — the
  // bill engine's calculatePriceNew reads it, not price, for VARIANT rows.
  variantPrice: 3,
  baseItemPrice: 0,
  total_price: 3,
  selectedVariant: { id: "pepsi-l", name: "Large", price: 3 },
  customizations: {},
  baseItem: { id: "pepsi", name: "Pepsi", hasVariant: true },
};

const renderSheet = (open = true, onClose = vi.fn()) => {
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open={open} onClose={onClose} />
      </MemoryRouter>
    </Provider>
  );
  return { ...utils, onClose };
};

const cartState = () => (store.getState() as any).cart;

/** Loyalty ON = kiosk_settings.enable_loyalty AND a partner (BagSheetLoyalty
 *  precedent); no opener props are wired in this file. */
const seedLoyaltyOn = () => {
  store.dispatch(setKioskSettings({ enable_loyalty: true }));
  store.dispatch(
    setLoyaltyPartner({
      partner: { partner_name: "Xeno" },
      partnerDetails: { partner_name: "Xeno" },
    })
  );
};

describe("BagSheet (Figma 1:3171 / 1:3236 — MY BAG)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
  });

  it("renders nothing while closed", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    renderSheet(false);
    expect(screen.queryByTestId("bag-sheet")).not.toBeInTheDocument();
  });

  it("open: renders header count, the rows from the store, and both order-type segments", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...DRINK_ROW }]));
    renderSheet();
    const sheet = screen.getByTestId("bag-sheet");
    expect(sheet).toHaveTextContent("My Bag (3)"); // 1 + 2 quantities
    expect(screen.getByTestId("bag-row-cb-1")).toHaveTextContent("Cheese Burger");
    expect(screen.getByTestId("bag-row-pep-1")).toHaveTextContent("Pepsi");
    // Read-only order-type toggle renders both segments (locked decision 2).
    expect(screen.getByTestId("bag-ordertype-eatin")).toBeInTheDocument();
    expect(screen.getByTestId("bag-ordertype-takeout")).toBeInTheDocument();
    // Bottom bar CTAs: loyalty is off here, so LOG-IN & GET REWARDS is
    // hidden (user decision 2026-10-05) and PAY stands alone.
    expect(screen.queryByTestId("bag-login-rewards")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-pay")).toHaveClass("flex-1"); // PAY takes the full row
    expect(screen.getByTestId("bag-pay")).not.toHaveClass("w-[400px]");
  });

  it("bill lines come from getCalculatedBill: Sub Total and Total agree with the seeded rows (£ strings)", () => {
    // A GBP-style deployment disables the whole-unit round-off, so the bag
    // total keeps its pence (the default engine behavior is pinned below).
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...DRINK_ROW }]));
    renderSheet();
    // 8.60 + (3 × 2) = 14.60; no charges seeded → SubTotal === Total.
    expect(screen.getByTestId("bag-subtotal")).toHaveTextContent("£14.60");
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£14.60");
    expect(screen.getByTestId("bag-pay")).toHaveTextContent("£14.60");
    // Contract A3: the recompute mirrors netAmount into the slice.
    expect(cartState().netAmount).toBeCloseTo(14.6, 2);
  });

  it("without disable_roundoff the engine rounds the NET amount to whole units (fork bill parity)", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...DRINK_ROW }]));
    renderSheet();
    // Sub Total is always exact; getNetAmount rounds 14.60 → 15 when no
    // deployment setting disables round-off (billCalculation getNetAmount).
    expect(screen.getByTestId("bag-subtotal")).toHaveTextContent("£14.60");
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£15.00");
  });

  it("empty cart auto-exits once the bag held rows: clears instructions, empties the cart, and calls onClose (contract A3)", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(setCartInstructions("extra ketchup"));
    const { onClose } = renderSheet(true);
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      store.dispatch(setCartItems([]));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cartState().instructions).toBe("");
    expect(cartState().cartItems).toEqual([]);
  });

  it("an open bag that has not held rows yet (crash-reload: the Dexie rehydrate is still on its way) does NOT exit", () => {
    store.dispatch(setCartInstructions("extra ketchup"));
    const { onClose } = renderSheet(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(cartState().instructions).toBe("extra ketchup");
  });

  it("the held-rows latch re-arms: reopened over new rows, the same bag exits again on its next real empty (no rehydrate signal, so the latch is the only gate)", () => {
    // Mutation verifier: a latch armed once per mount kept a real empty bag
    // open the second time and no test noticed.
    const onClose = vi.fn();
    const sheet = (open: boolean) => (
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <BagSheet open={open} onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    const { rerender } = render(sheet(true));
    act(() => {
      store.dispatch(setCartItems([]));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Closed onto /menu; the guest adds again and reopens the same bag.
    rerender(sheet(false));
    act(() => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    });
    rerender(sheet(true));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      store.dispatch(setCartItems([]));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(cartState().cartItems).toEqual([]);
  });

  it("does NOT auto-exit while the cart has items", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    const { onClose } = renderSheet(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  describe("remove-confirm interception at qty 1 (locked decision 3)", () => {
    it("decrease at qty 1 opens the REMOVE ITEM modal without touching the cart", async () => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      renderSheet();
      await userEvent.click(screen.getByTestId("bag-dec-cb-1"));
      expect(screen.getByTestId("remove-item-modal")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Remove Item" })).toHaveAttribute("aria-modal", "true");
      expect(cartState().cartItems).toHaveLength(1);
      expect(cartState().cartItems[0].quantity).toBe(1);
    });

    it("cancel keeps the row and closes the modal", async () => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      renderSheet();
      await userEvent.click(screen.getByTestId("bag-dec-cb-1"));
      await userEvent.click(screen.getByTestId("remove-item-cancel"));
      expect(screen.queryByTestId("remove-item-modal")).not.toBeInTheDocument();
      expect(cartState().cartItems).toHaveLength(1);
      expect(screen.getByTestId("bag-row-cb-1")).toBeInTheDocument();
    });

    it("confirm deletes the row; the now-empty bag auto-exits via onClose", async () => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      const { onClose } = renderSheet();
      await userEvent.click(screen.getByTestId("bag-dec-cb-1"));
      await userEvent.click(screen.getByTestId("remove-item-confirm"));
      expect(cartState().cartItems).toEqual([]);
      expect(cartState().totalQuantity).toBe(0);
      // totalQuantity hit 0 → the auto-exit effect fires.
      expect(onClose).toHaveBeenCalled();
      expect(screen.queryByTestId("remove-item-modal")).not.toBeInTheDocument();
    });

    it("plain decrease at qty > 1 skips the confirm entirely", async () => {
      store.dispatch(setCartItems([{ ...DRINK_ROW }]));
      renderSheet();
      await userEvent.click(screen.getByTestId("bag-dec-pep-1"));
      expect(screen.queryByTestId("remove-item-modal")).not.toBeInTheDocument();
      expect(cartState().cartItems[0].quantity).toBe(1);
    });
  });

  it("X and the backdrop both close via onClose (never a trapped customer — Rule 1)", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    const { onClose } = renderSheet();
    await userEvent.click(screen.getByTestId("bag-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("LOG-IN & GET REWARDS: hidden with loyalty OFF; with loyalty ON but no opener wired it is inert (coming-soon pressed state, dispatches nothing)", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    const { unmount } = renderSheet();
    expect(screen.queryByTestId("bag-login-rewards")).not.toBeInTheDocument();
    unmount();

    seedLoyaltyOn();
    renderSheet();
    const before = cartState();
    const button = screen.getByTestId("bag-login-rewards");
    // Loyalty on: the Figma 1:3171 split — the CTA flexes, PAY keeps 400 px.
    expect(button).toHaveClass("flex-1");
    expect(screen.getByTestId("bag-pay")).toHaveClass("w-[400px]");
    expect(screen.getByTestId("bag-pay")).not.toHaveClass("flex-1");
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(button).toHaveTextContent(/coming soon/i);
    expect(cartState()).toBe(before); // no state mutation at all (P7c wires it)
  });
});

/*
  P9c (Figma 1:5445): in the ADA view only the sheet's HEIGHT changes — the
  header, the scroll body and the pinned CTA row re-flow inside it. The height
  is an inline style sized from the KioskStage constants (jsdom has no
  Tailwind), so it is asserted there.
*/
describe("BagSheet in the ADA reach zone (P9c)", () => {
  /** The rounded sheet panel (the X's header sits directly inside it). */
  const panel = () =>
    screen.getByTestId("bag-close").closest(".rounded-t-\\[60px\\]");

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("normal mode keeps the Figma 1:3171 height", () => {
    renderSheet();
    expect(panel()).toHaveStyle({ height: "1676px" });
  });

  it("ADA: 765 tall with the X, PAY and log-in CTAs all rendered; the brand-zone exit restores 1676 live", () => {
    // The log-in CTA renders only with loyalty on (decision 2026-10-05).
    seedLoyaltyOn();
    store.dispatch(toggleAccessibilityMode());
    renderSheet();

    expect(panel()).toHaveStyle({ height: "765px" });
    expect(panel()).toContainElement(screen.getByTestId("bag-pay"));
    expect(panel()).toContainElement(screen.getByTestId("bag-login-rewards"));
    // One CTA row: 1080 − 2×24 padding − 24 gap = 1008 → PAY 400 + the CTA flexes into 608.
    expect(screen.getByTestId("bag-login-rewards").parentElement).toBe(
      screen.getByTestId("bag-pay").parentElement
    );

    act(() => {
      store.dispatch(closeAccessibilityMode());
    });
    expect(panel()).toHaveStyle({ height: "1676px" });
  });

  it("ADA with loyalty OFF: PAY alone fills the CTA row inside the 765 px sheet", () => {
    store.dispatch(toggleAccessibilityMode());
    renderSheet();

    expect(panel()).toHaveStyle({ height: "765px" });
    expect(panel()).toContainElement(screen.getByTestId("bag-pay"));
    expect(screen.getByTestId("bag-pay")).toHaveClass("flex-1");
    expect(screen.queryByTestId("bag-login-rewards")).not.toBeInTheDocument();
  });

  it("a stale flag with the tenant gate off never shrinks the sheet", () => {
    store.dispatch(toggleAccessibilityMode());
    store.dispatch(setEnableAccessibilityMode(false));
    renderSheet();

    expect(panel()).toHaveStyle({ height: "1676px" });
  });
});
