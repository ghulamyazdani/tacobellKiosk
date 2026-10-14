import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setKioskSettings,
  setSkipPhoneAndName,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { turnOfLoyalty, turnOnLoyalty } from "@cx-sdk/ordering/state/loyalty.slice";
import { resolveCheckoutRoute } from "@cx-sdk/ordering/checkout/checkoutPreflight";
import { store } from "../../../redux/app/store";
import useCheckoutFlow, {
  nextCheckoutStep,
  previousCheckoutStep,
  type CheckoutFlow,
  type CheckoutStep,
} from "../useCheckoutFlow";

/*
  User 2026-10-14: every BACK returns to the screen the guest came from — on
  /payment the name step, or with CRM hidden "the previous level" — and
  never breaks the flow. Forward and BACK read ONE list of steps; the bag's
  PAY (the SDK's resolveCheckoutRoute) is pinned to it here.
*/

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

const ALL: CheckoutStep[] = ["/cart", "/tent", "/phone", "/customerName", "/payment", "/receipt"];

/** Every combination of the three settings, and the steps a guest walks under it. */
const FLOWS: Array<[string, CheckoutFlow, CheckoutStep[]]> = [
  ["CRM shown, table, loyalty off", { tabType: "table", skipCRM: false, isLoyaltyOn: false }, ["/cart", "/tent", "/phone", "/customerName", "/payment", "/receipt"]],
  ["CRM shown, table, loyalty on", { tabType: "table", skipCRM: false, isLoyaltyOn: true }, ["/cart", "/tent", "/customerName", "/payment", "/receipt"]],
  ["CRM shown, dine in, loyalty off", { tabType: "dine_in", skipCRM: false, isLoyaltyOn: false }, ["/cart", "/phone", "/customerName", "/payment", "/receipt"]],
  ["CRM shown, dine in, loyalty on", { tabType: "dine_in", skipCRM: false, isLoyaltyOn: true }, ["/cart", "/customerName", "/payment", "/receipt"]],
  ["CRM hidden, table, loyalty off", { tabType: "table", skipCRM: true, isLoyaltyOn: false }, ["/cart", "/tent", "/payment", "/receipt"]],
  ["CRM hidden, table, loyalty on", { tabType: "table", skipCRM: true, isLoyaltyOn: true }, ["/cart", "/tent", "/payment", "/receipt"]],
  ["CRM hidden, dine in, loyalty off", { tabType: "dine_in", skipCRM: true, isLoyaltyOn: false }, ["/cart", "/payment", "/receipt"]],
  ["CRM hidden, dine in, loyalty on", { tabType: "dine_in", skipCRM: true, isLoyaltyOn: true }, ["/cart", "/payment", "/receipt"]],
];

/** Forward taps from the bag until /receipt (bounded: a loop is a failure, not a hang). */
const walkForward = (flow: CheckoutFlow) => {
  const steps: CheckoutStep[] = ["/cart"];
  while (steps.length < 10 && steps[steps.length - 1] !== "/receipt") {
    steps.push(nextCheckoutStep(steps[steps.length - 1], flow));
  }
  return steps;
};

describe("the checkout steps — one list for forward and BACK", () => {
  it.each(FLOWS)("%s: forward from the bag walks exactly these steps", (_name, flow, walk) => {
    expect(walkForward(flow)).toEqual(walk);
  });

  it.each(FLOWS)("%s: BACK on each step lands on the one before it", (_name, flow, walk) => {
    const back = walk.slice(1).map((step) => previousCheckoutStep(step, flow));

    expect(back).toEqual(walk.slice(0, -1));
  });

  it.each(FLOWS)("%s: the step after the bag is the bag's own PAY pick (the SDK's resolveCheckoutRoute)", (_name, flow) => {
    expect(nextCheckoutStep("/cart", flow)).toBe(`/${resolveCheckoutRoute(flow)}`);
  });

  it.each(FLOWS)("%s: BACK from any step — even one this session skips (a stale URL) — never lands on a skipped step", (_name, flow, walk) => {
    for (const step of ALL.slice(1)) {
      expect(walk).toContain(previousCheckoutStep(step, flow));
    }
  });

  it.each(FLOWS)("%s: the list's ends stay put — no BACK before the bag, no step after the receipt question", (_name, flow) => {
    expect(previousCheckoutStep("/cart", flow)).toBe("/cart");
    expect(nextCheckoutStep("/receipt", flow)).toBe("/receipt");
    expect(previousCheckoutStep("/receipt", flow)).toBe("/payment");
  });

  it("the user's rule: BACK on /payment → the name step; with CRM hidden the previous level — the table number, else the bag", () => {
    expect(previousCheckoutStep("/payment", { tabType: "table", skipCRM: false, isLoyaltyOn: false })).toBe("/customerName");
    expect(previousCheckoutStep("/payment", { tabType: "table", skipCRM: true, isLoyaltyOn: false })).toBe("/tent");
    expect(previousCheckoutStep("/payment", { tabType: "dine_in", skipCRM: true, isLoyaltyOn: false })).toBe("/cart");
  });
});

describe("useCheckoutFlow — the kiosk's settings, navigated", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter>{children}</MemoryRouter>
    </Provider>
  );
  const flow = () => renderHook(() => useCheckoutFlow(), { wrapper }).result.current;
  const PHONE_CHECKOUT = ["/phone", { state: { checkoutRoute: "phone" } }];

  beforeEach(() => {
    mockNavigate.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setTabType("table"));
    store.dispatch(setKioskSettings({ skip_crm_page: false }));
    store.dispatch(turnOfLoyalty());
  });

  it("CRM shown, loyalty off: BACK on the name step opens /phone in CHECKOUT mode (the state /phone reads), and so does /tent's forward", () => {
    flow().goBack("/customerName");
    flow().goNext("/tent");

    expect(mockNavigate.mock.calls).toEqual([PHONE_CHECKOUT, PHONE_CHECKOUT]);
  });

  it("loyalty on (enable_loyalty AND the partner): the phone was asked before the menu, so BACK on the name step → /tent", () => {
    store.dispatch(setKioskSettings({ skip_crm_page: false, enable_loyalty: true }));
    store.dispatch(turnOnLoyalty({}));
    flow().goBack("/customerName");

    expect(mockNavigate.mock.calls).toEqual([["/tent"]]);
  });

  it("CRM hidden (skip_crm_page): BACK on /payment → /tent on a table order, /cart on any other", () => {
    store.dispatch(setKioskSettings({ skip_crm_page: true }));
    flow().goBack("/payment");
    store.dispatch(setTabType("take_away"));
    flow().goBack("/payment");

    expect(mockNavigate.mock.calls).toEqual([["/tent"], ["/cart"]]);
  });

  it("appSettings.skipPhoneAndName — set by no code — adds or skips no step", () => {
    store.dispatch(setSkipPhoneAndName(true));
    flow().goBack("/payment");
    flow().goBack("/customerName");

    expect(mockNavigate.mock.calls).toEqual([["/customerName"], PHONE_CHECKOUT]);
  });
});
