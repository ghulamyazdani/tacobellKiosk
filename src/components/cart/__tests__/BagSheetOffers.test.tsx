/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart-row and offer fixtures mirror the untyped legacy cart slice /
 * converter output; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setCartItems,
  applyOffer,
  openOfferRemovalModal,
} from "@cx-sdk/ordering/state/cart.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import {
  setCurrency,
  setDeploymentInfo,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../BagSheet";
import "../../../i18n";

/** Paid CUSTOMIZABLE row, £8.60 line (P7a BagSheet fixture parity). */
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

/** Second paid row (£3 × 2) so the cart survives removing the burger. */
const DRINK_ROW = {
  id: "pepsi",
  itemId: "pep-1",
  uniqueItemId: "pep-1-u",
  name: "Pepsi",
  quantity: 2,
  type: "VARIANT",
  price: 0,
  variantPrice: 3,
  baseItemPrice: 0,
  total_price: 3,
  selectedVariant: { id: "pepsi-l", name: "Large", price: 3 },
  customizations: {},
  baseItem: { id: "pepsi", name: "Pepsi", hasVariant: true },
};

/** COMMITTED freebie row — the shape redeemGetItem stamps (scenario 5). */
const SALAD_FREEBIE_ROW = {
  id: "greek-salad",
  itemId: "gs-1",
  uniqueItemId: "gs-1",
  name: "Greek Salad",
  quantity: 1,
  type: "ITEM",
  price: 17,
  total_price: 17,
  undiscounted_total_price: 17,
  discounted_total_price: 0,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  customizations: {},
};

const saladEntity = {
  id: "greek-salad",
  name: "Greek Salad",
  price: 17,
  modifiers: [] as any[],
  hasVariant: false,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  type: "ITEM",
  discounted_total_price: 0,
  undiscounted_total_price: 17,
};

const SALAD_ENTRY = {
  _id: "gi-salad",
  baseItemId: "greek-salad",
  name: "Greek Salad",
  relation: "and",
  discountType: "percent",
  value: 100,
  quantity: 1,
  type: "ITEM",
  entities: saladEntity,
};

const offerBase = {
  isAvailable: true,
  isComplimentary: false,
  autoApplied: false,
  sameOrLess: false,
  getItemOnly: false,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  minBillAmount: null as number | null,
  minItemCount: null as number | null,
  maxDiscount: null as number | null,
  isAndOffer: true,
  applicable: {
    on: "complete",
    categories: [] as any[],
    items: [] as any[],
    isExclude: false,
    isInclude: false,
    rawItems: [] as any[],
  },
  buyItems: {},
  getItems: {},
  itemQuantities: [] as any[],
  leastItemValueCount: { buyQuantity: null, getQuantity: null },
  buygetGroupWiseOfferValues: {
    discountType: "percent",
    value: null,
    getQuantity: null,
    buyQuantity: null,
  },
};

const FLAT_OFFER = {
  ...offerBase,
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
};

const FREE_SALAD_OFFER = {
  ...offerBase,
  _id: "offer-free-salad",
  name: "Free Greek Salad",
  type: { name: "item", value: 0 },
  getItemOnly: true,
  getItems: { items: [SALAD_ENTRY] },
};

/**
 * BOGO-shaped offer whose buy side is the Cheese Burger — removing the
 * burger row must break check 6 (isBOGOOfferApplicable) and auto-remove it.
 */
