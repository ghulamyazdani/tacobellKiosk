import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { pushCharges, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../BagSheet";
import "../../../i18n";

/*
  P9a (the D10 rule, applied to PAY): the checkout preflight awaits a menu
  revalidation, the server time and the scheduler sweep — none with a
  timeout — so idle can end the session under them. A late result must
  neither drive the emptied kiosk into the checkout fan-out nor raise the
  (redux, hence next-customer) global error.

  Seams: fetchMenu (answered by hand), the server-time trigger and the
  scheduler sweep (whose Dexie mirror has no IndexedDB in jsdom). The
  scheduler module is spread from the original so its dayjs plugin
  registration still runs. useNavigate is a spy.
*/

const mockNavigate = vi.fn();
const mockFetchMenu = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../hooks/menuHooks/useMenuConverters", () => ({
  default: () => ({
    fetchMenu: (...args: unknown[]) => mockFetchMenu(...args),
  }),
}));

vi.mock("@cx-sdk/catalog/services/settingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/settingsApi")>()),
  useLazyGetServerTimeQuery: () => [
    () => ({ unwrap: () => Promise.resolve({}) }),
  ],
}));

vi.mock("../../../hooks/schedulerHooks/useSchedulerConverter", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../hooks/schedulerHooks/useSchedulerConverter")
  >()),
  default: () => ({
    isValidAsPerSchedulers: () => true,
    updateCartItemsByMenu: async () => ({
      updatedCart: [],
      invalidSchedulerItemIds: [],
    }),
  }),
}));

/** Paid row (BagSheet.test fixture) — a valid, non-zero bill. */
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

const globalError = () =>
  (store.getState() as { appSettings: { showGlobalError: boolean } }).appSettings
    .showGlobalError;

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>
  );

/** PAY; the menu revalidation stays in flight until settled. */
const payWithRevalidationInFlight = () => {
  let settle!: { answer: (m: unknown) => void; fail: (e: unknown) => void };
  mockFetchMenu.mockReturnValue(
    new Promise((resolve, reject) => {
      settle = { answer: resolve, fail: reject };
    })
  );
  act(() => {
    fireEvent.click(screen.getByTestId("bag-pay"));
  });
  expect(mockFetchMenu).toHaveBeenCalledTimes(1);
  const flush = (fn: () => void) =>
    act(async () => {
      fn();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  return {
    answer: () => flush(() => settle.answer({})),
    fail: () => flush(() => settle.fail(new Error("getMenu 504"))),
  };
};

describe("BagSheet PAY — a late checkout result is dropped (P9a)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    mockNavigate.mockReset();
    mockFetchMenu.mockReset();
  });

  it("answered while the bag is up: continues into the checkout fan-out", async () => {
    mount();
    const pay = payWithRevalidationInFlight();

    await pay.answer();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringMatching(/^\/(tent|payment|customerName|phone)$/),
      { state: { checkoutRoute: expect.any(String) } }
    );
  });

  it("answered after the session ended: no navigation", async () => {
    const view = mount();
    const pay = payWithRevalidationInFlight();

    view.unmount();
    await pay.answer();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(globalError()).toBe(false);
  });

  it("failing while the bag is up: surfaces the global error (never a frozen sheet)", async () => {
    mount();
    const pay = payWithRevalidationInFlight();

    await pay.fail();

    expect(globalError()).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("failing after the session ended: no global error for the next customer", async () => {
    const view = mount();
    const pay = payWithRevalidationInFlight();

    view.unmount();
    await pay.fail();

    expect(globalError()).toBe(false);
  });
});

/*
  A non-empty charge at PAY: handlePay stores the bill's charges with
  setAppliedCharges, and Immer freezes whatever lands in the store. The bill
  is memoised and its getNetAmount() re-assigns every charge's `amount`, so
  storing the bill's OWN detail objects made the re-render that releases the
  PAY latch throw ("Cannot assign to read only property 'amount'").
*/
describe("BagSheet PAY — a non-empty charge", () => {
  const appliedCharges = () =>
    (store.getState() as unknown as { order: { appliedCharges: unknown } }).order
      .appliedCharges;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(pushCharges([{ name: "Bag fee", type: "fixed", value: 2 }]));
    mockNavigate.mockReset();
    mockFetchMenu.mockReset();
  });

  it("stores a copy: the bag still renders its total after PAY, and the order carries the fee", async () => {
    mount();
    // £8.60 + the £2 fee = £10.60; no disable_roundoff → whole units.
    expect(screen.getByTestId("bag-pay")).toHaveTextContent("£11.00");
    const pay = payWithRevalidationInFlight();

    await pay.answer();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("bag-pay")).toHaveTextContent("£11.00");
    expect(appliedCharges()).toEqual([
      expect.objectContaining({ name: "Bag fee", type: "fixed", amount: 2 }),
    ]);
  });
});
