/**
 * BagSheet — lane "offers" additions, on the REAL store and apply core:
 * revalidation check 7 (sameOrLess), the applied-row pop (AppliedRowPop +
 * the module spent key), the "Applied for you" caption, and auto-apply
 * (useOfferAutoApply: operator-flagged, cart-neutral, never over a customer
 * choice, never while a sheet / picker / buy stage / removal notice is up).
 */
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  applyOffer,
  openOfferRemovalModal,
  setCartInstructions,
  setCartItems,
  updateItemCartRdx,
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

/**
 * The ONE lazy chunk, real — except that the buy stage can be held "still
 * loading" (suspended on `stall.promise`) to show its Suspense fallback.
 * null (the default) renders the real stage at once.
 */
const stall = vi.hoisted(() => ({ promise: null as Promise<void> | null }));
vi.mock("../bagLazyParts", async (importOriginal) => {
  const parts = await importOriginal<typeof import("../bagLazyParts")>();
  const { createElement, use } = await import("react");
  const Stage = parts.BuyStageSheet;
  return {
    ...parts,
    BuyStageSheet: (props: ComponentProps<typeof Stage>) => {
      if (stall.promise) use(stall.promise);
      return createElement(Stage, props);
    },
  };
});

/**
 * The real freebie picker — unless `pickerCrash.on` makes it fail to render
 * while open. Mocked at its own module: the bag's picker loads with the bag's
 * first render, and that early load reads the chunk above unmocked.
 */
const pickerCrash = vi.hoisted(() => ({ on: false }));
vi.mock("../../offer/FreebiePickerSheet", async (importOriginal) => {
  const picker = await importOriginal<typeof import("../../offer/FreebiePickerSheet")>();
  const { createElement } = await import("react");
  const Picker = picker.default;
  return {
    ...picker,
    default: (props: ComponentProps<typeof Picker>) => {
      if (pickerCrash.on && props.open) throw new Error("picker render failed");
      return createElement(Picker, props);
    },
  };
});

/** The real snapshot planner — unless `plan.fail` makes the stage's rollback throw (Rule 2: it still closes). */
const plan = vi.hoisted(() => ({ fail: false }));
vi.mock("@cx-sdk/ordering/cart/cartEngine", async (importOriginal) => {
  const engine = await importOriginal<typeof import("@cx-sdk/ordering/cart/cartEngine")>();
  return {
    ...engine,
    planCartSnapshotRestore: (...args: Parameters<typeof engine.planCartSnapshotRestore>) => {
      if (plan.fail) throw new Error("rollback failed");
      return engine.planCartSnapshotRestore(...args);
    },
  };
});

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
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
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
    // Lazy (bagLazyParts): the rewards sheet mounts once its chunk resolves
    // (5 s: the house LAZY window — a known flake at 1 s under load).
    await userEvent.click(await screen.findByTestId("offer-row-plain-flat-1", {}, { timeout: 5000 }));
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
      // The (lazy) celebration is mounted, and shows nothing.
      await screen.findByTestId("offer-celebration-region");
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

    await userEvent.click(await screen.findByTestId("rewards-close"));
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
    await userEvent.click(await screen.findByTestId("offer-row-add-items-offer-buy-two"));
    // Lazy (bagLazyParts): the stage mounts once its chunk resolves.
    expect(await screen.findByTestId("buy-stage-sheet")).toBeInTheDocument();

    act(() => void store.dispatch(setFilteredOffers([BUY_TWO_SAUCES, AUTO_FLAT])));
    expect(slotId()).toBeUndefined();

    await userEvent.click(screen.getByTestId("buy-stage-close"));
    await waitFor(() => expect(slotId()).toBe("auto-flat-2"));
  });

  it("no auto-apply while the FREEBIE PICKER is open (latch cleared on purpose to isolate the picker veto)", async () => {
    store.dispatch(setFilteredOffers([SAUCE_CHOICE]));
    render(<BagUi />);
    await userEvent.click(screen.getByTestId("bag-rewards-entry"));
    await userEvent.click(await screen.findByTestId("offer-row-offer-sauce-choice"));
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

    // P9f overlay-button pattern: the applied row's named overlay opens the sheet.
    await userEvent.click(screen.getByRole("button", { name: "Rewards & Offers" }));
    await userEvent.click(await screen.findByTestId("offer-row-min-three-1"));
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

  it("a flagged onGrossTotal offer whose own £2 takes the net under its £10 minimum lands ONCE and stays — the engine, the ranking and revalidation all judge the £11.60 item subtotal, so no notice and no re-apply loop", async () => {
    const grossAuto = flat("gross-auto-2", 2, { autoApplied: true, minBillAmount: 10, onGrossTotal: true });
    store.dispatch(setCartItems([{ ...BURGER_ROW }, drinkRow(1)]));
    store.dispatch(setFilteredOffers([grossAuto]));
    const spy = vi.spyOn(store, "dispatch");
    render(<BagUi />);

    await waitFor(() => expect(slotId()).toBe("gross-auto-2"));
    expect(state().cart.offerRemovalModal.isOpen).toBe(false);
    expect(swapCount(spy)).toBe(1);
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£2.00");
    spy.mockRestore();
  });
});

