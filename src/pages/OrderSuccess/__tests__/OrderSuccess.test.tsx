/* eslint-disable @typescript-eslint/no-explicit-any --
 * Order/menu fixtures mirror the untyped SDK slices this screen reads; typed
 * with those slices, not here. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  pushOrderInOngoingOrders,
  setOrderId,
} from "@cx-sdk/ordering/state/order.slice";
import { turnOnLoyalty } from "@cx-sdk/ordering/state/loyalty.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import { store } from "../../../redux/app/store";
import { IdleHoldContext } from "../../../hooks/utils/useIdleTimeout";
import OrderSuccess, { ORDER_SUCCESS_COUNTDOWN_SECONDS } from "../index";
import i18n from "../../../i18n";

/*
  HOUSE STYLE: real store + Provider + MemoryRouter + RESET_STATE + i18n.

  Mocked, and only these:
  - useNavigate, so the two exits (/start vs /second) are assertable;
  - usePrintUtility, so "printed exactly once, with the pushed order, BEFORE
    the reset wiped it" can be asserted by snapshotting the store at call
    time. The print gate itself is covered by usePrintUtility's own suite —
    and mocking it here also guarantees this file never reaches the print
    agent's URL.

  useSessionReset is REAL: that is the whole point of the two exit tests. The
  scopes are told apart by what survives — "full" clears the menu (the loaders
  refetch it), "nextCustomer" keeps it so /second is instant.
*/

const mockNavigate = vi.fn();
const mockPrintOrderTicket = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../hooks/utils/usePrintUtility", () => ({
  default: () => ({
    shouldPrintReceipt: () => false,
    printOrderTicket: (...args: unknown[]) => mockPrintOrderTicket(...args),
  }),
}));

const state = () => store.getState() as any;

const ORDER_ID = "TB-ORDER-ABCDE12345";
const MENU_FIXTURE = { categories: [{ id: "c1", name: "Sides" }] };

/** The order snapshot `pushOrder` stores — what the ticket is built from. */
const pushedOrder = (orderId: string) => ({
  orderId,
  netAmount: 24.5,
  orderStatus: "PENDING",
  orderInfo: {
    source: { name: "Kiosk" },
    tabType: "table",
    tableNumber: "12",
    items: [{ name: "Crunchwrap Supreme", quantity: 1 }],
  },
});

/** The store as it is the instant the customer lands on Order Complete. */
const seedPlacedOrder = (orderId = ORDER_ID) => {
  store.dispatch(
    setCartItems([
      {
        id: "crunchwrap",
        itemId: "cw-1",
        name: "Crunchwrap Supreme",
        quantity: 1,
        type: "ITEM",
        total_price: 24.5,
      },
    ])
  );
  store.dispatch(setAmount(24.5));
  store.dispatch(setOrderId(orderId));
  store.dispatch(pushOrderInOngoingOrders(pushedOrder(orderId)));
  store.dispatch(setMenuData({ menu: MENU_FIXTURE }));
};

const mount = (locationState?: unknown) =>
  render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[{ pathname: "/orderSuccess", state: locationState }]}
      >
        <OrderSuccess />
      </MemoryRouter>
    </Provider>
  );

const tap = (testId: string) => {
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const tick = (seconds: number) => {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
};

const orderNumber = () => screen.getByTestId("order-number").textContent;
const heading = () => screen.getByTestId("order-success").textContent ?? "";
const progress = () =>
  Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));

