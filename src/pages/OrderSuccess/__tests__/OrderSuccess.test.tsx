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
import { setBillPaymentInfo, setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { readOpenPaytmSession } from "@cx-sdk/payments/gateways/paytmKiosk";
import { KioskEventName } from "@cx-sdk/core";
import { store } from "../../../redux/app/store";
import { IdleHoldContext } from "../../../hooks/utils/useIdleTimeout";
import { notePath } from "../../../hooks/utils/usePageEnter";
import { PAY_AT_COUNTER_PAYMENT_TYPE } from "../../../hooks/paymentsHooks/usePayAtCounter";
import OrderSuccess, { ORDER_SUCCESS_COUNTDOWN_SECONDS } from "../index";
import i18n from "../../../i18n";

/*
  HOUSE STYLE: real store + Provider + MemoryRouter + RESET_STATE + i18n.

  Mocked, and only these:
  - useNavigate, so the one exit (the countdown → /start) is assertable;
  - the analytics adapter (pass-through), so the order of the exit events
    — and that nothing resets the analytics session here (audit-fixes B3:
    the next guest's splash tap does) — is assertable;
  - usePrintUtility, so "printed exactly once, with the pushed order, BEFORE
    /start's reset wipes it" can be asserted by snapshotting the store at
    call time. The print gate itself is covered by usePrintUtility's own
    suite — and mocking it here also guarantees this file never reaches the
    print agent's URL.

  Nothing is reset here (hazard H1): the exit empties only the payment slice
  and navigates — /start's mount runs the full reset (StartScreen's suite) —
  so what the exit leaves in the store, and on screen, is asserted.
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

/** A loyalty deployment (enable_loyalty + the partner's runtime flag). */
const loyaltyOn = () => {
  store.dispatch(setKioskSettings({ enable_loyalty: true }));
  store.dispatch(turnOnLoyalty({}));
};
/** …and a customer who identified themselves this session (frame 1:3437). */
const signIn = () => {
  loyaltyOn();
  store.dispatch(setPhoneNumberRdx("9876543210"));
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

const tick = (seconds: number) => {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
};

const root = () => screen.getByTestId("order-success");
const orderNumber = () => screen.getByTestId("order-number").textContent;
const heading = () => root().textContent ?? "";
const newOrder = () => screen.getByTestId("order-success-new-order");
/** START NEW ORDER's ticking part, as rendered after the label. */
const countdown = () => screen.getByTestId("order-success-countdown").textContent;
const label = (seconds: number) => ` · ${i18n.t("success.countdown", { seconds })}`;
const fill = () => screen.getByTestId("order-success-countdown-fill");
/** The sr-only status as the first tick fills it (19 s left, unless that tick was late). */
const sentence = (seconds = ORDER_SUCCESS_COUNTDOWN_SECONDS - 1) => i18n.t("success.countdownA11y", { seconds });
/** Figma copy with no data source (QR, points, campaign) and the old panel's promo copy. */
const OMITTED_COPY = /scan to earn|110 points|for your meal|earn points|decades|merch|tuesday drops/i;

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
    });

    it('greets a recognised loyalty customer with the "ORDER" heading', () => {
      signIn();
      mount();

      expect(heading()).toContain(i18n.t("success.orderHeading"));
    });

    it("treats loyalty-on-but-anonymous as a guest", () => {
      // Loyalty being enabled on the deployment is not the same as this
      // customer having identified themselves.
      loyaltyOn();
      mount();

      expect(heading()).toContain(i18n.t("success.thankYou"));
    });

    it("treats an identified customer on a loyalty-off deployment as a guest", () => {
      store.dispatch(setPhoneNumberRdx("9876543210"));
      mount();

      expect(heading()).toContain(i18n.t("success.thankYou"));
    });

    it("shows the same order number either way", () => {
      signIn();
      mount();

      expect(orderNumber()).toBe("#12345");
    });
  });

  /*
    Figma 1:5932 / 1:3437 draw no control and no countdown. The screen has
    one exit (user decision 2026-10-12 — the Rule 1 "way back" exemption of
    an order confirmation), taken by its countdown or by START NEW ORDER
    (user 2026-10-13), whose label shows the countdown (user 2026-10-14).
  */
  describe("one control: START NEW ORDER, counting down (users 2026-10-13 / 2026-10-14)", () => {
    it.each([
      ["a guest", () => undefined],
      ["a guest on a loyalty deployment", loyaltyOn],
      ["an identified customer", signIn],
      ["ADA", () => store.dispatch(toggleAccessibilityMode())],
    ])("%s: the one button is START NEW ORDER, named without its seconds, showing the full countdown; no progressbar role", (_who, seed) => {
      seed();
      mount();

      expect(screen.getAllByRole("button")).toEqual([
        screen.getByRole("button", { name: i18n.t("success.startNewOrder") }),
      ]);
      expect(countdown()).toBe(label(ORDER_SUCCESS_COUNTDOWN_SECONDS));
      expect(screen.queryByRole("progressbar")).toBeNull();
    });
  });

  describe("the auto exit", () => {
    it("is still up at 19 s; at 20 s it goes to Splash ONCE, closing the paid Paytm session on the way — /start's mount runs the full reset (H1)", () => {
      // A paid EDC session is still in the payment slice on arrival.
      store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
      store.dispatch(setBillPaymentInfo({ posBillNo: "17000000000001234", posBillTime: 1_700_000_000_000 }));
      expect(readOpenPaytmSession(state().payment)).not.toBeNull();
      mount();

      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS - 1);
      expect(mockNavigate).not.toHaveBeenCalled();

      tick(1);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/start");
      // /start's Paytm release finds nothing to read for an order already paid…
      expect(readOpenPaytmSession(state().payment)).toBeNull();
      // …and nothing else is reset here: the order, the bag and the menu are /start's.
      expect(state().order.orderId).toBe(ORDER_ID);
      expect(state().cart.cartItems).toHaveLength(1);
      expect(state().menu.menu).toEqual(MENU_FIXTURE);
    });

    it("leaves the screen as it is on the way out: an identified customer under ADA keeps the ORDER heading, the number and the zone's layout — no bell, START NEW ORDER at its foot (an emptied store would commit the guest frame on the full stage first)", () => {
      signIn();
      store.dispatch(toggleAccessibilityMode());
      mount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS);

      expect(mockNavigate).toHaveBeenCalledWith("/start");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(i18n.t("success.orderHeading"));
      expect(orderNumber()).toBe("#12345");
      expect(screen.queryByAltText("Taco Bell")).toBeNull();
      expect(newOrder()).toHaveClass("bottom-[24px]");
      expect(newOrder()).not.toHaveClass("top-[1812px]");
      expect(state().customerInfo.customerInfo.customerPhone).toBe("9876543210");
      expect(state().appSettings.accessibilityMode).toBe(true);
    });

    it("counts from arrival: a tap does not extend it", () => {
      mount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS - 5);
      fireEvent.pointerDown(root());
      fireEvent.click(root());
      expect(countdown()).toBe(label(5));
      tick(5);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/start");
    });

    it("counts from arrival: a render on the way (the ADA switch at 15 s) never restarts it", () => {
      mount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS - 5);
      act(() => {
        store.dispatch(toggleAccessibilityMode());
      });
      expect(countdown()).toBe(label(5));
      tick(5);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/start");
    });

    it("never exits twice, however long the clock keeps running", () => {
      mount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS * 3);

      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("never exits twice when it renders again on its way out (in the app the emptied payment reaches it through usePrintUtility before the route changes)", () => {
      mount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS);
      expect(mockNavigate).toHaveBeenCalledTimes(1);

      act(() => {
        store.dispatch(setAmount(30));
      });

      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("clears its timer on unmount (Rule 5)", () => {
      const view = mount();
      view.unmount();
      // Nothing left pending: a leaked timeout would only set state on an unmounted screen (a no-op).
      expect(vi.getTimerCount()).toBe(0);
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS * 2);

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  /*
    The countdown (user 2026-10-14; design language — client sign-off): ONE
    clock, a deadline fixed at mount and read by a 1 s interval, drives the
    digits AND the exit, so the label can never disagree with the screen.
    The fill is CSS (index.css .tb-countdown-fill; jsdom runs no animation),
    so here: its class, its duration's source and its identity.
  */
  describe("the countdown (user 2026-10-14)", () => {
    beforeEach(() => {
      analyticsLog.length = 0;
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    });

    it("the label counts 20, 19 … 1, a second apart; at 0 the exit fires ONCE, as the timeout, and the clock stops", () => {
      mount();
      analyticsLog.length = 0; // the mount's OrderSuccessViewed

      const seen = [countdown()];
      for (let second = 1; second < ORDER_SUCCESS_COUNTDOWN_SECONDS; second += 1) {
        tick(1);
        seen.push(countdown());
      }
      expect(seen).toEqual(
        Array.from({ length: ORDER_SUCCESS_COUNTDOWN_SECONDS }, (_, i) => label(ORDER_SUCCESS_COUNTDOWN_SECONDS - i))
      );
      expect(mockNavigate).not.toHaveBeenCalled();

      tick(1);
      expect(mockNavigate.mock.calls).toEqual([["/start"]]);
      expect(analyticsLog[0]).toEqual(["capture", KioskEventName.startOverFromOrderSuccessTimeoutTriggered]);
      expect(vi.getTimerCount()).toBe(0);
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(analyticsLog.filter(([, event]) => event === KioskEventName.startOverFromOrderSuccessTimeoutTriggered)).toHaveLength(1);
    });

    it("reads the deadline, not a tick count: a late tick catches up — the screen reader's sentence too — and one past the deadline exits", () => {
      mount();
      // A throttled timer: the wall clock runs on 5 s with no tick.
      vi.setSystemTime(Date.now() + 5_000);
      tick(1);
      expect(countdown()).toBe(label(ORDER_SUCCESS_COUNTDOWN_SECONDS - 6));
      expect(screen.getByRole("status").textContent).toBe(sentence(ORDER_SUCCESS_COUNTDOWN_SECONDS - 6));
      expect(mockNavigate).not.toHaveBeenCalled();

      vi.setSystemTime(Date.now() + 60_000);
      tick(1);
      expect(mockNavigate.mock.calls).toEqual([["/start"]]);
      expect(analyticsLog).toContainEqual(["capture", KioskEventName.startOverFromOrderSuccessTimeoutTriggered]);
    });

    it("START NEW ORDER exits at once with the tap event and stops the clock: the digits freeze, the countdown never fires", () => {
      mount();
      tick(5);
      expect(countdown()).toBe(label(ORDER_SUCCESS_COUNTDOWN_SECONDS - 5));
      analyticsLog.length = 0;

      fireEvent.click(newOrder());

      expect(mockNavigate.mock.calls).toEqual([["/start"]]);
      expect(analyticsLog[0]).toEqual(["capture", KioskEventName.startOverFromOrderSuccessClicked]);
      expect(vi.getTimerCount()).toBe(0);
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS);
      expect(countdown()).toBe(label(ORDER_SUCCESS_COUNTDOWN_SECONDS - 5));
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(analyticsLog.map(([, event]) => event)).not.toContain(
        KioskEventName.startOverFromOrderSuccessTimeoutTriggered
      );
    });

    it("the accessible name never ticks (aria-label; the digits aria-hidden) and the screen reader gets the countdown ONCE: one sr-only status that mounts EMPTY (a live region must exist before its text does), is filled by the first tick, and never changes after", () => {
      mount();
      const button = screen.getByRole("button", { name: i18n.t("success.startNewOrder") });
      expect(button).toHaveAttribute("aria-label", i18n.t("success.startNewOrder"));
      expect(screen.getByTestId("order-success-countdown")).toHaveAttribute("aria-hidden", "true");
      const status = screen.getByRole("status");
      expect(status).toHaveClass("sr-only");
      expect(status.textContent).toBe("");

      tick(1);
      expect(screen.getByRole("status")).toBe(status);
      expect(status.textContent).toBe(sentence());

      tick(7);

      expect(countdown()).toBe(label(ORDER_SUCCESS_COUNTDOWN_SECONDS - 8));
      expect(button).toHaveAccessibleName(i18n.t("success.startNewOrder"));
      expect(screen.getByRole("status")).toBe(status);
      expect(status.textContent).toBe(sentence());
      // No per-second live region: the sentence is the screen's only one.
      expect(root().querySelectorAll('[aria-live], [role="status"], [role="timer"], [role="alert"], [role="log"]')).toHaveLength(1);
    });

    it("the fill: aria-hidden, the ONE CSS animation class, its duration fed from the constant, clipped by the button — nothing inline moves it, and no tick or ADA switch remounts it (a remount would restart the slide)", () => {
      mount();
      const slide = fill();
      expect(slide).toHaveAttribute("aria-hidden", "true");
      // 15 %: the white label over it keeps 3:1 on tb-orchid (contrast.test; 20 % gave 2.93).
      expect(slide).toHaveClass("tb-countdown-fill", "absolute", "inset-0", "bg-tb-surface/15");
      expect(slide.style.getPropertyValue("--tb-countdown")).toBe(`${ORDER_SUCCESS_COUNTDOWN_SECONDS}s`);
      expect([slide.style.transform, slide.style.animation, slide.style.width]).toEqual(["", "", ""]);
      expect(slide.parentElement).toBe(newOrder());
      expect(newOrder()).toHaveClass("overflow-hidden", "rounded-[8px]");

      tick(5);
      act(() => {
        store.dispatch(toggleAccessibilityMode());
      });
      tick(5);

      expect(fill()).toBe(slide);
    });

    it("Arabic: the label and its seconds in Arabic with Western digits, one dir=auto leaf; the name and the sentence in Arabic", async () => {
      await act(async () => {
        await i18n.changeLanguage("ar");
      });
      mount();

      expect(countdown()).toBe(label(ORDER_SUCCESS_COUNTDOWN_SECONDS));
      expect(countdown()).toContain(`${ORDER_SUCCESS_COUNTDOWN_SECONDS}`);
      expect(countdown()).toContain("ث");
      expect(screen.getByTestId("order-success-countdown").parentElement).toHaveAttribute("dir", "auto");
      expect(newOrder()).toHaveAccessibleName(i18n.t("success.startNewOrder"));
      expect(screen.getByRole("status").textContent).toBe("");
      tick(1);
      expect(countdown()).toContain(`${ORDER_SUCCESS_COUNTDOWN_SECONDS - 1}`);
      expect(screen.getByRole("status").textContent).toBe(sentence());
      expect(screen.getByRole("status").textContent).toContain("ثانية");
    });
  });

  /*
    audit-fixes B3 — a guest's analytics session starts at the splash tap.
    The timer's exit goes to /start, so it closes this guest and resets
    nothing; START NEW ORDER (2026-10-13) leaves the same way, reporting
    its click instead of the timeout.
  */
  describe("the analytics session (audit-fixes B3)", () => {
    beforeEach(() => {
      analyticsLog.length = 0;
    });

    it("the timer's exit: TimeoutTriggered, OrderCompleted, SessionEnd and AccountSignoutSuccess — once, and no reset", () => {
      mount();
      analyticsLog.length = 0; // the mount's OrderSuccessViewed
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS + 5);

      expect(analyticsLog).toEqual([
        ["capture", KioskEventName.startOverFromOrderSuccessTimeoutTriggered],
        ["capture", KioskEventName.OrderCompleted],
        ["capture", KioskEventName.SessionEnd],
        ["capture", KioskEventName.AccountSignoutSuccess],
      ]);
    });

    it("START NEW ORDER: the same exit at once, reporting the click — and the timer after it does nothing", () => {
      store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
      store.dispatch(setBillPaymentInfo({ posBillNo: "17000000000001234", posBillTime: 1_700_000_000_000 }));
      mount();
      expect(readOpenPaytmSession(state().payment)).not.toBeNull();
      analyticsLog.length = 0;

      fireEvent.click(screen.getByRole("button", { name: /start new order/i }));
      fireEvent.click(screen.getByRole("button", { name: /start new order/i }));
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS + 5);

      expect(analyticsLog).toEqual([
        ["capture", KioskEventName.startOverFromOrderSuccessClicked],
        ["capture", KioskEventName.OrderCompleted],
        ["capture", KioskEventName.SessionEnd],
        ["capture", KioskEventName.AccountSignoutSuccess],
      ]);
      expect(mockNavigate.mock.calls).toEqual([["/start"]]);
      expect(readOpenPaytmSession(state().payment)).toBeNull();
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

      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS);

      expect(mockNavigate).toHaveBeenCalledWith("/start");
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
      // it could prompt over this screen or end the session before the exit
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
  Lane order-success — Figma 1:5932 (guest) and 1:3437 (identified loyalty
  customer), drawn where data exists: the "Gradient" + plastic_2 sheen and
  Figma's one PROCEED line for every payment. The photo panel and the
  guest's UNLOCK FREEBIES WITH POINTS are gone (user 2026-10-14: "remove the
  static image in the middle"; the unlock arrow pointed into the photo). The
  QR, the points figure and the campaign copy have no source and are
  omitted, never faked.
*/
describe("OrderSuccess — the Figma frames (lane order-success)", () => {
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

  it("layers: the 1:5932 gradient and the plastic sheen at 50 %, both stage-registered (bottom-anchored, 1920 tall) — no texture tile, no inline gradient", () => {
    mount();

    const gradient = screen.getByTestId("order-success-bg");
    expect(gradient).toHaveClass("tb-order-gradient", "absolute", "bottom-0", "left-0", "h-[1920px]", "w-[1080px]");
    expect(gradient).toHaveAttribute("aria-hidden", "true");
    const sheen = root().querySelector('img[src*="plastic-overlay"]');
    expect(sheen).toHaveClass("opacity-50", "absolute", "bottom-0", "left-0", "h-[1920px]", "w-[1080px]");
    expect(sheen).toHaveAttribute("alt", "");
    expect(root().innerHTML).not.toContain("bg-texture");
    expect(root()).not.toHaveAttribute("style");
    expect(root()).toHaveClass("relative", "h-full", "w-[1080px]", "overflow-hidden");
  });

  it.each([
    ["a guest (1:5932)", () => undefined, ["sheen", "bell"]],
    ["a guest on a loyalty deployment (1:5932)", loyaltyOn, ["sheen", "bell"]],
    ["an identified customer (1:3437)", signIn, ["sheen", "bell"]],
    ["ADA", () => store.dispatch(toggleAccessibilityMode()), ["sheen"]],
    [
      "ADA, a guest on a loyalty deployment",
      () => {
        loyaltyOn();
        store.dispatch(toggleAccessibilityMode());
      },
      ["sheen"],
    ],
  ])("%s: no photo panel and no UNLOCK FREEBIES WITH POINTS (user 2026-10-14) — the only pictures are the sheen and the bell, and no QR", (_who, seed, pictures) => {
    seed();
    mount();

    expect(screen.queryByTestId("order-success-panel")).toBeNull();
    expect(screen.queryByTestId("order-success-unlock")).toBeNull();
    // The bell is a small SVG, inlined as a data: URI — known by its alt.
    const what = (img: HTMLImageElement) =>
      img.alt === "Taco Bell" ? "bell" : img.getAttribute("src")?.includes("plastic-overlay") ? "sheen" : img.getAttribute("src");
    expect([...root().querySelectorAll("img")].map(what)).toEqual(pictures);
    expect(root().querySelector("svg, canvas")).toBeNull();
    expect(heading()).not.toMatch(/unlock|freebies|with points/i);
  });

  it.each([
    ["loyalty is off", () => undefined],
    ["a guest on a loyalty deployment", loyaltyOn],
    ["an identified customer (1:3437)", signIn],
    ["an identified customer on a loyalty-OFF deployment", () => store.dispatch(setPhoneNumberRdx("9876543210"))],
  ])("no QR, points or campaign copy anywhere when %s", (_when, seed) => {
    seed();
    mount();

    expect(heading()).not.toMatch(OMITTED_COPY);
  });

  it.each([
    ["pay at counter", PAY_AT_COUNTER_PAYMENT_TYPE],
    ["a Paytm card payment", "PaytmEdc"],
    ["a Paytm QR payment", "PaytmDynamicQr"],
  ])("PROCEED is Figma's one line for %s", (_label, type) => {
    store.dispatch(setKioskPaymentType({ type }));
    mount();

    expect(screen.getByTestId("order-success-proceed").textContent).toBe(
      i18n.t("success.proceedToCounter")
    );
  });
});

/*
  Lane figma-polish S4 #5/#6/#7, rebuilt by lane order-success — the text
  block of 1:5932 (guest) and 1:3437 / 1:3778 (loyalty): a guest gets the
  Title/H3 thank-you (48/44, −1) on Figma's two lines ("THANK YOU" / "FOR
  YOUR ORDER"), 24 above the Title/H1 number (116/98, −3.27); a loyalty
  customer gets ONE H1 block — "ORDER" and the number both 116/98, the
  number at mt-0. With the panel gone (user 2026-10-14) ONE rule centres
  the block on the page: the stage, or ADA's reach zone. The bell sits at
  128; ADA drops it.
*/
describe("OrderSuccess — the Figma text block (S4)", () => {
  const H1 = ["text-[116px]", "leading-[98px]", "tracking-[-3.27px]"];
  const CENTRED = ["absolute", "left-1/2", "top-1/2", "-translate-x-1/2", "-translate-y-1/2", "w-[920px]"];
  const heading = () => screen.getByRole("heading", { level: 1 });
  const block = () => heading().parentElement as HTMLElement;
  const number = () => screen.getByTestId("order-number");

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

  it("guest: the thank-you is Title/H3 on Figma's two lines (pre-line, no 569 box); the H1 number 24 below it; the block centred on the stage (920 wide, never Figma's 345 top); the bell at 128", () => {
    mount();

    // toHaveTextContent would collapse the copy's line break, not the expected string's.
    expect(heading().textContent).toBe(i18n.t("success.thankYou"));
    expect(heading()).toHaveClass("whitespace-pre-line", "text-[48px]", "leading-[44px]", "tracking-[-1px]");
    expect(heading()).not.toHaveClass("w-[569px]");
    expect(heading()).not.toHaveClass("mx-auto");
    expect(heading()).not.toHaveClass("text-[116px]");
    expect(number()).toHaveClass(...H1, "mt-[24px]");
    expect(block()).toHaveClass(...CENTRED);
    expect(block()).not.toHaveClass("top-[345px]");
    expect(screen.getByTestId("order-success-proceed")).toHaveClass("tb-compressed", "mt-[24px]", "text-[34px]", "leading-[38px]");
    expect(screen.getAllByAltText("Taco Bell")[0]).toHaveClass("top-[128px]");
  });

  it("loyalty: ONE H1 block — 'ORDER' and the number both 116/98 −3.27, the number at mt-0, natural width — centred like the guest's", () => {
    signIn();
    mount();

    expect(heading()).toHaveTextContent(i18n.t("success.orderHeading"));
    expect(heading()).toHaveClass(...H1);
    expect(heading()).not.toHaveClass("w-[569px]");
    expect(heading()).not.toHaveClass("text-[48px]");
    expect(number()).toHaveClass(...H1, "mt-0");
    expect(number()).not.toHaveClass("mt-[24px]");
    expect(block()).toHaveClass(...CENTRED);
  });

  it("ONE centring rule for both modes: ADA's block carries exactly the stage's classes (centred in the reach zone, never a top or bottom offset) and drops the bell", () => {
    const view = mount();
    const stageClasses = block().className;
    view.unmount();

    store.dispatch(toggleAccessibilityMode());
    mount();

    expect(block().className).toBe(stageClasses);
    expect(block()).toHaveClass(...CENTRED);
    expect(block().className).not.toMatch(/\b(top|bottom)-\[/);
    expect(heading()).toHaveClass("whitespace-pre-line", "text-[48px]");
    expect(screen.queryByAltText("Taco Bell")).not.toBeInTheDocument();
  });
});

/*
  Lane motion, rebuilt by lane order-success (MV2). The text block is the
  one .tb-enter block under the page's latched data-enter; the number pops
  with ONE burst on an in-session arrival; the countdown fill slides in CSS
  (the countdown block above). Mounting a block after the arrival would
  START its entrance — or restart the slide — on a live page; the ADA exit
  did once (D-M6: the mode switch never animates).
*/
describe("OrderSuccess — motion (lane motion)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockNavigate.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    seedPlacedOrder();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the ADA switch never remounts the text block or the countdown fill (D-M6)", () => {
    loyaltyOn();
    store.dispatch(toggleAccessibilityMode());
    mount();
    const block = screen.getByRole("heading", { level: 1 }).parentElement as HTMLElement;
    const slide = fill();
    expect(block).toHaveClass("tb-enter");

    act(() => {
      store.dispatch(toggleAccessibilityMode()); // the brand-panel exit
    });

    expect(screen.getByRole("heading", { level: 1 }).parentElement).toBe(block);
    expect(fill()).toBe(slide);
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

  it("tb-enter [--i:0] on the text block only — never the bell, the layers, the button or its fill", () => {
    loyaltyOn();
    notePath("/start");
    mountPushed();
    const blocks = [...root().querySelectorAll(".tb-enter")];
    expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0"]);
    expect(blocks[0]).toContainElement(screen.getByTestId("order-number"));
    expect(blocks[0]).toContainElement(screen.getByTestId("order-success-proceed"));
    expect(screen.getByAltText("Taco Bell").closest(".tb-enter")).toBeNull();
    expect(newOrder().closest(".tb-enter")).toBeNull();
    expect(screen.getByTestId("order-success-bg").closest(".tb-enter")).toBeNull();
  });
});
