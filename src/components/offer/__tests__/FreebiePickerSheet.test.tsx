/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offer and getItems-entry fixtures mirror the untyped SDK converter output;
 * typed in the P7+ domain passes. Do not add NEW anys.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { addGetItemsRdx, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  setCurrency,
  setDeploymentInfo,
  setDiscountOnAddon,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { findOrphanedFreebieRows } from "@cx-sdk/ordering/offer/offerCommitRules";
import { store } from "../../../redux/app/store";
import FreebiePickerSheet from "../FreebiePickerSheet";
import OfferTierHost from "../OfferTierHost";
import useOrderHook from "../../../hooks/menuHooks/useOrderHook";
import i18n from "../../../i18n";

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

/**
 * Converter variant-id branch (useOfferConverters `!entity`): the get entry
 * IS one size of a base item — a fixed-size grant (isVariantSelected).
 */
const FRIES_M = { id: "fries-m", name: "Medium", price: 3, isActive: true, modifiers: ["sauce_group"] };
const FRIES_L = { id: "fries-l", name: "Large", price: 5, isActive: true, modifiers: ["sauce_group"] };
const friesBase = {
  id: "fries",
  name: "Fries",
  price: 0,
  hasVariant: true,
  modifiers: ["sauce_group"],
  variants: [FRIES_M, FRIES_L],
};
const fixedSizeEntry = (variant: typeof FRIES_M) => ({
  _id: `gi-${variant.id}`,
  baseItemId: variant.id,
  name: "Fries",
  relation: "or",
  discountType: "percent",
  value: 100,
  quantity: 1,
  entities: {
    ...friesBase,
    discounted_total_price: 0,
    undiscounted_total_price: variant.price,
    isVariantSelected: true,
    discountType: "percent",
    discountValue: 100,
    selectedVariant: { ...variant, isGetItemCustomized: false, isGetItem: true, discounted_total_price: 0 },
    selectedVariantId: variant.id,
    customizations: { sauce_group: [] },
    selectedVariantModifiers: ["sauce_group"],
    type: "VARIANT",
    baseItem: { ...friesBase, isGetItemCustomized: false, isGetItem: true },
    baseItemPrice: 0,
    variantPrice: variant.price,
    isGetItemCustomized: false,
    isGetItem: true,
  },
});

/** "Free fries": two sizes of ONE base — they share entities.id. */
const SIZES_OFFER = {
  ...offerBase,
  _id: "offer-fries-size",
  name: "Free Fries",
  isAndOffer: false,
  getItems: { items: [fixedSizeEntry(FRIES_M), fixedSizeEntry(FRIES_L)] },
};

/** Group-wise "buy 2 get 1 side" whose "and" list mixes plain + customizable. */
const GROUP_WISE_OFFER = {
  ...offerBase,
  _id: "offer-gw",
  name: "Buy 2 get a side",
  getItemOnly: false,
  buygetGroupWiseOffer: true,
  isAndOffer: true,
  buygetGroupWiseOfferValues: { discountType: "percent", value: 100, getQuantity: 1, buyQuantity: 2 },
  getItems: {
    items: [
      { ...AND_OFFER.getItems.items[0] },
      { ...MIXED_OFFER.getItems.items[1], _id: "gi-kiddie-gw", relation: "and" },
    ],
  },
};

const PICKLE_GROUP = {
  _id: "pickle_group",
  name: "Extras",
  min: 0,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "pickles", name: "Extra Pickles", price: 1, isActive: true }],
};

/** OR offer: a 50%-off customizable burger (pickles +£1) or a sauce. */
const HALF_BURGER_OFFER = {
  ...offerBase,
  _id: "offer-half-burger",
  name: "Burger Half Price Or Sauce",
  isAndOffer: false,
  getItems: {
    items: [
      orEntry("tortilla-sauce", "Tortilla Sauce"),
      {
        _id: "gi-half-burger",
        baseItemId: "half-burger",
        name: "Half Burger",
        relation: "or",
        discountType: "percent",
        value: 50,
        quantity: 1,
        entities: {
          id: "half-burger",
          name: "Half Burger",
          price: 9,
          modifiers: ["pickle_group"],
          hasVariant: false,
          discountType: "percent",
          discountValue: 50,
          isGetItem: true,
          type: "CUSTOMIZABLE",
          customizations: { pickle_group: [] },
          baseItem: { id: "half-burger", name: "Half Burger", price: 9, modifiers: ["pickle_group"] },
          baseItemPrice: 9,
        },
      },
    ],
  },
};

const renderPicker = (offer: any, open = true, withTierHost = false) => {
  const onClose = vi.fn();
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <FreebiePickerSheet open={open} offer={offer} onClose={onClose} />
        {withTierHost && <OfferTierHost />}
      </MemoryRouter>
    </Provider>
  );
  return { ...utils, onClose };
};

const tierSessionOpen = () =>
  Boolean(
    (store.getState() as any).makeItAMeal.makeItAMealModal.tier1CustomizationModal.isOpen
  );

const cartState = () => (store.getState() as any).cart;
const getItemRows = () =>
  cartState().cartItems.filter((row: any) => row?.isGetItem);

