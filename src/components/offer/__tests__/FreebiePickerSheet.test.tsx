/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offer and getItems-entry fixtures mirror the untyped SDK converter output;
 * typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import FreebiePickerSheet from "../FreebiePickerSheet";
import "../../../i18n";

/** Paid row so the cart is non-empty when a freebie commits (P7a parity). */
const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 8.6,
  customizations: {},
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8 },
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

const orEntry = (id: string, name: string) => ({
  _id: `gi-${id}`,
  baseItemId: id,
  name,
  relation: "or",
  discountType: "percent",
  value: 100,
  quantity: 1,
  type: "ITEM",
  entities: sauceEntity(id, name),
});

const offerBase = {
  isAvailable: true,
  isComplimentary: false,
  getItemOnly: true,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  minBillAmount: null as number | null,
  minItemCount: null as number | null,
  maxDiscount: null as number | null,
  type: { name: "item", value: 0 },
  applicable: {
    on: "complete",
    isExclude: false,
    isInclude: false,
    rawItems: [] as any[],
  },
  buyItems: {},
  leastItemValueCount: { buyQuantity: null, getQuantity: null },
  buygetGroupWiseOfferValues: {
    discountType: "percent",
    value: null,
    getQuantity: null,
    buyQuantity: null,
  },
};

/** Two-way "or" choice: the customer picks ONE. */
const CHOICE_OFFER = {
  ...offerBase,
  _id: "offer-free-sauce-choice",
  name: "Free Sauce",
  isAndOffer: false,
  getItems: {
    items: [
      orEntry("tortilla-sauce", "Tortilla Sauce"),
      orEntry("caesar-dressing", "Caesar Dressing"),
    ],
  },
};

/** Pure-"and" grant: every plain entry is part of the reward. */
const AND_OFFER = {
  ...offerBase,
  _id: "offer-free-salad",
  name: "Free Greek Salad",
  isAndOffer: true,
  getItems: {
    items: [
      {
        _id: "gi-salad",
        baseItemId: "greek-salad",
        name: "Greek Salad",
        relation: "and",
        discountType: "percent",
        value: 100,
        quantity: 1,
        type: "ITEM",
        entities: {
          ...sauceEntity("greek-salad", "Greek Salad"),
          price: 17,
          undiscounted_total_price: 17,
        },
      },
    ],
  },
};

/** OR offer whose second alternative still carries a modifier choice. */
const MIXED_OFFER = {
  ...offerBase,
  _id: "offer-mixed",
  name: "Free Side",
  isAndOffer: false,
  getItems: {
    items: [
      orEntry("tortilla-sauce", "Tortilla Sauce"),
      {
        _id: "gi-kiddie",
        baseItemId: "kiddie-meal",
        name: "Kiddie Meal",
        relation: "or",
        discountType: "percent",
        value: 100,
        quantity: 1,
        type: "ITEM",
        entities: {
          id: "kiddie-meal",
          name: "Kiddie Meal",
          price: 12,
          modifiers: ["m1"],
          hasVariant: false,
          discountType: "percent",
          discountValue: 100,
          isGetItem: true,
          type: "CUSTOMIZABLE",
          customizations: { m1: [] },
          baseItem: { id: "kiddie-meal", name: "Kiddie Meal", price: 12 },
          baseItemPrice: 12,
        },
      },
    ],
  },
};

const renderPicker = (offer: any, open = true) => {
  const onClose = vi.fn();
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <FreebiePickerSheet open={open} offer={offer} onClose={onClose} />
      </MemoryRouter>
    </Provider>
  );
  return { ...utils, onClose };
};

const cartState = () => (store.getState() as any).cart;
const getItemRows = () =>
  cartState().cartItems.filter((row: any) => row?.isGetItem);

