/**
 * BagSheet — lane "offers" additions, on the REAL store and apply core:
 * revalidation check 7 (sameOrLess), the applied-row pop (AppliedRowPop +
 * the module spent key), the "Applied for you" caption, and auto-apply
 * (useOfferAutoApply: operator-flagged, cart-neutral, never over a customer
 * choice, never while a sheet / picker / buy stage / removal notice is up).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  applyOffer,
  openOfferRemovalModal,
  setCartInstructions,
  setCartItems,
} from "@cx-sdk/ordering/state/cart.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import {
  setCurrency,
  setDeploymentInfo,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import {
  markOfferAutoApplied,
  resetOfferSession,
} from "../../../redux/features/offerSession/offerSession.slice";
import { resetAppliedBarCelebration } from "../../../utils/offerCelebration";
import BagSheet from "../BagSheet";
import "../../../i18n";

type Row = { id?: string; itemId?: string; isGetItem?: boolean; [key: string]: unknown };

/** Paid CUSTOMIZABLE row, £8.60 line (P7a fixture parity). */
const BURGER_ROW: Row = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 8.6,
  customizations: { sauce_group: [{ id: "onions", name: "Add Onions", price: 0.6, quantity: 1 }] },
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8, modifiers: ["sauce_group"] },
};
const drinkRow = (quantity: number): Row => ({
  id: "pepsi",
  itemId: "pep-1",
  uniqueItemId: "pep-1-u",
  name: "Pepsi",
  quantity,
  type: "ITEM",
  price: 3,
  total_price: 3,
  customizations: {},
});
const SAUCE = {
  id: "tortilla-sauce",
  name: "Tortilla Sauce",
  price: 2,
  subCategoryId: "sauces",
  modifiers: [] as string[],
  hasVariant: false,
};
const SAUCE_ROW: Row = {
  ...SAUCE,
  itemId: "ts-1",
  uniqueItemId: "ts-1",
  quantity: 1,
  type: "ITEM",
  total_price: 2,
  customizations: {},
};
const freebieRow = (id: string, name: string, price: number): Row => ({
  id,
  itemId: `${id}-free`,
  uniqueItemId: `${id}-free`,
  name,
  quantity: 1,
  type: "ITEM",
  price,
  total_price: price,
  undiscounted_total_price: price,
  discounted_total_price: 0,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  customizations: {},
});

const entity = (id: string, name: string, price: number) => ({
  id,
  name,
  price,
  modifiers: [] as string[],
  hasVariant: false,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  type: "ITEM",
  discounted_total_price: 0,
  undiscounted_total_price: price,
});
const getEntry = (id: string, name: string, relation: string, price: number) => ({
  _id: `gi-${id}`,
  baseItemId: id,
  name,
  relation,
  discountType: "percent",
  value: 100,
  quantity: 1,
  entities: entity(id, name, price),
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
    categories: [] as unknown[],
    items: [] as unknown[],
    isExclude: false,
    isInclude: false,
    rawItems: [] as unknown[],
  },
  getItems: {},
};
const flat = (id: string, value: number, extra: object = {}) => ({
  ...offerBase,
  _id: id,
  name: `£${value} off your order`,
  type: { name: "amount", value },
  ...extra,
});

/** Operator-flagged (payload autoApplied:true) — the default scope picks these. */
const AUTO_FLAT = flat("auto-flat-2", 2, { autoApplied: true });
/** Unflagged: the machine never picks it under "operatorFlagged". */
const PLAIN_FLAT = flat("plain-flat-1", 1);

/** sameOrLess plain BOGO: buy one £2 sauce, pick a side. */
const SOL_BOGO = {
  ...offerBase,
  _id: "offer-sol-bogo",
  name: "Buy a sauce, pick a side",
  type: { name: "item", value: 0 },
  sameOrLess: true,
  isAndOffer: false,
  applicable: {
    ...offerBase.applicable,
    rawItems: [{ item: { baseItemId: "tortilla-sauce", name: "Tortilla Sauce" }, quantity: 1, relation: "or" }],
  },
  getItems: {
    items: [
      getEntry("greek-salad", "Greek Salad", "or", 17),
      getEntry("caesar-dressing", "Caesar Dressing", "or", 2),
    ],
    categories: [],
  },
};

