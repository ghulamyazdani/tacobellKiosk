import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { pushOrderInOngoingOrders, setOrderId } from "@cx-sdk/ordering/state/order.slice";
import { setIdealTimeout, setPaymentSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { store } from "../../../redux/app/store";
import { IdleHoldContext } from "../../../hooks/utils/useIdleTimeout";
import ReceiptPreferenceScreen from "../index";

/*
  /receipt AFTER a Paytm payment (user 2026-10-13: "the receipt question …
  should be after that"). Only /paymentPolling's paid tail reaches /receipt
  with a Paytm type — the order is placed (by the backend) and paid, the
  session's ids already cleared. The mode comes from the PERSISTED type, never
  router state, so every case mounts with none. The real usePayAtCounter and
  usePaytmCheckout edges are spied to prove this screen pushes, initiates and
  mints NOTHING: its only exit is /orderSuccess {receipt}. The paid tail has
  recorded the order locally (`record()`, its bookkeeping) — unless a reload
  dropped that record, which is not persisted.
*/

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  capture: vi.fn(),
  dqr: vi.fn(),
  edc: vi.fn(),
  pushOrder: vi.fn(),
  ids: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => m.navigate,
}));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => m.capture(...args),
}));
vi.mock("../../../hooks/menuHooks/useOrderHook", () => ({
  default: () => ({
    pushOrder: (...args: unknown[]) => m.pushOrder(...args),
    generateQROrderId: () => Promise.resolve("TB-ORDER-ABCDE12345"),
  }),
}));
vi.mock("@cx-sdk/payments/services/paymentSettingsFetchApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useInitiatePaytmDqrKioskMutation: () => [(body: unknown) => m.dqr(body)],
  useInitiatePaytmEdcKioskMutation: () => [(body: unknown) => m.edc(body)],
}));
vi.mock("@cx-sdk/payments/gateways/paymentSession", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generatePaymentIds: () => m.ids(),
}));

const option = (label: string, fields: Record<string, string>) => ({
  _id: `pay_${label}`,
  tenant_id: "tenant1",
  deployment_id: "dep1",
  setting_label: label,
  value: [{ id: "activate", value: true }, ...Object.entries(fields).map(([id, value]) => ({ id, value }))],
});
const EDC = option("PaytmEdc", { paytm_device_id: "EDC-DEVICE-1" });
const DQR = option("PaytmDynamicQr", { paytm_dqr_merchant_guid: "MID-1", paytm_dqr_secret_key: "KEY-1" });

const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
/** One macrotask: the COD push's 0 ms buffer hop. */
const macrotask = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

const adjust = vi.fn<(delta: 1 | -1) => void>();
/** IdleGuard's hold counter, as the screen drives it. */
const holds = () => adjust.mock.calls.reduce((sum, [delta]) => sum + delta, 0);
const Wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <IdleHoldContext.Provider value={adjust}>
      <MemoryRouter initialEntries={["/receipt"]}>{children}</MemoryRouter>
    </IdleHoldContext.Provider>
  </Provider>
);
const mount = () => render(<ReceiptPreferenceScreen />, { wrapper: Wrapper });
const receiptEvents = () =>
  m.capture.mock.calls.filter(([, props]) => (props as { screen?: string })?.screen === "receipt");
const nothingSent = () => {
  expect(m.pushOrder).not.toHaveBeenCalled();
  expect(m.edc).not.toHaveBeenCalled();
  expect(m.dqr).not.toHaveBeenCalled();
  expect(m.ids).not.toHaveBeenCalled();
};

/** The paid order: its id persisted at initiate (order.orderId). */
const ORDER = "17000000000011";
/** The paid tail's local record (order.currentOrder — memory only). */
const record = () => store.dispatch(pushOrderInOngoingOrders({ orderId: ORDER }));

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  adjust.mockReset();
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCartItems([{ id: "cw", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 9 }]));
  store.dispatch(setAmount(9));
  store.dispatch(setPaymentSettings([EDC, DQR]));
  store.dispatch(setOrderId(ORDER));
});

