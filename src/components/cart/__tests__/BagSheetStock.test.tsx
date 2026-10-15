import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { applyOffer, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency, setShowErrorModalGlobal } from "@cx-sdk/catalog/state/appSettings.slice";
import { setUpdatedBaseItems } from "@cx-sdk/catalog/state/Menu.slice";
import {
  setAutenticationDetails,
  setSelectedTabId,
} from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../BagSheet";
import i18n from "../../../i18n";

/*
  audit-fixes A1 — PAY re-checks stock (the SDK sweep, lazy in bagLazyParts)
  before the checkout: an out-of-stock row or a broken choice keeps the
  guest on the bag with a message and the row's look; the check failing
  lets PAY through (fail OPEN, D-A1-1); a bag changed mid-check, or a bag
  that is gone, is never written to.
  Seams: navigation, analytics, PAY's revalidation (fetchMenu, the server
  time, the scheduler — it hands back COPIES of the rows, like the real
  one), the stock feed (answered by hand) and two pass-through spies:
  useCartHook.replaceCartItems (the ONE write) and
  useOfferApply.handleCartDrivenRemoval (the offer drop). The lazy-chunk
  rejection is BagSheetChunkFail's (a real one).
*/

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  capture: vi.fn(),
  fetchMenu: vi.fn(),
  feed: vi.fn<(body: unknown) => Promise<unknown>>(),
  invalid: [] as string[],
  /** A group the scheduler empties on its copies (an add-on out of its window). */
  dropGroup: null as string | null,
  replace: vi.fn(),
  removal: vi.fn(),
  /** The server clock's answer (getServerTime). */
  serverTime: vi.fn<() => Promise<unknown>>(),
  /** A scheduler that throws (a row it cannot read). */
  schedulerError: null as Error | null,
  /** The checkout-preflight step that throws once ("<step> broke"). */
  throwAt: null as "entry" | "decision" | "route" | null,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: mocks.capture,
}));

/** The min / max groups the tests use: exactly one pick required… */
const BOX_GROUP = { _id: "box_g", name: "Sides", min: 1, max: 1, order: 1 };
/** …a reward's one-option required group (the rewards sheet auto-picks it)… */
const BUN_GROUP = { _id: "bun_g", name: "Tortilla", min: 1, max: 1, order: 1 };
/** …and optional paid add-ons. */
const EXTRAS_GROUP = { _id: "extras_g", name: "Extras", min: 0, max: 2, order: 1 };
const GROUPS: Record<string, object> = {
  [BOX_GROUP._id]: BOX_GROUP,
  [BUN_GROUP._id]: BUN_GROUP,
  [EXTRAS_GROUP._id]: EXTRAS_GROUP,
};

vi.mock("../../../hooks/menuHooks/useMenuConverters", () => ({
  default: () => ({
    fetchMenu: (...args: unknown[]) => mocks.fetchMenu(...args),
    isAllowMultiplePunch: () => false,
    fetchModifierProperties: (ids: string[]) =>
      ids.map((id) => (GROUPS[id] ? { ...GROUPS[id] } : undefined)),
  }),
}));

vi.mock("@cx-sdk/catalog/services/settingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/settingsApi")>()),
  useLazyGetServerTimeQuery: () => [() => ({ unwrap: () => mocks.serverTime() })],
}));

/** The PAY decisions, real — each throws once while mocks.throwAt names its step. */
vi.mock("@cx-sdk/ordering/checkout/checkoutPreflight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cx-sdk/ordering/checkout/checkoutPreflight")>();
  const armed =
    <A extends unknown[], R>(step: NonNullable<typeof mocks.throwAt>, fn: (...args: A) => R) =>
    (...args: A): R => {
      if (mocks.throwAt === step) {
        mocks.throwAt = null;
        throw new Error(`${step} broke`);
      }
      return fn(...args);
    };
  return {
    ...actual,
    evaluateCheckoutEntryGuards: armed("entry", actual.evaluateCheckoutEntryGuards),
    resolveCheckoutStockDecision: armed("decision", actual.resolveCheckoutStockDecision),
    getCheckoutNetAmount: armed("route", actual.getCheckoutNetAmount),
  };
});

vi.mock("@cx-sdk/catalog/services/outOfStockApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/outOfStockApi")>()),
  useGetOutOfStockMutation: () => [(body: unknown) => ({ unwrap: () => mocks.feed(body) })],
}));