/** Locked bogoBuySide with a resolvable buy stage (buy 2 sauces). */
const BUY_TWO_SAUCES = {
  ...offerBase,
  _id: "offer-buy-two",
  name: "Buy 2 sauces get a Caesar free",
  type: { name: "item", value: 0 },
  applicable: {
    ...offerBase.applicable,
    rawItems: [{ item: { baseItemId: "tortilla-sauce", name: "Tortilla Sauce" }, quantity: 2, relation: "and" }],
  },
  getItems: { items: [getEntry("caesar-dressing", "Caesar Dressing", "and", 2)], categories: [] },
};

/** Two-way "or" freebie choice: SAVE hands it to the picker. */
const SAUCE_CHOICE = {
  ...offerBase,
  _id: "offer-sauce-choice",
  name: "Free sauce of your choice",
  type: { name: "item", value: 0 },
  getItemOnly: true,
  isAndOffer: false,
  getItems: {
    items: [
      getEntry("tortilla-sauce", "Tortilla Sauce", "or", 2),
      getEntry("caesar-dressing", "Caesar Dressing", "or", 2),
    ],
    categories: [],
  },
};

const BagUi = ({ open = true }: { open?: boolean }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/cart"]}>
      <BagSheet open={open} onClose={vi.fn()} />
    </MemoryRouter>
  </Provider>
);

interface TestState {
  cart: {
    cartItems: Row[];
    cartOffer: { _id?: string } | null;
    offerModal: { isOpen: boolean };
    offerRemovalModal: { isOpen: boolean; data?: { _id?: string } };
  };
  offerSession: { autoApplyOptOut: boolean; autoAppliedOfferId: string | null };
}
const state = () => store.getState() as unknown as TestState;
const slotId = () => state().cart.cartOffer?._id;
const setCart = (rows: Row[]) => act(() => void store.dispatch(setCartItems(rows)));
const savePop = () => screen.getByTestId("bag-rewards-applied").querySelector(".tb-chip-pop");
const pulse = () => screen.getByTestId("bag-rewards-applied").querySelector(".tb-success-pulse");
const saveLine = () => within(screen.getByTestId("bag-rewards-applied")).getByText(/^Save £/);
const caption = () => screen.queryByTestId("bag-rewards-applied-for-you");
const swapCount = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([a]) => (a as { type?: string })?.type === "cart/swapCartOffer").length;

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  resetAppliedBarCelebration();
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
  store.dispatch(setEntityMap({ entityMap: { [SAUCE.id]: SAUCE } }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BagSheet — revalidation check 7 (sameOrLess)", () => {
  it("an applied sameOrLess BOGO with a DEARER freebie row is removed with the notice", async () => {
    store.dispatch(setCartItems([{ ...SAUCE_ROW }, freebieRow("greek-salad", "Greek Salad", 17)]));
    store.dispatch(applyOffer({ offer: SOL_BOGO }));
    render(<BagUi />);

    await waitFor(() => expect(state().cart.offerRemovalModal.isOpen).toBe(true));
    expect(state().cart.offerRemovalModal.data?._id).toBe("offer-sol-bogo");
    expect(slotId()).toBeUndefined();
    expect(state().cart.cartItems.filter((row) => row.isGetItem)).toEqual([]);
    expect(screen.getByTestId("offer-removal-notice")).toHaveTextContent("Reward Removed");
    // A machine removal never latches auto-apply.
    expect(state().offerSession.autoApplyOptOut).toBe(false);
  });

  it("control: the same offer with an equally priced freebie row survives", () => {
    store.dispatch(setCartItems([{ ...SAUCE_ROW }, freebieRow("caesar-dressing", "Caesar Dressing", 2)]));
    store.dispatch(applyOffer({ offer: SOL_BOGO }));
    render(<BagUi />);

    expect(slotId()).toBe("offer-sol-bogo");
    expect(state().cart.offerRemovalModal.isOpen).toBe(false);
  });
});

