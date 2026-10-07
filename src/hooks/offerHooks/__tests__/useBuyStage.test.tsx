/**
 * useBuyStage — the in-bag BOGO buy-stage journey host (lane "offers", item
 * 31), on the REAL store. One snapshot per journey, taken before the first
 * paid row lands; rolled back on BACK / X / picker dismiss / bag close unless
 * the journey's offer made it onto the bill (read from the LIVE slot); never
 * on a plain unmount. Each journey reports Opened, then Completed or
 * Abandoned, exactly once.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { applyOffer, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import type { BuyStageView } from "@cx-sdk/ordering/offer/buyStageUtils";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { store } from "../../../redux/app/store";
import useBuyStage from "../useBuyStage";
import useOfferApply, { type OfferCommitResult } from "../useOfferApply";
import "../../../i18n";

const mockCapture = vi.fn();
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

// The rollback replaces the IndexedDB mirror wholesale — spy on that write.
const mockReplaceIndexedDbCart = vi.fn();
vi.mock("../../cartHooks/useCartIndexedDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cartHooks/useCartIndexedDb")>();
  return {
    default: () => ({
      ...actual.default(),
      replaceIndexedDbCart: (items: unknown) => mockReplaceIndexedDbCart(items),
    }),
  };
});

type Row = { itemId: string; [key: string]: unknown };

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
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8 },
};
const sauceRow = (itemId: string, quantity = 1): Row => ({
  id: "tortilla-sauce",
  itemId,
  uniqueItemId: itemId,
  name: "Tortilla Sauce",
  quantity,
  type: "ITEM",
  price: 2,
  total_price: 2,
  customizations: {},
});
const CAESAR_ROW: Row = { ...sauceRow("cd-1"), id: "caesar-dressing", name: "Caesar Dressing" };
const LOYALTY_ROW: Row = { ...sauceRow("loy-1"), isLoyaltyItem: true, total_price: 0 };

const plainEntity = (id: string, name: string, price: number) => ({
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
  type: "ITEM",
  entities: plainEntity(id, name, price),
});
const TORTILLA_OR = getEntry("tortilla-sauce", "Tortilla Sauce", "or", 2);

const base = {
  isAvailable: true,
  isComplimentary: false,
  autoApplied: false,
  sameOrLess: false,
  getItemOnly: false,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  minBillAmount: null,
  minItemCount: null,
  maxDiscount: null,
  isAndOffer: true,
  isBuyAndOffer: false,
  type: { name: "item", value: 0 },
  applicable: { on: "complete", isExclude: false, isInclude: false, rawItems: [] as unknown[] },
};
const asOffer = (fixture: object): SavingsOffer => fixture as unknown as SavingsOffer;

/** Least-value: buy 2 sauces, the cheapest is free (cart-neutral → swap). */
const LEAST = asOffer({
  ...base,
  _id: "least-2",
  name: "Buy 2 sauces, cheapest free",
  getLeastValueItem: true,
  leastItemValueCount: { buyQuantity: 2, getQuantity: 1, getDiscount: 100 },
  applicable: { ...base.applicable, rawItems: [{ item: { baseItemId: "tortilla-sauce" } }] },
  getItems: { items: [], categories: [] },
});
const LEAST_VIEW: BuyStageView = { mode: "least", groups: [], sharedRequiredQuantity: 2 };

/** "or" BOGO: buy a burger, pick a free sauce → needs the picker. */
const OR_BOGO = asOffer({
  ...base,
  _id: "bogo-or",
  name: "Buy a burger, pick a sauce",
  isAndOffer: false,
  applicable: { ...base.applicable, rawItems: [{ item: { baseItemId: "cheese-burger" }, quantity: 1, relation: "or" }] },
  getItems: {
    items: [TORTILLA_OR, getEntry("caesar-dressing", "Caesar Dressing", "or", 2)],
    categories: [],
  },
});
const PLAIN_OR_VIEW: BuyStageView = { mode: "plain-or", groups: [], sharedRequiredQuantity: 0 };