describe("FreebiePickerSheet (P7b freebie choice — contract picker recipe)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("renders nothing while closed, and nothing for an empty offer", () => {
    renderPicker(CHOICE_OFFER, false);
    expect(screen.queryByTestId("freebie-picker")).not.toBeInTheDocument();
    renderPicker(null, true);
    expect(screen.queryByTestId("freebie-picker")).not.toBeInTheDocument();
  });

  // Walk 2026-10-14: an imageless row's 84 px plate read as a failed load.
  it("an imageless option carries the faint bell on its 84 px plate; one with a photo shows the photo", () => {
    const photo = "https://cdn.example.com/kiosk/caesar.png";
    const caesar = orEntry("caesar-dressing", "Caesar Dressing");
    renderPicker({
      ...CHOICE_OFFER,
      getItems: {
        items: [
          orEntry("tortilla-sauce", "Tortilla Sauce"),
          { ...caesar, entities: { ...caesar.entities, image_url: photo } },
        ],
      },
    });

    const plate = within(screen.getByTestId("freebie-option-tortilla-sauce")).getByTestId("no-image-bell");
    expect(plate).toHaveClass("h-[84px]", "w-[84px]", "rounded-[8px]", "bg-tb-grey-6");
    const pictured = screen.getByTestId("freebie-option-caesar-dressing");
    expect(within(pictured).queryByTestId("no-image-bell")).toBeNull();
    expect(pictured.querySelector("img")).toHaveAttribute("src", photo);
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
    // The struck full price (moduloCalcaledValue: whole amounts print
    // whole), then what CONFIRM charges — nothing reads "Free", never "£0"
    // (posistKiosk OfferItem: effectivePrice <= 0 → offer.badgeFree).
    expect(tortilla).toHaveTextContent(/£2Free$/);
    expect(caesar).toHaveTextContent("Caesar Dressing");

    const confirm = screen.getByTestId("freebie-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(tortilla);
    expect(tortilla).toHaveAttribute("aria-pressed", "true");
    expect(caesar).toHaveAttribute("aria-pressed", "false");
    expect(confirm).toHaveAttribute("aria-disabled", "false");
  });

  it("motion: the panel rises (tb-sheet-enter) over a still scrim; a pick's indicator pops in (D-M3, §3.2)", async () => {
    renderPicker(CHOICE_OFFER);
    const sheet = screen.getByTestId("freebie-picker");
    const [scrim, panel] = Array.from(sheet.children);
    expect(scrim.tagName).toBe("BUTTON");
    expect(scrim).not.toHaveAttribute("style");
    expect(scrim.className).not.toMatch(/(^|\s)(tb-|animate-)/);
    expect(panel).toBe(screen.getByRole("dialog"));
    expect(panel).toHaveClass("tb-sheet-enter");
    expect(panel).not.toHaveAttribute("style");
    expect(sheet.querySelector("style")).toBeNull();

    const tortilla = screen.getByTestId("freebie-option-tortilla-sauce");
    expect(sheet.querySelector(".tb-pop-in")).toBeNull();
    await userEvent.click(tortilla);
    expect(tortilla.querySelectorAll(".tb-pop-in")).toHaveLength(1);
    expect(screen.getByTestId("freebie-option-caesar-dressing").querySelector(".tb-pop-in")).toBeNull();
    expect(tortilla).not.toHaveClass("tb-select"); // a full-width row only pops its indicator
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

  it("customizable alternative is enabled: a tap seeds an in-place tier-1 isGetItem session and never navigates", async () => {
    const LocationProbe = () => (
      <span data-testid="location">{useLocation().pathname}</span>
    );
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <FreebiePickerSheet open offer={MIXED_OFFER} onClose={vi.fn()} />
          <LocationProbe />
        </MemoryRouter>
      </Provider>
    );
    const kiddie = screen.getByTestId("freebie-option-kiddie-meal");
    expect(kiddie).toBeEnabled();
    await userEvent.click(kiddie);

    const miam = (store.getState() as any).makeItAMeal.makeItAMealModal;
    expect(miam.isMakeItAMealSessionActive).toBe(true);
    expect(miam.tier1CustomizationModal.isOpen).toBe(true);
    expect(miam.tier1CustomizationModal.customizations.selectedEntity).toMatchObject({
      id: "kiddie-meal",
      isGetItem: true,
      quantity: 1,
    });
    // Nothing is staged until the embedded PDP commits, so nothing is picked.
    expect(cartState().getItems).toEqual([]);
    expect(screen.getByTestId("freebie-confirm")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/cart");
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
    // Motion §3.2: each granted plain entry's filled check pops in.
    const sheet = screen.getByTestId("freebie-picker");
    expect(sheet.querySelectorAll('[aria-hidden="true"].tb-pop-in.bg-tb-purple svg')).toHaveLength(
      sheet.querySelectorAll('[aria-hidden="true"].bg-tb-purple svg').length
    );
    expect(sheet.querySelectorAll(".tb-pop-in svg").length).toBeGreaterThan(0);
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

describe("FreebiePickerSheet — lane offers review fixes", () => {
  beforeAll(() => {
    // The embedded PDP scrolls its option list; jsdom has no scrollTo.
    Element.prototype.scrollTo = () => {};
  });
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
    store.dispatch(setModifiersMap({ modifiersMap: { pickle_group: PICKLE_GROUP } }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("F1: a variant-id freebie is a fixed-size grant — no PDP, names its size, only the picked size lands, and the bill agrees with the row", async () => {
    const { onClose } = renderPicker(SIZES_OFFER);
    const [medium, large] = screen.getAllByTestId("freebie-option-fries");
    expect(medium).toHaveTextContent("Medium");
    expect(medium).toHaveTextContent(/£3Free$/);
    expect(large).toHaveTextContent("Large");
    expect(large).toHaveTextContent(/£5Free$/);

    await userEvent.click(large);
    expect(tierSessionOpen()).toBe(false);
    // The sizes share entities.id: the pick is per ENTRY, never both.
    expect(large).toHaveAttribute("aria-pressed", "true");
    expect(medium).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByTestId("freebie-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const freebies = getItemRows();
    expect(freebies).toHaveLength(1);
    expect(freebies[0].selectedVariant.id).toBe("fries-l");
    expect(freebies[0].undiscounted_total_price).toBe(5);
    expect(freebies[0].discounted_total_price).toBe(0);

    const { result } = renderHook(() => useOrderHook(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <MemoryRouter>{children}</MemoryRouter>
        </Provider>
      ),
    });
    const bill: any = result.current.getCalculatedBill(cartState());
    expect(bill.getTotalDiscount()).toBe(5);
  });

  it("F2 (G3): a group-wise 'pick 1' offer grants exactly the ONE pick, never every 'and' entry — CONFIRM is locked with a hint until then, the other row locks after", async () => {
    const { onClose } = renderPicker(GROUP_WISE_OFFER);
    const confirm = screen.getByTestId("freebie-confirm");
    const salad = screen.getByTestId("freebie-option-greek-salad");
    const kiddie = screen.getByTestId("freebie-option-kiddie-meal");
    // No all-selected "and" grant: nothing is picked until the guest picks.
    expect(salad).toHaveAttribute("aria-pressed", "false");
    expect(kiddie).toBeEnabled();
    expect(kiddie).toHaveTextContent("Customize");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("freebie-group-hint")).toHaveTextContent(
      "Select 1 more item to continue"
    );
    await userEvent.click(confirm);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(salad);
    expect(salad).toHaveAttribute("aria-pressed", "true");
    // At getQuantity: the unpicked row is out of play, the hint clears.
    expect(kiddie).toBeDisabled();
    expect(screen.getByTestId("freebie-group-hint")).toBeEmptyDOMElement();
    expect(confirm).toHaveAttribute("aria-disabled", "false");
    // A second tap adds nothing (more is impossible).
    await userEvent.click(salad);
    expect(salad).not.toHaveTextContent("2 x");

    await userEvent.click(confirm);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const freebies = getItemRows();
    expect(freebies.map((row: any) => row.id)).toEqual(["greek-salad"]);
    expect(freebies[0].quantity).toBe(1);
    expect(cartState().cartOffer._id).toBe("offer-gw");
  });

  it("UI-2/3/6: a customized freebie keeps its pick through re-tap + BACK, shows the price CONFIRM charges behind a neutral CTA, and the closed PDP briefly swallows ghost taps", async () => {
    const { onClose } = renderPicker(HALF_BURGER_OFFER, true, true);
    await userEvent.click(screen.getByTestId("freebie-option-half-burger"));
    let host = await screen.findByTestId("offer-tier-host");
    // No "free" claim: this freebie is 50% off.
    expect(within(host).getByTestId("pdp-add-to-bag")).toHaveTextContent("ADD TO REWARD");
    await userEvent.click(within(host).getByTestId("pdp-option-pickles"));
    await userEvent.click(within(host).getByTestId("pdp-add-to-bag"));
    await waitFor(() => expect(screen.queryByTestId("offer-tier-host")).toBeNull());
    expect(screen.getByTestId("offer-tier-tap-guard")).toBeInTheDocument();
    await waitFor(
      () => expect(screen.queryByTestId("offer-tier-tap-guard")).toBeNull(),
      { timeout: 1500 }
    );

    const row = () => screen.getByTestId("freebie-option-half-burger");
    expect(row()).toHaveTextContent("Customized — tap to change");
    // 50% off the £9 base, the £1 add-on in full (discountOnAddon off).
    expect(row()).toHaveTextContent(/£10£5\.50$/);

    // "Tap to change", then change your mind: BACK keeps the held pick.
    await userEvent.click(row());
    host = await screen.findByTestId("offer-tier-host");
    await userEvent.click(within(host).getByTestId("pdp-back"));
    await waitFor(() => expect(screen.queryByTestId("offer-tier-host")).toBeNull());
    expect(cartState().getItems).toHaveLength(1);
    expect(row()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("freebie-confirm")).toHaveAttribute("aria-disabled", "false");

    await userEvent.click(screen.getByTestId("freebie-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const freebies = getItemRows();
    expect(freebies).toHaveLength(1);
    expect(freebies[0].undiscounted_total_price).toBe(10);
    expect(freebies[0].discounted_total_price).toBe(5.5);
    expect(cartState().getItems).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Lane "offers" (item 32): customizable freebies are customised IN PLACE
 * (OfferTierHost) and held in cart.getItems until CONFIRM. Newest wins.
 * ------------------------------------------------------------------ */

/** A customised Kiddie Meal as the embedded PDP holds it (base £12 + £1 add-on). */
const STAGED_KIDDIE = {
  id: "kiddie-meal",
  itemId: "kiddie-staged-1",
  itemType: "CUSTOMIZABLE",
  type: "CUSTOMIZABLE",
  name: "Kiddie Meal",
  quantity: 1,
  price: 12,
  total_price: 13,
  customizations: { m1: [{ id: "toy", name: "Toy", price: 1, quantity: 1 }] },
  isGetItem: true,
};

/** Pure-"and" grant: a plain salad AND a customizable kiddie meal. */
const AND_MIXED_OFFER = {
  ...offerBase,
  _id: "offer-and-mixed",
  name: "Free Salad And Kiddie Meal",
  isAndOffer: true,
  getItems: {
    items: [
      { ...AND_OFFER.getItems.items[0] },
      { ...MIXED_OFFER.getItems.items[1], _id: "gi-kiddie-and", relation: "and" },
    ],
  },
};

/** OR: a FREE customizable burger (pickles +£1) or a sauce — production entries carry no `type`. */
const FREE_BURGER_OR_OFFER = {
  ...offerBase,
  _id: "offer-free-burger-or",
  name: "Free Burger Or Sauce",
  isAndOffer: false,
  getItems: {
    items: [
      orEntry("tortilla-sauce", "Tortilla Sauce"),
      {
        _id: "gi-free-burger",
        baseItemId: "free-burger",
        name: "Free Burger",
        relation: "or",
        discountType: "percent",
        value: 100,
        quantity: 1,
        entities: {
          id: "free-burger",
          name: "Free Burger",
          price: 9,
          modifiers: ["pickle_group"],
          hasVariant: false,
          discountType: "percent",
          discountValue: 100,
          isGetItem: true,
          type: "CUSTOMIZABLE",
          customizations: { pickle_group: [] },
          baseItem: { id: "free-burger", name: "Free Burger", price: 9, modifiers: ["pickle_group"] },
          baseItemPrice: 9,
        },
      },
    ],
  },
};

const stage = (row: object) => act(() => void store.dispatch(addGetItemsRdx(row)));
const backdrop = () =>
  screen
    .getAllByRole("button", { name: "Close" })
    .find((button) => !button.hasAttribute("data-testid")) as HTMLElement;

describe("FreebiePickerSheet — customizable freebies (lane offers)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
    store.dispatch(setModifiersMap({ modifiersMap: { pickle_group: PICKLE_GROUP } }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("a customizable or-option tap seeds the tier plan (isGetItem, qty 1) in place — and keeps an already-held customization (newest wins)", async () => {
    const LocationProbe = () => <span data-testid="location">{useLocation().pathname}</span>;
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <FreebiePickerSheet open offer={MIXED_OFFER} onClose={vi.fn()} />
          <LocationProbe />
        </MemoryRouter>
      </Provider>
    );
    stage(STAGED_KIDDIE);

    await userEvent.click(screen.getByTestId("freebie-option-kiddie-meal"));

    const tier1 = (store.getState() as any).makeItAMeal.makeItAMealModal.tier1CustomizationModal;
    expect(tier1.isOpen).toBe(true);
    expect(tier1.customizations.selectedEntity).toMatchObject({
      id: "kiddie-meal",
      isGetItem: true,
      quantity: 1,
    });
    // "Tap to change": the held pick survives until a new one lands (BACK keeps it).
    expect(cartState().getItems).toHaveLength(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/cart");
  });

  it("with a held row the option reads selected + 'Customized', priced as CONFIRM will charge it", () => {
    renderPicker(MIXED_OFFER);
    stage(STAGED_KIDDIE);

    const kiddie = screen.getByTestId("freebie-option-kiddie-meal");
    expect(kiddie).toHaveAttribute("aria-pressed", "true");
    expect(kiddie).toHaveTextContent("Customized — tap to change");
    // Struck: base + add-on; then the base free, the add-on charged.
    expect(kiddie).toHaveTextContent(/£13£1$/);
    expect(screen.getByTestId("freebie-option-tortilla-sauce")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("freebie-confirm")).toHaveAttribute("aria-disabled", "false");
  });

  it("an uncustomized customizable row says 'Customize' and shows no price pair", () => {
    renderPicker(MIXED_OFFER);
    const kiddie = screen.getByTestId("freebie-option-kiddie-meal");
    expect(kiddie).toHaveTextContent("Customize");
    expect(kiddie).not.toHaveTextContent("Customized");
    expect(kiddie.textContent).not.toContain("£");
  });

  it("a plain pick clears the held customization (or-mode: one pick)", async () => {
    renderPicker(MIXED_OFFER);
    stage(STAGED_KIDDIE);

    await userEvent.click(screen.getByTestId("freebie-option-tortilla-sauce"));

    expect(cartState().getItems).toEqual([]);
    expect(screen.getByTestId("freebie-option-tortilla-sauce")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("freebie-option-kiddie-meal")).toHaveAttribute("aria-pressed", "false");
  });

  it("and-mode: CONFIRM is gated until every customizable entry is held; then the commit lands plain + customised rows", async () => {
    const { onClose } = renderPicker(AND_MIXED_OFFER);
    const confirm = screen.getByTestId("freebie-confirm");
    expect(screen.getByTestId("freebie-option-greek-salad")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("freebie-option-kiddie-meal")).toHaveAttribute("aria-pressed", "false");
    expect(confirm).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(confirm);
    expect(onClose).not.toHaveBeenCalled();
    expect(getItemRows()).toEqual([]);

    stage(STAGED_KIDDIE);
    expect(confirm).toHaveAttribute("aria-disabled", "false");
    await userEvent.click(confirm);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(getItemRows().map((row: any) => row.id).sort()).toEqual(["greek-salad", "kiddie-meal"]);
    expect(cartState().cartOffer._id).toBe("offer-and-mixed");
    expect(cartState().getItems).toEqual([]);
  });

  it("production get_cx_valid_offers entries (baseItemId null, the item id in `_id`): the held customization still unlocks CONFIRM, and what lands survives the crash-reload ownership check", async () => {
    const offer = {
      ...AND_MIXED_OFFER,
      _id: "offer-and-mixed-null-base",
      getItems: {
        items: AND_MIXED_OFFER.getItems.items.map((entry: any) => ({
          ...entry,
          _id: entry.entities.id,
          baseItemId: null,
        })),
      },
    };
    const { onClose } = renderPicker(offer);
    const confirm = screen.getByTestId("freebie-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");

    stage(STAGED_KIDDIE);
    expect(screen.getByTestId("freebie-option-kiddie-meal")).toHaveAttribute("aria-pressed", "true");
    expect(confirm).toHaveAttribute("aria-disabled", "false");
    await userEvent.click(confirm);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(getItemRows().map((row: any) => row.id).sort()).toEqual(["greek-salad", "kiddie-meal"]);
    expect(findOrphanedFreebieRows(cartState().cartOffer, cartState().cartItems)).toEqual([]);
  });

  it.each([
    [false, 1],
    [true, 0],
  ])(
    "CONFIRM lands the customised freebie at redeemGetItem prices (discountOnAddon %s → £%s); the offer applies and nothing stays held",
    async (discountOnAddon, discounted) => {
      store.dispatch(setDiscountOnAddon(discountOnAddon));
      const { onClose } = renderPicker(FREE_BURGER_OR_OFFER, true, true);

      await userEvent.click(screen.getByTestId("freebie-option-free-burger"));
      const host = await screen.findByTestId("offer-tier-host");
      await userEvent.click(within(host).getByTestId("pdp-option-pickles"));
      await userEvent.click(within(host).getByTestId("pdp-add-to-bag"));
      await waitFor(() => expect(screen.queryByTestId("offer-tier-host")).toBeNull());
      expect(cartState().getItems).toHaveLength(1);

      await userEvent.click(screen.getByTestId("freebie-confirm"));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

      const freebies = getItemRows();
      expect(freebies).toHaveLength(1);
      expect(freebies[0]).toMatchObject({
        id: "free-burger",
        isGetItem: true,
        undiscounted_total_price: 10,
        discounted_total_price: discounted,
      });
      expect(freebies[0].customizations.pickle_group[0].id).toBe("pickles");
      expect(cartState().cartOffer._id).toBe("offer-free-burger-or");
      expect(cartState().getItems).toEqual([]);
    }
  );

  it.each([
    ["X", () => screen.getByTestId("freebie-close")],
    ["the backdrop", backdrop],
  ])("%s empties the held rows and commits nothing", async (_label, target) => {
    const { onClose } = renderPicker(MIXED_OFFER);
    stage(STAGED_KIDDIE);

    await userEvent.click(target());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cartState().getItems).toEqual([]);
    expect(getItemRows()).toEqual([]);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
  });

  it("two customizations of the same freebie: the NEWEST is priced and committed, never the superseded one", async () => {
    const { onClose } = renderPicker(MIXED_OFFER);
    stage(STAGED_KIDDIE); // Toy +£1
    stage({
      ...STAGED_KIDDIE,
      itemId: "kiddie-staged-2",
      total_price: 14,
      customizations: { m1: [{ id: "puzzle", name: "Puzzle", price: 2, quantity: 1 }] },
    });

    const kiddie = screen.getByTestId("freebie-option-kiddie-meal");
    expect(kiddie).toHaveTextContent(/£14£2$/);

    await userEvent.click(screen.getByTestId("freebie-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const freebies = getItemRows();
    expect(freebies).toHaveLength(1);
    expect(freebies[0].customizations.m1.map((addOn: any) => addOn.id)).toEqual(["puzzle"]);
    expect(cartState().getItems).toEqual([]);
  });

  it("a customised pick of a qty-2 grant lands BOTH units (they share the one customization)", async () => {
    const twoBurgers = {
      ...FREE_BURGER_OR_OFFER,
      _id: "offer-two-burgers",
      getItems: {
        items: [
          FREE_BURGER_OR_OFFER.getItems.items[0],
          { ...FREE_BURGER_OR_OFFER.getItems.items[1], quantity: 2 },
        ],
      },
    };
    const { onClose } = renderPicker(twoBurgers);
    stage({
      id: "free-burger",
      itemId: "burger-staged-1",
      itemType: "CUSTOMIZABLE",
      type: "CUSTOMIZABLE",
      name: "Free Burger",
      quantity: 1,
      price: 9,
      total_price: 10,
      customizations: { pickle_group: [{ id: "pickles", name: "Extra Pickles", price: 1, quantity: 1 }] },
      isGetItem: true,
    });

    await userEvent.click(screen.getByTestId("freebie-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const burgers = getItemRows().filter((row: any) => row.id === "free-burger");
    expect(burgers.reduce((units: number, row: any) => units + Number(row.quantity), 0)).toBe(2);
    expect(cartState().cartOffer._id).toBe("offer-two-burgers");
  });
});

/* ------------------------------------------------------------------ *
 * G3: a group-wise "pick N" offer — the guest picks EXACTLY getQuantity
 * units (SDK getGroupWisePickState), whatever the entries' relation.
 * ------------------------------------------------------------------ */

/** Production-shaped group-wise entry: "or", NO quantity, discount normalised by the converter. */
const gwEntry = (id: string, name: string, price: number) => ({
  _id: `gi-gw-${id}`,
  baseItemId: id,
  name,
  relation: "or",
  discountType: "percent",
  value: 100,
  quantity: null,
  entities: { ...sauceEntity(id, name), price, undiscounted_total_price: price },
});

/** "Pick 2 free sides" over FOUR configured: three plain, one customizable burger. */
const PICK_2_OFFER = {
  ...offerBase,
  _id: "offer-gw-pick-2",
  name: "Pick 2 free sides",
  getItemOnly: false,
  buygetGroupWiseOffer: true,
  isAndOffer: false,
  buygetGroupWiseOfferValues: { discountType: "percent", value: 100, getQuantity: 2, buyQuantity: 1 },
  getItems: {
    items: [
      gwEntry("greek-salad", "Greek Salad", 17),
      gwEntry("tortilla-sauce", "Tortilla Sauce", 2),
      gwEntry("caesar-dressing", "Caesar Dressing", 2),
      { ...FREE_BURGER_OR_OFFER.getItems.items[1], _id: "gi-gw-burger", quantity: null },
    ],
  },
};

/** A customised free burger as the embedded PDP holds it (base £9 + £1 pickles). */
const STAGED_FREE_BURGER = {
  id: "free-burger",
  itemId: "burger-staged-gw",
  itemType: "CUSTOMIZABLE",
  type: "CUSTOMIZABLE",
  name: "Free Burger",
  quantity: 1,
  price: 9,
  total_price: 10,
  customizations: { pickle_group: [{ id: "pickles", name: "Extra Pickles", price: 1, quantity: 1 }] },
  isGetItem: true,
};

describe("FreebiePickerSheet — group-wise pick N (G3)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
    store.dispatch(setModifiersMap({ modifiersMap: { pickle_group: PICKLE_GROUP } }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  const option = (id: string) => screen.getByTestId(`freebie-option-${id}`);
  const hint = () => screen.getByTestId("freebie-group-hint");
  /** What the bill engine grants for the cart as it stands. */
  const billDiscount = (): number => {
    const { result } = renderHook(() => useOrderHook(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <MemoryRouter>{children}</MemoryRouter>
        </Provider>
      ),
    });
    return (result.current.getCalculatedBill(cartState()) as any).getTotalDiscount();
  };

  it("pick 2 of 4 (production entries: 'or', quantity null): CONFIRM locked with a hint until exactly 2, the rest lock at 2, '−' frees a slot, and the bill grants exactly the 2 picks", async () => {
    const { onClose } = renderPicker(PICK_2_OFFER);
    const confirm = screen.getByTestId("freebie-confirm");
    expect(screen.getByText("Select 2 items to redeem with your reward.")).toBeInTheDocument();
    expect(hint()).toHaveTextContent("Select 2 more items to continue");
    expect(confirm).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(option("greek-salad"));
    expect(hint()).toHaveTextContent("Select 1 more item to continue");
    await userEvent.click(option("tortilla-sauce"));
    expect(hint()).toBeEmptyDOMElement();
    expect(confirm).toHaveAttribute("aria-disabled", "false");
    // At 2 the unpicked rows are out of play: a third pick is impossible.
    expect(option("caesar-dressing")).toBeDisabled();
    expect(option("free-burger")).toBeDisabled();

    // "−" frees a slot: swap the sauce for the dressing.
    await userEvent.click(screen.getByTestId("freebie-dec-tortilla-sauce"));
    expect(option("tortilla-sauce")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("freebie-dec-tortilla-sauce")).toBeNull();
    expect(option("caesar-dressing")).toBeEnabled();
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(option("caesar-dressing"));

    await userEvent.click(confirm);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const freebies = getItemRows();
    expect(freebies.map((row: any) => row.id).sort()).toEqual(["caesar-dressing", "greek-salad"]);
    expect(freebies.reduce((units: number, row: any) => units + Number(row.quantity), 0)).toBe(2);
    expect(freebies.every((row: any) => row.discounted_total_price === 0)).toBe(true);
    expect(cartState().cartOffer._id).toBe("offer-gw-pick-2");
    expect(billDiscount()).toBe(19);
  });

  it("the same plain freebie twice is two units ('2 x' on the row) and both land", async () => {
    const { onClose } = renderPicker(PICK_2_OFFER);
    await userEvent.click(option("tortilla-sauce"));
    await userEvent.click(option("tortilla-sauce"));
    expect(option("tortilla-sauce")).toHaveTextContent("2 x Tortilla Sauce");
    expect(option("greek-salad")).toBeDisabled();

    await userEvent.click(screen.getByTestId("freebie-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const sauces = getItemRows().filter((row: any) => row.id === "tortilla-sauce");
    expect(sauces.reduce((units: number, row: any) => units + Number(row.quantity), 0)).toBe(2);
    expect(getItemRows()).toHaveLength(sauces.length);
    expect(billDiscount()).toBe(4);
  });

  it("a customizable entry is ONE pick with its own customization (in-bag PDP): it counts 1 toward N, a re-tap re-customizes instead of adding, '−' drops it; CONFIRM lands it at redeemGetItem prices", async () => {
    const { onClose } = renderPicker(PICK_2_OFFER, true, true);
    const burger = () => option("free-burger");

    await userEvent.click(burger());
    let host = await screen.findByTestId("offer-tier-host");
    await userEvent.click(within(host).getByTestId("pdp-option-pickles"));
    await userEvent.click(within(host).getByTestId("pdp-add-to-bag"));
    await waitFor(() => expect(screen.queryByTestId("offer-tier-host")).toBeNull());
    await waitFor(
      () => expect(screen.queryByTestId("offer-tier-tap-guard")).toBeNull(),
      { timeout: 1500 }
    );
    expect(burger()).toHaveAttribute("aria-pressed", "true");
    expect(burger()).toHaveTextContent("Customized — tap to change");
    expect(hint()).toHaveTextContent("Select 1 more item to continue");

    // A re-tap re-customizes — still ONE unit; BACK keeps the held pick.
    await userEvent.click(burger());
    host = await screen.findByTestId("offer-tier-host");
    await userEvent.click(within(host).getByTestId("pdp-back"));
    await waitFor(() => expect(screen.queryByTestId("offer-tier-host")).toBeNull());
    expect(burger()).not.toHaveTextContent("2 x");
    expect(hint()).toHaveTextContent("Select 1 more item to continue");

    // "−" drops the customized pick: its held row goes.
    await waitFor(
      () => expect(screen.queryByTestId("offer-tier-tap-guard")).toBeNull(),
      { timeout: 1500 }
    );
    await userEvent.click(screen.getByTestId("freebie-dec-free-burger"));
    expect(cartState().getItems).toEqual([]);
    expect(burger()).toHaveAttribute("aria-pressed", "false");
    expect(hint()).toHaveTextContent("Select 2 more items to continue");

    stage(STAGED_FREE_BURGER);
    await userEvent.click(option("greek-salad"));
    expect(option("tortilla-sauce")).toBeDisabled();
    await userEvent.click(screen.getByTestId("freebie-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const burgers = getItemRows().filter((row: any) => row.id === "free-burger");
    expect(burgers).toHaveLength(1);
    // Base free, the £1 add-on charged (discountOnAddon off).
    expect(burgers[0]).toMatchObject({ undiscounted_total_price: 10, discounted_total_price: 1 });
    expect(burgers[0].customizations.pickle_group[0].id).toBe("pickles");
    expect(cartState().getItems).toEqual([]);
    expect(billDiscount()).toBe(26);
  });

  it("two entries sharing one base item: a customization backs ONE pick (the first entry), never both", () => {
    const [burgerEntry] = PICK_2_OFFER.getItems.items.slice(3);
    const twins = {
      ...PICK_2_OFFER,
      _id: "offer-gw-twins",
      getItems: {
        items: [burgerEntry, { ...burgerEntry, _id: "gi-gw-burger-twin" }, PICK_2_OFFER.getItems.items[0]],
      },
    };
    renderPicker(twins);
    stage(STAGED_FREE_BURGER);

    const [first, second] = screen.getAllByTestId("freebie-option-free-burger");
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");
    expect(hint()).toHaveTextContent("Select 1 more item to continue");
    expect(screen.getByTestId("freebie-confirm")).toHaveAttribute("aria-disabled", "true");
  });

  it("an unconfigured group-wise offer (no getQuantity) can never commit: rows locked, CONFIRM locked, 'can't be applied'", async () => {
    const unconfigured = {
      ...PICK_2_OFFER,
      _id: "offer-gw-unconfigured",
      buygetGroupWiseOfferValues: { ...PICK_2_OFFER.buygetGroupWiseOfferValues, getQuantity: null },
    };
    const { onClose } = renderPicker(unconfigured);
    expect(option("greek-salad")).toBeDisabled();
    expect(hint()).toHaveTextContent("This reward can't be applied to your current order");

    await userEvent.click(screen.getByTestId("freebie-confirm"));
    expect(onClose).not.toHaveBeenCalled();
    expect(getItemRows()).toEqual([]);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
  });

  it.each([
    ["null", null],
    ["0", 0],
  ])("a group-wise offer whose shared discount value is %s can't be applied: rows locked, CONFIRM locked, nothing lands at full price", async (_label, value) => {
    const zeroValue = {
      ...PICK_2_OFFER,
      _id: "offer-gw-zero-value",
      buygetGroupWiseOfferValues: { ...PICK_2_OFFER.buygetGroupWiseOfferValues, value },
    };
    const { onClose } = renderPicker(zeroValue);
    expect(hint()).toHaveTextContent("This reward can't be applied to your current order");
    expect(option("greek-salad")).toBeDisabled();
    expect(option("tortilla-sauce")).toBeDisabled();
    const confirm = screen.getByTestId("freebie-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(option("tortilla-sauce"));
    await userEvent.click(confirm);
    expect(onClose).not.toHaveBeenCalled();
    expect(getItemRows()).toEqual([]);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
  });

  it("'get 2' over ONE customizable entry can never fill (one customization per entry): 'can't be applied' up front, the row locked before any PDP, CONFIRM locked", async () => {
    const burgerEntry = PICK_2_OFFER.getItems.items[3];
    const oneCustom = { ...PICK_2_OFFER, _id: "offer-gw-one-custom", getItems: { items: [burgerEntry] } };
    const { onClose } = renderPicker(oneCustom, true, true);
    expect(hint()).toHaveTextContent("This reward can't be applied to your current order");
    expect(option("free-burger")).toBeDisabled();
    expect(option("free-burger")).not.toHaveTextContent("Customize");

    await userEvent.click(screen.getByTestId("freebie-confirm"));
    expect(onClose).not.toHaveBeenCalled();
    expect(tierSessionOpen()).toBe(false);
    expect(getItemRows()).toEqual([]);
  });

  /** Freebie units committed for `id` (production entries land one row per unit). */
  const unitsOf = (id?: string) =>
    getItemRows()
      .filter((row: any) => id === undefined || row.id === id)
      .reduce((units: number, row: any) => units + Number(row.quantity), 0);

  it("pick 3 at 50% off: '2 x' sauce + the customized burger land EXACTLY 3 units, and the bill grants half of each pick's base — £1 + £1 + £4.50, the burger's £1 add-on charged", async () => {
    // Converter-normalised entries (useOfferConverters stamps the shared
    // discount; a CUSTOMIZABLE entity gets no price stamps).
    const halfOff = (entry: any) => ({
      ...entry,
      value: 50,
      entities:
        entry.entities.type === "ITEM"
          ? { ...entry.entities, discountValue: 50, discounted_total_price: entry.entities.price / 2 }
          : { ...entry.entities, discountValue: 50 },
    });
    const pick3Half = {
      ...PICK_2_OFFER,
      _id: "offer-gw-pick-3-half",
      buygetGroupWiseOfferValues: { discountType: "percent", value: 50, getQuantity: 3, buyQuantity: 1 },
      getItems: { items: PICK_2_OFFER.getItems.items.map(halfOff) },
    };
    const { onClose } = renderPicker(pick3Half);
    expect(screen.getByText("Select 3 items to redeem with your reward.")).toBeInTheDocument();
    expect(hint()).toHaveTextContent("Select 3 more items to continue");

    await userEvent.click(option("tortilla-sauce"));
    await userEvent.click(option("tortilla-sauce"));
    expect(option("tortilla-sauce")).toHaveTextContent("2 x Tortilla Sauce");
    expect(hint()).toHaveTextContent("Select 1 more item to continue");
    expect(option("greek-salad")).toBeEnabled();

    stage(STAGED_FREE_BURGER);
    expect(hint()).toBeEmptyDOMElement();
    expect(option("greek-salad")).toBeDisabled();
    expect(option("caesar-dressing")).toBeDisabled();
    await userEvent.click(screen.getByTestId("freebie-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    expect(unitsOf("tortilla-sauce")).toBe(2);
    expect(unitsOf("free-burger")).toBe(1);
    expect(unitsOf()).toBe(3);
    expect(getItemRows().find((row: any) => row.id === "free-burger")).toMatchObject({
      undiscounted_total_price: 10,
      discounted_total_price: 5.5,
    });
    expect(cartState().cartOffer._id).toBe("offer-gw-pick-3-half");
    expect(billDiscount()).toBe(6.5);
  });

  it("a burst of taps inside ONE render (every tap reads the same picks) can over-count the row, never the grant: CONFIRM stays locked and commits nothing until '−' is back at exactly N", async () => {
    const { onClose } = renderPicker(PICK_2_OFFER);
    const confirm = screen.getByTestId("freebie-confirm");
    await userEvent.click(option("greek-salad"));

    // React batches updates inside one act(): no re-render between the taps.
    // (A real browser renders between two taps — e2e E10's double tap.)
    const sauce = option("tortilla-sauce");
    act(() => {
      sauce.click();
      sauce.click();
    });
    expect(sauce).toHaveTextContent("2 x Tortilla Sauce");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(confirm);
    expect(onClose).not.toHaveBeenCalled();
    expect(getItemRows()).toEqual([]);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);

    await userEvent.click(screen.getByTestId("freebie-dec-tortilla-sauce"));
    expect(sauce).not.toHaveTextContent("2 x");
    expect(confirm).toHaveAttribute("aria-disabled", "false");
    await userEvent.click(confirm);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(unitsOf()).toBe(2);
    expect(billDiscount()).toBe(19);
  });

  it("two sizes of ONE base (variant-id entries share entities.id) are separate picks: a tap picks only that size, never its sibling, and CONFIRM grants exactly the tapped size", async () => {
    // Mutation verifier: counting picks by the entity id let ONE tap pick
    // every size of the base (two freebies for one tap) and no test noticed.
    const sizesPick2 = {
      ...PICK_2_OFFER,
      _id: "offer-gw-fries-sizes",
      getItems: {
        items: [
          { ...fixedSizeEntry(FRIES_M), quantity: null },
          { ...fixedSizeEntry(FRIES_L), quantity: null },
          PICK_2_OFFER.getItems.items[1],
        ],
      },
    };
    const { onClose } = renderPicker(sizesPick2);
    const [medium, large] = screen.getAllByTestId("freebie-option-fries");

    await userEvent.click(large);
    expect(large).toHaveAttribute("aria-pressed", "true");
    expect(medium).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByTestId("freebie-dec-fries")).toHaveLength(1);
    expect(hint()).toHaveTextContent("Select 1 more item to continue");
    expect(screen.getByTestId("freebie-confirm")).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(option("tortilla-sauce"));
    expect(medium).toBeDisabled();
    await userEvent.click(screen.getByTestId("freebie-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const fries = getItemRows().filter((row: any) => row.id === "fries");
    expect(fries.map((row: any) => row.selectedVariant.id)).toEqual(["fries-l"]);
    expect(unitsOf()).toBe(2);
    // Large £5 + sauce £2, both free.
    expect(billDiscount()).toBe(7);
  });
});

/* ------------------------------------------------------------------ *
 * Lane offers-parity (U9, F1): get-CATEGORY groups in the picker — one
 * section per group with entities, "Any N from <group>" + "n of N added",
 * the group's own discount line. A plain entity adds a unit per tap up to
 * the need ("−" takes one back); a customizable entity is ONE unit per
 * group (its embedded-PDP row, attributed to the group the guest tapped —
 * D7); a group that can never fill says "can't be applied" up front. "Or"
 * offers complete ONE option (an item radio, or a whole group at exactly
 * its need) — a pick in one clears the others, never the active group's
 * staged rows. CONFIRM sends the item picks + the exact commit lines.
 * ------------------------------------------------------------------ */
const catPlain = (id: string, name: string, price: number) => ({
  ...sauceEntity(id, name),
  price,
  undiscounted_total_price: price,
});
const catCustom = (id: string, name: string, price: number) => ({
  id,
  name,
  price,
  modifiers: ["pickle_group"],
  hasVariant: false,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  type: "CUSTOMIZABLE",
  customizations: { pickle_group: [] },
  baseItem: { id, name, price, modifiers: ["pickle_group"] },
  baseItemPrice: price,
});
const stagedCustom = (id: string, itemId: string, total = 1) => ({
  id,
  itemId,
  itemType: "CUSTOMIZABLE",
  type: "CUSTOMIZABLE",
  name: id,
  quantity: 1,
  price: 1,
  total_price: total,
  customizations: { pickle_group: [] },
  isGetItem: true,
});

/** Sauces ×2 at 100 %: two plain sauces + a customizable BBQ sauce. */
const SAUCES_GROUP = {
  _id: "sauces",
  name: "Sauces",
  quantity: 2,
  relation: "and",
  value: 100,
  discountType: "percent",
  entities: [
    catPlain("tortilla-sauce", "Tortilla Sauce", 2),
    catPlain("caesar-dressing", "Caesar Dressing", 2),
    catCustom("bbq-sauce", "BBQ Sauce", 1),
  ],
};
const CAT_AND_OFFER = {
  ...offerBase,
  _id: "offer-cat-and",
  name: "A salad and any 2 sauces free",
  isAndOffer: true,
  getItems: { items: [{ ...AND_OFFER.getItems.items[0] }], categories: [SAUCES_GROUP] },
};
const CAT_OR_OFFER = {
  ...offerBase,
  _id: "offer-cat-or",
  name: "A salad or any 2 sauces",
  isAndOffer: false,
  getItems: {
    items: [{ ...AND_OFFER.getItems.items[0], relation: "or" }],
    categories: [{ ...SAUCES_GROUP, relation: "or" }],
  },
};

describe("FreebiePickerSheet — get-category groups (offers-parity F1)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
    store.dispatch(setModifiersMap({ modifiersMap: { pickle_group: PICKLE_GROUP } }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  const option = (entityId: string, groupId = "sauces") =>
    screen.getByTestId(`freebie-cat-option-${groupId}-${entityId}`);
  const count = (groupId = "sauces") => screen.getByTestId(`freebie-cat-count-${groupId}`);
  const confirm = () => screen.getByTestId("freebie-confirm");

  it("one section per group: 'Any 2 from Sauces' + '0 of 2 added', each row on the GROUP's discount line", () => {
    renderPicker(CAT_AND_OFFER);
    const section = screen.getByTestId("freebie-cat-sauces");
    expect(section).toHaveTextContent("Any 2 from Sauces");
    expect(count()).toHaveTextContent("0 of 2 added");
    expect(option("tortilla-sauce")).toHaveTextContent("Free");
    expect(option("tortilla-sauce")).toHaveTextContent("Tortilla Sauce");
    // The item entry still renders above the section.
    expect(screen.getByTestId("freebie-option-greek-salad")).toBeInTheDocument();
  });

  it("a plain entity: '+' adds a unit up to the need, unpicked rows lock at the need, '−' takes one back", async () => {
    renderPicker(CAT_AND_OFFER);
    await userEvent.click(option("tortilla-sauce"));
    expect(count()).toHaveTextContent("1 of 2 added");
    await userEvent.click(option("tortilla-sauce"));
    expect(count()).toHaveTextContent("2 of 2 added");
    expect(option("tortilla-sauce")).toHaveTextContent("2 x Tortilla Sauce");
    expect(option("caesar-dressing")).toBeDisabled();
    // A third unit is impossible.
    await userEvent.click(option("tortilla-sauce"));
    expect(count()).toHaveTextContent("2 of 2 added");

    await userEvent.click(screen.getByTestId("freebie-cat-dec-sauces-tortilla-sauce"));
    expect(count()).toHaveTextContent("1 of 2 added");
    expect(option("caesar-dressing")).toBeEnabled();
  });

  it("a customizable entity opens the embedded PDP; its staged row counts ONE unit for the tapped group; a re-customization replaces it", async () => {
    renderPicker(CAT_AND_OFFER);
    await userEvent.click(option("bbq-sauce"));
    expect(tierSessionOpen()).toBe(true);
    expect(count()).toHaveTextContent("0 of 2 added");

    stage(stagedCustom("bbq-sauce", "bbq-1"));
    expect(count()).toHaveTextContent("1 of 2 added");
    expect(option("bbq-sauce")).toHaveTextContent("Customized — tap to change");

    // A second customization of the same entity: still ONE unit.
    await userEvent.click(option("bbq-sauce"));
    stage(stagedCustom("bbq-sauce", "bbq-2", 2));
    expect(count()).toHaveTextContent("1 of 2 added");

    // "−" drops it (every row it holds).
    await userEvent.click(screen.getByTestId("freebie-cat-dec-sauces-bbq-sauce"));
    expect(count()).toHaveTextContent("0 of 2 added");
    expect(cartState().getItems).toEqual([]);
  });

  it("a row staged WITHOUT a group tap never counts for the group", () => {
    renderPicker(CAT_AND_OFFER);
    stage(stagedCustom("bbq-sauce", "bbq-1"));
    expect(count()).toHaveTextContent("0 of 2 added");
  });

  it("a group only customizable entities can never fill says 'can't be applied' up front, rows locked; need 0 too", () => {
    const burgersOnly = {
      ...CAT_AND_OFFER,
      _id: "offer-burgers",
      getItems: {
        items: [],
        categories: [{ ...SAUCES_GROUP, _id: "burgers", name: "Burgers", entities: [catCustom("free-burger", "Burger", 9)] }],
      },
    };
    renderPicker(burgersOnly);
    expect(screen.getByTestId("freebie-cat-na-burgers")).toHaveTextContent(
      "This reward can't be applied to your current order"
    );
    expect(option("free-burger", "burgers")).toBeDisabled();
    expect(confirm()).toHaveAttribute("aria-disabled", "true");
    cleanup();

    renderPicker({
      ...CAT_AND_OFFER,
      _id: "offer-need-0",
      getItems: { items: [], categories: [{ ...SAUCES_GROUP, quantity: 0 }] },
    });
    expect(screen.getByTestId("freebie-cat-na-sauces")).toBeInTheDocument();
    expect(option("tortilla-sauce")).toBeDisabled();
  });

  it("and-mode: CONFIRM needs every item entry AND every group at exactly its need; it lands the salad + the group's lines, stamped from the group", async () => {
    const { onClose } = renderPicker(CAT_AND_OFFER);
    expect(confirm()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(option("tortilla-sauce"));
    expect(confirm()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(option("caesar-dressing"));
    expect(confirm()).toHaveAttribute("aria-disabled", "false");

    await userEvent.click(confirm());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const rows = getItemRows();
    expect(rows.map((row: any) => row.id).sort()).toEqual(["caesar-dressing", "greek-salad", "tortilla-sauce"]);
    const sauces = rows.filter((row: any) => row.id !== "greek-salad");
    expect(sauces.every((row: any) => row.discountType === "percent" && Number(row.discountValue) === 100)).toBe(true);
    expect(sauces.every((row: any) => row.discounted_total_price === 0)).toBe(true);
    expect(cartState().cartOffer._id).toBe("offer-cat-and");
    expect(cartState().getItems).toEqual([]);
  });

  it("a category-ONLY 'and' offer (no item entries) can confirm (was: an empty picker, CONFIRM never enabled)", async () => {
    const { onClose } = renderPicker({ ...CAT_AND_OFFER, _id: "offer-cat-only", getItems: { items: [], categories: [SAUCES_GROUP] } });
    await userEvent.click(option("tortilla-sauce"));
    await userEvent.click(option("tortilla-sauce"));
    await userEvent.click(confirm());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const sauces = getItemRows().filter((row: any) => row.id === "tortilla-sauce");
    expect(sauces.reduce((units: number, row: any) => units + Number(row.quantity), 0)).toBe(2);
  });

  it("or-mode: a group pick clears the item radio, and the reverse — never wiping the ACTIVE group's staged rows", async () => {
    renderPicker(CAT_OR_OFFER);
    const salad = () => screen.getByTestId("freebie-option-greek-salad");

    await userEvent.click(salad());
    expect(salad()).toHaveAttribute("aria-pressed", "true");
    expect(confirm()).toHaveAttribute("aria-disabled", "false");

    // A group pick clears the item radio.
    await userEvent.click(option("tortilla-sauce"));
    expect(salad()).toHaveAttribute("aria-pressed", "false");
    expect(count()).toHaveTextContent("1 of 2 added");
    expect(confirm()).toHaveAttribute("aria-disabled", "true");

    // A customized group pick, then another plain unit: the staged row stays.
    await userEvent.click(option("bbq-sauce"));
    stage(stagedCustom("bbq-sauce", "bbq-1"));
    expect(count()).toHaveTextContent("2 of 2 added");
    await userEvent.click(screen.getByTestId("freebie-cat-dec-sauces-tortilla-sauce"));
    await userEvent.click(option("caesar-dressing"));
    expect(cartState().getItems.map((row: any) => row.itemId)).toEqual(["bbq-1"]);
    expect(count()).toHaveTextContent("2 of 2 added");
    expect(confirm()).toHaveAttribute("aria-disabled", "false");

    // The reverse: the item radio clears the group — its units AND its staged row.
    await userEvent.click(salad());
    expect(salad()).toHaveAttribute("aria-pressed", "true");
    expect(count()).toHaveTextContent("0 of 2 added");
    expect(cartState().getItems).toEqual([]);
  });

  it("or-mode CONFIRM sends ONE option: the completed group's lines only", async () => {
    const { onClose } = renderPicker(CAT_OR_OFFER);
    await userEvent.click(option("tortilla-sauce"));
    await userEvent.click(option("caesar-dressing"));
    await userEvent.click(confirm());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(getItemRows().map((row: any) => row.id).sort()).toEqual(["caesar-dressing", "tortilla-sauce"]);
  });

  it("X empties the staged rows and commits nothing", async () => {
    const { onClose } = renderPicker(CAT_AND_OFFER);
    await userEvent.click(option("bbq-sauce"));
    stage(stagedCustom("bbq-sauce", "bbq-1"));
    await userEvent.click(screen.getByTestId("freebie-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cartState().getItems).toEqual([]);
    expect(getItemRows()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Walk 2026-10-14 ("Testing Get After All"): the header promised a FREE
 * item over options that were all 50 % off, and "Select 1 item" above
 * "Any 2 from Chinese · 0 of 2 added". "Free" only when every option is
 * 100 % off; one shared discount is named; mixed stamps get a neutral
 * title (each row names its own). "Select N" is the count CONFIRM needs.
 * ------------------------------------------------------------------ */
describe("FreebiePickerSheet — the header names the discount and the picks it needs", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: { pickle_group: PICKLE_GROUP } }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  /** "Any 2 from Chinese" at `value` % off — the walk's category-only "or" offer. */
  const chinese = (value: number) => ({
    _id: "chinese",
    name: "Chinese",
    quantity: 2,
    relation: "or",
    value,
    discountType: "percent",
    entities: [
      { ...catPlain("chilli", "Chilli Manchurian", 20), discountValue: value, discounted_total_price: 20 - (20 * value) / 100 },
      { ...catPlain("noodles", "Noodles", 5), discountValue: value, discounted_total_price: 5 - (5 * value) / 100 },
    ],
  });
  const getAfterAll = (value: number) => ({
    ...offerBase,
    _id: `offer-get-after-all-${value}`,
    name: "Testing Get After All",
    isAndOffer: false,
    getItems: { items: [], categories: [chinese(value)] },
  });
  const title = () => screen.getByRole("dialog").querySelector("#freebie-picker-title");

  it("all options 50 % off, a group of 2: 'Choose Your 50% off Item' + 'Select 2 items…' — the header never says free", () => {
    renderPicker(getAfterAll(50));
    expect(screen.getByRole("dialog", { name: "Choose Your 50% off Item" })).toBeInTheDocument();
    expect(screen.getByText("Select 2 items to redeem with your reward.")).toBeInTheDocument();
    expect(screen.getByTestId("freebie-cat-count-chinese")).toHaveTextContent("0 of 2 added");
    expect(title()).not.toHaveTextContent(/free/i);
    expect(screen.queryByText("Select 1 item to redeem with your reward.")).toBeNull();
  });

  it("1 %-off picks name 1 % — never the FREE ITEM header", () => {
    renderPicker(getAfterAll(1));
    expect(screen.getByRole("dialog", { name: "Choose Your 1% off Item" })).toBeInTheDocument();
  });

  it("an amount off is named in the deployment's currency", () => {
    const fiveOff = { ...orEntry("tortilla-sauce", "Tortilla Sauce"), discountType: "amount", value: 5 };
    renderPicker({ ...CHOICE_OFFER, _id: "offer-five-off", getItems: { items: [fiveOff] } });
    // posistKiosk's OfferItem pickerAmountOff: moduloCalcaledValue — "£5", never "£5.00".
    expect(screen.getByRole("dialog", { name: "Choose Your £5 off Item" })).toBeInTheDocument();
  });

  it("mixed stamps (a 50 % item + a 1 % group): the neutral 'Choose Your Reward' — each row names its own", () => {
    const mixed = {
      ...CAT_AND_OFFER,
      _id: "offer-mixed-stamps",
      getItems: {
        items: [{ ...AND_OFFER.getItems.items[0], value: 50 }],
        categories: [{ ...SAUCES_GROUP, value: 1 }],
      },
    };
    renderPicker(mixed);
    expect(screen.getByRole("dialog", { name: "Choose Your Reward" })).toBeInTheDocument();
    expect(screen.getByTestId("freebie-option-greek-salad")).toHaveTextContent("50% off");
    expect(screen.getByTestId("freebie-cat-option-sauces-tortilla-sauce")).toHaveTextContent("1% off");
    // "and": the salad comes with the reward; the sauces group needs 2 picks.
    expect(screen.getByText("Select 2 items to redeem with your reward.")).toBeInTheDocument();
    cleanup();

    // One free option is not enough: a free sauce OR a half-price burger.
    renderPicker(HALF_BURGER_OFFER);
    expect(screen.getByRole("dialog", { name: "Choose Your Reward" })).toBeInTheDocument();
    expect(screen.getByText("Select 1 item to redeem with your reward.")).toBeInTheDocument();
  });

  it("every option 100 % off keeps 'Choose Your Free Item'", () => {
    renderPicker(CAT_OR_OFFER);
    expect(screen.getByRole("dialog", { name: "Choose Your Free Item" })).toBeInTheDocument();
  });

  // Review of the walk fixes: "And Offer With Varaint" (a fixed item AND any
  // 2 from a group) read "These items come with your reward." while CONFIRM
  // waited for 2 picks. An "and" offer asks for every group's need.
  it("'and' with a group: 'Select 2 items…' — CONFIRM waits for exactly those 2 picks; a second group adds its need", async () => {
    renderPicker(CAT_AND_OFFER);
    expect(screen.getByText("Select 2 items to redeem with your reward.")).toBeInTheDocument();
    expect(screen.queryByText("These items come with your reward.")).toBeNull();
    const confirm = screen.getByTestId("freebie-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByTestId("freebie-cat-option-sauces-tortilla-sauce"));
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByTestId("freebie-cat-option-sauces-tortilla-sauce"));
    expect(confirm).toHaveAttribute("aria-disabled", "false");
    cleanup();

    const sides = { ...SAUCES_GROUP, _id: "sides", name: "Sides", quantity: 1 };
    renderPicker({ ...CAT_AND_OFFER, _id: "offer-two-groups", getItems: { ...CAT_AND_OFFER.getItems, categories: [SAUCES_GROUP, sides] } });
    expect(screen.getByText("Select 3 items to redeem with your reward.")).toBeInTheDocument();
  });

  it("'and' without a group keeps 'These items come with your reward.'; Arabic names the group's 2", async () => {
    renderPicker(AND_OFFER);
    expect(screen.getByText("These items come with your reward.")).toBeInTheDocument();
    cleanup();

    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderPicker(CAT_AND_OFFER);
    const subtitle = screen.getByText((_, el) => el?.textContent === i18n.t("offers.picker.groupSubtitle", { count: 2 }));
    expect(subtitle.textContent).toMatch(/\p{Script=Arabic}/u);
    expect(screen.queryByText(i18n.t("offers.freebieSubtitleAnd"))).toBeNull();
  });

  it("'or' options needing different counts (an item = 1, a group of 2): 'Choose one option…', never 'Select 1 item'", () => {
    renderPicker(CAT_OR_OFFER);
    expect(screen.getByText("Choose one option to redeem with your reward.")).toBeInTheDocument();
    expect(screen.queryByText("Select 1 item to redeem with your reward.")).toBeNull();
  });

  it("Arabic: the discount title and the plural 'Select N' resolve in Arabic", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderPicker(getAfterAll(50));
    const heading = title() as HTMLElement;
    expect(heading).toHaveTextContent(
      i18n.t("offers.freebieTitleDiscount", { discount: i18n.t("offers.percentOff", { value: 50 }) })
    );
    expect(heading.textContent).toMatch(/\p{Script=Arabic}/u);
    const subtitle = screen.getByText((_, el) => el?.textContent === i18n.t("offers.picker.groupSubtitle", { count: 2 }));
    expect(subtitle.textContent).toMatch(/\p{Script=Arabic}/u);
    expect(subtitle.textContent).not.toBe(i18n.t("offers.picker.groupSubtitle", { count: 1 }));
  });

  // Walk 2026-10-14: "2 X Chilli Manchurian £20.00 → £19.80" — a unit price
  // beside a two-unit label. A row prices the units it names, like the bag.
  it("a two-unit grant prices both units: '2 x Chilli Manchurian' £40.00 → £39.60", () => {
    const chilli = {
      ...orEntry("chilli", "Chilli Manchurian"),
      discountType: "percent",
      value: 1,
      quantity: 2,
      entities: {
        ...sauceEntity("chilli", "Chilli Manchurian"),
        price: 20,
        discountValue: 1,
        undiscounted_total_price: 20,
        discounted_total_price: 19.8,
      },
    };
    renderPicker({ ...CHOICE_OFFER, _id: "offer-two-chilli", getItems: { items: [chilli] } });
    const row = screen.getByTestId("freebie-option-chilli");
    expect(row).toHaveTextContent("2 x Chilli Manchurian");
    expect(row).toHaveTextContent(/£40£39\.60$/);
    expect(row).not.toHaveTextContent(/£20(?![\d.])/);
    expect(row).not.toHaveTextContent("£19.80");
  });

  it("a category pick prices the units picked; an unpicked row shows one unit", async () => {
    renderPicker(getAfterAll(50));
    const chilli = () => screen.getByTestId("freebie-cat-option-chinese-chilli");
    expect(chilli()).toHaveTextContent(/£20£10$/);
    await userEvent.click(chilli());
    await userEvent.click(chilli());
    expect(chilli()).toHaveTextContent("2 x Chilli Manchurian");
    expect(chilli()).toHaveTextContent(/£40£20$/);
    expect(chilli()).not.toHaveTextContent(/£10(?![\d.])/);
    expect(screen.getByTestId("freebie-cat-option-chinese-noodles")).toHaveTextContent(/£5£2\.50$/);
  });
});

/* ------------------------------------------------------------------ *
 * Lane free-label: a row CONFIRM charges nothing for reads "Free" under
 * its struck price, never "£0" — posistKiosk's OfferItem price line
 * (effectivePrice <= 0 → offer.badgeFree), item and category tiles alike.
 * A row that still charges something (a paid add-on, a partial discount)
 * keeps its figure — the cases above.
 * ------------------------------------------------------------------ */
describe("FreebiePickerSheet — a row CONFIRM charges nothing for reads Free", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("an item row and a category row at 100 % off: the struck price, then Free", () => {
    renderPicker(CAT_AND_OFFER);
    expect(screen.getByTestId("freebie-option-greek-salad")).toHaveTextContent(/£17Free$/);
    expect(screen.getByTestId("freebie-cat-option-sauces-tortilla-sauce")).toHaveTextContent(/£2Free$/);
  });

  it("an amount off that covers the whole price is free too", () => {
    const fiveOff = { ...orEntry("tortilla-sauce", "Tortilla Sauce"), discountType: "amount", value: 5 };
    renderPicker({ ...CHOICE_OFFER, _id: "offer-five-off", getItems: { items: [fiveOff] } });
    expect(screen.getByTestId("freebie-option-tortilla-sauce")).toHaveTextContent(/£5 off£2Free$/);
  });

  it("Arabic: the price line reads the Arabic word", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderPicker(CHOICE_OFFER);
    const free = i18n.t("offers.free");
    expect(free).toMatch(/\p{Script=Arabic}/u);
    expect(screen.getByTestId("freebie-option-tortilla-sauce")).toHaveTextContent(new RegExp(`£2${free}$`));
  });
});
