import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  setKioskSettings,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { turnOfLoyalty, turnOnLoyalty } from "@cx-sdk/ordering/state/loyalty.slice";
import {
  selectCustomerName,
  setCustomerName,
  setPhoneNumberRdx,
} from "@cx-sdk/core/customer/customerInfo.slice";
import { store } from "../../../redux/app/store";
import { notePath } from "../../../hooks/utils/usePageEnter";
import CustomerName from "../index";
import i18n from "../../../i18n";

/*
  P9b R4 (U2): /customerName (the zero-bill loyalty push) renders the same
  order-error panel as /receipt. The push itself is the hook's (pinned in
  usePayAtCounter.test and ReceiptPreference.test); here the hook is a stub
  so the panel's copy switch can be driven directly.
*/

const pay = vi.hoisted(() => ({
  failed: true,
  onTimeout: false,
  pushing: false,
  retry: vi.fn(),
  dismissError: vi.fn(),
}));

// The CRM prefill's network edge (only this screen imports it): each lookup
// stays in flight until the test answers it; abort() rejects it, as RTK does.
const crm = vi.hoisted(() => ({
  abort: vi.fn(),
  lookups: [] as { answer: (body: unknown) => void; aborted: () => boolean }[],
}));
vi.mock("@cx-sdk/core/customer/services/customerInfo", () => ({
  useGetCustomerNameByNumberMutation: () => [
    () => {
      let answer!: (body: unknown) => void;
      let fail!: (error: Error) => void;
      let aborted = false;
      const done = new Promise((resolve, reject) => {
        answer = resolve;
        fail = reject;
      });
      crm.lookups.push({ answer, aborted: () => aborted });
      return {
        unwrap: () => done,
        abort: () => {
          aborted = true;
          crm.abort();
          fail(new Error("Aborted"));
        },
      };
    },
  ],
}));

vi.mock("../../../hooks/paymentsHooks/usePayAtCounter", () => ({
  default: () => ({
    start: () => {},
    isBuffering: false,
    isPushing: pay.pushing,
    hasFailed: pay.failed,
    failedOnTimeout: pay.failed && pay.onTimeout,
    retry: pay.retry,
    dismissError: pay.dismissError,
  }),
}));

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customerName"]}>
        <CustomerName />
      </MemoryRouter>
    </Provider>
  );

describe("/customerName order-error panel (P9b R4)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = true;
    pay.onTimeout = false;
    pay.retry.mockReset();
    pay.dismissError.mockReset();
  });

  it("after a timeout: the UNCERTAIN copy — never 'didn't reach the restaurant'", () => {
    pay.onTimeout = true;
    mount();

    const panel = screen.getByTestId("order-error");
    expect(
      screen.getByRole("alertdialog", {
        name: i18n.t("orderError.uncertainTitle"),
        description: i18n.t("orderError.uncertainMessage"),
      })
    ).toBe(panel);
    expect(panel).toHaveTextContent(i18n.t("orderError.uncertainTitle"));
    expect(panel).toHaveTextContent(i18n.t("orderError.uncertainMessage"));
    expect(panel).not.toHaveTextContent(i18n.t("orderError.message"));
  });

  it("after a clean, exhausted ladder: the ordinary copy", () => {
    mount();

    const panel = screen.getByTestId("order-error");
    expect(
      screen.getByRole("alertdialog", {
        name: i18n.t("orderError.title"),
        description: i18n.t("orderError.message"),
      })
    ).toBe(panel);
    expect(panel).toHaveTextContent(i18n.t("orderError.title"));
    expect(panel).toHaveTextContent(i18n.t("orderError.message"));
    expect(panel).not.toHaveTextContent(i18n.t("orderError.uncertainTitle"));
  });

  it("Retry goes back to the SAME hook instance (same order id) — no new push path", () => {
    pay.onTimeout = true;
    mount();

    fireEvent.click(screen.getByTestId("order-error-retry"));

    expect(pay.retry).toHaveBeenCalledTimes(1);
    expect(pay.dismissError).not.toHaveBeenCalled();
  });

  it("the empty-name placeholder is 55 % black (P9f contrast: 35 % was 2.43:1)", () => {
    pay.failed = false;
    mount();

    const placeholder = screen.getByText(i18n.t("customerName.placeholder"));
    expect(placeholder).toHaveClass("text-black/55");
    expect(placeholder).not.toHaveClass("text-black/35");
  });

  it("the start screen's backdrop: the texture tiles and the 50 % plastic sheen, stage-registered (user 2026-10-14)", () => {
    pay.failed = false;
    mount();

    const backdrop = screen.getByTestId("customer-name-backdrop");
    expect(backdrop.style.backgroundImage).toContain("bg-texture");
    expect(backdrop.style.backgroundSize).toBe("240px 240px");
    expect(backdrop).toHaveClass("bottom-0", "h-[1920px]", "w-[1080px]");
    const sheen = screen.getByTestId("customer-name-sheen");
    expect(sheen.getAttribute("src")).toContain("plastic-overlay");
    expect(sheen).toHaveClass("opacity-50", "pointer-events-none", "bottom-0", "h-[1920px]");
    const root = screen.getByTestId("customer-name-screen");
    expect(root.children[0]).toBe(backdrop);
    expect(root.children[1]).toBe(sheen);
  });
});

