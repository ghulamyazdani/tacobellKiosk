/* eslint-disable @typescript-eslint/no-explicit-any --
 * Order/menu fixtures mirror the untyped SDK slices this screen reads; typed
 * with those slices, not here. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { setKioskSettings, toggleAccessibilityMode } from "@cx-sdk/catalog/state/appSettings.slice";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  pushOrderInOngoingOrders,
  setOrderId,
} from "@cx-sdk/ordering/state/order.slice";
import { turnOnLoyalty } from "@cx-sdk/ordering/state/loyalty.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import { KioskEventName } from "@cx-sdk/core";
import { store } from "../../../redux/app/store";
import { IdleHoldContext } from "../../../hooks/utils/useIdleTimeout";
import { notePath } from "../../../hooks/utils/usePageEnter";
import OrderSuccess, { ORDER_SUCCESS_COUNTDOWN_SECONDS } from "../index";
import i18n from "../../../i18n";

/*
  HOUSE STYLE: real store + Provider + MemoryRouter + RESET_STATE + i18n.

  Mocked, and only these:
  - useNavigate, so the two exits (/start vs /second) are assertable;
  - the analytics adapter (pass-through), so the order of the exit events
    and the per-guest session reset (audit-fixes B3) is assertable;
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

/** Every analytics call, in order: ["capture", event] or ["reset"]. */
const { analyticsLog } = vi.hoisted(() => ({ analyticsLog: [] as unknown[][] }));