vi.mock("../../../hooks/schedulerHooks/useSchedulerConverter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../hooks/schedulerHooks/useSchedulerConverter")>()),
  default: () => ({
    isValidAsPerSchedulers: () => true,
    updateCartItemsByMenu: async (rows: { id: string; customizations?: Record<string, unknown[]> }[]) => {
      if (mocks.schedulerError) throw mocks.schedulerError;
      return {
      updatedCart: structuredClone(rows).map((row) => {
        const copy = { ...row, isAvailable: !mocks.invalid.includes(row.id) };
        // The real engine splices an add-on out of its window from the copy
        // and reports nothing (schedulerEngine.applySchedulersToCartItems).
        if (mocks.dropGroup && copy.customizations?.[mocks.dropGroup]) {
          copy.customizations = { ...copy.customizations, [mocks.dropGroup]: [] };
        }
        return copy;
      }),
      invalidSchedulerItemIds: rows.filter((row) => mocks.invalid.includes(row.id)).map((row) => row.id),
      };
    },
  }),
}));

vi.mock("../../../hooks/menuHooks/useCartHook", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/menuHooks/useCartHook")>();
  return {
    ...actual,
    default: () => {
      const real = actual.default();
      return {
        ...real,
        replaceCartItems: (rows: unknown[]) => {
          mocks.replace(rows);
          real.replaceCartItems(rows);
        },
      };
    },
  };
});

vi.mock("../../../hooks/offerHooks/useOfferApply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/offerHooks/useOfferApply")>();
  return {
    ...actual,
    default: () => {
      const real = actual.default();
      return {
        ...real,
        handleCartDrivenRemoval: (silent: boolean) => {
          mocks.removal(silent);
          real.handleCartDrivenRemoval(silent);
        },
      };
    },
  };
});

const BURGER = { id: "burger", itemId: "b-1", name: "Cheese Burger", quantity: 1, type: "ITEM", price: 8, total_price: 8 };
const SALAD = { id: "salad", itemId: "s-1", name: "Greek Salad", quantity: 1, type: "ITEM", price: 6, total_price: 6 };
/** A committed 100 % freebie (redeemGetItem's stamps). */
const FREEBIE = {
  id: "sauce", itemId: "f-1", name: "Tortilla Sauce", quantity: 1, type: "ITEM", price: 2, total_price: 2,
  isGetItem: true, discountType: "percent", discountValue: 100,
};
/** A pack whose required slot is empty — a min / max error, never out of stock. */
const BOX = {
  id: "box", itemId: "x-1", name: "Dream box", quantity: 1, type: "CUSTOMIZABLE", price: 25, total_price: 25,
  customizations: { [BOX_GROUP._id]: [] }, baseItem: { id: "box", name: "Dream box", modifiers: [BOX_GROUP._id] },
};
/** A redeemed CUSTOMIZABLE XENO reward: its one-option required group auto-picked. */
const REWARD = {
  id: "wrap", itemId: "r-1", name: "Free Wrap", quantity: 1, type: "CUSTOMIZABLE",
  isLoyaltyItem: true, isRedeemed: true, discount_type: "percentage", discount_value: 100,
  price: 0, total_price: 0, undiscounted_price: 5, undiscounted_total_price: 5,
  extra_fields: [{ name: "Points Value", value: 300 }],
  customizations: {
    [BUN_GROUP._id]: [{ id: "bun", name: "Tortilla", entityType: "Addon", isActive: true, price: 0, quantity: 1 }],
  },
  baseItem: { id: "wrap", name: "Free Wrap", modifiers: [BUN_GROUP._id] },
};
/** A paid customizable row with a £2 add-on. */
const BURRITO = {
  id: "burrito", itemId: "w-1", name: "Burrito", quantity: 1, type: "CUSTOMIZABLE", price: 5, total_price: 7,
  customizations: {
    [EXTRAS_GROUP._id]: [{ id: "egg", name: "Egg", entityType: "Addon", isActive: true, price: 2, quantity: 1 }],
  },
  baseItem: { id: "burrito", name: "Burrito", modifiers: [EXTRAS_GROUP._id] },
};
/** A Large Pepsi whose SIZE the last PAY found out of stock — a stale flag now. */
const PEPSI_STALE_SIZE = {
  id: "pepsi", itemId: "p-1", name: "Pepsi", quantity: 1, type: "VARIANT", price: 3, total_price: 3, variantPrice: 3,
  selectedVariant: { id: "pepsi-l", name: "Large", price: 3, outOfStock: true },
  customizations: {},
  baseItem: { id: "pepsi", name: "Pepsi", hasVariant: true, variants: [{ id: "pepsi-l", name: "Large", price: 3 }] },
};
const OFFER = {
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
  isAvailable: true,
  applicable: { on: "complete", categories: [], items: [], isExclude: false, isInclude: false, rawItems: [] },
  buyItems: {},
  getItems: {},
};