/*
  Lane motion (§2.3 / §2.7). The root's data-enter is latched at mount: none
  on a page load (POP), fwd on a PUSH, back on a PUSH to a screen already on
  the session trail (AppRoutes' notePath; seeded here). Only the content
  blocks carry tb-enter [--i]; CONTINUE / BACK, the footer and the overlays
  never move.
*/
describe("/customerName — the route entrance (lane motion)", () => {
  /** A PUSH from another route: <Navigate> fires after the first commit. */
  const mountPushed = () =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/from"]}>
          <Routes>
            <Route path="/from" element={<Navigate to="/customerName" />} />
            <Route path="/customerName" element={<CustomerName />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  const root = () => screen.getByTestId("customer-name-screen");

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = false;
    pay.onTimeout = false;
    notePath("/start");
  });

  it("a page load (POP) mounts still; a PUSH arrives fwd; a PUSH back to a visited /customerName arrives back", () => {
    const pop = mount();
    expect(root()).not.toHaveAttribute("data-enter");
    pop.unmount();

    const pushed = mountPushed();
    expect(root()).toHaveAttribute("data-enter", "fwd");
    pushed.unmount();

    notePath("/customerName");
    notePath("/payment");
    mountPushed();
    expect(root()).toHaveAttribute("data-enter", "back");
  });

  it("tb-enter [--i] on the title, copy, field and keyboard (0–3) — never CONTINUE / BACK (chrome, as /tent's pair), the footer or the error panel", () => {
    pay.failed = true;
    mountPushed();
    const blocks = [...root().querySelectorAll(".tb-enter")];
    expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0", "1", "2", "3"]);
    expect(blocks[0]).toBe(screen.getByRole("heading", { level: 1 }));
    expect(blocks[2]).toContainElement(screen.getByTestId("customer-name-input"));
    expect(blocks[3]).toContainElement(screen.getByTestId("kiosk-keyboard"));
    for (const id of ["customer-name-continue", "customer-name-back", "footer-cancel", "order-error"]) {
      expect(screen.getByTestId(id).closest(".tb-enter")).toBeNull();
    }
  });
});

