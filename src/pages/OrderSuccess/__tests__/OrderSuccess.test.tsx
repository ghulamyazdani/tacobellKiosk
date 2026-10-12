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
  - useNavigate, so the one exit (the 20 s timer → /start) is assertable;
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
const panel = () => screen.getByTestId("order-success-panel");
const unlock = () => screen.queryByTestId("order-success-unlock");
/** The three annotation lines (each a rotated span in its positioned box). */
const unlockLines = () => [...(unlock()?.querySelectorAll("span") ?? [])];
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
      // Loyalty off: no points pitch at all (D8).
      expect(unlock()).toBeNull();
    });

    it('greets a recognised loyalty customer with the "ORDER" heading', () => {
      signIn();
      mount();

      expect(heading()).toContain(i18n.t("success.orderHeading"));
      // 1:3437 draws no unlock pitch for a customer already in loyalty.
      expect(unlock()).toBeNull();
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
    Figma 1:5932 / 1:3437 draw no control and no countdown: the screen has
    exactly one exit, its 20 s timer (user decision 2026-10-12 — the Rule 1
    "way back" exemption of an order confirmation).
  */
  describe("no controls (Figma)", () => {
    it.each([
      ["a guest", () => undefined],
      ["a guest on a loyalty deployment", loyaltyOn],
      ["an identified customer", signIn],
      ["ADA", () => store.dispatch(toggleAccessibilityMode())],
    ])("%s: no button, no progress bar, no countdown copy", (_who, seed) => {
      seed();
      mount();

      expect(screen.queryAllByRole("button")).toEqual([]);
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(heading()).not.toMatch(/returning|start over|new order/i);
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

    it("leaves the screen as it is on the way out: an identified customer under ADA keeps the ORDER heading, the number, the 725 panel and the zone (an emptied store would commit the guest frame on the full stage first)", () => {
      signIn();
      store.dispatch(toggleAccessibilityMode());
      mount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS);

      expect(mockNavigate).toHaveBeenCalledWith("/start");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(i18n.t("success.orderHeading"));
      expect(orderNumber()).toBe("#12345");
      expect(panel()).toHaveClass("top-[725px]", "invisible");
      expect(state().customerInfo.customerInfo.customerPhone).toBe("9876543210");
      expect(state().appSettings.accessibilityMode).toBe(true);
    });

    it("counts from arrival: a tap does not extend it", () => {
      mount();
      tick(ORDER_SUCCESS_COUNTDOWN_SECONDS - 5);
      fireEvent.pointerDown(root());
      fireEvent.click(root());
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
    audit-fixes B3 — a guest's analytics session starts at the splash tap.
    The timer's exit goes to /start, so it closes this guest and resets
    nothing; START OVER's click event is gone with the button.
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
    it("holds the idle clock while up — its own 20 s timer owns the exit", () => {
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
  customer), drawn where data exists: the "Gradient" + plastic_2 sheen, the
  photo panel (412×900, r56) at each frame's own top, Figma's one PROCEED
  line for every payment, and the guest's UNLOCK FREEBIES WITH POINTS only
  where loyalty is on. The QR, the points figure and the campaign copy have
  no source and are omitted, never faked.
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
    ["a guest (1:5932)", () => undefined, "top-[792px]", "top-[725px]", "panel-guest"],
    ["a guest on a loyalty deployment (1:5932)", loyaltyOn, "top-[792px]", "top-[725px]", "panel-guest"],
    ["an identified customer (1:3437)", signIn, "top-[725px]", "top-[792px]", "panel-loyalty"],
  ])("%s: the photo panel — 412×900 at x 334, r56, clipped, its frame's photo and nothing else", (_who, seed, top, otherTop, asset) => {
    seed();
    mount();

    const box = panel();
    expect(box).toHaveClass(top, "absolute", "left-[334px]", "h-[900px]", "w-[412px]", "rounded-[56px]", "overflow-hidden");
    expect(box).not.toHaveClass(otherTop);
    const images = box.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("alt", "");
    expect(images[0]).toHaveAttribute("draggable", "false");
    expect(images[0].getAttribute("src")).toContain(asset);
    // No QR (the Figma one scans to a brewery) and no copy on the photo.
    expect(box.querySelector("svg")).toBeNull();
    expect(box.textContent).toBe("");
  });

  it("a guest on a loyalty deployment gets UNLOCK / FREEBIES / WITH POINTS in reading order, FREEBIES yellow, under the mirrored arrow — painted AFTER the panel, so the arrowhead sits over the photo", () => {
    loyaltyOn();
    mount();

    const wrap = unlock() as HTMLElement;
    expect(wrap).toBeInTheDocument();
    // Real text (contract §3.5): nothing on its way up hides it from assistive tech.
    expect(wrap.closest('[aria-hidden="true"]')).toBeNull();
    expect(unlockLines().map((line) => line.textContent)).toEqual([
      i18n.t("success.unlockTop"),
      i18n.t("success.unlockFreebies"),
      i18n.t("success.unlockBottom"),
    ]);
    const [top, freebies, bottom] = unlockLines();
    expect(freebies).toHaveClass("text-tb-yellow", "tb-display", "font-bold", "rotate-15", "whitespace-nowrap");
    for (const line of [top, bottom]) {
      expect(line).toHaveClass("text-tb-surface", "font-bold", "uppercase", "rotate-15", "whitespace-nowrap");
    }
    expect(top.parentElement).toHaveClass("absolute", "-translate-x-1/2", "left-[875.22px]", "top-[1367.53px]");
    expect(freebies.parentElement).toHaveClass("absolute", "-translate-x-1/2", "left-[866.49px]", "top-[1384.21px]");
    expect(bottom.parentElement).toHaveClass("absolute", "-translate-x-1/2", "left-[859.72px]", "top-[1418.77px]");

    const arrow = wrap.querySelector("img") as HTMLImageElement;
    expect(arrow).toHaveClass("absolute", "left-[707.75px]", "top-[1272.6px]", "h-[63.434px]", "w-[144.259px]", "-scale-x-100", "rotate-[39.4deg]");
    expect(arrow).toHaveAttribute("alt", "");
    expect(arrow).toHaveAttribute("draggable", "false");
    expect(arrow.getAttribute("src")).toContain("unlock-arrow");

    expect(panel().compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["loyalty is off", () => undefined],
    ["an identified customer (1:3437)", signIn],
    ["an identified customer on a loyalty-OFF deployment", () => store.dispatch(setPhoneNumberRdx("9876543210"))],
  ])("no unlock pitch when %s — and no QR, points or campaign copy anywhere", (_when, seed) => {
    seed();
    mount();

    expect(unlock()).toBeNull();
    expect(heading()).not.toMatch(OMITTED_COPY);
  });

  it("no QR, points or campaign copy on the guest's loyalty frame either", () => {
    loyaltyOn();
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
  block of 1:5932 (guest) and 1:3437 / 1:3778 (loyalty) at top 345: a guest
  gets the Title/H3 thank-you (48/44, −1) on Figma's two lines ("THANK YOU" /
  "FOR YOUR ORDER"), 24 above the Title/H1 number (116/98, −3.27); a loyalty
  customer gets ONE H1 block — "ORDER" and the number both 116/98, the
  number at mt-0. The bell sits at 128; ADA centres the block in the reach
  zone and drops the bell.
*/
describe("OrderSuccess — the Figma text block (S4)", () => {
  const H1 = ["text-[116px]", "leading-[98px]", "tracking-[-3.27px]"];
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

  it("guest: the thank-you is Title/H3 on Figma's two lines (pre-line, no 569 box); the H1 number 24 below it; the block at 345 (920 wide); the bell at 128", () => {
    mount();

    // toHaveTextContent would collapse the copy's line break, not the expected string's.
    expect(heading().textContent).toBe(i18n.t("success.thankYou"));
    expect(heading()).toHaveClass("whitespace-pre-line", "text-[48px]", "leading-[44px]", "tracking-[-1px]");
    expect(heading()).not.toHaveClass("w-[569px]");
    expect(heading()).not.toHaveClass("mx-auto");
    expect(heading()).not.toHaveClass("text-[116px]");
    expect(number()).toHaveClass(...H1, "mt-[24px]");
    expect(block()).toHaveClass("top-[345px]", "w-[920px]");
    expect(block()).not.toHaveClass("top-1/2");
    expect(screen.getByTestId("order-success-proceed")).toHaveClass("tb-compressed", "mt-[24px]", "text-[34px]", "leading-[38px]");
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

  it("ADA centres the block in the reach zone (never the 345 top) and drops the bell; the classes follow the same split", () => {
    store.dispatch(toggleAccessibilityMode());
    mount();

    expect(block()).toHaveClass("top-1/2", "-translate-y-1/2", "-translate-x-1/2");
    expect(block()).not.toHaveClass("top-[345px]");
    expect(block().className).not.toContain("bottom-[");
    expect(heading()).toHaveClass("whitespace-pre-line", "text-[48px]");
    expect(screen.queryByAltText("Taco Bell")).not.toBeInTheDocument();
  });
});

/*
  Lane motion, rebuilt by lane order-success (MV2). The text block and the
  photo panel are .tb-enter blocks under the page's latched data-enter; the
  unlock arrow pops 300 ms in and its three lines 380 ms in (tokens, never
  raw ms); the number pops with ONE burst on an in-session arrival. Mounting
  a block (or flipping display: none → block) after the arrival would START
  its entrance on a live page — the ADA exit did (D-M6: the mode switch never
  animates). ADA hides the panel and the unlock with `invisible`, which
  restarts nothing.
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

  it("the ADA switch never remounts or un-displays the panel or the unlock (D-M6)", () => {
    loyaltyOn();
    store.dispatch(toggleAccessibilityMode());
    mount();
    const inAda = [panel(), unlock() as HTMLElement];
    expect(inAda[0]).toHaveClass("tb-enter", "invisible");
    expect(inAda[1]).toHaveClass("invisible");

    act(() => {
      store.dispatch(toggleAccessibilityMode()); // the brand-panel exit
    });
    expect(panel()).toBe(inAda[0]);
    expect(unlock()).toBe(inAda[1]);
    for (const element of inAda) {
      expect(element).not.toHaveClass("invisible");
      expect(element).not.toHaveClass("hidden");
    }
  });

  it("the unlock arrow pops 300 ms in and each line box 380 ms in — on the motion tokens, never raw ms", () => {
    loyaltyOn();
    mount();
    const wrap = unlock() as HTMLElement;

    expect(wrap.querySelector("img")).toHaveClass(
      "tb-pop-in",
      "[animation-delay:calc(var(--tb-dur-page)+var(--tb-stagger))]"
    );
    const boxes = unlockLines().map((line) => line.parentElement);
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box).toHaveClass("tb-pop-in", "[animation-delay:calc(var(--tb-dur-page)+3*var(--tb-stagger))]");
    }
    // The wrapper itself is static: the pops are the only motion in it.
    expect(wrap.className).not.toMatch(/tb-(enter|pop-in)/);
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

  it("tb-enter [--i] on the text block and the panel (0–1) — never the bell, the layers or the unlock", () => {
    loyaltyOn(); // the unlock is on screen
    notePath("/start");
    mountPushed();
    const blocks = [...root().querySelectorAll(".tb-enter")];
    expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0", "1"]);
    expect(blocks[0]).toContainElement(screen.getByTestId("order-number"));
    expect(blocks[0]).toContainElement(screen.getByTestId("order-success-proceed"));
    expect(blocks[1]).toBe(panel());
    expect(screen.getByAltText("Taco Bell").closest(".tb-enter")).toBeNull();
    expect(unlock()?.closest(".tb-enter")).toBeNull();
    expect(screen.getByTestId("order-success-bg").closest(".tb-enter")).toBeNull();
  });
});