describe("BagSheet — applied-row pop (AppliedRowPop + the spent key)", () => {
  beforeEach(() => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("the first render after an apply pops the Save line and pulses the plate", () => {
    render(<BagUi />);
    act(() => void store.dispatch(applyOffer({ offer: PLAIN_FLAT })));
    expect(savePop()).toBe(saveLine());
    expect(pulse()).not.toBeNull();
  });

  it("a same-key re-render does not replay (the animated node is never remounted)", () => {
    render(<BagUi />);
    act(() => void store.dispatch(applyOffer({ offer: PLAIN_FLAT })));
    const line = saveLine();

    act(() => void store.dispatch(setCartInstructions("no onions")));

    expect(saveLine()).toBe(line);
  });

  it("closing and reopening the bag with the same key renders the row quiet", () => {
    const view = render(<BagUi />);
    act(() => void store.dispatch(applyOffer({ offer: PLAIN_FLAT })));
    expect(savePop()).not.toBeNull();

    view.rerender(<BagUi open={false} />);
    view.rerender(<BagUi open />);

    expect(saveLine()).toHaveTextContent("Save £1.00");
    expect(savePop()).toBeNull();
    expect(pulse()).toBeNull();
  });

  it("a discount change replays (a new value is worth celebrating)", () => {
    const pct = { ...flat("pct-10", 0), name: "10% off", type: { name: "percent", value: 10 } };
    const view = render(<BagUi />);
    act(() => void store.dispatch(applyOffer({ offer: pct })));
    expect(saveLine()).toHaveTextContent("Save £0.86");
    view.rerender(<BagUi open={false} />);
    view.rerender(<BagUi open />);
    expect(savePop()).toBeNull();

    setCart([{ ...BURGER_ROW }, { ...BURGER_ROW, itemId: "cb-2", uniqueItemId: "cb-2-u" }]);

    expect(saveLine()).toHaveTextContent("Save £1.72");
    expect(savePop()).not.toBeNull();
    expect(pulse()).not.toBeNull();
  });

  it("Remove then re-apply of the SAME offer replays (the removal path resets the spent key)", async () => {
    store.dispatch(setFilteredOffers([PLAIN_FLAT]));
    render(<BagUi />);
    act(() => void store.dispatch(applyOffer({ offer: PLAIN_FLAT })));
    expect(savePop()).not.toBeNull();

    await userEvent.click(screen.getByTestId("bag-rewards-remove"));
    await userEvent.click(await screen.findByTestId("bag-rewards-entry"));
    await userEvent.click(screen.getByTestId("offer-row-plain-flat-1"));
    await userEvent.click(screen.getByTestId("rewards-save"));

    await waitFor(() => expect(slotId()).toBe("plain-flat-1"));
    expect(savePop()).not.toBeNull();
    expect(pulse()).not.toBeNull();
  });
});

describe("BagSheet — the 'Applied for you' caption", () => {
  beforeEach(() => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: PLAIN_FLAT }));
  });

  it("shows only when autoAppliedOfferId is the applied offer's _id", () => {
    render(<BagUi />);
    expect(caption()).toBeNull();

    act(() => void store.dispatch(markOfferAutoApplied("some-other-offer")));
    expect(caption()).toBeNull();

    act(() => void store.dispatch(markOfferAutoApplied("plain-flat-1")));
    expect(caption()).toHaveTextContent("Applied for you");
  });
});

