/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offer and cart-row fixtures mirror the untyped SDK cart slice / converter
 * output; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems, applyOffer } from "@cx-sdk/ordering/state/cart.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import RewardsSheet from "../RewardsSheet";
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

const sauceEntity = (id: string, name: string) => ({
  id,
  name,
  price: 2,
  modifiers: [] as any[],
  hasVariant: false,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  type: "ITEM",
  discounted_total_price: 0,
  undiscounted_total_price: 2,
});

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

/** Always eligible against the £8.60 cart. */
const FLAT_OFFER = {
  ...offerBase,
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
};

/** LOCKED against the £8.60 cart (minBill 25 → £16.40 short). */
const PERCENT_OFFER = {
  ...offerBase,
  _id: "offer-percent-25",
  name: "25% off your order",
  type: { name: "percent", value: 25 },
  minBillAmount: 25,
  maxDiscount: 10,
};

/** GONE — isAvailable:false with no numeric gap → unavailable. */
const GONE_OFFER = {
  ...offerBase,
  _id: "offer-gone",
  name: "Expired offer",
  type: { name: "amount", value: 1 },
  isAvailable: false,
};

/** OR-choice freebie — eligible, but the commit must hand off to the picker. */
const CHOICE_OFFER = {
  ...offerBase,
  _id: "offer-free-sauce-choice",
  name: "Free Sauce",
  type: { name: "item", value: 0 },
  getItemOnly: true,
  isAndOffer: false,
  getItems: {
    items: [
      {
        _id: "gi-tortilla",
        baseItemId: "tortilla-sauce",
        name: "Tortilla Sauce",
        relation: "or",
        discountType: "percent",
        value: 100,
        quantity: 1,
        type: "ITEM",
        entities: sauceEntity("tortilla-sauce", "Tortilla Sauce"),
      },
      {
        _id: "gi-caesar",
        baseItemId: "caesar-dressing",
        name: "Caesar Dressing",
        relation: "or",
        discountType: "percent",
        value: 100,
        quantity: 1,
        type: "ITEM",
        entities: sauceEntity("caesar-dressing", "Caesar Dressing"),
      },
    ],
  },
};

const renderSheet = (open = true) => {
  const onClose = vi.fn();
  const onNeedsPicker = vi.fn();
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <RewardsSheet open={open} onClose={onClose} onNeedsPicker={onNeedsPicker} />
      </MemoryRouter>
    </Provider>
  );
  return { ...utils, onClose, onNeedsPicker };
};

const cartState = () => (store.getState() as any).cart;

describe("RewardsSheet (Figma 1:3824 / 1:3858 / 1:3924 — REWARDS)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("renders nothing while closed", () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER]));
    renderSheet(false);
    expect(screen.queryByTestId("rewards-sheet")).not.toBeInTheDocument();
  });

  it("open: eligible row gets a radio, locked row gets the pink minBill nudge (no radio), gone row is struck", () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER, PERCENT_OFFER, GONE_OFFER]));
    renderSheet();
    expect(screen.getByTestId("rewards-sheet")).toBeInTheDocument();

    // Eligible: radio, save copy.
    const flat = screen.getByTestId("offer-row-offer-flat-2");
    expect(screen.getByTestId("offer-radio-offer-flat-2")).toBeInTheDocument();
    expect(flat).toHaveTextContent("Save £2.00");

    // Locked minBill: engine-computed £16.40 shortfall on the £8.60 cart.
    expect(
      screen.queryByTestId("offer-radio-offer-percent-25")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("offer-row-nudge-offer-percent-25")).toHaveTextContent(
      "Add £16.40+ to your order to be eligible to redeem this reward"
    );

    // Gone: struck name, no radio, no nudge.
    const gone = screen.getByTestId("offer-row-offer-gone");
    expect(within(gone).getByText("Expired offer")).toHaveClass("line-through");
    expect(screen.queryByTestId("offer-radio-offer-gone")).not.toBeInTheDocument();
    expect(screen.queryByTestId("offer-row-nudge-offer-gone")).not.toBeInTheDocument();

    // Something is pickable → SAVE SELECTION is live.
    expect(screen.getByTestId("rewards-save")).toBeEnabled();
  });

  it("no rankable offers: the none-available copy shows and SAVE stays disabled", () => {
    store.dispatch(setFilteredOffers([]));
    renderSheet();
    expect(screen.getByText("No rewards right now")).toBeInTheDocument();
    expect(
      screen.getByText("There are no rewards available for this order.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("rewards-save")).toBeDisabled();
  });

  it("only locked/gone offers: nothing pickable → SAVE disabled", () => {
    store.dispatch(setFilteredOffers([PERCENT_OFFER, GONE_OFFER]));
    renderSheet();
    expect(screen.getByTestId("offer-row-offer-percent-25")).toBeInTheDocument();
    expect(screen.getByTestId("rewards-save")).toBeDisabled();
  });

  it("applied offer is preselected with the Applied chip; unchanged SAVE just closes", async () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER, PERCENT_OFFER]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    const { onClose } = renderSheet();

    const row = screen.getByTestId("offer-row-offer-flat-2");
    expect(row).toHaveAttribute("aria-checked", "true");
    expect(row).toHaveTextContent("Applied");

    await userEvent.click(screen.getByTestId("rewards-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // No re-commit: the slot still holds the same offer.
    expect(cartState().cartOffer._id).toBe("offer-flat-2");
  });

  it("pick + SAVE commits through the apply core (atomic swap) and closes", async () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER, PERCENT_OFFER]));
    const { onClose, onNeedsPicker } = renderSheet();

    await userEvent.click(screen.getByTestId("offer-row-offer-flat-2"));
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await userEvent.click(screen.getByTestId("rewards-save"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(cartState().cartOffer._id).toBe("offer-flat-2");
    expect(cartState().cartOfferSource).toBe("offer");
    expect(onNeedsPicker).not.toHaveBeenCalled();
  });

  it("X closes without committing the pending pick", async () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER]));
    const { onClose } = renderSheet();
    await userEvent.click(screen.getByTestId("offer-row-offer-flat-2"));
    await userEvent.click(screen.getByTestId("rewards-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
  });

  it("an OR-choice pick hands the offer to onNeedsPicker (before close) instead of applying it", async () => {
    store.dispatch(setFilteredOffers([CHOICE_OFFER]));
    const { onClose, onNeedsPicker } = renderSheet();

    await userEvent.click(screen.getByTestId("offer-row-offer-free-sauce-choice"));
    await userEvent.click(screen.getByTestId("rewards-save"));

    await waitFor(() => expect(onNeedsPicker).toHaveBeenCalledTimes(1));
    expect(onNeedsPicker.mock.calls[0][0]._id).toBe("offer-free-sauce-choice");
    expect(onClose).toHaveBeenCalledTimes(1);
    // Nothing landed: no slot write, no freebie rows.
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(
      cartState().cartItems.filter((row: any) => row?.isGetItem)
    ).toEqual([]);
  });

  it("ADA (P9c): capped by its containing block with the X and SAVE outside the scroller", () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER]));
    renderSheet();
    const close = screen.getByTestId("rewards-close");

    expect(
      close.closest('[class*="h-[min(1470px,calc(100%_-_96px))]"]')
    ).not.toBeNull();
    expect(close.closest(".overflow-y-auto")).toBeNull();
    expect(
      screen.getByTestId("rewards-save").closest(".overflow-y-auto")
    ).toBeNull();
    expect(
      screen.getByTestId("offer-row-offer-flat-2").closest(".overflow-y-auto")
    ).not.toBeNull();
  });
});