/*
  Review (lane walk-offers-2): check 8 prices the live bill, but the
  ranking, the notice's "Add X+" gap and auto-apply read useOfferSavings'
  caches, keyed on a cart signature that left add-ons out. An Edit that
  only dropped one kept them on the old money: the notice lost its reason,
  the sheet offered the reward again, and a flagged one came back after
  every GOT IT — the guest never reached PAY.
*/
describe("BagSheet — an Edit that only drops an add-on, under a min-bill reward", () => {
  /** The burger with a £3 Extra Cheese: £11.60 (its own itemId: no earlier test warmed the caches). */
  const RICH: Row = {
    ...BURGER_ROW,
    itemId: "cb-rich",
    uniqueItemId: "cb-rich-u",
    total_price: 11.6,
    customizations: {
      sauce_group: [
        { id: "onions", name: "Add Onions", price: 0.6, quantity: 1 },
        { id: "cheese", name: "Extra Cheese", price: 3, quantity: 1 },
      ],
    },
  };
  /** The PDP's commit: the same itemId, price and quantity, the cheese gone — £8.60. */
  const LEAN: Row = { ...BURGER_ROW, itemId: "cb-rich", uniqueItemId: "cb-rich-u" };
  /** Edit from the bag: it closes for the PDP, the commit lands, it reopens. */
  const editFromBag = (view: ReturnType<typeof render>) => {
    view.rerender(<BagUi open={false} />);
    act(() => void store.dispatch(updateItemCartRdx({ item: { ...LEAN } })));
    view.rerender(<BagUi open />);
  };
  const NUDGE = "Add £1.40+ to your order to be eligible to redeem this reward";

  it("a chosen reward goes with its 'Add £1.40+' line, and the reopened sheet nudges instead of offering it", async () => {
    const min10 = flat("min10-flat-2", 2, { minBillAmount: 10 });
    store.dispatch(setCartItems([{ ...RICH }]));
    store.dispatch(setFilteredOffers([min10]));
    store.dispatch(applyOffer({ offer: min10 }));
    const view = render(<BagUi />);
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£2.00");

    editFromBag(view);

    await waitFor(() => expect(state().cart.offerRemovalModal.isOpen).toBe(true));
    expect(slotId()).toBeUndefined();
    expect(screen.getByTestId("offer-removal-notice")).toHaveTextContent(NUDGE);

    await userEvent.click(screen.getByTestId("offer-removal-gotit"));
    await userEvent.click(screen.getByTestId("bag-rewards-entry"));
    expect(
      await screen.findByTestId("offer-row-nudge-min10-flat-2", {}, { timeout: 5000 })
    ).toHaveTextContent(NUDGE);
    expect(screen.queryByTestId("offer-radio-min10-flat-2")).toBeNull();
  });

  it("a flagged reward goes ONCE: GOT IT never brings it back", async () => {
    const autoMin10 = flat("auto-min10-flat-2", 2, { autoApplied: true, minBillAmount: 10 });
    store.dispatch(setCartItems([{ ...RICH }]));
    store.dispatch(setFilteredOffers([autoMin10]));
    const spy = vi.spyOn(store, "dispatch");
    const view = render(<BagUi />);
    await waitFor(() => expect(slotId()).toBe("auto-min10-flat-2"));

    editFromBag(view);

    await waitFor(() => expect(state().cart.offerRemovalModal.isOpen).toBe(true));
    expect(screen.getByTestId("offer-removal-notice")).toHaveTextContent(NUDGE);
    await userEvent.click(screen.getByTestId("offer-removal-gotit"));

    expect(state().cart.offerRemovalModal.isOpen).toBe(false);
    expect(slotId()).toBeUndefined();
    expect(swapCount(spy)).toBe(1);
    spy.mockRestore();
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
    await userEvent.click(await screen.findByTestId(`offer-row-add-items-${offerId}`));
    await userEvent.click(await screen.findByTestId(`buy-stage-add-${SAUCE.id}`));
    expect(state().cart.cartItems.map((row) => row.id)).toEqual([BURGER_ROW.id, SAUCE.id]);
  };

  it("while the stage's code still loads, its scrim is the stage's own Close: a tap abandons the journey (nothing added, the bag intact); once the code arrives the stage opens", async () => {
    let arrive!: () => void;
    stall.promise = new Promise<void>((resolve) => (arrive = resolve));
    onTestFinished(() => {
      stall.promise = null;
    });
    store.dispatch(setFilteredOffers([BUY_TWO_SAUCES]));
    render(<BagUi />);
    await userEvent.click(screen.getByTestId("bag-rewards-entry"));
    await userEvent.click(await screen.findByTestId("offer-row-add-items-offer-buy-two"));

    const loading = await screen.findByRole("button", { name: "Close rewards" });
    expect(loading).toHaveAttribute("data-testid", "buy-stage-loading");
    expect(screen.queryByTestId("rewards-sheet")).toBeNull();
    expect(screen.queryByTestId("buy-stage-sheet")).toBeNull();

    await userEvent.click(loading);
    expect(screen.queryByTestId("buy-stage-loading")).toBeNull();
    expect(state().cart.cartItems).toEqual([BURGER_ROW]);
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£8.60");

    await act(async () => arrive());
    await userEvent.click(screen.getByTestId("bag-rewards-entry"));
    await userEvent.click(await screen.findByTestId("offer-row-add-items-offer-buy-two"));
    expect(await screen.findByTestId("buy-stage-sheet")).toBeInTheDocument();
    expect(screen.queryByTestId("buy-stage-loading")).toBeNull();
  });

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

    expect(await screen.findByTestId("buy-stage-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("buy-stage-guard")).toBeEmptyDOMElement();
  });

  /*
    Review (lane walk-offers-2): the stage's "−" reaches a PRE-journey row of
    its tile's item. Judged mid-journey, the applied reward that row held up
    went — and BACK restored the rows but not the reward. Revalidation waits
    for the journey, then judges the bag it leaves.
  */
  it.each([
    ["a bill minimum (£10.60 → £8.60 under £10)", { minBillAmount: 10 }],
    ["an item minimum (2 → 1 under 2)", { minItemCount: 2 }],
  ])(
    "a reward the stage's '−' takes under %s is not judged mid-journey: BACK restores the rows AND the reward, no notice",
    async (_label, minimum) => {
      const held = flat("held-flat-2", 2, minimum);
      store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...SAUCE_ROW }]));
      store.dispatch(setFilteredOffers([held, BUY_TWO_SAUCES]));
      store.dispatch(applyOffer({ offer: held }));
      render(<BagUi />);
      await userEvent.click(screen.getByRole("button", { name: "Rewards & Offers" }));
      await userEvent.click(await screen.findByTestId("offer-row-add-items-offer-buy-two"));
      await screen.findByTestId("buy-stage-sheet");

      await userEvent.click(screen.getByTestId(`buy-stage-dec-${SAUCE.id}`)); // the pre-journey sauce
      expect(state().cart.cartItems.map((row) => row.itemId)).toEqual(["cb-1"]);
      expect(state().cart.offerRemovalModal.isOpen).toBe(false);
      expect(slotId()).toBe("held-flat-2");

      await userEvent.click(screen.getByTestId("buy-stage-back"));
      expect(state().cart.cartItems.map((row) => row.itemId)).toEqual(["cb-1", "ts-1"]);
      expect(slotId()).toBe("held-flat-2");
      expect(state().cart.offerRemovalModal.isOpen).toBe(false);
      await userEvent.click(screen.getByTestId("rewards-close"));
      expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£2.00");
    }
  );

  it("the wait spans the stage → picker hand-off: CONTINUE into the picker with the bag still under the reward's minimum, then X — the rows AND the reward come back", async () => {
    /** A burger AND 2 sauces, then a side of your choice (the picker). */
    const BURGER_SAUCES_PICK = {
      ...offerBase,
      _id: "offer-burger-sauces-pick",
      name: "A burger and 2 sauces, pick a side",
      type: { name: "item", value: 0 },
      isAndOffer: false,
      applicable: {
        ...offerBase.applicable,
        rawItems: [
          { item: { baseItemId: BURGER_ROW.id, name: "Cheese Burger" }, quantity: 1, relation: "and" },
          { item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: 2, relation: "and" },
        ],
      },
      getItems: {
        items: [getEntry("greek-salad", "Greek Salad", "or", 17), getEntry("caesar-dressing", "Caesar Dressing", "or", 2)],
        categories: [],
      },
    };
    const held = flat("held-flat-2", 2, { minBillAmount: 15 });
    store.dispatch(setEntityMap({ entityMap: { [SAUCE.id]: SAUCE, [BURGER_ROW.id as string]: BURGER_ROW.baseItem } }));
    store.dispatch(setCartItems([{ ...BURGER_ROW, quantity: 2 }])); // £17.20
    store.dispatch(setFilteredOffers([held, BURGER_SAUCES_PICK]));
    store.dispatch(applyOffer({ offer: held }));
    render(<BagUi />);
    await userEvent.click(screen.getByRole("button", { name: "Rewards & Offers" }));
    await userEvent.click(await screen.findByTestId("offer-row-add-items-offer-burger-sauces-pick"));
    await screen.findByTestId("buy-stage-sheet");

    await userEvent.click(screen.getByTestId(`buy-stage-dec-${BURGER_ROW.id}`)); // a pre-journey burger: £8.60
    await userEvent.click(screen.getByTestId(`buy-stage-add-${SAUCE.id}`));
    await userEvent.click(screen.getByTestId(`buy-stage-inc-${SAUCE.id}`)); // £12.60, still under £15
    await userEvent.click(screen.getByTestId("buy-stage-continue"));
    await screen.findByTestId("freebie-picker");
    expect(screen.queryByTestId("buy-stage-sheet")).toBeNull();
    expect(state().cart.offerRemovalModal.isOpen).toBe(false);
    expect(slotId()).toBe("held-flat-2");

    await userEvent.click(screen.getByTestId("freebie-close"));
    expect(state().cart.cartItems).toEqual([{ ...BURGER_ROW, quantity: 2 }]);
    expect(slotId()).toBe("held-flat-2");
    expect(state().cart.offerRemovalModal.isOpen).toBe(false);
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£2.00");
  });

  it("…and the moment the journey ends, the bag it leaves IS judged: a rollback that fails keeps the trashed bag, and the reward goes with its notice", async () => {
    plan.fail = true;
    onTestFinished(() => {
      plan.fail = false;
    });
    const held = flat("held-flat-2", 2, { minBillAmount: 10 });
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...SAUCE_ROW }]));
    store.dispatch(setFilteredOffers([held, BUY_TWO_SAUCES]));
    store.dispatch(applyOffer({ offer: held }));
    render(<BagUi />);
    await userEvent.click(screen.getByRole("button", { name: "Rewards & Offers" }));
    await userEvent.click(await screen.findByTestId("offer-row-add-items-offer-buy-two"));
    await screen.findByTestId("buy-stage-sheet");
    await userEvent.click(screen.getByTestId(`buy-stage-dec-${SAUCE.id}`));
    expect(state().cart.offerRemovalModal.isOpen).toBe(false);

    await userEvent.click(screen.getByTestId("buy-stage-close"));
    expect(screen.queryByTestId("buy-stage-sheet")).toBeNull();
    expect(state().cart.cartItems.map((row) => row.itemId)).toEqual(["cb-1"]);
    await waitFor(() => expect(state().cart.offerRemovalModal.isOpen).toBe(true));
    expect(slotId()).toBeUndefined();
    expect(screen.getByTestId("offer-removal-notice")).toHaveTextContent(
      "Add £1.40+ to your order to be eligible to redeem this reward"
    );
  });

  /*
    Review (lane walk-offers-2): the wait read pickerOffer, which only the
    picker's own X cleared — a picker that failed to render (its boundary
    showed nothing) held revalidation off for the rest of the bag. Its
    fallback settles like X, for every choice handed to it.
  */
  it("a picker that fails to render settles like its X, each time — a journey rolls back, and the held reward is judged again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pickerCrash.on = true;
    onTestFinished(() => {
      pickerCrash.on = false;
    });
    const held = flat("held-flat-2", 2, { minBillAmount: 10 });
    store.dispatch(setCartItems([{ ...BURGER_ROW }, drinkRow(1)])); // £11.60
    store.dispatch(setFilteredOffers([held, SAUCE_CHOICE, SOL_BOGO]));
    store.dispatch(applyOffer({ offer: held }));
    render(<BagUi />);

    // A choice SAVEd off the rewards sheet: the picker fails, nothing is chosen.
    await userEvent.click(screen.getByRole("button", { name: "Rewards & Offers" }));
    await userEvent.click(await screen.findByTestId("offer-row-offer-sauce-choice"));
    await userEvent.click(screen.getByTestId("rewards-save"));
    await waitFor(() => expect(screen.queryByTestId("rewards-sheet")).toBeNull());
    expect(screen.queryByTestId("freebie-picker")).toBeNull();
    expect(slotId()).toBe("held-flat-2");

    // Its boundary still tripped, a buy stage CONTINUEs into it: the stage's sauce goes back.
    await userEvent.click(screen.getByRole("button", { name: "Rewards & Offers" }));
    await userEvent.click(await screen.findByTestId("offer-row-add-items-offer-sol-bogo"));
    await userEvent.click(await screen.findByTestId(`buy-stage-add-${SAUCE.id}`));
    await userEvent.click(screen.getByTestId("buy-stage-continue"));
    await waitFor(() => expect(screen.queryByTestId("buy-stage-sheet")).toBeNull());
    expect(state().cart.cartItems.map((row) => row.itemId)).toEqual(["cb-1", "pep-1"]);
    expect(slotId()).toBe("held-flat-2");
    expect(state().cart.offerRemovalModal.isOpen).toBe(false);

    // Nothing holds revalidation: under the minimum, the reward goes with its notice.
    setCart([{ ...BURGER_ROW }]); // £8.60
    await waitFor(() => expect(state().cart.offerRemovalModal.isOpen).toBe(true));
    expect(slotId()).toBeUndefined();
    expect(screen.getByTestId("offer-removal-notice")).toHaveTextContent(
      "Add £1.40+ to your order to be eligible to redeem this reward"
    );
  });
});

