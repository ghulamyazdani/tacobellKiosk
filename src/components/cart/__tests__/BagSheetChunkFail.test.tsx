import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setPipelines, setSelectedPipeline, setTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { store } from "../../../redux/app/store";
import { ErrorBoundary } from "../../../ErrorBoundary";
import BagSheet from "../BagSheet";
import "../../../i18n";

/*
  Lane figma-polish G2(b) — the WHOLE lazy UI chunk fails to load (a deploy
  re-hashed it inside chunkRecovery's 60 s no-reload window, so no reload
  heals it): every lazy part of the bag sits behind its own local boundary,
  so the bag degrades part by part instead of reaching the app crash screen —
  rows, totals and PAY stay, and PAY still checks out. The rail, the freebie
  picker and the celebration simply vanish; the rewards sheet and the buy
  stage show their named scrim, which closes them.
  The chunk REALLY rejects, for EVERY importer: one of its modules fails to
  evaluate, so each import() of bagLazyParts rejects — concurrent ones too
  (the bag's lazy parts all import it in the same render). A throwing
  vi.mock factory on bagLazyParts itself is NOT enough: Vitest 5 rejects only
  the first of several concurrent imports and hands the rest the real module,
  so the rewards sheet loaded its real code ~0.4 s later and the scrim seen
  was only Suspense's. Each test waits until every mounted part's boundary
  has tripped (one local_fallback per part) before it looks.
  Seams: analytics, navigation, PAY's revalidation (fetchMenu, the server
  time, the scheduler sweep), and the buy-stage hook (armed by hand — its
  real arming path is the rewards sheet, which is in the failed chunk).
*/

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  navigate: vi.fn(),
  fetchMenu: vi.fn(),
  stage: null as null | { buyStage: unknown; abandon: () => void },
}));

// A module only bagLazyParts imports: its evaluation fails, so does the chunk's.
vi.mock("../OrderTypeSwitchFlow", () => {
  throw new TypeError("Failed to fetch dynamically imported module: /assets/bagLazyParts-0ld.js");
});

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: mocks.capture,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../../hooks/menuHooks/useMenuConverters", () => ({
  default: () => ({ fetchMenu: (...args: unknown[]) => mocks.fetchMenu(...args) }),
}));

vi.mock("@cx-sdk/catalog/services/settingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/settingsApi")>()),
  useLazyGetServerTimeQuery: () => [() => ({ unwrap: () => Promise.resolve({}) })],
}));

vi.mock("../../../hooks/schedulerHooks/useSchedulerConverter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../hooks/schedulerHooks/useSchedulerConverter")>()),
  default: () => ({
    isValidAsPerSchedulers: () => true,
    updateCartItemsByMenu: async () => ({ updatedCart: [], invalidSchedulerItemIds: [] }),
  }),
}));

vi.mock("../../../hooks/offerHooks/useBuyStage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/offerHooks/useBuyStage")>();
  return {
    ...actual,
    default: (open: boolean) => {
      const real = actual.default(open);
      return mocks.stage ? { ...real, ...mocks.stage } : real;
    },
  };
});

/** Paid row — a valid, non-zero bill. */
const BURGER = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1",
  name: "Cheese Burger",
  quantity: 2,
  type: "ITEM",
  price: 8,
  total_price: 8,
};

/** One available bill offer, so the bag shows its rewards entry. */
const OFFER = {
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
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
  applicable: { on: "complete", categories: [], items: [], isExclude: false, isInclude: false, rawItems: [] },
  buyItems: {},
  getItems: {},
  itemQuantities: [],
  leastItemValueCount: { buyQuantity: null, getQuantity: null },
  buygetGroupWiseOfferValues: { discountType: "percent", value: null, getQuantity: null, buyQuantity: null },
};

const P1 = { _id: "p1", tab_id: "t1", tab_type: "dine_in" };
const cartItems = () => (store.getState() as unknown as { cart: { cartItems: Array<{ quantity: number }> } }).cart.cartItems;

/** The bag under the app's global boundary — a crash would show app-error. */
const localFallbacks = () =>
  mocks.capture.mock.calls.filter(
    ([event, props]) =>
      event === "error_occurred" && (props as { recovery_path?: string } | undefined)?.recovery_path === "local_fallback"
  ).length;

