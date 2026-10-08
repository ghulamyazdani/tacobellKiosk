import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartInstructions, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import { store } from "../redux/app/store";
import useOrderHook from "../hooks/menuHooks/useOrderHook";

/*
  audit-fixes U3 — the bag's cooking instructions reach the order: the SDK's
  buildPushOrderPayload (behind useOrderHook.getPushOrderData) copies
  cart.instructions into `special_instructions` of BOTH bodies — the
  pay-at-counter push (`pushOrderData`) and the Paytm `order_details`
  (`toPush`, usePaytmCheckout). Read-only use of the real hook and builder.
*/

const CW = { id: "cw", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 9, price: 9 };

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(Provider, { store, children: createElement(MemoryRouter, { children }) });

const pushBodies = async () => {
  const { result } = renderHook(() => useOrderHook(), { wrapper });
  const { pushOrderData, toPush } = (await result.current.getPushOrderData("ORD-1")) as {
    pushOrderData: { special_instructions?: unknown };
    toPush: { special_instructions?: unknown };
  };
  return { pushOrderData, toPush };
};

describe("special_instructions on the order push (U3)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCartItems([CW]));
  });

  it("the saved note rides both bodies verbatim", async () => {
    store.dispatch(setCartInstructions("no onions, extra sauce"));
    const { pushOrderData, toPush } = await pushBodies();

    expect(pushOrderData.special_instructions).toBe("no onions, extra sauce");
    expect(toPush.special_instructions).toBe("no onions, extra sauce");
  });

  it("no note → an empty string (never a stale one: the reset and the empty-bag exit clear it)", async () => {
    store.dispatch(setCartInstructions("left by the last guest"));
    store.dispatch(setCartInstructions(""));
    const { pushOrderData, toPush } = await pushBodies();

    expect(pushOrderData.special_instructions).toBe("");
    expect(toPush.special_instructions).toBe("");
  });
});

/*
  audit-fixes UB5 / Q23 (fork parity): the guest's picked country never joins
  the customer's number on the order — customer.mobile stays the bare digits
  on BOTH bodies. The builder does read the pick in one place: the five
  nudgeNotification status callbacks carry its dial code (countryCode=971,
  digits only) — fork parity, pinned so a change is deliberate.
*/
describe("the picked country on the order push (UB5, Q23)", () => {
  type Push = { customer: { mobile: unknown } } & Record<string, unknown>;
  const callbacks = (body: Push) =>
    ["rejectUrl", "acceptUrl", "billPrintUrl", "dispatchUrl", "settleUrl"].map((key) => String(body[key]));

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCartItems([CW]));
    store.dispatch(setPhoneNumberRdx("501234567"));
  });

  it("a UAE pick: customer.mobile is the bare digits on both bodies; the status callbacks say countryCode=971", async () => {
    store.dispatch(setCountryCode({ code: "AE", dialCode: "+971", min: 9, max: 9, picked: true }));
    const { pushOrderData, toPush } = (await pushBodies()) as unknown as { pushOrderData: Push; toPush: Push };

    expect(pushOrderData.customer.mobile).toBe("501234567");
    expect(toPush.customer.mobile).toBe("501234567");
    for (const url of [...callbacks(pushOrderData), ...callbacks(toPush)]) {
      expect(url).toMatch(/[?&]countryCode=971$/);
    }
  });

  it("the default India: the same bare digits; the callbacks say countryCode=91", async () => {
    const { pushOrderData } = (await pushBodies()) as unknown as { pushOrderData: Push };

    expect(pushOrderData.customer.mobile).toBe("501234567");
    expect(callbacks(pushOrderData).every((url) => url.endsWith("countryCode=91"))).toBe(true);
  });
});