describe("BagSheet — auto-apply (scope: operatorFlagged)", () => {
  beforeEach(() => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it.each([false, true])(
    "opening the bag with a flagged flat offer applies it exactly once — caption, no celebration card (StrictMode %s)",
    async (reactStrictMode) => {
      store.dispatch(setFilteredOffers([PLAIN_FLAT, AUTO_FLAT]));
      const spy = vi.spyOn(store, "dispatch");
      render(<BagUi />, { reactStrictMode });

      await waitFor(() => expect(slotId()).toBe("auto-flat-2"));
      expect(swapCount(spy)).toBe(1);
      expect(caption()).toHaveTextContent("Applied for you");
      expect(state().cart.offerModal.isOpen).toBe(false);
      expect(screen.queryByTestId("offer-applied-celebration")).toBeNull();
      expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£2.00");
      expect(state().offerSession).toEqual({ autoApplyOptOut: false, autoAppliedOfferId: "auto-flat-2" });
      spy.mockRestore();
    }
  );

  it("no auto-apply while the REWARDS SHEET is open; closing it (X, not a choice) lets it apply", async () => {
    store.dispatch(setFilteredOffers([PLAIN_FLAT]));
    render(<BagUi />);
    await userEvent.click(screen.getByTestId("bag-rewards-entry"));

    act(() => void store.dispatch(setFilteredOffers([PLAIN_FLAT, AUTO_FLAT])));
    expect(slotId()).toBeUndefined();

    await userEvent.click(screen.getByTestId("rewards-close"));
    await waitFor(() => expect(slotId()).toBe("auto-flat-2"));
  });

  it("no auto-apply while the REMOVAL NOTICE is up; GOT IT lets it apply", async () => {
    store.dispatch(setFilteredOffers([AUTO_FLAT]));
    store.dispatch(openOfferRemovalModal(flat("gone-offer", 5)));
    render(<BagUi />);
    expect(screen.getByTestId("offer-removal-notice")).toBeInTheDocument();
    expect(slotId()).toBeUndefined();

    await userEvent.click(screen.getByTestId("offer-removal-gotit"));
    await waitFor(() => expect(slotId()).toBe("auto-flat-2"));
  });

  it("no auto-apply while the BUY STAGE is open; abandoning it lets it apply", async () => {
    store.dispatch(setFilteredOffers([BUY_TWO_SAUCES]));
    render(<BagUi />);
    await userEvent.click(screen.getByTestId("bag-rewards-entry"));
    await userEvent.click(screen.getByTestId("offer-row-add-items-offer-buy-two"));
    expect(screen.getByTestId("buy-stage-sheet")).toBeInTheDocument();

    act(() => void store.dispatch(setFilteredOffers([BUY_TWO_SAUCES, AUTO_FLAT])));
    expect(slotId()).toBeUndefined();

    await userEvent.click(screen.getByTestId("buy-stage-close"));
    await waitFor(() => expect(slotId()).toBe("auto-flat-2"));
  });

  it("no auto-apply while the FREEBIE PICKER is open (latch cleared on purpose to isolate the picker veto)", async () => {
    store.dispatch(setFilteredOffers([SAUCE_CHOICE]));
    render(<BagUi />);
    await userEvent.click(screen.getByTestId("bag-rewards-entry"));
    await userEvent.click(screen.getByTestId("offer-row-offer-sauce-choice"));
    await userEvent.click(screen.getByTestId("rewards-save"));
    await screen.findByTestId("freebie-picker");

    act(() => {
      store.dispatch(resetOfferSession());
      store.dispatch(setFilteredOffers([SAUCE_CHOICE, AUTO_FLAT]));
    });
    expect(slotId()).toBeUndefined();

    await userEvent.click(screen.getByTestId("freebie-close"));
    await waitFor(() => expect(slotId()).toBe("auto-flat-2"));
  });

  it("after a customer Remove, later cart edits (and a bag reopen) never re-apply", async () => {
    store.dispatch(setFilteredOffers([AUTO_FLAT]));
    const view = render(<BagUi />);
    await waitFor(() => expect(slotId()).toBe("auto-flat-2"));

    await userEvent.click(screen.getByTestId("bag-rewards-remove"));
    expect(slotId()).toBeUndefined();
    expect(state().offerSession).toEqual({ autoApplyOptOut: true, autoAppliedOfferId: null });

    setCart([{ ...BURGER_ROW }, drinkRow(2)]);
    view.rerender(<BagUi open={false} />);
    view.rerender(<BagUi open />);

    expect(slotId()).toBeUndefined();
    expect(screen.getByTestId("bag-rewards-entry")).toBeInTheDocument();
  });

  it("a customer SAVE of another offer that is later cart-removed → the flagged offer is NOT auto-applied", async () => {
    const minThree = flat("min-three-1", 1, { minItemCount: 3 });
    store.dispatch(setCartItems([{ ...BURGER_ROW }, drinkRow(2)]));
    store.dispatch(setFilteredOffers([AUTO_FLAT, minThree]));
    render(<BagUi />);
    await waitFor(() => expect(slotId()).toBe("auto-flat-2"));

    await userEvent.click(screen.getByTestId("bag-rewards-applied"));
    await userEvent.click(screen.getByTestId("offer-row-min-three-1"));
    await userEvent.click(screen.getByTestId("rewards-save"));
    await waitFor(() => expect(slotId()).toBe("min-three-1"));
    expect(caption()).toBeNull();

    setCart([{ ...BURGER_ROW }, drinkRow(1)]); // 2 items < minItemCount 3
    await waitFor(() => expect(state().cart.offerRemovalModal.isOpen).toBe(true));
    await userEvent.click(screen.getByTestId("offer-removal-gotit"));

    expect(slotId()).toBeUndefined();
    expect(state().offerSession.autoApplyOptOut).toBe(true);
  });

  it("a MACHINE removal of the auto offer shows the notice and does not latch; after GOT IT, once eligible again, it re-applies", async () => {
    const autoMinTwo = flat("auto-min-two", 2, { autoApplied: true, minItemCount: 2 });
    store.dispatch(setCartItems([{ ...BURGER_ROW }, drinkRow(1)]));
    store.dispatch(setFilteredOffers([autoMinTwo]));
    render(<BagUi />);
    await waitFor(() => expect(slotId()).toBe("auto-min-two"));

    setCart([{ ...BURGER_ROW }]); // 1 item < minItemCount 2
    await waitFor(() => expect(state().cart.offerRemovalModal.isOpen).toBe(true));
    expect(screen.getByTestId("offer-removal-notice")).toHaveTextContent("Reward Removed");
    expect(state().offerSession.autoApplyOptOut).toBe(false);
    expect(slotId()).toBeUndefined();

    await userEvent.click(screen.getByTestId("offer-removal-gotit"));
    expect(slotId()).toBeUndefined(); // still ineligible

    setCart([{ ...BURGER_ROW }, drinkRow(1)]);
    await waitFor(() => expect(slotId()).toBe("auto-min-two"));
    expect(caption()).toHaveTextContent("Applied for you");
  });

  it("a MACHINE removal never lets ANOTHER flagged offer land under the notice (same-commit live read); it applies after GOT IT", async () => {
    const autoMinTwoBig = flat("auto-min-two-3", 3, { autoApplied: true, minItemCount: 2 });
    store.dispatch(setCartItems([{ ...BURGER_ROW }, drinkRow(1)]));
    store.dispatch(setFilteredOffers([autoMinTwoBig, AUTO_FLAT]));
    render(<BagUi />);
    await waitFor(() => expect(slotId()).toBe("auto-min-two-3")); // the bigger saving wins

    setCart([{ ...BURGER_ROW }]); // £3 offer no longer holds; the £2 one still would
    await waitFor(() => expect(state().cart.offerRemovalModal.isOpen).toBe(true));
    expect(slotId()).toBeUndefined();

    await userEvent.click(screen.getByTestId("offer-removal-gotit"));
    await waitFor(() => expect(slotId()).toBe("auto-flat-2"));
    expect(caption()).toHaveTextContent("Applied for you");
  });
});

/* ------------------------------------------------------------------ *
 * Mutation-verifier pins: the page-owned buy-stage hand-offs (BACK →
 * rewards, CONTINUE → picker with the ceiling-filtered offer, picker
 * dismiss → rollback, refused CONTINUE → inline line, fresh journey →
 * clean line).
 * ------------------------------------------------------------------ */

/** sameOrLess "or" whose ONLY freebie (£17) is dearer than the £2 buy item. */
const SOL_SALAD_ONLY = {
  ...SOL_BOGO,
  _id: "offer-sol-salad",
  name: "Buy a sauce, get a salad",
  getItems: { items: [getEntry("greek-salad", "Greek Salad", "or", 17)], categories: [] },
};

describe("BagSheet — buy-stage hand-offs", () => {
  beforeEach(() => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  const openStage = async (offerId: string) => {
    await userEvent.click(screen.getByTestId("bag-rewards-entry"));
    await userEvent.click(screen.getByTestId(`offer-row-add-items-${offerId}`));
    await userEvent.click(screen.getByTestId(`buy-stage-add-${SAUCE.id}`));
    expect(state().cart.cartItems.map((row) => row.id)).toEqual([BURGER_ROW.id, SAUCE.id]);
  };

  it("BACK abandons the journey (paid rows rolled back) and returns to the rewards list", async () => {
    store.dispatch(setFilteredOffers([BUY_TWO_SAUCES]));
    render(<BagUi />);
    await openStage("offer-buy-two");

    await userEvent.click(screen.getByTestId("buy-stage-back"));

    expect(screen.queryByTestId("buy-stage-sheet")).toBeNull();
    expect(screen.getByTestId("rewards-sheet")).toBeInTheDocument();
    expect(state().cart.cartItems).toEqual([BURGER_ROW]);
  });

  it("CONTINUE on a sameOrLess 'or' BOGO opens the picker with the ceiling-FILTERED offer; dismissing it rolls the stage back", async () => {
    store.dispatch(setFilteredOffers([SOL_BOGO]));
    render(<BagUi />);
    await openStage("offer-sol-bogo");

    await userEvent.click(screen.getByTestId("buy-stage-continue"));
    const picker = await screen.findByTestId("freebie-picker");
    expect(screen.queryByTestId("buy-stage-sheet")).toBeNull();
    expect(within(picker).getByTestId("freebie-option-caesar-dressing")).toBeInTheDocument();
    expect(within(picker).queryByTestId("freebie-option-greek-salad")).toBeNull(); // £17 > the £2 buy

    await userEvent.click(screen.getByTestId("freebie-close"));

    expect(screen.queryByTestId("freebie-picker")).toBeNull();
    expect(state().cart.cartItems).toEqual([BURGER_ROW]);
    expect(slotId()).toBeUndefined();
  });

  it("a refused CONTINUE keeps the stage open with the not-applicable line; a NEW journey starts without it", async () => {
    store.dispatch(setFilteredOffers([SOL_SALAD_ONLY]));
    render(<BagUi />);
    await openStage("offer-sol-salad");

    await userEvent.click(screen.getByTestId("buy-stage-continue"));
    await waitFor(() =>
      expect(screen.getByTestId("buy-stage-guard")).toHaveTextContent(
        "This reward can't be applied to your current order"
      )
    );
    expect(screen.getByTestId("buy-stage-sheet")).toBeInTheDocument();
    expect(slotId()).toBeUndefined();

    await userEvent.click(screen.getByTestId("buy-stage-close"));
    expect(state().cart.cartItems).toEqual([BURGER_ROW]);
    await userEvent.click(screen.getByTestId("bag-rewards-entry"));
    await userEvent.click(screen.getByTestId("offer-row-add-items-offer-sol-salad"));

    expect(screen.getByTestId("buy-stage-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("buy-stage-guard")).toBeEmptyDOMElement();
  });
});
