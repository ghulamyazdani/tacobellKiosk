/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offer and cart-row fixtures mirror the untyped SDK cart slice / converter
 * output; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems, applyOffer } from "@cx-sdk/ordering/state/cart.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import { selectAddToCartModal } from "../../../redux/features/menuSelections/menuSelections.slice";
import RewardsSheet from "../RewardsSheet";
import "../../../i18n";

/** offers-parity U4: the real describer, unless a test makes it throw (D10). */
const describer = vi.hoisted(() => ({ throwing: false }));
vi.mock("../../../hooks/offerHooks/useOfferDescription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/offerHooks/useOfferDescription")>();
  return {
    ...actual,
    default: () => {
      const real = actual.default();
      return describer.throwing
        ? () => {
            throw new Error("describer exploded");
          }
        : real;
    },
  };
});

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
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("renders nothing while closed", () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER]));
    renderSheet(false);
    expect(screen.queryByTestId("rewards-sheet")).not.toBeInTheDocument();
  });

  it("motion D-M3: the panel rises (tb-sheet-enter), the scrim never animates, no inline keyframes remain", () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER]));
    renderSheet();
    const sheet = screen.getByTestId("rewards-sheet");
    const [scrim, panel] = Array.from(sheet.children);
    expect(scrim.tagName).toBe("BUTTON");
    expect(scrim).not.toHaveAttribute("style");
    expect(scrim.className).not.toMatch(/(^|\s)(tb-|animate-)/);
    expect(panel).toBe(screen.getByRole("dialog"));
    expect(panel).toHaveClass("tb-sheet-enter");
    expect(panel).not.toHaveAttribute("style");
    expect(sheet.querySelector("style")).toBeNull();
  });

  it("open: eligible row gets a radio, locked row gets the pink minBill nudge (no radio), gone row is struck", () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER, PERCENT_OFFER, GONE_OFFER]));
    renderSheet();
    expect(screen.getByTestId("rewards-sheet")).toBeInTheDocument();

    // Eligible: radio, save copy (offers-parity D8: the text is the row body's).
    const flat = screen.getByTestId("offer-row-body-offer-flat-2");
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
    expect(screen.getByTestId("offer-row-body-offer-flat-2")).toHaveTextContent("Applied");

    await userEvent.click(screen.getByTestId("rewards-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // No re-commit: the slot still holds the same offer.
    expect(cartState().cartOffer._id).toBe("offer-flat-2");
  });

  // Review of the walk fixes: the bag read "Save £5.40" while the reopened
  // sheet's APPLIED row read "Save up to £6.20" (the rank-time ceiling). The
  // applied row restates what the bag applies.
  it("the APPLIED row reads the bag's figure (appliedSaving), never the rank-time 'up to'; other rows keep theirs", () => {
    const SALAD_OR_SAUCE = {
      ...CHOICE_OFFER,
      _id: "offer-salad-or-sauce",
      name: "A salad or a sauce",
      getItems: {
        items: [
          CHOICE_OFFER.getItems.items[0],
          {
            ...CHOICE_OFFER.getItems.items[1],
            _id: "gi-salad",
            baseItemId: "greek-salad",
            name: "Greek Salad",
            entities: { ...sauceEntity("greek-salad", "Greek Salad"), price: 17, undiscounted_total_price: 17 },
          },
        ],
      },
    };
    const FLAT_3 = { ...FLAT_OFFER, _id: "offer-flat-3", name: "£3 off your order", type: { name: "amount", value: 3 } };
    store.dispatch(setFilteredOffers([SALAD_OR_SAUCE, FLAT_3]));
    store.dispatch(applyOffer({ offer: SALAD_OR_SAUCE }));
    const sheet = (appliedSaving?: number) =>
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={["/cart"]}>
            <RewardsSheet open onClose={vi.fn()} appliedSaving={appliedSaving} />
          </MemoryRouter>
        </Provider>
      );

    const { unmount } = sheet();
    expect(screen.getByTestId("offer-row-body-offer-salad-or-sauce")).toHaveTextContent("Save up to £17.00");
    unmount();

    sheet(2);
    const applied = screen.getByTestId("offer-row-body-offer-salad-or-sauce");
    expect(applied).toHaveTextContent("Applied");
    expect(applied).toHaveTextContent("Save £2.00");
    expect(applied).not.toHaveTextContent("up to");
    expect(screen.getByTestId("offer-row-body-offer-flat-3")).toHaveTextContent("Save £3.00");
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

  it("a SAVE that resolves after the sheet unmounted (idle reset / bag close) hands nothing to the page", async () => {
    store.dispatch(setFilteredOffers([CHOICE_OFFER]));
    const { onClose, onNeedsPicker, unmount } = renderSheet();
    await userEvent.click(screen.getByTestId("offer-row-offer-free-sauce-choice"));

    // Synchronous tap: the commit's continuation is still queued when the
    // sheet goes away.
    fireEvent.click(screen.getByTestId("rewards-save"));
    unmount();
    await act(async () => {});

    expect(onNeedsPicker).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ADA (P9c): capped by its containing block with the X and SAVE outside the scroller", () => {
    store.dispatch(setFilteredOffers([FLAT_OFFER]));
    renderSheet();
    const close = screen.getByTestId("rewards-close");

    expect(
      close.closest('[class*="h-[min(1480px,calc(100%_-_96px))]"]')
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

/* ------------------------------------------------------------------ *
 * Lane "offers": ADD ITEMS hand-off (item 31) and the sameOrLess SAVE
 * verdicts (31b) — through the REAL apply core.
 * ------------------------------------------------------------------ */

const SAUCE_ENTITY = {
  id: "tortilla-sauce",
  name: "Tortilla Sauce",
  price: 2,
  subCategoryId: "sauces",
  modifiers: [] as any[],
  hasVariant: false,
};

/** Paid Tortilla Sauce (£2) — the buy side of the sameOrLess offers. */
const SAUCE_ROW = {
  ...SAUCE_ENTITY,
  itemId: "ts-1",
  uniqueItemId: "ts-1",
  quantity: 1,
  type: "ITEM",
  total_price: 2,
  customizations: {},
};

const getEntry = (id: string, name: string, relation: string, price: number) => ({
  _id: `gi-${id}`,
  baseItemId: id,
  name,
  relation,
  discountType: "percent",
  value: 100,
  quantity: 1,
  entities: { ...sauceEntity(id, name), price, undiscounted_total_price: price },
});

const buyRaw = (baseItemId: string, quantity: number, relation = "and") => ({
  ...offerBase.applicable,
  rawItems: [{ item: { baseItemId, name: "Tortilla Sauce" }, quantity, relation }],
});

/** Buy 2 sauces (cart has none) → locked bogoBuySide with a resolvable view. */
const BOGO_OFFER = {
  ...offerBase,
  _id: "offer-bogo",
  name: "Buy 2 sauces get a Caesar free",
  type: { name: "item", value: 0 },
  applicable: buyRaw("tortilla-sauce", 2),
  getItems: { items: [getEntry("caesar-dressing", "Caesar Dressing", "and", 2)], categories: [] },
};

/** sameOrLess, buy one £2 sauce: "and" grant with a £17 salad → blocked. */
const SOL_AND_OFFER = {
  ...BOGO_OFFER,
  _id: "offer-sol-and",
  name: "Buy a sauce, get a salad and a dressing",
  sameOrLess: true,
  applicable: buyRaw("tortilla-sauce", 1),
  getItems: {
    items: [
      getEntry("greek-salad", "Greek Salad", "and", 17),
      getEntry("caesar-dressing", "Caesar Dressing", "and", 2),
    ],
    categories: [],
  },
};

/** sameOrLess "or": the £17 salad is filtered out, the £2 Caesar survives. */
const SOL_OR_OFFER = {
  ...SOL_AND_OFFER,
  _id: "offer-sol-or",
  name: "Buy a sauce, pick a side",
  isAndOffer: false,
  getItems: {
    items: [
      getEntry("greek-salad", "Greek Salad", "or", 17),
      getEntry("caesar-dressing", "Caesar Dressing", "or", 2),
    ],
    categories: [],
  },
};

const renderWithAddItems = (onAddItems?: (...args: any[]) => void) => {
  const onClose = vi.fn();
  const onNeedsPicker = vi.fn();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <RewardsSheet
          open
          onClose={onClose}
          onNeedsPicker={onNeedsPicker}
          onAddItems={onAddItems}
        />
      </MemoryRouter>
    </Provider>
  );
  return { onClose, onNeedsPicker };
};

describe("RewardsSheet — lane offers (ADD ITEMS, sameOrLess verdicts)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setEntityMap({ entityMap: { [SAUCE_ENTITY.id]: SAUCE_ENTITY } }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("ADD ITEMS on a resolvable locked bogoBuySide row calls onAddItems(offer, view) and THEN onClose", async () => {
    store.dispatch(setFilteredOffers([BOGO_OFFER, PERCENT_OFFER, GONE_OFFER]));
    const order: string[] = [];
    const onAddItems = vi.fn(() => order.push("addItems"));
    const { onClose } = renderWithAddItems(onAddItems);
    onClose.mockImplementation(() => order.push("close"));

    await userEvent.click(screen.getByTestId("offer-row-add-items-offer-bogo"));

    expect(order).toEqual(["addItems", "close"]);
    const [offer, view] = onAddItems.mock.calls[0] as unknown as [any, any];
    expect(offer._id).toBe("offer-bogo");
    expect(view.mode).toBe("plain-and");
    expect(view.groups.map((group: any) => group.key)).toEqual(["tortilla-sauce"]);
    // The minBill and gone rows are untouched by the hand-off.
    expect(screen.queryByTestId("offer-row-add-items-offer-percent-25")).not.toBeInTheDocument();
    expect(screen.getByTestId("offer-row-nudge-offer-percent-25")).toHaveTextContent(
      "Add £16.40+ to your order to be eligible to redeem this reward"
    );
    expect(screen.queryByTestId("offer-row-add-items-offer-gone")).not.toBeInTheDocument();
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
  });

  it.each([
    [
      "group-wise (the picker cannot cap 'pick N')",
      {
        ...BOGO_OFFER,
        _id: "offer-gw",
        buygetGroupWiseOffer: true,
        buygetGroupWiseOfferValues: { discountType: "percent", value: "100", getQuantity: 1, buyQuantity: 2 },
      },
    ],
    [
      "an unresolvable buy item (absent from the menu)",
      { ...BOGO_OFFER, _id: "offer-ghost", applicable: buyRaw("not-on-menu", 1) },
    ],
  ])("no ADD ITEMS for %s — the row stays inert", (_label, offer) => {
    store.dispatch(setFilteredOffers([offer]));
    renderWithAddItems(vi.fn());
    // Still a locked bogoBuySide row — only the buy stage is withheld.
    expect(screen.getByTestId(`offer-row-${offer._id}`)).toHaveTextContent(
      "Add the qualifying items to unlock this reward"
    );
    expect(screen.queryByTestId(`offer-row-add-items-${offer._id}`)).not.toBeInTheDocument();
  });

  it("no onAddItems prop → no ADD ITEMS at all", () => {
    store.dispatch(setFilteredOffers([BOGO_OFFER]));
    renderSheet();
    expect(screen.getByTestId("offer-row-offer-bogo")).toBeInTheDocument();
    expect(screen.queryByTestId("offer-row-add-items-offer-bogo")).not.toBeInTheDocument();
  });

  it("a sameOrLess-BLOCKED SAVE keeps the sheet open with the inline not-applicable line; the next pick clears it", async () => {
    store.dispatch(setCartItems([{ ...SAUCE_ROW }]));
    store.dispatch(setFilteredOffers([SOL_AND_OFFER, FLAT_OFFER]));
    const { onClose, onNeedsPicker } = renderSheet();
    const line = screen.getByTestId("rewards-not-applicable");
    expect(line).toHaveAttribute("role", "status");
    expect(line).toBeEmptyDOMElement(); // mounted before its text

    await userEvent.click(screen.getByTestId("offer-row-offer-sol-and"));
    await userEvent.click(screen.getByTestId("rewards-save"));

    await waitFor(() =>
      expect(line).toHaveTextContent("This reward can't be applied to your current order")
    );
    expect(screen.getByTestId("rewards-sheet")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onNeedsPicker).not.toHaveBeenCalled();
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(screen.getByTestId("rewards-save")).toBeEnabled();

    await userEvent.click(screen.getByTestId("offer-row-offer-flat-2"));
    expect(line).toBeEmptyDOMElement();
  });

  it("onNeedsPicker receives the ceiling-FILTERED offer (result.offer), never the original", async () => {
    store.dispatch(setCartItems([{ ...SAUCE_ROW }]));
    store.dispatch(setFilteredOffers([SOL_OR_OFFER]));
    const { onClose, onNeedsPicker } = renderSheet();

    await userEvent.click(screen.getByTestId("offer-row-offer-sol-or"));
    await userEvent.click(screen.getByTestId("rewards-save"));

    await waitFor(() => expect(onNeedsPicker).toHaveBeenCalledTimes(1));
    const handed = onNeedsPicker.mock.calls[0][0];
    expect(handed._id).toBe("offer-sol-or");
    expect(handed.getItems.items.map((entry: any) => entry.baseItemId)).toEqual(["caesar-dressing"]);
    const original = (store.getState() as any).offer.filteredOffers[0];
    expect(handed).not.toBe(original);
    expect(original.getItems.items).toHaveLength(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ *
 * Lane offers-parity (U4): ADD ITEMS for get-category BOGOs (F1) and on a
 * min-items lock while the buy side is unmet (F2 / D4); offers that can
 * never unlock on this menu are hidden, a sold-out buy side is a gone row
 * (F4); every row gets its description (F3), and a describer that throws
 * never blanks the sheet (D10).
 * ------------------------------------------------------------------ */
describe("RewardsSheet — offers-parity", () => {
  beforeEach(() => {
    describer.throwing = false;
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setEntityMap({ entityMap: { [SAUCE_ENTITY.id]: SAUCE_ENTITY } }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  const GET_CATEGORY_BOGO = {
    ...BOGO_OFFER,
    _id: "offer-get-cat",
    name: "Buy 2 sauces get any side",
    getItems: {
      items: [],
      categories: [
        {
          _id: "sides",
          name: "Sides",
          quantity: 1,
          relation: "and",
          discountType: "percent",
          value: 100,
          entities: [{ id: "x", name: "Side X", price: 2, type: "ITEM" }],
        },
      ],
    },
  };

  /** Least-value: any 2 sauces, the cheapest free — with an item minimum. */
  const leastWithMin = (minItemCount: number) => ({
    ...offerBase,
    _id: "offer-least-min",
    name: "Get least priced item free",
    type: { name: "item", value: 0 },
    getLeastValueItem: true,
    minItemCount,
    leastItemValueCount: { buyQuantity: 2, getQuantity: 1, getDiscount: 100 },
    applicable: {
      ...offerBase.applicable,
      rawItems: [{ item: { baseItemId: SAUCE_ENTITY.id, name: "Tortilla Sauce" }, quantity: 1, relation: "or" }],
    },
    getItems: { items: [], categories: [] },
  });

  it("F1 (flipped): a get-category BOGO's locked row offers ADD ITEMS and hands the stage over", async () => {
    store.dispatch(setFilteredOffers([GET_CATEGORY_BOGO]));
    const onAddItems = vi.fn();
    renderWithAddItems(onAddItems);
    await userEvent.click(screen.getByTestId("offer-row-add-items-offer-get-cat"));
    expect(onAddItems).toHaveBeenCalledTimes(1);
    expect((onAddItems.mock.calls[0] as unknown as [any, any])[1].mode).toBe("plain-and");
  });

  it("D4: a least-value minItems lock with the buy side UNMET → nudge AND ADD ITEMS", () => {
    store.dispatch(setFilteredOffers([leastWithMin(3)]));
    renderWithAddItems(vi.fn());
    expect(screen.getByTestId("offer-row-nudge-offer-least-min")).toHaveTextContent(
      "Add 2 more items to your order to be eligible to redeem this reward"
    );
    expect(screen.getByTestId("offer-row-add-items-offer-least-min")).toBeInTheDocument();
  });

  it("D4: the same lock with the buy side MET → the nudge only (a stage could only add more buy items)", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...SAUCE_ROW, quantity: 2 }]));
    store.dispatch(setFilteredOffers([leastWithMin(5)]));
    renderWithAddItems(vi.fn());
    expect(screen.getByTestId("offer-row-nudge-offer-least-min")).toHaveTextContent(
      "Add 2 more items to your order to be eligible to redeem this reward"
    );
    expect(screen.queryByTestId("offer-row-add-items-offer-least-min")).toBeNull();
  });

  it("a minItems lock on a bill-wise offer → no ADD ITEMS (no stage resolves)", () => {
    store.dispatch(setFilteredOffers([{ ...FLAT_OFFER, _id: "offer-flat-min", minItemCount: 5 }]));
    renderWithAddItems(vi.fn());
    expect(screen.getByTestId("offer-row-nudge-offer-flat-min")).toBeInTheDocument();
    expect(screen.queryByTestId("offer-row-add-items-offer-flat-min")).toBeNull();
  });

  it("group-wise still never offers ADD ITEMS", () => {
    store.dispatch(
      setFilteredOffers([
        {
          ...GET_CATEGORY_BOGO,
          _id: "offer-gw-cat",
          buygetGroupWiseOffer: true,
          buygetGroupWiseOfferValues: { discountType: "percent", value: "100", getQuantity: 1, buyQuantity: 2 },
        },
      ])
    );
    renderWithAddItems(vi.fn());
    expect(screen.getByTestId("offer-row-offer-gw-cat")).toBeInTheDocument();
    expect(screen.queryByTestId("offer-row-add-items-offer-gw-cat")).toBeNull();
  });

  const stampedBuy = (id: string, baseItemId: string) => ({
    ...BOGO_OFFER,
    _id: id,
    name: `Buy ${baseItemId}`,
    applicable: {
      ...offerBase.applicable,
      rawItems: [{ item: { baseItemId, name: baseItemId }, quantity: 1, relation: "and", isRawItemAvailable: false }],
    },
  });

  it("F4: a stamped dead buy item absent from the menu → not listed at all", () => {
    store.dispatch(setFilteredOffers([stampedBuy("offer-never", "not-on-menu"), FLAT_OFFER]));
    renderSheet();
    expect(screen.queryByTestId("offer-row-offer-never")).toBeNull();
    expect(screen.queryByTestId("offer-row-body-offer-never")).toBeNull();
    expect(screen.getByTestId("offer-row-offer-flat-2")).toBeInTheDocument();
  });

  it("F4: the same item on the menu but sold out → a struck 'Not available right now' row with NO description", () => {
    store.dispatch(
      setEntityMap({
        entityMap: {
          [SAUCE_ENTITY.id]: SAUCE_ENTITY,
          "sold-out-sauce": { ...SAUCE_ENTITY, id: "sold-out-sauce", name: "Sold Out Sauce", outOfStock: true },
        },
      })
    );
    store.dispatch(setFilteredOffers([stampedBuy("offer-sold-out", "sold-out-sauce")]));
    renderSheet();
    const row = screen.getByTestId("offer-row-offer-sold-out");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveTextContent("Not available right now");
    expect(within(row).getByText("Buy sold-out-sauce")).toHaveClass("line-through");
    expect(screen.queryByTestId("offer-row-desc-offer-sold-out")).toBeNull();
    expect(screen.queryByTestId("offer-row-add-items-offer-sold-out")).toBeNull();
  });

  it("F3: the composed description reaches the row", () => {
    store.dispatch(setFilteredOffers([BOGO_OFFER]));
    renderWithAddItems(vi.fn());
    expect(screen.getByTestId("offer-row-desc-offer-bogo")).toHaveTextContent(
      "Buy 2 Tortilla Sauce & get 1 Caesar Dressing for free"
    );
  });

  it("D10: a describer that throws never blanks the sheet — the rows render on their mechanic copy", () => {
    describer.throwing = true;
    store.dispatch(setFilteredOffers([BOGO_OFFER, FLAT_OFFER]));
    renderWithAddItems(vi.fn());
    expect(screen.getByTestId("rewards-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("offer-row-offer-bogo")).toHaveTextContent("Add the qualifying items to unlock this reward");
    expect(screen.getByTestId("offer-row-body-offer-flat-2")).toHaveTextContent("Save £2.00");
  });
});

/* ------------------------------------------------------------------ *
 * A Suggested rail add lands IN the bag, under the open sheet: the bag's row
 * and the moving nudge confirm it. Every menu add opens the product-added
 * modal now (user 2026-10-14), so suppressAddedModal is all that keeps a rail
 * tap from opening it under the bag (the tap guard armed over it, a stale
 * modal on /menu after). The pool is not filtered by the cart, so a tap can
 * bump a row as well as punch one.
 * ------------------------------------------------------------------ */
describe("RewardsSheet — a Suggested rail add never opens the product-added modal", () => {
  /** Plain (the one-tap add intent) and flagged: the rail's pool. */
  const SALAD = { id: "greek-salad", name: "Greek Salad", price: 17, isActive: true, isCartRecommended: true };
  /** Locked by its minimum with or without a salad in the bag, so the rail stays up. */
  const MIN_100 = { ...PERCENT_OFFER, _id: "offer-min-100", name: "25% off over £100", minBillAmount: 100 };
  const salads = () => cartState().cartItems.filter((row: { id?: string }) => row?.id === SALAD.id);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setEntityMap({ entityMap: { [SALAD.id]: SALAD } }));
    store.dispatch(setFilteredOffers([MIN_100]));
  });

  it("a new row: the salad lands and the modal stays shut", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    renderSheet();
    fireEvent.click(screen.getByTestId(`offer-suggested-item-${SALAD.id}`));

    expect(salads()).toEqual([expect.objectContaining({ quantity: 1 })]);
    expect(selectAddToCartModal(store.getState())).toBe(false);
  });

  it("+1 on the salad already in the bag: its row bumps to 2 and the modal stays shut", () => {
    const saladRow = { ...SALAD, itemId: "gs-1", uniqueItemId: "gs-1", quantity: 1, type: "ITEM", total_price: 17 };
    store.dispatch(setCartItems([{ ...BURGER_ROW }, saladRow]));
    renderSheet();
    fireEvent.click(screen.getByTestId(`offer-suggested-item-${SALAD.id}`));

    expect(salads()).toEqual([expect.objectContaining({ itemId: "gs-1", quantity: 2 })]);
    expect(selectAddToCartModal(store.getState())).toBe(false);
  });
});