const BOGO_OFFER = {
  ...offerBase,
  _id: "offer-bogo-burger",
  name: "Burger BOGO",
  type: { name: "item", value: 0 },
  applicable: {
    on: "complete",
    categories: [] as any[],
    items: [] as any[],
    isExclude: false,
    isInclude: false,
    rawItems: [
      {
        relation: "and",
        quantity: 1,
        item: { baseItemId: "cheese-burger", name: "Cheese Burger" },
      },
    ],
  },
  getItems: { items: [SALAD_ENTRY] },
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

describe("BagSheet offers vertical (Figma 1:3137 — Rewards in MY BAG)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    // GBP-style deployment: keep pence out of the round-off so every asserted
    // figure is exact (P7a bill-line test precedent).
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
  });

  it("no offers and none applied: no Rewards section at all", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    renderSheet();
    expect(screen.queryByTestId("bag-rewards-entry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-rewards-applied")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-discounts")).not.toBeInTheDocument();
  });

  it("unapplied entry row (decision 5): Rewards & Offers + top-ranked offer name; tap opens the RewardsSheet", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(setFilteredOffers([FLAT_OFFER]));
    renderSheet();

    const entry = screen.getByTestId("bag-rewards-entry");
    expect(entry).toHaveTextContent("Rewards & Offers");
    expect(entry).toHaveTextContent("£2 off your order"); // best ranked name
    expect(screen.queryByTestId("rewards-sheet")).not.toBeInTheDocument();

    await userEvent.click(entry);
    expect(screen.getByTestId("rewards-sheet")).toBeInTheDocument();
  });

  it("applied offer: applied row with Save line and −£X, Discounts bill line, and the ORDER & PAY CTA (real bill figures)", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    renderSheet();

    const applied = screen.getByTestId("bag-rewards-applied");
    expect(applied).toHaveTextContent("£2 off your order");
    expect(applied).toHaveTextContent("Save £2.00");
    expect(applied).toHaveTextContent("−£2.00"); // U+2212 minus (brief literal)
    expect(screen.getByTestId("bag-rewards-remove")).toBeInTheDocument();
    expect(screen.queryByTestId("bag-rewards-entry")).not.toBeInTheDocument();

    // Bill block: 8.60 − 2.00 = 6.60, discount line between Sub Total & Total.
    expect(screen.getByTestId("bag-subtotal")).toHaveTextContent("£8.60");
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£2.00");
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£6.60");
    const pay = screen.getByTestId("bag-pay");
    expect(pay).toHaveTextContent("Order & Pay");
    expect(pay).toHaveTextContent("£6.60");
  });

  it("Remove (direct removal): clears the slot with NO notice; discounts line and CTA flip back", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    renderSheet();

    await userEvent.click(screen.getByTestId("bag-rewards-remove"));

    await waitFor(() =>
      expect(screen.queryByTestId("bag-rewards-applied")).not.toBeInTheDocument()
    );
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(screen.queryByTestId("bag-discounts")).not.toBeInTheDocument();
    const pay = screen.getByTestId("bag-pay");
    expect(pay).not.toHaveTextContent("Order & Pay");
    expect(pay).toHaveTextContent("Pay");
    expect(pay).toHaveTextContent("£8.60");
    // Direct removal is notice-free (fork parity — scenario 4).
    expect(cartState().offerRemovalModal.isOpen).toBe(false);
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();
  });

  it("committed freebie row (scenario 5): Free chip, struck £17.00 over £0.00, no stepper; bill reflects the row-stamp discount", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...SALAD_FREEBIE_ROW }]));
    store.dispatch(applyOffer({ offer: FREE_SALAD_OFFER }));
    renderSheet();

    // The freebie survives revalidation (checks count PAID rows only).
    const row = screen.getByTestId("bag-row-gs-1");
    expect(screen.getByTestId("bag-free-chip-gs-1")).toHaveTextContent("Free");
    expect(row).toHaveTextContent("£17.00"); // struck undiscounted line
    expect(row).toHaveTextContent("£0.00"); // discounted price shown
    // isGetItem rows never get a stepper (isPaidRow excludes them).
    expect(screen.queryByTestId("bag-dec-gs-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-inc-gs-1")).not.toBeInTheDocument();

    // Bill: subtotal 8.60 + 17.00 = 25.60; discount 17.00 → total 8.60.
    expect(screen.getByTestId("bag-subtotal")).toHaveTextContent("£25.60");
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£17.00");
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£8.60");
    expect(screen.getByTestId("bag-rewards-applied")).toHaveTextContent(
      "Save £17.00"
    );
  });

  it("REVALIDATION: removing the BOGO's buy-side row auto-removes the offer and opens the removal notice; GOT IT closes it", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...DRINK_ROW }]));
    store.dispatch(applyOffer({ offer: BOGO_OFFER }));
    const { onClose } = renderSheet();

    // Sanity: buy side satisfied on open — the offer survives the first pass.
    expect(cartState().cartOffer._id).toBe("offer-bogo-burger");
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();

    // Remove the qualifying burger (qty 1 → REMOVE ITEM confirm, P7a flow).
    await userEvent.click(screen.getByTestId("bag-dec-cb-1"));
    await userEvent.click(screen.getByTestId("remove-item-confirm"));

    await waitFor(() =>
      expect(cartState().offerRemovalModal.isOpen).toBe(true)
    );
    expect(cartState().offerRemovalModal.data._id).toBe("offer-bogo-burger");
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);

    // The notice restates the offer, the WHY (bogo buy side), and the new total.
    const notice = screen.getByTestId("offer-removal-notice");
    expect(notice).toHaveTextContent("Reward Removed");
    expect(notice).toHaveTextContent(
      "Burger BOGO no longer applies to your order."
    );
    expect(notice).toHaveTextContent(
      "Add the qualifying items to unlock this reward"
    );
    expect(notice).toHaveTextContent("Your total is now £6.00"); // 2 × £3 left

    await userEvent.click(screen.getByTestId("offer-removal-gotit"));
    expect(cartState().offerRemovalModal.isOpen).toBe(false);
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();
    // The bag stays up — the drink row still holds the cart open.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("bag-row-pep-1")).toBeInTheDocument();
  });

  it("scenario 7: a freebie-only cart auto-removes the offer, empty-exits, and the notice SURVIVES emptyCart", async () => {
    store.dispatch(setCartItems([{ ...SALAD_FREEBIE_ROW }]));
    store.dispatch(applyOffer({ offer: FREE_SALAD_OFFER }));
    const { onClose } = renderSheet();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Cart fully emptied, offer gone…
    expect(cartState().cartItems).toEqual([]);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    // …but the removal notice was snapshotted across emptyCart's modal reset.
    expect(cartState().offerRemovalModal.isOpen).toBe(true);
    expect(cartState().offerRemovalModal.data._id).toBe("offer-free-salad");
  });

  it("while closed the bag still renders the redux-driven removal notice (menu persistence, scenario 7 tail)", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(openOfferRemovalModal(FLAT_OFFER));
    renderSheet(false);

    expect(screen.queryByTestId("bag-sheet")).not.toBeInTheDocument();
    const notice = screen.getByTestId("offer-removal-notice");
    expect(notice).toHaveTextContent("Reward Removed");
    // No bag bill here — the notice recomputes the total from the live cart.
    expect(notice).toHaveTextContent("Your total is now £8.60");

    await userEvent.click(screen.getByTestId("offer-removal-gotit"));
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();
    expect(cartState().offerRemovalModal.isOpen).toBe(false);
  });
});