/* ------------------------------------------------------------------ *
 * Lane loyalty-visual: a XENO reward in the bag (an ordinary discounted
 * cart row — it never touches cartOffer).
 *  - D3: the machine never auto-applies an offer while the reward is in the
 *    bag and the slot is empty.
 *  - F1: the applied-offer row, its pop key and the celebration carry the
 *    OFFER's own saving; the Discounts line and ORDER & PAY keep the total.
 * ------------------------------------------------------------------ */

/** Redeemed 100 % XENO reward: £17 discounted to £0 (redeemItem shape). */
const REWARD_ROW: Row = {
  id: "5dd1093829754a432f2c32e2",
  itemId: "lr-1",
  uniqueItemId: "lr-1-u",
  name: "Greek Salad",
  quantity: 1,
  type: "ITEM",
  isLoyaltyItem: true,
  isRedeemed: true,
  coupon_code: "static6562",
  discount_type: "percentage",
  discount_value: 100,
  price: 0,
  total_price: 0,
  undiscounted_price: 17,
  undiscounted_total_price: 17,
  extra_fields: [{ name: "Points Value", value: 3000 }],
  customizations: {},
};
const FLAT_TWO = flat("flat-two", 2);
const discountsLine = () => screen.getByTestId("bag-discounts");

describe("BagSheet — a XENO reward in the bag (lane loyalty-visual D3 + F1)", () => {
  beforeEach(() => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  });

  it("D3: a flagged offer is never auto-applied while the reward is in the bag and the slot is empty — across cart edits and a reopen; it lands once the reward leaves", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    store.dispatch(setFilteredOffers([AUTO_FLAT]));
    const spy = vi.spyOn(store, "dispatch");
    const view = render(<BagUi />);
    expect(slotId()).toBeUndefined();

    setCart([{ ...BURGER_ROW }, drinkRow(2), { ...REWARD_ROW }]);
    view.rerender(<BagUi open={false} />);
    view.rerender(<BagUi open />);

    expect(slotId()).toBeUndefined();
    expect(swapCount(spy)).toBe(0);
    expect(state().offerSession).toEqual({ autoApplyOptOut: false, autoAppliedOfferId: null });

    // Control: the same bag without the reward is auto-applied.
    setCart([{ ...BURGER_ROW }, drinkRow(2)]);
    await waitFor(() => expect(slotId()).toBe("auto-flat-2"));
  });

  it("F1: offer + reward — the applied row shows only the offer's £2; Discounts and ORDER & PAY keep the £19 total", () => {
    store.dispatch(applyOffer({ offer: FLAT_TWO }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    render(<BagUi />);

    const applied = screen.getByTestId("bag-rewards-applied");
    expect(saveLine()).toHaveTextContent("Save £2.00");
    expect(applied).toHaveTextContent("−£2.00");
    expect(applied).not.toHaveTextContent("19.00");
    // Bill: 8.60 + 17.00 = 25.60; discounts 17.00 (reward) + 2.00 (offer).
    expect(screen.getByTestId("bag-subtotal")).toHaveTextContent("£25.60");
    expect(discountsLine()).toHaveTextContent("−£19.00");
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£6.60");
    const pay = screen.getByTestId("bag-pay");
    expect(pay).toHaveTextContent("Order & Pay");
    expect(pay).toHaveTextContent("£6.60");
  });

  it("F1: offer only — the row and the Discounts line both read the offer's £2 (unchanged)", () => {
    store.dispatch(applyOffer({ offer: FLAT_TWO }));
    render(<BagUi />);

    expect(saveLine()).toHaveTextContent("Save £2.00");
    expect(screen.getByTestId("bag-rewards-applied")).toHaveTextContent("−£2.00");
    expect(discountsLine()).toHaveTextContent("−£2.00");
    expect(screen.getByTestId("bag-pay")).toHaveTextContent("Order & Pay");
  });

  it("F1: reward only — no applied row; the Discounts line carries the reward's £17", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    render(<BagUi />);

    expect(screen.queryByTestId("bag-rewards-applied")).toBeNull();
    expect(discountsLine()).toHaveTextContent("−£17.00");
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£8.60");
    // The CTA label follows the bill's discount, the reward's included.
    expect(screen.getByTestId("bag-pay")).toHaveTextContent("Order & Pay");
  });

  it("F1: an applied offer that saves nothing never borrows the reward's saving — no Save line, no £17 on its row", () => {
    store.dispatch(applyOffer({ offer: flat("flat-zero", 0) }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    render(<BagUi />);

    const applied = screen.getByTestId("bag-rewards-applied");
    expect(within(applied).queryByText(/^Save /)).toBeNull();
    expect(applied).not.toHaveTextContent("17.00");
    expect(discountsLine()).toHaveTextContent("−£17.00");
  });

  it("F1: the applied-row pop does NOT replay when the reward lands under an unchanged offer (barKey = the offer's own saving)", () => {
    const view = render(<BagUi />);
    act(() => void store.dispatch(applyOffer({ offer: FLAT_TWO })));
    expect(savePop()).not.toBeNull();
    view.rerender(<BagUi open={false} />);
    view.rerender(<BagUi open />);
    expect(savePop()).toBeNull();
    const line = saveLine();

    setCart([{ ...BURGER_ROW }, { ...REWARD_ROW }]);

    expect(discountsLine()).toHaveTextContent("−£19.00"); // the total moved…
    expect(saveLine()).toBe(line); // …but the row was not remounted
    expect(saveLine()).toHaveTextContent("Save £2.00");
    expect(savePop()).toBeNull();
    expect(pulse()).toBeNull();
  });

  it("F1: a SAVE swap with the reward in the bag (allowed: an offer was applied first) celebrates the NEW offer's own saving", async () => {
    store.dispatch(setFilteredOffers([PLAIN_FLAT, FLAT_TWO]));
    store.dispatch(applyOffer({ offer: PLAIN_FLAT }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    render(<BagUi />);
    expect(saveLine()).toHaveTextContent("Save £1.00");

    await userEvent.click(screen.getByRole("button", { name: "Rewards & Offers" }));
    await userEvent.click(await screen.findByTestId("offer-row-flat-two"));
    await userEvent.click(screen.getByTestId("rewards-save"));

    await waitFor(() => expect(slotId()).toBe("flat-two"));
    const card = await screen.findByTestId("offer-applied-celebration");
    expect(card).toHaveTextContent("You save £2.00");
    expect(card).not.toHaveTextContent("19.00");
    expect(saveLine()).toHaveTextContent("Save £2.00");
    expect(discountsLine()).toHaveTextContent("−£19.00");
  });
});