describe("FreebiePickerSheet (P7b freebie choice — contract picker recipe)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("renders nothing while closed, and nothing for an empty offer", () => {
    renderPicker(CHOICE_OFFER, false);
    expect(screen.queryByTestId("freebie-picker")).not.toBeInTheDocument();
    renderPicker(null, true);
    expect(screen.queryByTestId("freebie-picker")).not.toBeInTheDocument();
  });

  it("OR offer: both options render with the Free line and struck full price; CONFIRM is gated on a pick", async () => {
    renderPicker(CHOICE_OFFER);
    expect(screen.getByTestId("freebie-picker")).toBeInTheDocument();
    expect(screen.getByText("Choose Your Free Item")).toBeInTheDocument();
    expect(
      screen.getByText("Select 1 item to redeem with your reward.")
    ).toBeInTheDocument();

    const tortilla = screen.getByTestId("freebie-option-tortilla-sauce");
    const caesar = screen.getByTestId("freebie-option-caesar-dressing");
    expect(tortilla).toHaveTextContent("Tortilla Sauce");
    expect(tortilla).toHaveTextContent("Free");
    expect(tortilla).toHaveTextContent("£2.00"); // struck full price
    expect(tortilla).toHaveTextContent("£0.00"); // discounted line
    expect(caesar).toHaveTextContent("Caesar Dressing");

    const confirm = screen.getByTestId("freebie-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(tortilla);
    expect(tortilla).toHaveAttribute("aria-pressed", "true");
    expect(caesar).toHaveAttribute("aria-pressed", "false");
    expect(confirm).toHaveAttribute("aria-disabled", "false");
  });

  it("gated CONFIRM without a pick commits nothing", async () => {
    const { onClose } = renderPicker(CHOICE_OFFER);
    await userEvent.click(screen.getByTestId("freebie-confirm"));
    expect(getItemRows()).toEqual([]);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pick + CONFIRM commits the PICKED entry as a real isGetItem row, applies the offer, and closes", async () => {
    const { onClose } = renderPicker(CHOICE_OFFER);
    await userEvent.click(screen.getByTestId("freebie-option-caesar-dressing"));
    await userEvent.click(screen.getByTestId("freebie-confirm"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const freebies = getItemRows();
    expect(freebies).toHaveLength(1);
    expect(freebies[0].id).toBe("caesar-dressing");
    expect(freebies[0].isGetItem).toBe(true);
    expect(freebies[0].discounted_total_price).toBe(0);
    expect(freebies[0].undiscounted_total_price).toBe(2);
    // The un-picked alternative never lands.
    expect(freebies.some((row: any) => row.id === "tortilla-sauce")).toBe(false);
    expect(cartState().cartOffer._id).toBe("offer-free-sauce-choice");
    expect(cartState().getItems).toEqual([]); // committed, not staged
  });

  it("customizable alternative renders disabled with the coming-soon note (tier session deferred)", async () => {
    renderPicker(MIXED_OFFER);
    const kiddie = screen.getByTestId("freebie-option-kiddie-meal");
    expect(kiddie).toBeDisabled();
    expect(kiddie).toHaveTextContent("Customization coming soon");
    await userEvent.click(kiddie);
    // A disabled row can never become the pick.
    expect(screen.getByTestId("freebie-confirm")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    // The plain alternative still works.
    await userEvent.click(screen.getByTestId("freebie-option-tortilla-sauce"));
    expect(screen.getByTestId("freebie-confirm")).toHaveAttribute(
      "aria-disabled",
      "false"
    );
  });

  it("AND offer: all-selected grant, CONFIRM live immediately, commit lands every plain entry", async () => {
    const { onClose } = renderPicker(AND_OFFER);
    expect(
      screen.getByText("These items come with your reward.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("freebie-confirm")).toHaveAttribute(
      "aria-disabled",
      "false"
    );
    await userEvent.click(screen.getByTestId("freebie-confirm"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const freebies = getItemRows();
    expect(freebies).toHaveLength(1);
    expect(freebies[0].id).toBe("greek-salad");
    expect(freebies[0].discounted_total_price).toBe(0);
    expect(freebies[0].undiscounted_total_price).toBe(17);
    expect(cartState().cartOffer._id).toBe("offer-free-salad");
  });

  it("X closes without committing", async () => {
    const { onClose } = renderPicker(CHOICE_OFFER);
    await userEvent.click(screen.getByTestId("freebie-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getItemRows()).toEqual([]);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
  });

  it("ADA (P9c): capped by its containing block with the X and CONFIRM outside the scroller", () => {
    renderPicker(CHOICE_OFFER);
    const close = screen.getByTestId("freebie-close");

    expect(
      close.closest('[class*="max-h-[min(1200px,calc(100%_-_96px))]"]')
    ).not.toBeNull();
    expect(close.closest(".overflow-y-auto")).toBeNull();
    expect(
      screen.getByTestId("freebie-confirm").closest(".overflow-y-auto")
    ).toBeNull();
    expect(
      screen
        .getByTestId("freebie-option-tortilla-sauce")
        .closest(".overflow-y-auto")
    ).not.toBeNull();
  });
});