describe("/receipt AFTER the payment (Paytm) — U8", () => {
  it.each([
    ["PaytmEdc", "YES", "receipt-print", "print"],
    ["PaytmEdc", "NO", "receipt-none", "none"],
    ["PaytmDynamicQr", "YES", "receipt-print", "print"],
    ["PaytmDynamicQr", "NO", "receipt-none", "none"],
  ] as const)("%s, %s: no BACK; a double tap goes to /orderSuccess ONCE with its choice — nothing pushed, initiated or minted", async (type, _label, testId, receipt) => {
    store.dispatch(setKioskPaymentType({ type }));
    record();
    mount();

    // A placed, paid order: the question and its two answers, no way back.
    expect(screen.queryByTestId("receipt-back")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toEqual([
      screen.getByTestId("receipt-print"),
      screen.getByTestId("receipt-none"),
    ]);

    act(() => {
      fireEvent.click(screen.getByTestId(testId));
      fireEvent.click(screen.getByTestId(testId));
    });
    await flush();

    expect(m.navigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt } }]]);
    expect(receiptEvents()).toEqual([["other", { screen: "receipt", receipt_preference: receipt }]]);
    nothingSent();
    expect(screen.queryByTestId("paytm-preparing")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-buffer")).not.toBeInTheDocument();
  });
});

describe("/receipt AFTER the payment — idle held, NO by itself at T − 20 s (U9)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    record();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("T = 60: idle held while it shows; nothing at 39 999 ms; at 40 000 ms ONE timed-out NO to Order Complete; released on leaving", () => {
    store.dispatch(setIdealTimeout(60));
    const view = mount();
    expect(holds()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(39_999);
    });
    expect(m.navigate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(receiptEvents()).toEqual([
      ["other", { screen: "receipt", receipt_preference: "none", reason: "timeout" }],
    ]);
    expect(m.navigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "none" } }]]);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(m.navigate).toHaveBeenCalledTimes(1);
    nothingSent();

    view.unmount();
    expect(holds()).toBe(0);
  });

  it("a guest who answered at 10 s is never answered for again by the timer", () => {
    store.dispatch(setIdealTimeout(60));
    mount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("receipt-print"));
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(m.navigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "print" } }]]);
    expect(receiptEvents()).toEqual([["other", { screen: "receipt", receipt_preference: "print" }]]);
  });

  it("unmounted at 10 s: the timer never fires", () => {
    store.dispatch(setIdealTimeout(60));
    const view = mount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(m.navigate).not.toHaveBeenCalled();
    expect(receiptEvents()).toEqual([]);
  });

  it("the slice default (180 s, clamped to Rule 1's 120): NO at 100 s, not before", () => {
    mount();
    act(() => {
      vi.advanceTimersByTime(99_999);
    });
    expect(m.navigate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(m.navigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "none" } }]]);
  });
});

describe("/receipt AFTER the payment — the local order record is gone (review 1 F1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["PaytmEdc", "PaytmDynamicQr"])("%s after a reload here (order.currentOrder is not persisted, so YES could not print): never asked — nothing rendered, on to /orderSuccess as NO, once", (type) => {
    store.dispatch(setKioskPaymentType({ type }));
    mount();

    expect(screen.queryByTestId("receipt-screen")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(m.navigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "none" } }]]);
    expect(receiptEvents()).toEqual([
      ["other", { screen: "receipt", receipt_preference: "none", reason: "no_local_record" }],
    ]);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(m.navigate).toHaveBeenCalledTimes(1);
    nothingSent();
  });

  it("a record of ANOTHER order (the last guest's — the session reset keeps currentOrder) is no record either: never asked", () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    store.dispatch(pushOrderInOngoingOrders({ orderId: "17000000000009" }));
    mount();

    expect(screen.queryByTestId("receipt-screen")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(m.navigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "none" } }]]);
  });
});

describe("/receipt BEFORE the push (pay at counter) — unchanged", () => {
  it("COD is untouched: PAY_AT_RESTAURANT pushes through usePayAtCounter, no Paytm initiate, no PleaseWait", async () => {
    store.dispatch(setKioskPaymentType({ type: "PAY_AT_RESTAURANT" }));
    m.pushOrder.mockResolvedValue({});
    mount();
    expect(screen.getByTestId("receipt-back")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("receipt-print"));
    await flush();
    await macrotask();
    await flush();

    expect(m.pushOrder).toHaveBeenCalledTimes(1);
    expect(m.pushOrder).toHaveBeenCalledWith("TB-ORDER-ABCDE12345", true, 9);
    expect(m.navigate).toHaveBeenCalledWith("/orderSuccess", { state: { receipt: "print" } });
    expect(m.edc).not.toHaveBeenCalled();
    expect(m.dqr).not.toHaveBeenCalled();
    expect(m.ids).not.toHaveBeenCalled();
    expect(screen.queryByTestId("paytm-preparing")).not.toBeInTheDocument();
    expect(receiptEvents()).toEqual([["other", { screen: "receipt", receipt_preference: "print" }]]);
  });
});