/*
  motion-v2 MV3: the CRM prefill wait (it mounts with the page) shows the
  house sweep above its label — it was a still line.
*/
describe("/customerName — the CRM lookup wait", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = false;
    pay.onTimeout = false;
    crm.abort.mockReset();
    crm.lookups.length = 0;
  });

  it("a phone with no stored name: the loading layer stacks the house sweep above its label; leaving aborts the lookup", () => {
    store.dispatch(setPhoneNumberRdx("9953833675"));
    const view = mount();

    const loading = screen.getByTestId("customer-name-loading");
    expect(loading).toHaveClass("flex-col", "gap-[32px]");
    const sweep = loading.querySelectorAll(".tb-indeterminate");
    expect(sweep).toHaveLength(1);
    const track = sweep[0].parentElement as HTMLElement;
    expect(track).toHaveClass("overflow-hidden");
    expect(track.nextElementSibling).toHaveTextContent(i18n.t("customerName.loading"));
    expect(loading.querySelector("button")).toBeNull();
    // It mounts with the page, under the entering keyboard: never revealed late (motion-v2 MV4 "NOT on").
    expect(loading.closest(".tb-reveal-late")).toBeNull();

    view.unmount();
    expect(crm.abort).toHaveBeenCalled();
  });

  // StrictMode (every dev build) runs the mount effect twice: the first lookup
  // is aborted on the way to the second. Its stale settle used to end the wait
  // while the live lookup still ran (and forgot it, so leaving never aborted it).
  it("StrictMode's re-run: the aborted first lookup neither ends the wait nor forgets the live one", async () => {
    store.dispatch(setPhoneNumberRdx("9953833675"));
    const view = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/customerName"]}>
          <CustomerName />
        </MemoryRouter>
      </Provider>,
      { reactStrictMode: true }
    );
    expect(crm.lookups.map((lookup) => lookup.aborted())).toEqual([true, false]);
    await act(async () => {}); // the aborted lookup settles
    expect(screen.getByTestId("customer-name-loading")).toBeInTheDocument();

    view.unmount(); // leaving still aborts the live lookup
    expect(crm.lookups[1].aborted()).toBe(true);
  });

  it("the live lookup's answer ends the wait (and prefills the name)", async () => {
    store.dispatch(setPhoneNumberRdx("9953833675"));
    mount();
    await act(async () => {
      crm.lookups[0].answer([{ firstname: "Ana", updated: "2026-10-01T00:00:00Z" }]);
    });
    expect(screen.queryByTestId("customer-name-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("customer-name-input")).toHaveTextContent("Ana");
  });
});