vi.mock("../../../utils/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils/analytics")>();
  return {
    ...actual,
    captureKioskEvent: (...args: Parameters<typeof actual.captureKioskEvent>) => {
      analyticsLog.push(["capture", args[0]]);
      actual.captureKioskEvent(...args);
    },
    resetAnalyticsSession: () => {
      analyticsLog.push(["reset"]);
      actual.resetAnalyticsSession();
    },
  };
});

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

  /*
    audit-fixes B3 — Place New Order skips the splash tap, where a guest's
    analytics session normally starts, so it resets the session itself:
    AFTER this guest's closing events. Start Over and the countdown go to
    /start, whose splash tap resets for the next guest.
  */
  describe("the analytics session (audit-fixes B3)", () => {
    beforeEach(() => {
      analyticsLog.length = 0;
    });

    const resets = () => analyticsLog.filter(([kind]) => kind === "reset");

    it("Place New Order: OrderCompleted, SessionEnd and AccountSignoutSuccess, THEN one reset", () => {
      mount();
      analyticsLog.length = 0; // the mount's OrderSuccessViewed
      tap("order-success-neworder");

      expect(analyticsLog).toEqual([
        ["capture", KioskEventName.OrderCompleted],
        ["capture", KioskEventName.SessionEnd],
        ["capture", KioskEventName.AccountSignoutSuccess],
        ["reset"],
      ]);
    });

    it("Start Over does not reset (the next guest's splash tap does)", () => {
      mount();
      tap("order-success-startover");

      expect(analyticsLog).toContainEqual(["capture", KioskEventName.SessionEnd]);
      expect(resets()).toEqual([]);
    });

    it("the countdown's exit does not reset either", () => {
      mount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS);

      expect(mockNavigate).toHaveBeenCalledWith("/start");
      expect(resets()).toEqual([]);
    });

    it("one exit, one reset: a second tap and the countdown add none", () => {
      mount();
      tap("order-success-neworder");
      tap("order-success-neworder");
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS + 5);

      expect(resets()).toHaveLength(1);
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

/*
  Lane figma-polish S4 #5/#6/#7 — the text block of 1:5932 (guest) and
  1:3437 / 1:3778 (loyalty) at top 345: a guest gets the Title/H3 thank-you
  (48/44, −1) in the frame's 569 px box, 24 above the Title/H1 number
  (116/98, −3.27); a loyalty customer gets ONE H1 block — "ORDER" and the
  number both 116/98, the number at mt-0. The bell sits at 128; ADA keeps its
  bottom-570 anchor (P9c) and drops the bell.
*/
describe("OrderSuccess — the Figma text block (S4)", () => {
  const H1 = ["text-[116px]", "leading-[98px]", "tracking-[-3.27px]"];
  const heading = () => screen.getByRole("heading", { level: 1 });
  const block = () => heading().parentElement as HTMLElement;
  const number = () => screen.getByTestId("order-number");
  const signIn = () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    store.dispatch(turnOnLoyalty({}));
    store.dispatch(setPhoneNumberRdx("9876543210"));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockNavigate.mockReset();
    mockPrintOrderTicket.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    seedPlacedOrder();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("guest: the thank-you is Title/H3 in the 569 px box; the H1 number 24 below it; the block at 345 (920 wide); the bell at 128", () => {
    mount();

    expect(heading()).toHaveTextContent(i18n.t("success.thankYou"));
    expect(heading()).toHaveClass("mx-auto", "w-[569px]", "text-[48px]", "leading-[44px]", "tracking-[-1px]");
    expect(heading()).not.toHaveClass("text-[116px]");
    expect(number()).toHaveClass(...H1, "mt-[24px]");
    expect(block()).toHaveClass("top-[345px]", "w-[920px]");
    expect(block().className).not.toContain("top-[300px]");
    expect(screen.getAllByAltText("Taco Bell")[0]).toHaveClass("top-[128px]");
  });

  it("loyalty: ONE H1 block — 'ORDER' and the number both 116/98 −3.27, the number at mt-0, natural width", () => {
    signIn();
    mount();

    expect(heading()).toHaveTextContent(i18n.t("success.orderHeading"));
    expect(heading()).toHaveClass(...H1);
    expect(heading()).not.toHaveClass("w-[569px]");
    expect(heading()).not.toHaveClass("text-[48px]");
    expect(number()).toHaveClass(...H1, "mt-0");
    expect(number()).not.toHaveClass("mt-[24px]");
    expect(block()).toHaveClass("top-[345px]");
  });

  it("ADA keeps the bottom-570 anchor (never the 345 top) and drops the bell; the classes follow the same split", () => {
    store.dispatch(toggleAccessibilityMode());
    mount();

    expect(block()).toHaveClass("bottom-[570px]");
    expect(block()).not.toHaveClass("top-[345px]");
    expect(heading()).toHaveClass("w-[569px]", "text-[48px]");
    expect(screen.queryByAltText("Taco Bell")).not.toBeInTheDocument();
  });
});

/*
  Lane motion. The promo panel is a .tb-enter block under the page's latched
  data-enter: mounting it (or flipping display: none → flex) after the
  arrival would START its entrance on a live page — the ADA exit did (D-M6:
  the mode switch never animates). ADA hides it with `invisible`, which
  restarts nothing. The countdown fill is a compositor-only translateX of a
  full-width rounded fill (a scaleX squashed its 6 px leading cap).
*/
describe("OrderSuccess — motion (lane motion)", () => {
  const panel = () =>
    screen.getByText(i18n.t("success.rewardsHeadline")).parentElement as HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    mockNavigate.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    seedPlacedOrder();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the ADA switch never remounts or un-displays the promo panel (D-M6)", () => {
    store.dispatch(toggleAccessibilityMode());
    mount();
    const inAda = panel();
    expect(inAda).toHaveClass("tb-enter", "invisible");

    act(() => {
      store.dispatch(toggleAccessibilityMode()); // the brand-panel exit
    });
    expect(panel()).toBe(inAda);
    expect(inAda).not.toHaveClass("invisible");
    expect(inAda).not.toHaveClass("hidden");
  });

  it("the countdown fill slides in from the left (translateX), never scaleX", () => {
    mount();
    const fill = screen.getByRole("progressbar").firstElementChild as HTMLElement;
    expect(fill.style.transform).toBe("translateX(-100%)");

    tick(5);
    expect(fill.style.transform).toBe("translateX(-75%)");
  });

  it("the fill is a full-width transform with a 1 s linear transition — never a width — and aria-valuenow still reports the progress", () => {
    mount();
    const bar = screen.getByRole("progressbar");
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).toHaveClass("w-full", "transition-transform", "duration-1000", "ease-linear");
    expect(fill.style.width).toBe("");
    expect(fill.style.transform).not.toMatch(/scale/);

    tick(5);
    expect(progress()).toBe(25);
    expect(fill.style.transform).toBe(`translateX(${progress() - 100}%)`);
    expect(fill.style.width).toBe("");
  });

  /** A PUSH from another route: <Navigate> fires after the first commit. */
  const mountPushed = () =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/from"]}>
          <Routes>
            <Route path="/from" element={<Navigate to="/orderSuccess" />} />
            <Route path="/orderSuccess" element={<OrderSuccess />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  const root = () => screen.getByTestId("order-success");
  const pieces = () => document.querySelectorAll(".tb-confetti-piece");

  it("a reload (POP) is still and never bursts; an in-session arrival (PUSH) is fwd with ONE 28-piece burst on the number", () => {
    notePath("/start");
    const pop = mount();
    expect(root()).not.toHaveAttribute("data-enter");
    expect(pieces()).toHaveLength(0);
    expect(screen.getByTestId("order-number")).toHaveClass("tb-pop-in");
    pop.unmount();

    notePath("/receipt");
    mountPushed();
    expect(root()).toHaveAttribute("data-enter", "fwd");
    const number = screen.getByTestId("order-number");
    expect(number).toHaveClass("tb-pop-in", "relative");
    const burst = number.querySelector(":scope > span");
    expect(burst).toHaveAttribute("aria-hidden", "true");
    expect(burst).toHaveClass("pointer-events-none", "absolute", "inset-0");
    expect(burst?.querySelectorAll(".tb-confetti-piece")).toHaveLength(28);
    expect(pieces()).toHaveLength(28); // ONE burst
    expect(orderNumber()).toBe("#12345"); // empty pieces: the called-out number is intact
  });

  it("the next customer's Order Complete (PLACE NEW ORDER chains them) arrives fwd and bursts again", () => {
    notePath("/orderSuccess"); // the previous customer
    for (const path of ["/second", "/menu", "/cart", "/payment", "/receipt"]) notePath(path);
    mountPushed();

    expect(root()).toHaveAttribute("data-enter", "fwd");
    expect(pieces()).toHaveLength(28);
  });

  it("tb-enter [--i] on the heading, the promo panel, the countdown and the buttons (0–3) — never the bell", () => {
    notePath("/start");
    mountPushed();
    const blocks = [...root().querySelectorAll(".tb-enter")];
    expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0", "1", "2", "3"]);
    expect(blocks[0]).toContainElement(screen.getByTestId("order-number"));
    expect(blocks[1]).toBe(panel());
    expect(blocks[2]).toContainElement(screen.getByRole("progressbar"));
    expect(blocks[3]).toContainElement(screen.getByTestId("order-success-neworder"));
    expect(screen.getByAltText("Taco Bell").closest(".tb-enter")).toBeNull();
  });
});