/** The backend's feed entry: Kiosk, out of stock. */
const oos = (item_id: string) => ({ item_id, type: "item", partners: { partner_name: "Kiosk", inStock: false } });

type Row = { itemId: string; outOfStock?: boolean; isAvailable?: boolean };
interface State {
  cart: { cartItems: Row[]; cartOffer: Record<string, unknown>; offerRemovalModal: { isOpen: boolean } };
  appSettings: { showGlobalError: boolean; errorMessageGlobal: string };
  menu: { updatedBaseItems: unknown[]; minMaxErroredBaseItems: unknown[] };
  menuSelections: { outOfStockItems: Record<string, unknown> };
  loyalty: { totalLoyaltyPoints: number };
}
const st = () => store.getState() as unknown as State;
const row = (itemId: string) => st().cart.cartItems.find((r) => r.itemId === itemId);
const sweepFailed = () =>
  mocks.capture.mock.calls.some(
    ([event, props]) =>
      event === "error_occurred" && (props as { error_source?: string })?.error_source === "checkout_stock_sweep",
  );

const renderBag = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );

const pay = () =>
  act(async () => {
    fireEvent.click(screen.getByTestId("bag-pay"));
  });

/** Let a settled feed's continuation run to its end (a few microtasks). */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });

/** A feed answer held open until `answer` / `fail`. */
const holdFeed = () => {
  let settleFeed!: { answer: (feed: unknown) => void; fail: (error: unknown) => void };
  mocks.feed.mockReturnValueOnce(
    new Promise((resolve, reject) => {
      settleFeed = { answer: resolve, fail: reject };
    }),
  );
  return settleFeed;
};