/** sameOrLess "and" BOGO: the £17 salad is over the £2 buy → blocked. */
const SOL_AND = asOffer({
  ...base,
  _id: "sol-and",
  name: "Buy a sauce, get a salad and a dressing",
  sameOrLess: true,
  applicable: { ...base.applicable, rawItems: [{ item: { baseItemId: "tortilla-sauce" }, quantity: 1, relation: "and" }] },
  getItems: {
    items: [
      getEntry("greek-salad", "Greek Salad", "and", 17),
      getEntry("caesar-dressing", "Caesar Dressing", "and", 2),
    ],
    categories: [],
  },
});
const PLAIN_AND_VIEW: BuyStageView = { mode: "plain-and", groups: [], sharedRequiredQuantity: 0 };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/cart"]}>{children}</MemoryRouter>
  </Provider>
);

interface CartView {
  cartItems: Row[];
  cartOffer?: { _id?: string } | null;
}
const cart = () => (store.getState() as unknown as { cart: CartView }).cart;
const byItemId = (rows: Row[]) => [...rows].sort((a, b) => a.itemId.localeCompare(b.itemId));
const setCart = (rows: Row[]) => act(() => void store.dispatch(setCartItems(rows)));
const stageEvents = () =>
  mockCapture.mock.calls
    .filter(([name]) => String(name).startsWith("offer_buy_stage"))
    .map(([name, props]) => [name, (props as { offer_id?: string })?.offer_id]);

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ symbol: "£" }));
  mockCapture.mockClear();
  mockReplaceIndexedDbCart.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useBuyStage — snapshot and rollback", () => {
  it("start snapshots the cart BEFORE any adds; re-opening the same journey keeps that ONE baseline", () => {
    setCart([BURGER_ROW]);
    const { result } = renderHook(() => useBuyStage(true), { wrapper });

    act(() => result.current.start(LEAST, LEAST_VIEW));
    expect(result.current.buyStage).toEqual({ offer: LEAST, view: LEAST_VIEW });
    setCart([BURGER_ROW, sauceRow("s1")]);
    act(() => result.current.start(LEAST, LEAST_VIEW));
    setCart([BURGER_ROW, sauceRow("s1", 2)]);
    act(() => result.current.abandon());

    expect(cart().cartItems).toEqual([BURGER_ROW]);
    expect(result.current.buyStage).toBeNull();
    expect(stageEvents()).toEqual([
      ["offer_buy_stage_opened", "least-2"],
      ["offer_buy_stage_abandoned", "least-2"],
    ]);
  });

  it("abandon restores the PAID rows exactly (redux + the IndexedDB replace), leaves loyalty rows alone, and reports Abandoned once", () => {
    const sauce = sauceRow("s1");
    setCart([BURGER_ROW, sauce, LOYALTY_ROW]);
    const { result } = renderHook(() => useBuyStage(true), { wrapper });

    act(() => result.current.start(LEAST, LEAST_VIEW));
    // Mid-journey: the burger went, the sauce grew to 3, a Caesar arrived.
    setCart([sauceRow("s1", 3), LOYALTY_ROW, CAESAR_ROW]);
    act(() => result.current.abandon());

    expect(byItemId(cart().cartItems)).toEqual(byItemId([BURGER_ROW, sauce, LOYALTY_ROW]));
    expect(mockReplaceIndexedDbCart).toHaveBeenCalledTimes(1);
    expect(mockReplaceIndexedDbCart).toHaveBeenCalledWith([LOYALTY_ROW, BURGER_ROW, sauce]);

    act(() => result.current.abandon()); // disarmed: a second abandon is a no-op
    expect(mockReplaceIndexedDbCart).toHaveBeenCalledTimes(1);
    expect(stageEvents()).toEqual([
      ["offer_buy_stage_opened", "least-2"],
      ["offer_buy_stage_abandoned", "least-2"],
    ]);
  });

  it("starting offer B while A's journey is armed rolls A back first; B baselines on the restored cart", () => {
    setCart([BURGER_ROW]);
    const { result } = renderHook(() => useBuyStage(true), { wrapper });

    act(() => result.current.start(LEAST, LEAST_VIEW));
    setCart([BURGER_ROW, sauceRow("s1", 2)]);
    act(() => result.current.start(OR_BOGO, PLAIN_OR_VIEW));

    expect(cart().cartItems).toEqual([BURGER_ROW]);
    expect(result.current.buyStage?.offer).toBe(OR_BOGO);

    setCart([BURGER_ROW, CAESAR_ROW]);
    act(() => result.current.abandon());
    expect(cart().cartItems).toEqual([BURGER_ROW]);
    expect(stageEvents()).toEqual([
      ["offer_buy_stage_opened", "least-2"],
      ["offer_buy_stage_abandoned", "least-2"],
      ["offer_buy_stage_opened", "bogo-or"],
      ["offer_buy_stage_abandoned", "bogo-or"],
    ]);
  });

  it("the bag closing (open → false) with an armed snapshot rolls back and clears the stage", () => {
    setCart([BURGER_ROW]);
    const { result, rerender } = renderHook(({ open }) => useBuyStage(open), {
      wrapper,
      initialProps: { open: true },
    });

    act(() => result.current.start(LEAST, LEAST_VIEW));
    setCart([BURGER_ROW, sauceRow("s1", 2)]);
    rerender({ open: false });

    expect(result.current.buyStage).toBeNull();
    expect(cart().cartItems).toEqual([BURGER_ROW]);
    expect(stageEvents().map(([name]) => name)).toEqual([
      "offer_buy_stage_opened",
      "offer_buy_stage_abandoned",
    ]);
  });

  it("a plain unmount NEVER rolls back (idle → /start's reset owns that; a StrictMode remount must not undo the cart)", () => {
    setCart([BURGER_ROW]);
    const { result, unmount } = renderHook(() => useBuyStage(true), { wrapper });

    act(() => result.current.start(LEAST, LEAST_VIEW));
    setCart([BURGER_ROW, sauceRow("s1", 2)]);
    unmount();

    expect(cart().cartItems).toEqual([BURGER_ROW, sauceRow("s1", 2)]);
    expect(mockReplaceIndexedDbCart).not.toHaveBeenCalled();
    expect(stageEvents().map(([name]) => name)).toEqual(["offer_buy_stage_opened"]);
  });
});