/**
 * The bag under the app's global boundary — a crash would show app-error.
 * `parts` = the lazy parts mounted with the bag: the rail, the rewards sheet,
 * the freebie picker and the celebration (+ the buy stage when armed).
 */
const renderBag = async (parts = 4) => {
  await act(async () => {
    render(
      <ErrorBoundary>
        <Provider store={store}>
          <MemoryRouter initialEntries={["/cart"]}>
            <BagSheet open onClose={vi.fn()} />
          </MemoryRouter>
        </Provider>
      </ErrorBoundary>
    );
  });
  // EVERY mounted part's own boundary caught the rejected import and said so.
  await waitFor(() => expect(localFallbacks()).toBe(parts));
  expect(mocks.capture).toHaveBeenCalledWith(
    "error_occurred",
    expect.objectContaining({ error_source: "react_boundary", recovery_path: "local_fallback" })
  );
};

const tap = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

describe("BagSheet with the lazy UI chunk failed (G2b): every part degrades locally", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setPipelines([P1]));
    store.dispatch(setSelectedPipeline(P1));
    store.dispatch(setTabType("dine_in"));
    store.dispatch(setCartItems([{ ...BURGER }]));
    store.dispatch(setFilteredOffers([OFFER]));
    mocks.capture.mockReset();
    mocks.navigate.mockReset();
    mocks.fetchMenu.mockReset();
    mocks.fetchMenu.mockResolvedValue({});
    mocks.stage = null;
    // React reports every boundary-caught error on the console.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    mocks.stage = null;
    vi.restoreAllMocks();
  });

  it("the simulation is a real rejection for every importer: concurrent imports of the chunk all reject", async () => {
    const imports = await Promise.allSettled([
      import("../bagLazyParts"),
      import("../bagLazyParts"),
      import("../bagLazyParts"),
    ]);

    expect(imports.map(({ status }) => status)).toEqual(["rejected", "rejected", "rejected"]);
  });

  it("no crash screen: rows, totals and PAY render — and PAY still checks out", async () => {
    await renderBag();

    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
    expect(mocks.capture).not.toHaveBeenCalledWith(
      "error_occurred",
      expect.objectContaining({ recovery_path: expect.stringMatching(/^\//) })
    );
    expect(screen.getByTestId("bag-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("bag-row-cb-1")).toHaveTextContent("Cheese Burger");
    const pay = screen.getByTestId("bag-pay");
    expect(pay).toBeEnabled();
    expect(pay).toHaveTextContent("£16.00");

    // The row still edits…
    fireEvent.click(screen.getByTestId("bag-inc-cb-1"));
    expect(cartItems()[0].quantity).toBe(3);

    // …and PAY runs its revalidation and moves on into the checkout.
    await tap("bag-pay");
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.fetchMenu).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/(tent|payment|customerName|phone)$/),
      { state: { checkoutRoute: expect.any(String) } }
    );
  });

  it("the rail, the celebration and the freebie picker are simply absent", async () => {
    await renderBag();

    expect(screen.queryByTestId("bag-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("offer-applied-celebration")).not.toBeInTheDocument();
    expect(screen.queryByTestId("freebie-picker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
  });

  it("the Rewards entry opens the NAMED rewards-loading scrim, which closes on tap; the bag stays", async () => {
    await renderBag();

    await tap("bag-rewards-entry");
    const scrim = screen.getByTestId("rewards-loading");
    expect(scrim).toHaveAccessibleName("Close rewards");
    expect(scrim).toHaveClass("absolute", "inset-0", "z-50");
    expect(screen.queryByTestId("rewards-sheet")).not.toBeInTheDocument();

    await tap("rewards-loading");
    expect(screen.queryByTestId("rewards-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-pay")).toBeEnabled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("an armed buy stage shows buy-stage-loading (named), whose tap abandons the stage", async () => {
    const abandon = vi.fn();
    mocks.stage = { buyStage: { offer: OFFER, view: {} }, abandon };
    await renderBag(5);

    const scrim = screen.getByTestId("buy-stage-loading");
    expect(scrim).toHaveAccessibleName("Close rewards");
    expect(scrim).toHaveClass("absolute", "inset-0", "z-50");
    expect(screen.queryByTestId("buy-stage-sheet")).not.toBeInTheDocument();

    await tap("buy-stage-loading");
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("app-error")).not.toBeInTheDocument();
  });
});