describe("BagSheet PAY re-checks stock (A1)", () => {
  beforeAll(async () => {
    // The ONE lazy chunk, once: no test races a cold transform.
    await import("../bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(
      setAutenticationDetails({ deploymentDetails: { _id: "dep1" }, licenseDetails: { deployment_id: "dep1" } }),
    );
    store.dispatch(setSelectedTabId("t1"));
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
    });
    mocks.invalid = [];
    mocks.dropGroup = null;
    mocks.schedulerError = null;
    mocks.throwAt = null;
    mocks.fetchMenu.mockResolvedValue({});
    mocks.feed.mockResolvedValue([]);
    mocks.serverTime.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("out of stock: PAY stays on the bag — the notice NAMES the item (walk-oos), ONE write flagging the row, both lists set, the row looks unavailable", async () => {
    store.dispatch(setCartItems([{ ...BURGER }, { ...SALAD }]));
    mocks.feed.mockResolvedValue([oos("burger")]);
    renderBag();
    await pay();

    await waitFor(() => expect(st().appSettings.showGlobalError).toBe(true));
    expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Cheese Burger");
    expect(st().appSettings.errorMessageGlobal).toBe(i18n.t("bag.outOfStock", { names: "Cheese Burger" }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    // The request: every row's id, the deployment and the tab.
    expect(mocks.feed).toHaveBeenCalledWith({ items_id: ["burger", "salad"], deployment_id: "dep1", tab_id: "t1" });
    // ONE write, the engine's rows.
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(row("b-1")?.outOfStock).toBe(true);
    expect(row("s-1")?.outOfStock).toBe(false);
    expect(st().menu.updatedBaseItems).toEqual(["b-1"]);
    expect(st().menu.minMaxErroredBaseItems).toEqual([]);
    expect(st().menuSelections.outOfStockItems).toEqual({
      burger: expect.objectContaining({ inStock: false, partner_name: "Kiosk" }),
    });
    expect(screen.getByTestId("bag-unavailable-b-1")).toHaveTextContent("Unavailable");
    expect(screen.queryByTestId("bag-unavailable-s-1")).not.toBeInTheDocument();
    expect(sweepFailed()).toBe(false);
    expect(mocks.removal).not.toHaveBeenCalled();

    // The latch is released: the next PAY checks again.
    await pay();
    await waitFor(() => expect(mocks.feed).toHaveBeenCalledTimes(2));
  });

  it("an out-of-stock freebie beside an out-of-stock paid row: the offer goes SILENTLY (one notice — the error)", async () => {
    store.dispatch(setCartItems([{ ...BURGER }, { ...FREEBIE }]));
    store.dispatch(applyOffer({ offer: OFFER }));
    mocks.feed.mockResolvedValue([oos("burger"), oos("sauce")]);
    renderBag();
    await pay();

    await waitFor(() => expect(mocks.removal).toHaveBeenCalledWith(true));
    expect(mocks.removal).toHaveBeenCalledTimes(1);
    expect(Object.keys(st().cart.cartOffer ?? {})).toHaveLength(0);
    expect(row("f-1")).toBeUndefined();
    expect(st().cart.offerRemovalModal.isOpen).toBe(false);
    // The notice names what the guest must resolve — never the auto-removed freebie.
    expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Cheese Burger");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("only the freebie out of stock: the offer goes WITH its removal notice and no out-of-stock error", async () => {
    store.dispatch(setCartItems([{ ...BURGER }, { ...FREEBIE }]));
    store.dispatch(applyOffer({ offer: OFFER }));
    mocks.feed.mockResolvedValue([oos("sauce")]);
    renderBag();
    await pay();

    await waitFor(() => expect(mocks.removal).toHaveBeenCalledWith(false));
    expect(st().cart.offerRemovalModal.isOpen).toBe(true);
    expect(row("f-1")).toBeUndefined();
    expect(st().appSettings.showGlobalError).toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("min / max: PAY stays — 'Some items in your bag need changes', the row says which and keeps Edit", async () => {
    store.dispatch(setCartItems([{ ...BOX }]));
    renderBag();
    await pay();

    await waitFor(() => expect(st().appSettings.showGlobalError).toBe(true));
    expect(st().appSettings.errorMessageGlobal).toBe(i18n.t("bag.someNeedChanges"));
    expect(st().menu.minMaxErroredBaseItems).toEqual(["x-1"]);
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("bag-changed-x-1")).toHaveTextContent(i18n.t("bag.choicesUnavailable"));
    expect(screen.queryByTestId("bag-unavailable-x-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-edit-x-1")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("the scheduler's unavailable item (in stock): the ONE write lands its flag — the row now looks unavailable — and PAY stays with its notice", async () => {
    store.dispatch(setCartItems([{ ...BURGER }, { ...SALAD }]));
    mocks.invalid = ["salad"];
    renderBag();
    await pay();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
    await settle();
    expect(st().appSettings.errorMessageGlobal).toBe(i18n.t("bag.itemUnavailable"));
    expect(st().menu.updatedBaseItems).toEqual([]);
    expect(row("s-1")?.isAvailable).toBe(false);
    expect(row("b-1")?.isAvailable).toBe(true);
    expect(screen.getByTestId("bag-unavailable-s-1")).toHaveTextContent("Unavailable");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("min / max beside the scheduler's unavailable item: its notice alone, never a second one over it", async () => {
    store.dispatch(setCartItems([{ ...BOX }, { ...SALAD }]));
    mocks.invalid = ["salad"];
    renderBag();
    await pay();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
    await settle();
    expect(st().menu.minMaxErroredBaseItems).toEqual(["x-1"]);
    expect(st().appSettings.errorMessageGlobal).toBe(i18n.t("bag.itemUnavailable"));
    expect(screen.getByTestId("bag-changed-x-1")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("in stock: no write, stale lists cleared, PAY proceeds", async () => {
    store.dispatch(setCartItems([{ ...BURGER }]));
    store.dispatch(setUpdatedBaseItems({ updatedBaseItems: ["gone-1"] }));
    renderBag();
    await pay();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(st().menu.updatedBaseItems).toEqual([]);
    expect(st().appSettings.showGlobalError).toBe(false);
    expect(sweepFailed()).toBe(false);
  });

  it("a stale flag from the last PAY, back in stock: ONE write clears it and PAY proceeds", async () => {
    store.dispatch(setCartItems([{ ...BURGER, outOfStock: true }]));
    renderBag();
    expect(screen.getByTestId("bag-unavailable-b-1")).toBeInTheDocument();
    await pay();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(row("b-1")?.outOfStock).toBe(false);
  });

  it("a stale SIZE flag, back in stock: the ONE write clears the size's flag too — the row is available again — and PAY proceeds", async () => {
    store.dispatch(setCartItems([structuredClone(PEPSI_STALE_SIZE)]));
    renderBag();
    expect(screen.getByTestId("bag-unavailable-p-1")).toBeInTheDocument();
    await pay();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    const pepsi = row("p-1") as Row & { selectedVariant?: { outOfStock?: boolean } };
    expect(pepsi.selectedVariant?.outOfStock).toBe(false);
    expect(screen.queryByTestId("bag-unavailable-p-1")).not.toBeInTheDocument();
  });

  /*
    Fixer F2: a stale flag alone lets PAY proceed on the bill the bag
    rendered — the write clears the flag on the LIVE rows. Writing the swept
    rows would also land an add-on the scheduler dropped silently, under an
    order priced and charged with it.
  */
  it("a stale flag beside an add-on the scheduler drops silently: the PAY that proceeds clears ONLY the flag — the bag keeps what it priced", async () => {
    store.dispatch(setCartItems([{ ...BURGER, outOfStock: true }, structuredClone(BURRITO)]));
    mocks.dropGroup = EXTRAS_GROUP._id;
    renderBag();
    const total = screen.getByTestId("bag-total").textContent;
    await pay();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(row("b-1")?.outOfStock).toBe(false);
    expect(row("w-1")).toEqual(
      expect.objectContaining({ total_price: 7, customizations: BURRITO.customizations }),
    );
    expect(screen.getByTestId("bag-total").textContent).toBe(total);
  });

  /*
    Fixer F1: a reward's auto-picked option goes out of stock. The reward has
    no Edit and no stepper, so Remove is its only way out — after PAY 1 AND
    after PAY 2, or every PAY stays blocked (Rule 1). Remove refunds the
    reward's points. walk-oos: the pick is KEPT, flagged (the fork drops it),
    so the row names it and PAY 2 — the option still out — blocks the same
    way, the notice naming it again.
  */
  it("a reward whose auto-picked option goes out of stock: Remove after PAY 1 and PAY 2, and it refunds the points", async () => {
    store.dispatch(setCartItems([{ ...BURGER }, structuredClone(REWARD)]));
    mocks.feed.mockResolvedValue([
      { item_id: "bun", type: "addon", partners: { partner_name: "Kiosk", inStock: false } },
    ]);
    renderBag();
    await pay();

    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Tortilla"));
    expect(st().menu.updatedBaseItems).toEqual(["r-1"]);
    const reward = row("r-1") as Row & { customizations?: Record<string, { id: string; outOfStock?: boolean }[]> };
    expect(reward.customizations?.[BUN_GROUP._id]).toEqual([
      expect.objectContaining({ id: "bun", outOfStock: true }),
    ]);
    expect(screen.getByTestId("bag-loyalty-remove-r-1")).toBeInTheDocument();

    act(() => {
      store.dispatch(setShowErrorModalGlobal({ showErrorModal: false, errorMessage: "" }));
    });
    await pay();
    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Tortilla"));
    expect(st().menu.updatedBaseItems).toEqual(["r-1"]);
    expect(screen.getByTestId("bag-loyalty-remove-r-1")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();

    const points = st().loyalty.totalLoyaltyPoints;
    fireEvent.click(screen.getByTestId("bag-loyalty-remove-r-1"));
    expect(row("r-1")).toBeUndefined();
    expect(row("b-1")).toBeDefined();
    expect(st().loyalty.totalLoyaltyPoints).toBe(points + 300);
  });

  it.each([
    ["the feed fails (a 504 / a timeout)", () => mocks.feed.mockRejectedValue(new Error("504"))],
    ["the feed is not a list", () => mocks.feed.mockResolvedValue({ message: "error" })],
  ])("%s: PAY proceeds (fail OPEN) and reports ErrorOccurred", async (_label, arrange) => {
    store.dispatch(setCartItems([{ ...BURGER }]));
    store.dispatch(setUpdatedBaseItems({ updatedBaseItems: ["b-1"] }));
    arrange();
    renderBag();
    await pay();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.capture).toHaveBeenCalledWith("error_occurred", { error_source: "checkout_stock_sweep" });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(st().appSettings.showGlobalError).toBe(false);
  });

  it("the bag changed while the check ran: no write, no message, no navigation — the next PAY checks the new bag", async () => {
    store.dispatch(setCartItems([{ ...BURGER }]));
    const feed = holdFeed();
    renderBag();
    await pay();
    await waitFor(() => expect(mocks.feed).toHaveBeenCalledTimes(1));

    act(() => {
      store.dispatch(setCartItems([{ ...BURGER, quantity: 2 }]));
    });
    feed.answer([oos("burger")]);
    await settle();

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(row("b-1")?.outOfStock).toBeUndefined();
    expect(st().menu.updatedBaseItems).toEqual([]);
    expect(st().appSettings.showGlobalError).toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();

    // The next PAY sweeps the bag as it is now (×2) and writes it.
    mocks.feed.mockResolvedValueOnce([oos("burger")]);
    await pay();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
    expect(row("b-1")).toEqual(expect.objectContaining({ quantity: 2, outOfStock: true }));
    expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Cheese Burger");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  /*
    walk-oos (user report 2026-10-14: "when customization is out of stock
    proper error message and indication of which item is out of stock should
    be there"). The fork's sweep DROPS the pick and lets the next PAY through
    without it; TB keeps it in the row, flagged: the notice and the row name
    it, its line still reads red, the money stays what the bag showed, and
    PAY stays blocked until the guest edits or removes the row.
  */
  it("walk-oos: an out-of-stock ADD-ON — PAY stays, the notice and the row NAME it, the pick stays flagged in the row (its total unchanged), Edit kept, and the next PAY blocks again", async () => {
    store.dispatch(setCartItems([structuredClone(BURRITO)]));
    mocks.feed.mockResolvedValue([
      { item_id: "egg", type: "addon", partners: { partner_name: "Kiosk", inStock: false } },
    ]);
    renderBag();
    await pay();

    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Egg"));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    const burrito = () =>
      row("w-1") as Row & { total_price?: number; customizations?: Record<string, { id: string; outOfStock?: boolean }[]> };
    expect(burrito().customizations?.[EXTRAS_GROUP._id]).toEqual([
      expect.objectContaining({ id: "egg", price: 2, outOfStock: true }),
    ]);
    expect(burrito().total_price).toBe(7);
    expect(st().menu.updatedBaseItems).toEqual(["w-1"]);
    expect(screen.getByTestId("bag-changed-w-1")).toHaveTextContent("Out of stock: Egg");
    expect(screen.getByTestId("bag-pick-oos-w-1-egg")).toHaveClass("text-tb-red");
    expect(screen.getByTestId("bag-pick-oos-w-1-egg")).toHaveTextContent("Egg +£2.00");
    expect(screen.getByTestId("bag-edit-w-1")).toBeInTheDocument();
    expect(screen.queryByTestId("bag-unavailable-w-1")).not.toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();

    // Still out: PAY never goes through without it.
    act(() => {
      store.dispatch(setShowErrorModalGlobal({ showErrorModal: false, errorMessage: "" }));
    });
    await pay();
    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Egg"));
    expect(mocks.replace).toHaveBeenCalledTimes(2);
    expect(burrito().customizations?.[EXTRAS_GROUP._id]).toEqual([
      expect.objectContaining({ id: "egg", outOfStock: true }),
    ]);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  /*
    Review F1: a check that cannot run fails OPEN (D-A1-1) only past what no
    check has flagged. The fork dropped an out-of-stock pick at PAY 1, so it
    could never be ordered; TB keeps it in the row, flagged — a failed feed
    at PAY 2 must not check it out (billed) while the row still names it.
  */
  it("walk-oos: PAY 1 flags an add-on, PAY 2's feed fails — the row's own flag still blocks PAY, the notice names it", async () => {
    store.dispatch(setCartItems([structuredClone(BURRITO)]));
    mocks.feed.mockResolvedValueOnce([
      { item_id: "egg", type: "addon", partners: { partner_name: "Kiosk", inStock: false } },
    ]);
    renderBag();
    await pay();
    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Egg"));
    act(() => {
      store.dispatch(setShowErrorModalGlobal({ showErrorModal: false, errorMessage: "" }));
    });

    mocks.feed.mockRejectedValueOnce(new Error("504"));
    await pay();
    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Egg"));
    expect(sweepFailed()).toBe(true);
    expect(mocks.feed).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("bag-pay")).toBeEnabled();
  });

  it.each([
    ["the item", () => ({ ...BURGER, outOfStock: true }), "Out of stock: Cheese Burger"],
    ["its size", () => structuredClone(PEPSI_STALE_SIZE), "Out of stock: Pepsi (Large)"],
  ])("walk-oos: the feed fails with %s flagged by the last PAY — PAY stays, the notice names it", async (_label, flagged, notice) => {
    store.dispatch(setCartItems([flagged(), { ...SALAD }]));
    mocks.feed.mockRejectedValue(new Error("504"));
    renderBag();
    await pay();

    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe(notice));
    expect(sweepFailed()).toBe(true);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("bag-pay")).toBeEnabled();
  });

  /*
    walk-oos 2 (user 2026-10-14, "Block while marked"): the feed down, PAY
    holds while any row or pick still carries a mark — a nested pick too —
    and names it; the guest edits or removes that line. Nothing marked: the
    same failed feed fails OPEN, as before (D-A1-1).
  */
  it("walk-oos 2: the feed down — a nested pick still marked blocks PAY by name; the guest removes the line and the same failed feed lets PAY through", async () => {
    const PACK = {
      id: "pack", itemId: "k-1", name: "Taco Pack", quantity: 1, type: "CUSTOMIZABLE", price: 9, total_price: 9,
      customizations: {
        [BOX_GROUP._id]: [
          {
            id: "fries", name: "Fries", entityType: "Combo", isActive: true, price: 0, quantity: 1,
            customizations: { [EXTRAS_GROUP._id]: [{ id: "salt", name: "Salt", isActive: true, price: 0, quantity: 1, outOfStock: true }] },
          },
        ],
      },
      baseItem: { id: "pack", name: "Taco Pack", modifiers: [BOX_GROUP._id] },
    };
    store.dispatch(setCartItems([PACK, { ...SALAD }]));
    mocks.feed.mockRejectedValue(new Error("504"));
    renderBag();
    await pay();

    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Salt"));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("bag-pay")).toBeEnabled();
    act(() => {
      store.dispatch(setShowErrorModalGlobal({ showErrorModal: false, errorMessage: "" }));
    });

    // The guest removes the marked line: nothing is marked any more.
    fireEvent.click(screen.getByTestId("bag-dec-k-1"));
    fireEvent.click(await screen.findByTestId("remove-item-confirm"));
    await waitFor(() => expect(row("k-1")).toBeUndefined());
    await pay();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.feed).toHaveBeenCalledTimes(2);
    expect(sweepFailed()).toBe(true);
    expect(st().appSettings.showGlobalError).toBe(false);
  });

  it("walk-oos: the flagged add-on back in stock — its own flag names it until then; ONE write clears it and PAY proceeds on the bill it rendered", async () => {
    const flagged = structuredClone(BURRITO);
    flagged.customizations[EXTRAS_GROUP._id] = [
      { ...flagged.customizations[EXTRAS_GROUP._id][0], outOfStock: true } as (typeof flagged.customizations)[string][number],
    ];
    store.dispatch(setCartItems([flagged]));
    renderBag();
    // The flag rides the row (persisted with it): no PAY list needed.
    expect(screen.getByTestId("bag-changed-w-1")).toHaveTextContent("Out of stock: Egg");
    const total = screen.getByTestId("bag-total").textContent;
    await pay();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(
      (row("w-1") as Row & { customizations?: Record<string, { outOfStock?: boolean }[]> }).customizations?.[
        EXTRAS_GROUP._id
      ],
    ).toEqual([expect.objectContaining({ id: "egg", outOfStock: false })]);
    expect(screen.queryByTestId("bag-changed-w-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-total").textContent).toBe(total);
    expect(st().appSettings.showGlobalError).toBe(false);
  });

  it("walk-oos: a SIZE out of stock — the notice names the item and its size", async () => {
    const pepsi = structuredClone(PEPSI_STALE_SIZE);
    pepsi.selectedVariant.outOfStock = false;
    store.dispatch(setCartItems([pepsi, { ...SALAD }]));
    mocks.feed.mockResolvedValue([
      { item_id: "pepsi-l", type: "variant", partners: { partner_name: "Kiosk", inStock: false } },
    ]);
    renderBag();
    await pay();

    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe("Out of stock: Pepsi (Large)"));
    expect(screen.getByTestId("bag-unavailable-p-1")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  /*
    Walk w4 #1: the first ORDER & PAY of an Arabic + ADA session waited with
    no sign of life, then showed "Something went wrong"; a second tap went
    through. PAY is busy while its checks run; the server clock — the one
    check here that could throw on the network — no longer fails PAY; and a
    step that does fail is reported by name.
  */
  it("w4 #1: PAY is busy — disabled, aria-busy, dimmed — while its checks run, and live again once they end", async () => {
    store.dispatch(setCartItems([{ ...BURGER }]));
    const feed = holdFeed();
    renderBag();
    const button = screen.getByTestId("bag-pay");
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    await pay();
    await waitFor(() => expect(mocks.feed).toHaveBeenCalledTimes(1));

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("opacity-40");
    // A second tap while it is busy starts nothing.
    await pay();
    expect(mocks.feed).toHaveBeenCalledTimes(1);

    feed.answer([oos("burger")]);
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).not.toHaveClass("opacity-40");
  });

  it("w4 #1: the server clock fails (a timeout) — PAY goes on with the device clock, never 'Something went wrong', and reports stage server_time", async () => {
    store.dispatch(setCartItems([{ ...BURGER }]));
    mocks.serverTime.mockRejectedValue({ status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" });
    renderBag();
    await pay();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(st().appSettings.showGlobalError).toBe(false);
    expect(mocks.feed).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith("error_occurred", {
      error_source: "checkout",
      stage: "server_time",
      error_status: "TIMEOUT_ERROR",
      error_detail: "TimeoutError: signal timed out",
    });
  });

  it("w4 #1: a step that throws (the scheduler) — the generic notice, ErrorOccurred names the step and the error, PAY live again", async () => {
    store.dispatch(setCartItems([{ ...BURGER }]));
    mocks.schedulerError = new Error("row without customizations");
    renderBag();
    await pay();

    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe(i18n.t("bag.checkoutFailed")));
    expect(mocks.capture).toHaveBeenCalledWith("error_occurred", {
      error_source: "checkout",
      stage: "scheduler",
      error_status: "Error",
      error_detail: "row without customizations",
    });
    expect(screen.getByTestId("bag-pay")).toBeEnabled();
    expect(mocks.feed).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  // Review: every step PAY's catch can be reached from reports its own name
  // — a wrong label sends the next walk to the wrong step.
  it.each([
    ["entry", () => void (mocks.throwAt = "entry")],
    ["menu", () => void mocks.fetchMenu.mockRejectedValue(new Error("menu broke"))],
    [
      "write_back",
      () => {
        mocks.feed.mockResolvedValue([oos("burger")]);
        mocks.replace.mockImplementationOnce(() => {
          throw new Error("write_back broke");
        });
      },
    ],
    ["decision", () => void (mocks.throwAt = "decision")],
    ["route", () => void (mocks.throwAt = "route")],
  ])("w4 #1: a throw at step '%s' — the generic notice, ErrorOccurred names that step, PAY live again", async (stage, arrange) => {
    store.dispatch(setCartItems([{ ...BURGER }]));
    renderBag();
    arrange();
    await pay();

    await waitFor(() => expect(st().appSettings.errorMessageGlobal).toBe(i18n.t("bag.checkoutFailed")));
    expect(mocks.capture).toHaveBeenCalledWith("error_occurred", {
      error_source: "checkout",
      stage,
      error_status: "Error",
      error_detail: `${stage} broke`,
    });
    expect(screen.getByTestId("bag-pay")).toBeEnabled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("the bag is gone (the session ended) while the check ran: nothing is dispatched", async () => {
    store.dispatch(setCartItems([{ ...BURGER }]));
    const feed = holdFeed();
    const view = renderBag();
    await pay();
    await waitFor(() => expect(mocks.feed).toHaveBeenCalledTimes(1));
    const before = store.getState();

    view.unmount();
    feed.answer([oos("burger")]);
    await settle();

    expect(store.getState()).toBe(before);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(sweepFailed()).toBe(false);
  });
});