describe("useBuyStage — CONTINUE", () => {
  it("least-value: continueStage swaps the offer on; Completed fires once; a later abandon / bag close is a no-op", async () => {
    setCart([BURGER_ROW]);
    const { result, rerender } = renderHook(({ open }) => useBuyStage(open), {
      wrapper,
      initialProps: { open: true },
    });

    act(() => result.current.start(LEAST, LEAST_VIEW));
    setCart([BURGER_ROW, sauceRow("s1", 2)]);
    let verdict: OfferCommitResult | undefined;
    await act(async () => {
      verdict = await result.current.continueStage();
    });

    expect(verdict).toEqual({ applied: true });
    expect(result.current.buyStage).toBeNull();
    expect(result.current.continuing).toBe(false);
    expect(cart().cartOffer?._id).toBe("least-2");
    // Released the moment the offer holds the slot (no further tap needed).
    const completed = [
      ["offer_buy_stage_opened", "least-2"],
      ["offer_buy_stage_completed", "least-2"],
    ];
    expect(stageEvents()).toEqual(completed);

    act(() => result.current.abandon());
    rerender({ open: false });
    expect(cart().cartItems).toEqual([BURGER_ROW, sauceRow("s1", 2)]);
    expect(mockReplaceIndexedDbCart).not.toHaveBeenCalled();
    expect(stageEvents()).toEqual(completed);
  });

  it("an 'or' BOGO → needsPicker; the stage closes but the snapshot stays ARMED, so a picker dismiss rolls back", async () => {
    setCart([sauceRow("s0")]);
    const { result } = renderHook(() => useBuyStage(true), { wrapper });

    act(() => result.current.start(OR_BOGO, PLAIN_OR_VIEW));
    setCart([sauceRow("s0"), BURGER_ROW]);
    let verdict: OfferCommitResult | undefined;
    await act(async () => {
      verdict = await result.current.continueStage();
    });

    expect(verdict).toEqual({ applied: false, needsPicker: true });
    expect(result.current.buyStage).toBeNull();
    expect(cart().cartItems).toEqual([sauceRow("s0"), BURGER_ROW]); // nothing rolled back yet

    act(() => result.current.rollbackIfAbandoned());
    expect(cart().cartItems).toEqual([sauceRow("s0")]);
    expect(stageEvents().map(([name]) => name)).toEqual([
      "offer_buy_stage_opened",
      "offer_buy_stage_abandoned",
    ]);
  });

  it("after the picker commit lands the offer, rollbackIfAbandoned (the picker's onClose) is a no-op and the journey completes once", async () => {
    setCart([sauceRow("s0")]);
    const { result } = renderHook(
      () => ({ stage: useBuyStage(true), apply: useOfferApply() }),
      { wrapper }
    );

    act(() => result.current.stage.start(OR_BOGO, PLAIN_OR_VIEW));
    setCart([sauceRow("s0"), BURGER_ROW]);
    await act(async () => {
      await result.current.stage.continueStage();
    });
    // Picker CONFIRM, then its onClose in the same continuation.
    await act(async () => {
      const landed = await result.current.apply.commitPickedFreebies({
        offer: OR_BOGO,
        picks: [TORTILLA_OR],
      });
      expect(landed).toBe(true);
      result.current.stage.rollbackIfAbandoned();
    });

    expect(cart().cartOffer?._id).toBe("bogo-or");
    const rows = cart().cartItems;
    expect(rows.filter((row) => !row.isGetItem)).toEqual([sauceRow("s0"), BURGER_ROW]);
    expect(rows.filter((row) => row.isGetItem).map((row) => row.id)).toEqual(["tortilla-sauce"]);
    expect(mockReplaceIndexedDbCart).not.toHaveBeenCalled();
    expect(stageEvents()).toEqual([
      ["offer_buy_stage_opened", "bogo-or"],
      ["offer_buy_stage_completed", "bogo-or"],
    ]);
  });

  it("rollbackIfAbandoned reads the LIVE slot: an offer that landed before React re-rendered is never rolled back", async () => {
    setCart([sauceRow("s0")]);
    const { result } = renderHook(() => useBuyStage(true), { wrapper });
    act(() => result.current.start(OR_BOGO, PLAIN_OR_VIEW));
    setCart([sauceRow("s0"), BURGER_ROW]);
    await act(async () => {
      await result.current.continueStage();
    });

    // ONE synchronous turn: the slot changes and the picker closes before
    // any re-render, so the release effect cannot have settled it first.
    act(() => {
      store.dispatch(applyOffer({ offer: OR_BOGO }));
      result.current.rollbackIfAbandoned();
    });

    expect(cart().cartItems).toEqual([sauceRow("s0"), BURGER_ROW]);
    expect(mockReplaceIndexedDbCart).not.toHaveBeenCalled();
    expect(stageEvents().map(([name]) => name)).toEqual([
      "offer_buy_stage_opened",
      "offer_buy_stage_completed",
    ]);
  });

  it("a blocked CONTINUE (sameOrLess) keeps the stage open and the cart untouched", async () => {
    setCart([sauceRow("s1")]);
    const { result } = renderHook(() => useBuyStage(true), { wrapper });

    act(() => result.current.start(SOL_AND, PLAIN_AND_VIEW));
    const before = structuredClone(cart().cartItems);
    let verdict: OfferCommitResult | undefined;
    await act(async () => {
      verdict = await result.current.continueStage();
    });

    expect(verdict).toEqual({ applied: false, blocked: "sameOrLess" });
    expect(result.current.buyStage?.offer).toBe(SOL_AND);
    expect(result.current.continuing).toBe(false);
    expect(cart().cartItems).toEqual(before);
    expect(Object.keys(cart().cartOffer ?? {})).toHaveLength(0);
    expect(stageEvents().map(([name]) => name)).toEqual(["offer_buy_stage_opened"]);
  });

  it("unmount during the continueStage await → nothing dispatched and no state set after the unmount", async () => {
    setCart([BURGER_ROW, sauceRow("s1", 2)]);
    // Installed BEFORE the first render: useDispatch hands out store.dispatch.
    const dispatchSpy = vi.spyOn(store, "dispatch");
    const { result, unmount } = renderHook(() => useBuyStage(true), { wrapper });
    act(() => result.current.start(LEAST, LEAST_VIEW));

    const errorSpy = vi.spyOn(console, "error");
    let pending: Promise<OfferCommitResult> = Promise.resolve({ applied: false });
    act(() => {
      pending = result.current.continueStage();
    });
    expect(result.current.continuing).toBe(true); // in flight
    const dispatchedBeforeUnmount = dispatchSpy.mock.calls.length;
    expect(dispatchedBeforeUnmount).toBeGreaterThan(0); // the commit itself ran
    unmount();

    const verdict = await pending;
    expect(verdict).toEqual({ applied: true });
    expect(dispatchSpy.mock.calls.length).toBe(dispatchedBeforeUnmount);
    expect(errorSpy).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