/*
  User 2026-10-14: BACK returns to the step the guest came from (useCheckoutFlow)
  — /phone in checkout mode (CRM shown, loyalty off), else the table number,
  else the bag. It was always the bag. The typed name is kept for the way back.
*/
describe("/customerName — BACK to the step the guest came from", () => {
  const Landed = () => {
    const { pathname, state } = useLocation();
    return <p data-testid="landed">{`${pathname} ${JSON.stringify(state)}`}</p>;
  };
  const mountInFlow = () =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/customerName"]}>
          <Routes>
            <Route path="/customerName" element={<CustomerName />} />
            <Route path="*" element={<Landed />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  const back = () => fireEvent.click(screen.getByTestId("customer-name-back"));
  const loyaltyOn = () => {
    store.dispatch(setKioskSettings({ skip_crm_page: false, enable_loyalty: true }));
    store.dispatch(turnOnLoyalty({}));
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = false;
    pay.pushing = false;
    // A table order with CRM shown and loyalty off: bag → /tent → /phone → here.
    store.dispatch(setTabType("table"));
    store.dispatch(setKioskSettings({ skip_crm_page: false }));
    store.dispatch(turnOfLoyalty());
  });

  it("loyalty off: BACK opens /phone in CHECKOUT mode — the phone skipped or not — keeping the typed name", () => {
    mountInFlow();
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    back();

    expect(screen.getByTestId("landed")).toHaveTextContent('/phone {"checkoutRoute":"phone"}');
    expect(selectCustomerName(store.getState())).toBe("a");
  });

  it("loyalty on, a table order: the phone was asked before the menu, so BACK → the table number", () => {
    loyaltyOn();
    mountInFlow();
    back();

    expect(screen.getByTestId("landed")).toHaveTextContent("/tent null");
  });

  it("loyalty on, no table step: BACK → the bag", () => {
    loyaltyOn();
    store.dispatch(setTabType("take_away"));
    mountInFlow();
    back();

    expect(screen.getByTestId("landed")).toHaveTextContent("/cart null");
  });

  it("refused while the order is being pushed", () => {
    pay.pushing = true;
    mountInFlow();
    back();

    expect(screen.queryByTestId("landed")).toBeNull();
    expect(screen.getByTestId("customer-name-screen")).toBeInTheDocument();
  });

  it("CANCEL ORDER's NO reads NO, BACK — it stays on this screen, not the menu", () => {
    mountInFlow();
    fireEvent.click(screen.getByTestId("footer-cancel"));

    // Exact: "No, back to menu" contains "No, back" (review 2026-10-15).
    expect(screen.getByTestId("cancel-order-cancel").textContent).toBe(i18n.t("cancelOrder.back"));
    fireEvent.click(screen.getByTestId("cancel-order-cancel"));
    expect(screen.getByTestId("customer-name-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("landed")).toBeNull();
  });
});

/*
  Review 2026-10-15: /payment's BACK returns here, to a question the guest
  has already answered. The return shows what they left, a blank included:
  no second CRM lookup (up to 10 s behind a full-screen wait, then the CRM
  name back in the field). And a blank CONTINUE is committed, so a name the
  guest removed never goes out on the order.
*/
describe("/customerName — the way back from /payment", () => {
  const Landed = () => <p data-testid="landed">{useLocation().pathname}</p>;
  /** A PUSH, as /payment's BACK is: <Navigate> fires after the first commit. */
  const mountPushed = () =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/from"]}>
          <Routes>
            <Route path="/from" element={<Navigate to="/customerName" />} />
            <Route path="/customerName" element={<CustomerName />} />
            <Route path="*" element={<Landed />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  /** The session trail of a guest who answered this screen, then paid's BACK. */
  const answeredThenBack = () => {
    notePath("/customerName");
    notePath("/payment");
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = false;
    pay.pushing = false;
    crm.abort.mockReset();
    crm.lookups.length = 0;
    notePath("/start");
    store.dispatch(setKioskSettings({ skip_crm_page: false }));
    store.dispatch(turnOfLoyalty());
    store.dispatch(setPhoneNumberRdx("9953833675"));
  });

  it("a forward entry looks the phone up; the return from /payment does not: no wait, and the blank the guest left stays blank", () => {
    const forward = mountPushed();
    expect(crm.lookups).toHaveLength(1);
    expect(screen.getByTestId("customer-name-loading")).toBeInTheDocument();
    forward.unmount();

    answeredThenBack();
    mountPushed();

    expect(screen.getByTestId("customer-name-screen")).toHaveAttribute("data-enter", "back");
    expect(crm.lookups).toHaveLength(1);
    expect(screen.queryByTestId("customer-name-loading")).toBeNull();
    expect(screen.getByTestId("customer-name-input").textContent).toBe(i18n.t("customerName.placeholder"));
    expect(screen.getByTestId("customer-name-continue")).toBeEnabled();
  });

  it("the name cleared on the way back: CONTINUE commits the blank, so the removed name never goes out", () => {
    store.dispatch(setCustomerName("John"));
    answeredThenBack();
    mountPushed();
    expect(screen.getByTestId("customer-name-input").textContent).toBe("John");

    fireEvent.click(screen.getByTestId("customer-name-clear"));
    fireEvent.click(screen.getByTestId("customer-name-continue"));

    expect(screen.getByTestId("landed")).toHaveTextContent("/payment");
    expect(selectCustomerName(store.getState())).toBe("");
  });
});

/*
  Layout (user 2026-10-15: "whatever you did for phone number screen do same
  for customer name screen" — CustomerPhone.test's twin). CONTINUE / BACK are
  /tent's CONFIRM / NO THANKS classes, bottom-anchored 24px above the footer
  as on /phone: CONTINUE 1648, BACK 1756, footer 1864 — the same stage px in
  the ADA zone, which is bottom-aligned with the stage. Title, subtitle, field
  and keyboard are one flex column centred between the bell and CONTINUE,
  24px off each (248–1624; ADA, no bell: 0–826 of the zone). Geometry is
  measured in tests/e2e/nameLayout.spec.ts.
*/
describe("/customerName — the bottom pair and the centred block (user 2026-10-15)", () => {
  /** tent-confirm / tent-skip's classes, minus their slot. */
  const CONFIRM_LOOK = "tb-display absolute left-[24px] h-[84px] w-[1032px] rounded-[8px] bg-tb-surface text-center text-[24px] leading-[20px] text-tb-purple shadow-[0_20px_40px_rgba(0,0,0,0.15)]";
  const SKIP_LOOK = "tb-display absolute left-[24px] h-[84px] w-[1032px] rounded-[8px] border border-tb-surface text-center text-[24px] leading-[20px] text-tb-surface";
  const classes = (id: string) => screen.getByTestId(id).className.split(/\s+/);
  const bell = () => screen.queryByRole("img", { name: "Taco Bell" });
  const block = () => screen.getByTestId("customer-name-content");

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    pay.failed = false;
    pay.onTimeout = false;
    pay.pushing = false;
  });

  afterEach(() => {
    pay.pushing = false;
  });

  for (const ada of [false, true]) {
    const mode = ada ? "ADA" : "normal";

    it(`${mode}: CONTINUE is the table screen's white CONFIRM and BACK its outline NO THANKS, bottom-anchored on the footer — one BACK, none at the top`, () => {
      if (ada) store.dispatch(toggleAccessibilityMode());
      mount();

      expect(classes("customer-name-continue")).toEqual(
        expect.arrayContaining([...CONFIRM_LOOK.split(" "), "bottom-[188px]", "disabled:opacity-60"])
      );
      expect(classes("customer-name-back")).toEqual(expect.arrayContaining([...SKIP_LOOK.split(" "), "bottom-[80px]"]));
      for (const id of ["customer-name-continue", "customer-name-back"]) {
        expect(classes(id).filter((c) => /^(top|bottom)-/.test(c)), id).toHaveLength(1);
        expect(screen.getByTestId(id).className, id).not.toMatch(/bg-tb-pink|w-\[600px\]|top-\[40px\]|left-\[40px\]/);
      }
      expect(screen.getAllByRole("button", { name: i18n.t("customerName.back") })).toHaveLength(1);
      // Paint order: the block, then CONTINUE, then BACK.
      const order = [...screen.getByTestId("customer-name-screen").children];
      expect(order.indexOf(screen.getByTestId("customer-name-continue"))).toBe(order.indexOf(block()) + 1);
      expect(order.indexOf(screen.getByTestId("customer-name-back"))).toBe(order.indexOf(block()) + 2);
    });

    it(`${mode}: title, subtitle, name field and keyboard are one flex column centred ${ada ? "above CONTINUE" : "between the bell and CONTINUE"}; the bell ${ada ? "is dropped" : "sits at /tent's 135, outside it"}`, () => {
      if (ada) store.dispatch(toggleAccessibilityMode());
      mount();

      expect(classes("customer-name-content")).toEqual(
        expect.arrayContaining(["absolute", "inset-x-0", "bottom-[296px]", "flex", "flex-col", "items-center", "justify-center"])
      );
      // Normal: the room starts 24px under the bell (135 + 89 + 24), as it ends 24px above CONTINUE.
      expect(classes("customer-name-content").filter((c) => /^top-/.test(c))).toEqual([ada ? "top-0" : "top-[248px]"]);
      const parts = [...block().children];
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe(screen.getByRole("heading", { level: 1 }));
      expect(parts[0]).toHaveClass("min-h-[140px]");
      expect(parts[1]).toHaveTextContent(i18n.t("customerName.subtitle"));
      expect(parts[2]).toContainElement(screen.getByTestId("customer-name-input"));
      // The field still anchors its clear button.
      expect(parts[2]).toHaveClass("relative");
      expect(parts[3]).toContainElement(screen.getByTestId("kiosk-keyboard"));
      expect(parts[3]).toHaveClass("w-[1000px]");
      // In the flow: no part is positioned on its own any more.
      for (const part of parts) {
        expect(part.className).not.toMatch(/\babsolute\b|\btop-\[|-translate-x-1\/2/);
      }
      // The gaps: the subtitle 150px under the title's top (140 + 10), then the old 74 / 60 (ADA: 20 / 20).
      const gaps = parts.slice(1).map((part) => part.className.match(/\bmt-\[(\d+)px\]/)?.[1]);
      expect(gaps).toEqual(ada ? ["10", "20", "20"] : ["10", "74", "60"]);
      for (const id of ["customer-name-continue", "customer-name-back"]) {
        expect(block()).not.toContainElement(screen.getByTestId(id));
      }
      if (ada) {
        expect(bell()).toBeNull();
      } else {
        expect(bell()).toHaveClass("top-[135px]");
        expect(block()).not.toContainElement(bell());
      }
    });
  }

  it("an order being placed: CONTINUE is disabled, says so, and wears the house dim on white", () => {
    pay.pushing = true;
    mount();

    const button = screen.getByTestId("customer-name-continue");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(i18n.t("payment.placingOrder"));
    expect(button).toHaveClass("bg-tb-surface", "disabled:opacity-60");
  });
});