describe("OrderSuccess — Order Complete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockNavigate.mockReset();
    mockPrintOrderTicket.mockReset();
    mockPrintOrderTicket.mockReturnValue(true);

    store.dispatch({ type: "RESET_STATE" });
    seedPlacedOrder();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the order number", () => {
    it("is the LAST FIVE characters of the order id", () => {
      mount();

      // "TB-ORDER-ABCDE12345" → the five characters called out at the counter.
      expect(orderNumber()).toBe("#12345");
    });

    it("tracks a different order id", () => {
      store.dispatch(setOrderId("QR-777-ZZ9XY"));
      mount();

      expect(orderNumber()).toBe("#ZZ9XY");
    });

    it("renders no stray hash when there is no order id at all", () => {
      store.dispatch(setOrderId(""));
      mount();

      expect(orderNumber()).toBe("");
    });
  });

  describe("guest vs logged-in", () => {
    it("thanks a guest by name-less salutation", () => {
      mount();

      expect(heading()).toContain(i18n.t("success.thankYou"));
      expect(heading()).not.toContain(i18n.t("success.orderHeading"));
      // Guest panel: the rewards invitation, not the merch promo.
      expect(heading()).toContain(i18n.t("success.rewardsHeadline"));
    });

    it('greets a recognised loyalty customer with the "ORDER" heading', () => {
      store.dispatch(setKioskSettings({ enable_loyalty: true }));
      store.dispatch(turnOnLoyalty({}));
      store.dispatch(setPhoneNumberRdx("9876543210"));
      mount();

      expect(heading()).toContain(i18n.t("success.orderHeading"));
      expect(heading()).toContain(i18n.t("success.promoHeadline"));
    });

    it("treats loyalty-on-but-anonymous as a guest", () => {
      // Loyalty being enabled on the deployment is not the same as this
      // customer having identified themselves.
      store.dispatch(setKioskSettings({ enable_loyalty: true }));
      store.dispatch(turnOnLoyalty({}));
      mount();

      expect(heading()).toContain(i18n.t("success.thankYou"));
    });

    it("treats an identified customer on a loyalty-off deployment as a guest", () => {
      store.dispatch(setPhoneNumberRdx("9876543210"));
      mount();

      expect(heading()).toContain(i18n.t("success.thankYou"));
    });

    it("shows the same order number either way", () => {
      store.dispatch(setKioskSettings({ enable_loyalty: true }));
      store.dispatch(turnOnLoyalty({}));
      store.dispatch(setPhoneNumberRdx("9876543210"));
      mount();

      expect(orderNumber()).toBe("#12345");
    });
  });

  describe("the countdown", () => {
    it("starts at the full window with an empty bar", () => {
      mount();

      expect(progress()).toBe(0);
      expect(heading()).toContain(
        i18n.t("success.autoReset", {
          seconds: ORDER_SUCCESS_COUNTDOWN_SECONDS,
        })
      );
    });

    it("runs the bar honestly from 0% to 100% (one constant, not three)", () => {
      mount();

      tick(5);
      expect(progress()).toBe(25);

      tick(5);
      expect(progress()).toBe(50);

      tick(10);
      expect(progress()).toBe(100);
    });

    it("counts the seconds down in the label", () => {
      mount();
      tick(3);

      expect(heading()).toContain(
        i18n.t("success.autoReset", {
          seconds: ORDER_SUCCESS_COUNTDOWN_SECONDS - 3,
        })
      );
    });

    it("takes the FULL reset back to Splash when nobody taps", () => {
      mount();
      expect(mockNavigate).not.toHaveBeenCalled();

      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS);

      expect(mockNavigate).toHaveBeenCalledWith("/start");
      expect(state().cart.cartItems).toEqual([]);
      expect(state().menu.menu).toEqual({});
    });

    it("does not fire the timeout twice if the clock keeps running", () => {
      mount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS + 10);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("clears its interval on unmount (Rule 5)", () => {
      const view = mount();
      view.unmount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS * 2);

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe("the two exits", () => {
    it('Start Over runs the FULL reset and goes to /start', () => {
      mount();
      tap("order-success-startover");

      expect(mockNavigate).toHaveBeenCalledWith("/start");
      expect(state().cart.cartItems).toEqual([]);
      expect(state().order.orderId).toBe("");
      // "full" drops the menu — the loaders refetch it on /start.
      expect(state().menu.menu).toEqual({});
    });

    it("Place New Order runs the nextCustomer reset and goes to /second", () => {
      mount();
      tap("order-success-neworder");

      expect(mockNavigate).toHaveBeenCalledWith("/second");
      expect(state().cart.cartItems).toEqual([]);
      expect(state().order.orderId).toBe("");
      // The fast path keeps the menu loaded — that IS the fast path.
      expect(state().menu.menu.categories).toHaveLength(1);
    });

    it("clears the customer with either scope", () => {
      store.dispatch(setPhoneNumberRdx("9876543210"));
      mount();
      tap("order-success-neworder");

      expect(state().customerInfo.customerInfo.customerPhone).toBe("");
      expect(state().appSettings.tent).toBeNull();
      expect(state().payment.paymentType).toBe("");
    });

    it("takes the first exit only — a second tap is inert", () => {
      mount();
      tap("order-success-startover");
      tap("order-success-neworder");

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/start");
    });

    it("a countdown that lands on the same tick as a tap does not double-exit", () => {
      mount();
      tap("order-success-neworder");
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS + 5);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/second");
    });
  });

  describe("the receipt print", () => {
    it("prints once on arrival, with the pushed order, before any reset", () => {
      mount({ receipt: "print" });

      expect(mockPrintOrderTicket).toHaveBeenCalledTimes(1);
      expect(mockPrintOrderTicket).toHaveBeenCalledWith("print", {
        order: pushedOrder(ORDER_ID),
        orderId: ORDER_ID,
        totalAmount: 24.5,
      });
      // The order the ticket was built from is still in the store at that
      // point — the reset that wipes it has not run yet.
      expect(state().order.currentOrder.orderId).toBe(ORDER_ID);
    });

    it("does not print again on the way out (per-order latch)", () => {
      mount({ receipt: "print" });
      expect(mockPrintOrderTicket).toHaveBeenCalledTimes(1);

      tap("order-success-startover");

      expect(mockPrintOrderTicket).toHaveBeenCalledTimes(1);
    });

    it('treats a missing router state as "none" — a reload must not reprint', () => {
      mount(undefined);

      expect(mockPrintOrderTicket).toHaveBeenCalledWith(
        "none",
        expect.anything()
      );
    });

    it("forwards the customer's actual choice", () => {
      mount({ receipt: "none" });

      expect(mockPrintOrderTicket).toHaveBeenCalledWith(
        "none",
        expect.anything()
      );
    });

    it("does not print when the pushed order is not this order", () => {
      // currentOrder still holds a PREVIOUS customer's order — printing it
      // would hand this customer the wrong receipt.
      store.dispatch(pushOrderInOngoingOrders(pushedOrder("SOME-OTHER-ID")));
      mount({ receipt: "print" });

      expect(mockPrintOrderTicket).not.toHaveBeenCalled();
    });

    it("does not print when there is no order id", () => {
      store.dispatch(setOrderId(""));
      mount({ receipt: "print" });

      expect(mockPrintOrderTicket).not.toHaveBeenCalled();
    });
  });

  describe("idle (P9a)", () => {
    it("holds the idle clock while up — its own countdown owns the exit", () => {
      // A push that outlived the hold cap left an idle period running; unheld,
      // it could prompt over this screen or end the session before leave()
      // sends its analytics.
      const hold = vi.fn<(delta: 1 | -1) => void>();
      const view = render(
        <IdleHoldContext.Provider value={hold}>
          <Provider store={store}>
            <MemoryRouter initialEntries={["/orderSuccess"]}>
              <OrderSuccess />
            </MemoryRouter>
          </Provider>
        </IdleHoldContext.Provider>
      );
      expect(hold.mock.calls).toEqual([[1]]);

      view.unmount();

      expect(hold.mock.calls).toEqual([[1], [-1]]);
    });
  });
});
