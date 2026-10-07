import { inspect } from "node:util";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setPaymentSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { setClaimedCoupon } from "@cx-sdk/ordering/state/loyalty.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import {
  getDetailedPaymentType,
  getPaymentType,
} from "@cx-sdk/ordering/order/orderBuilder";
import storage from "redux-persist/es/storage";
import { persistor, store } from "../../../redux/app/store";
import { IdleHoldContext } from "../../utils/useIdleTimeout";
import usePaytmCheckout from "../usePaytmCheckout";

/*
  P8b-05 — the Paytm INITIATE behind /receipt, a MONEY PATH. Real store, real
  SDK classifiers (paytmKiosk), real orderOutcomeClaim. Mocked edges only:
  the two initiate triggers, the id generator (deterministic, so "NEW ids"
  is provable), getPushOrderData, navigate, analytics and the lazy
  /paymentPolling screen loader (its own suite: PaytmPaymentRoute.test). The triggers
  snapshot the store at CALL time — that is how "the ids are stored BEFORE
  the request leaves" and "the claim is marked before it leaves" are proven.
*/

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  capture: vi.fn(),
  dqr: vi.fn(),
  edc: vi.fn(),
  getPushOrderData: vi.fn(),
  ids: vi.fn(),
  loadScreen: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => m.navigate,
}));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => m.capture(...args),
}));
vi.mock("../../menuHooks/useOrderHook", () => ({
  default: () => ({
    getPushOrderData: (...args: unknown[]) => m.getPushOrderData(...args),
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
vi.mock("../../../pages/PaytmPayment/loadPaytmScreen", () => ({
  loadPaytmScreen: () => m.loadScreen(),
}));
/** The settlement screen's chunk, arrived. */
const SCREEN = () => null;

interface Slices {
  payment: Record<string, unknown> & {
    posBillNo: string;
    posBillTime: unknown;
    paymentType: string;
    paytmQrCode: string;
  };
  order: { orderId: string };
  loyalty: {
    claimedCoupon: { isClaimed: boolean; couponData: Record<string, unknown> };
  };
}
const st = () => store.getState() as unknown as Slices;

const option = (label: string, fields: Record<string, string>) => ({
  _id: `pay_${label}`,
  tenant_id: "tenant1",
  deployment_id: "dep1",
  channel: "Kiosk",
  group: "payment",
  setting_label: label,
  setting_id: label,
  value: [
    { label: "Activate", id: "activate", value: true, fieldType: "checkbox" },
    ...Object.entries(fields).map(([id, value]) => ({ label: id, id, value, fieldType: "text" })),
  ],
});
const EDC = option("PaytmEdc", { paytm_device_id: "EDC-DEVICE-1" });
const DQR = option("PaytmDynamicQr", {
  paytm_dqr_merchant_guid: "MID-SECRET-1",
  paytm_dqr_secret_key: "KEY-SECRET-1",
});
const QR = "upi://pay?pa=tb@paytm&am=9.00";
const PHONE = "9876543210";
const CRUNCHWRAP = { id: "cw", itemId: "cw-1", name: "Crunchwrap", quantity: 1, type: "ITEM", total_price: 9 };
const REWARD = { id: "rw", itemId: "lr-1", name: "Salad", quantity: 1, type: "ITEM", isLoyaltyItem: true, total_price: 0 };
const CLAIMED = { couponCode: "RW-1", datetime: "2026-10-06", claimedPoints: 50, phoneNumber: PHONE };
const CLAIM_IDS = { reward_id: "RW-1", claim_datetime: "2026-10-06", points: 50 };

/** The order_details builder's tender blocks for `type` (what H-c inspects). */
const orderDetails = (type: string) => ({
  payments: { type: getPaymentType(type) },
  originalPayments: { cash: [], cards: [{ detail: [{ otherName: getDetailedPaymentType(type), amount: 9 }] }] },
  customer: { mobile: PHONE },
});

// RTK trigger results (fetchBaseQuery 2.12).
const OK_EDC = { data: { success: true, traceId: "t1" } };
const TIMEOUT = { error: { status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" } };
const MID_BODY_TIMEOUT = { error: { status: "PARSING_ERROR", originalStatus: 200, data: "", error: "TimeoutError: signal timed out" } };
const LOST_BODY = { error: { status: "PARSING_ERROR", originalStatus: 200, data: "x", error: "SyntaxError: Unexpected token" } };
const PROXY_502 = { error: { status: "PARSING_ERROR", originalStatus: 502, data: "<html>", error: "SyntaxError" } };
const FETCH = { error: { status: "FETCH_ERROR", error: "TypeError: Failed to fetch" } };
const http = (status: number, data: unknown = {}) => ({ error: { status, data } });
const BUSY = http(400, { msg: "Multiple payment request not allowed" });

/** generatePaymentIds, deterministic: attempt n gets BILL(n) / TIME(n). */
const BILL = (n: number) => `17000000000000${n}`;
const TIME = (n: number) => 1_700_000_000_000 + n;
let attempt = 0;

/** The store the instant a trigger was called. */
interface AtCall {
  posBillNo: string;
  posBillTime: unknown;
  orderId: string;
  markedFor: unknown;
}
let atCall: AtCall[] = [];
const snapshot = () => {
  const s = st();
  atCall.push({
    posBillNo: s.payment.posBillNo,
    posBillTime: s.payment.posBillTime,
    orderId: s.order.orderId,
    markedFor: s.loyalty.claimedCoupon.couponData.outcomeUnknownOrderId,
  });
};

type Trigger = typeof m.edc;
/** The trigger answers `replies` in turn (the last one repeats). */
const respond = (trigger: Trigger, ...replies: unknown[]) => {
  let call = 0;
  trigger.mockImplementation(() => {
    snapshot();
    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;
    return Promise.resolve(reply);
  });
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
/** The trigger never answers until the test says so. */
const hold = (trigger: Trigger) => {
  const answer = deferred<unknown>();
  trigger.mockImplementation(() => {
    snapshot();
    return answer.promise;
  });
  return answer;
};
const body = (trigger: Trigger, call = 0) => trigger.mock.calls[call]?.[0] as Record<string, unknown>;

const adjust = vi.fn<(delta: 1 | -1) => void>();
/** IdleGuard's hold counter, as the hook drives it. */
const holds = () => adjust.mock.calls.reduce((sum, [delta]) => sum + delta, 0);

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <IdleHoldContext.Provider value={adjust}>
      <MemoryRouter initialEntries={["/receipt"]}>{children}</MemoryRouter>
    </IdleHoldContext.Provider>
  </Provider>
);
const mountHook = () => renderHook(() => usePaytmCheckout(), { wrapper });
type Hook = ReturnType<typeof mountHook>["result"];

/** Let the initiate's promise chain run to its end. */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
const start = async (result: Hook, receipt: "print" | "none" = "print") => {
  act(() => result.current.start(receipt));
  await flush();
};
const events = (name: string) =>
  m.capture.mock.calls.filter(([event]) => event === name).map(([, props]) => props);
const arm = (type: string) => store.dispatch(setKioskPaymentType({ type }));
const claim = () => st().loyalty.claimedCoupon;

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  adjust.mockReset();
  atCall = [];
  attempt = 0;
  m.ids.mockImplementation(() => {
    attempt += 1;
    return Promise.resolve({ posBillNo: BILL(attempt), posBillTime: TIME(attempt) });
  });
  m.getPushOrderData.mockImplementation(() =>
    Promise.resolve({ toPush: orderDetails(st().payment.paymentType), pushOrderData: {} }),
  );
  m.loadScreen.mockResolvedValue(SCREEN);
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCartItems([CRUNCHWRAP]));
  store.dispatch(setAmount(9));
  store.dispatch(setPhoneNumberRdx(PHONE));
  store.dispatch(setPaymentSettings([EDC, DQR]));
});

describe("usePaytmCheckout — one initiate per tap, ids first", () => {
  it.each([
    ["PaytmEdc", m.edc, "paytmEdc"],
    ["PaytmDynamicQr", m.dqr, "paytmDqr"],
  ] as const)("%s: the ids are in the store BEFORE the request leaves; a double tap sends ONE", async (type, trigger, kind) => {
    arm(type);
    hold(trigger);
    const { result } = mountHook();
    expect(result.current.kind).toBe(kind);

    act(() => {
      result.current.start("print");
      result.current.start("print");
    });
    await flush();
    await start(result, "none"); // a later tap while the first is out

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(m.ids).toHaveBeenCalledTimes(1);
    expect(atCall).toEqual([
      { posBillNo: BILL(1), posBillTime: TIME(1), orderId: BILL(1), markedFor: undefined },
    ]);
    const sent = body(trigger);
    if (type === "PaytmEdc") {
      expect(sent).toMatchObject({ posBillNo: BILL(1), posBillTime: TIME(1), billId: BILL(1), deviceId: "EDC-DEVICE-1", amount: 9 });
    } else {
      expect(sent).toMatchObject({ posBillId: BILL(1), secretKey: "KEY-SECRET-1", mid: "MID-SECRET-1" });
      expect(sent.payload).toMatchObject({ orderId: BILL(1), amount: 9 });
    }
    expect(result.current.status).toBe("initiating");
    expect(m.navigate).not.toHaveBeenCalled();
  });

  it("F1: the ids are ON DISK before the request leaves, and a refusal takes them off disk before its panel shows", async () => {
    arm("PaytmEdc");
    // The web engine reads synchronously: each promise holds the disk AS OF
    // its read. redux-persist's own write timer cannot run in between — the
    // tap → request → refusal chain here is microtasks only.
    const disk: Promise<string | null>[] = [];
    const readDisk = () => disk.push(storage.getItem("persist:root") as Promise<string | null>);
    m.edc.mockImplementation(() => {
      readDisk();
      return Promise.resolve(BUSY);
    });
    m.capture.mockImplementation((name: unknown) => {
      if (name === "payment_failed_to_initiate") readDisk();
    });
    await persistor.flush();
    readDisk(); // before the tap: no ids on disk
    const { result } = mountHook();
    await start(result);

    const bills = (await Promise.all(disk)).map((raw) => {
      const root = JSON.parse(raw ?? "{}") as Record<string, string>;
      return (JSON.parse(root.payment) as { posBillNo: string }).posBillNo;
    });
    expect(bills).toEqual(["", BILL(1), ""]);
    expect(result.current.failure).toEqual({ reason: "busy", retryable: true });
  });
});

describe("usePaytmCheckout — local refusals send nothing and are never a dead tap", () => {
  it.each([
    ["no usable selection", "no_selection", () => store.dispatch(setPaymentSettings([DQR]))],
    ["a zero amount", "zero_amount", () => store.dispatch(setAmount(0))],
    ["a negative amount", "zero_amount", () => store.dispatch(setAmount(-3))],
    [
      "a COD-shaped order_details (H-c)",
      "order_details_mismatch",
      () => m.getPushOrderData.mockResolvedValue({ toPush: orderDetails("PAY_AT_RESTAURANT") }),
    ],
    [
      "order_details built for the OTHER Paytm tender (H-c)",
      "order_details_mismatch",
      () => m.getPushOrderData.mockResolvedValue({ toPush: orderDetails("PaytmDynamicQr") }),
    ],
    [
      "the /paymentPolling screen chunk did not arrive",
      "screen_unavailable",
      () => m.loadScreen.mockResolvedValue(null),
    ],
  ])("%s → a non-retryable failure panel, nothing sent", async (_label, why, breakIt) => {
    arm("PaytmEdc");
    breakIt();
    respond(m.edc, OK_EDC);
    const { result } = mountHook();
    await start(result);

    expect(m.edc).not.toHaveBeenCalled();
    expect(m.dqr).not.toHaveBeenCalled();
    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toEqual({ reason: "rejected", retryable: false });
    expect(events("error_occurred")).toEqual([{ error_source: "paytm_initiate", reason: why }]);
    expect(events("payment_failed_to_initiate")).toEqual([{ payment_type: "PaytmEdc", reason: "rejected" }]);
    expect(events("payment_initiated")).toEqual([]);
    // Whatever ids were minted are gone; nothing is left "open".
    expect(st().payment.posBillNo).toBe("");
    expect(holds()).toBe(0);

    // TRY AGAIN is not offered: retry() is inert.
    act(() => result.current.retry());
    await flush();
    expect(m.edc).not.toHaveBeenCalled();

    // The way out works, and the next tap is live again.
    act(() => result.current.dismiss());
    expect(result.current.status).toBe("idle");
    expect(result.current.failure).toBeNull();
  });

  it("the H-c guard runs on the order_details built for THIS bill, before any mark or event", async () => {
    arm("PaytmEdc");
    store.dispatch(setCartItems([CRUNCHWRAP, REWARD]));
    store.dispatch(setClaimedCoupon(CLAIMED));
    m.getPushOrderData.mockResolvedValue({ toPush: orderDetails("PAY_AT_RESTAURANT") });
    const { result } = mountHook();
    await start(result);

    expect(m.getPushOrderData).toHaveBeenCalledWith(BILL(1));
    expect(claim().couponData).toEqual(CLAIMED);
    expect(st().payment.posBillNo).toBe("");
  });

  it("the screen chunk is awaited BEFORE any id: nothing is minted, marked or sent while it loads, and a missing one mints nothing at all", async () => {
    arm("PaytmEdc");
    store.dispatch(setCartItems([CRUNCHWRAP, REWARD]));
    store.dispatch(setClaimedCoupon(CLAIMED));
    respond(m.edc, OK_EDC);
    const chunk = deferred<unknown>();
    m.loadScreen.mockReturnValue(chunk.promise);
    const { result } = mountHook();
    await start(result);

    expect(m.loadScreen).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("initiating");
    expect(holds()).toBe(1);
    expect(m.ids).not.toHaveBeenCalled();
    expect(m.edc).not.toHaveBeenCalled();
    expect(events("payment_initiated")).toEqual([]);

    await act(async () => chunk.resolve(null));
    await flush();
    expect(result.current.failure).toEqual({ reason: "rejected", retryable: false });
    expect(m.ids).not.toHaveBeenCalled();
    expect(m.getPushOrderData).not.toHaveBeenCalled();
    expect(m.edc).not.toHaveBeenCalled();
    expect(claim().couponData).toEqual(CLAIMED);
    expect(st().payment).toMatchObject({ posBillNo: "", posBillTime: "" });
    expect(holds()).toBe(0);
  });

  it("a non-retryable failure is never re-run by retry() — not even once the cause is gone", async () => {
    arm("PaytmEdc");
    store.dispatch(setAmount(0));
    respond(m.edc, OK_EDC);
    const { result } = mountHook();
    await start(result);
    store.dispatch(setAmount(9));

    act(() => result.current.retry());
    await flush();

    expect(m.edc).not.toHaveBeenCalled();
    expect(result.current.status).toBe("failed");
  });

  it("a local step that throws AFTER the ids were stored → a non-retryable panel, the ids cleared, nothing sent", async () => {
    arm("PaytmEdc");
    m.getPushOrderData.mockRejectedValue(new Error("order_details build failed"));
    respond(m.edc, OK_EDC);
    const { result } = mountHook();
    await start(result);

    expect(m.getPushOrderData).toHaveBeenCalledWith(BILL(1)); // minted and stored first
    expect(m.edc).not.toHaveBeenCalled();
    expect(result.current.failure).toEqual({ reason: "rejected", retryable: false });
    expect(events("error_occurred")).toEqual([{ error_source: "paytm_initiate", reason: "local_error" }]);
    // No armed type + ids left behind for /start's release to read as an open EDC session.
    expect(st().payment).toMatchObject({ posBillNo: "", posBillTime: "" });
    expect(holds()).toBe(0);
  });

  it("while a failure panel is up a tap is inert (a refusal, even once fixed; a retryable busy) — only dismiss() / TRY AGAIN move on", async () => {
    arm("PaytmEdc");
    store.dispatch(setAmount(0));
    respond(m.edc, BUSY, OK_EDC);
    const { result } = mountHook();
    await start(result);
    store.dispatch(setAmount(9));

    await start(result, "none");
    expect(m.ids).not.toHaveBeenCalled();
    expect(m.edc).not.toHaveBeenCalled();
    expect(result.current.status).toBe("failed");

    act(() => result.current.dismiss());
    await start(result);
    expect(result.current.failure).toEqual({ reason: "busy", retryable: true });

    await start(result, "none");
    expect(m.edc).toHaveBeenCalledTimes(1);
    expect(m.ids).toHaveBeenCalledTimes(1);
    expect(m.navigate).not.toHaveBeenCalled();
  });

  it("after a refusal is dismissed, a fixed state initiates normally (no dead end)", async () => {
    arm("PaytmEdc");
    store.dispatch(setAmount(0));
    respond(m.edc, OK_EDC);
    const { result } = mountHook();
    await start(result);
    act(() => result.current.dismiss());

    store.dispatch(setAmount(9));
    await start(result);

    expect(m.edc).toHaveBeenCalledTimes(1);
    expect(m.navigate).toHaveBeenCalledWith("/paymentPolling", { state: { receipt: "print" } });
  });
});

describe("usePaytmCheckout — what an answer means", () => {
  it("DQR ok: the QR is stored and /paymentPolling gets {receipt}; the instance never initiates again", async () => {
    arm("PaytmDynamicQr");
    respond(m.dqr, { data: { qrCode: QR } });
    const { result } = mountHook();
    await start(result, "print");

    expect(st().payment.paytmQrCode).toBe(QR);
    expect(st().payment.posBillNo).toBe(BILL(1));
    expect(m.navigate).toHaveBeenCalledTimes(1);
    expect(m.navigate).toHaveBeenCalledWith("/paymentPolling", { state: { receipt: "print" } });

    act(() => {
      result.current.start("none");
      result.current.retry();
    });
    await flush();
    expect(m.dqr).toHaveBeenCalledTimes(1);
    expect(m.navigate).toHaveBeenCalledTimes(1);
  });

  it("EDC ok: /paymentPolling with the receipt, no QR stored, same ids kept", async () => {
    arm("PaytmEdc");
    respond(m.edc, OK_EDC);
    const { result } = mountHook();
    await start(result, "none");

    expect(m.navigate).toHaveBeenCalledWith("/paymentPolling", { state: { receipt: "none" } });
    expect(st().payment.paytmQrCode).toBe("");
    expect(st().payment).toMatchObject({ posBillNo: BILL(1), posBillTime: TIME(1) });
    expect(events("error_occurred")).toEqual([]);
  });

  it.each([
    ["TIMEOUT_ERROR", TIMEOUT],
    ["a mid-body timeout", MID_BODY_TIMEOUT],
    ["a lost 2xx body", LOST_BODY],
    ["FETCH_ERROR", FETCH],
    ["500", http(500)],
    ["504", http(504)],
    ["a 502 html body", PROXY_502],
  ])("EDC %s = outcome unknown: SAME ids, → /paymentPolling, never a second initiate", async (_label, reply) => {
    arm("PaytmEdc");
    respond(m.edc, reply);
    const { result } = mountHook();
    await start(result, "print");

    expect(m.navigate).toHaveBeenCalledTimes(1);
    expect(m.navigate).toHaveBeenCalledWith("/paymentPolling", { state: { receipt: "print" } });
    expect(st().payment).toMatchObject({ posBillNo: BILL(1), posBillTime: TIME(1) });
    expect(st().order.orderId).toBe(BILL(1));
    expect(events("error_occurred")).toEqual([
      { error_source: "paytm_initiate", initiate_outcome_unknown: true, order_id: BILL(1), payment_type: "PaytmEdc" },
    ]);
    expect(events("payment_failed_to_initiate")).toEqual([]);
    expect(result.current.failure).toBeNull();

    act(() => {
      result.current.start("none");
      result.current.retry();
    });
    await flush();
    expect(m.edc).toHaveBeenCalledTimes(1);
    expect(m.ids).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["busy (400)", BUSY, "busy"],
    ["busy on a 503 (a definitive answer beats unknown)", http(503, { msg: "Multiple payment request not allowed" }), "busy"],
    ["a plain 400", http(400), "rejected"],
    ["200 with success:false", { data: { success: false } }, "rejected"],
  ])("EDC %s → the failure panel (retryable), ids cleared, nothing navigates", async (_label, reply, reason) => {
    arm("PaytmEdc");
    respond(m.edc, reply);
    const { result } = mountHook();
    await start(result);

    expect(result.current.status).toBe("failed");
    expect(result.current.failure).toEqual({ reason, retryable: true });
    expect(st().payment).toMatchObject({ posBillNo: "", posBillTime: "" });
    expect(m.navigate).not.toHaveBeenCalled();
    expect(events("payment_failed_to_initiate")).toEqual([{ payment_type: "PaytmEdc", reason }]);
    expect(holds()).toBe(0);
  });

  it.each([
    ["500", http(500)],
    ["TIMEOUT_ERROR", TIMEOUT],
  ])("DQR %s is retryable (the QR was never shown) and TRY AGAIN mints NEW ids, same receipt", async (_label, reply) => {
    arm("PaytmDynamicQr");
    respond(m.dqr, reply, { data: { qrCode: QR } });
    const { result } = mountHook();
    await start(result, "print");

    expect(result.current.failure).toEqual({ reason: "unknown", retryable: true });
    expect(st().payment.posBillNo).toBe("");
    expect(st().payment.paytmQrCode).toBe("");

    act(() => result.current.retry());
    await flush();

    expect(m.dqr).toHaveBeenCalledTimes(2);
    expect(body(m.dqr, 0).posBillId).toBe(BILL(1));
    expect(body(m.dqr, 1).posBillId).toBe(BILL(2));
    expect(atCall[1]).toMatchObject({ posBillNo: BILL(2), orderId: BILL(2) });
    expect(m.navigate).toHaveBeenCalledWith("/paymentPolling", { state: { receipt: "print" } });
    expect(st().payment.paytmQrCode).toBe(QR);
  });

  it("a trigger that THROWS is classified like an error envelope — never a crash", async () => {
    arm("PaytmEdc");
    m.edc.mockImplementation(() => {
      throw new Error("boom");
    });
    const { result } = mountHook();
    await start(result);

    expect(result.current.failure).toEqual({ reason: "rejected", retryable: true });
    expect(st().payment.posBillNo).toBe("");
  });
});

describe("usePaytmCheckout — S7: the claim mark follows THIS order", () => {
  const withReward = () => {
    store.dispatch(setCartItems([CRUNCHWRAP, REWARD]));
    store.dispatch(setClaimedCoupon(CLAIMED));
  };

  it("a riding reward is marked BEFORE the request leaves; its ids ride in PaymentInitiated", async () => {
    arm("PaytmEdc");
    withReward();
    respond(m.edc, OK_EDC);
    const { result } = mountHook();
    await start(result);

    expect(atCall[0].markedFor).toBe(BILL(1));
    expect(claim().couponData).toEqual({ ...CLAIMED, orderOutcomeUnknown: true, outcomeUnknownOrderId: BILL(1) });
    expect(events("payment_initiated")).toEqual([
      { order_id: BILL(1), net_amount: 9, payment_type: "PaytmEdc", provider: "paytm", ...CLAIM_IDS },
    ]);
  });

  it("no reward row in the bag → no mark, no ids", async () => {
    arm("PaytmEdc");
    store.dispatch(setClaimedCoupon(CLAIMED));
    respond(m.edc, OK_EDC);
    const { result } = mountHook();
    await start(result);

    expect(claim().couponData).toEqual(CLAIMED);
    expect(events("payment_initiated")).toEqual([
      { order_id: BILL(1), net_amount: 9, payment_type: "PaytmEdc", provider: "paytm" },
    ]);
  });

  it.each([
    ["PaytmEdc", m.edc, http(400)],
    ["PaytmDynamicQr", m.dqr, http(500)],
  ] as const)("%s: a clean failure of the SAME order un-marks it exactly", async (type, trigger, reply) => {
    arm(type);
    withReward();
    respond(trigger, reply);
    const { result } = mountHook();
    await start(result);

    expect(atCall[0].markedFor).toBe(BILL(1));
    expect(claim()).toEqual({ isClaimed: true, couponData: CLAIMED });
  });

  it("an EDC outcome-unknown keeps the mark (the order may exist)", async () => {
    arm("PaytmEdc");
    withReward();
    respond(m.edc, TIMEOUT);
    const { result } = mountHook();
    await start(result);

    expect(claim().couponData).toMatchObject({ orderOutcomeUnknown: true, outcomeUnknownOrderId: BILL(1) });
  });

  it("an EARLIER order's mark is never overwritten, and this order's clean failure never un-marks it", async () => {
    arm("PaytmEdc");
    store.dispatch(setCartItems([CRUNCHWRAP, REWARD]));
    const earlier = { ...CLAIMED, orderOutcomeUnknown: true, outcomeUnknownOrderId: "EARLIER-ORDER" };
    store.dispatch(setClaimedCoupon(earlier));
    respond(m.edc, http(400));
    const { result } = mountHook();
    await start(result);

    expect(atCall[0].markedFor).toBe("EARLIER-ORDER");
    expect(events("payment_initiated")[0]).toMatchObject(CLAIM_IDS);
    expect(claim()).toEqual({ isClaimed: true, couponData: earlier });
  });
});

describe("usePaytmCheckout — a screen that dies mid-initiate", () => {
  it("DQR: the late QR is neither stored nor followed", async () => {
    arm("PaytmDynamicQr");
    const answer = hold(m.dqr);
    const view = mountHook();
    await start(view.result);
    view.unmount();
    const dispatched = vi.fn();
    const unsubscribe = store.subscribe(dispatched);

    await act(async () => answer.resolve({ data: { qrCode: QR } }));
    await flush();

    expect(m.navigate).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
    expect(st().payment.paytmQrCode).toBe("");
    unsubscribe();
  });

  it("EDC: a late refusal dispatches nothing — the ids stay for /start's release", async () => {
    arm("PaytmEdc");
    const answer = hold(m.edc);
    const view = mountHook();
    await start(view.result);
    view.unmount();
    const dispatched = vi.fn();
    const unsubscribe = store.subscribe(dispatched);

    await act(async () => answer.resolve(BUSY));
    await flush();

    expect(dispatched).not.toHaveBeenCalled();
    expect(m.navigate).not.toHaveBeenCalled();
    expect(events("payment_failed_to_initiate")).toEqual([]);
    expect(st().payment.posBillNo).toBe(BILL(1));
    unsubscribe();
  });

  it("gone while order_details is being built: the initiate never leaves", async () => {
    arm("PaytmEdc");
    const built = deferred<{ toPush: unknown; pushOrderData: unknown }>();
    m.getPushOrderData.mockReturnValue(built.promise);
    respond(m.edc, OK_EDC);
    const view = mountHook();
    await start(view.result);
    expect(m.getPushOrderData).toHaveBeenCalledWith(BILL(1));
    view.unmount();
    const dispatched = vi.fn();
    const unsubscribe = store.subscribe(dispatched);

    await act(async () => built.resolve({ toPush: orderDetails("PaytmEdc"), pushOrderData: {} }));
    await flush();

    expect(m.edc).not.toHaveBeenCalled();
    expect(m.dqr).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
    expect(m.navigate).not.toHaveBeenCalled();
    expect(events("payment_initiated")).toEqual([]);
    unsubscribe();
  });

  it("gone while the screen chunk loads: no id is minted and nothing is sent", async () => {
    arm("PaytmEdc");
    const chunk = deferred<unknown>();
    m.loadScreen.mockReturnValue(chunk.promise);
    respond(m.edc, OK_EDC);
    const view = mountHook();
    await start(view.result);
    view.unmount();
    const dispatched = vi.fn();
    const unsubscribe = store.subscribe(dispatched);

    await act(async () => chunk.resolve(SCREEN));
    await flush();

    expect(m.ids).not.toHaveBeenCalled();
    expect(m.edc).not.toHaveBeenCalled();
    expect(dispatched).not.toHaveBeenCalled();
    expect(m.navigate).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("gone before the ids arrive: nothing is stored and nothing is sent", async () => {
    arm("PaytmEdc");
    const ids = deferred<{ posBillNo: string; posBillTime: number }>();
    m.ids.mockReturnValue(ids.promise);
    const view = mountHook();
    await start(view.result);
    view.unmount();
    const dispatched = vi.fn();
    const unsubscribe = store.subscribe(dispatched);

    await act(async () => ids.resolve({ posBillNo: BILL(9), posBillTime: TIME(9) }));
    await flush();

    expect(dispatched).not.toHaveBeenCalled();
    expect(m.edc).not.toHaveBeenCalled();
    expect(st().payment.posBillNo).toBe("");
    unsubscribe();
  });
});

describe("usePaytmCheckout — idle is held only while initiating", () => {
  it("idle → none; initiating → one; failed → none; TRY AGAIN → one; released on unmount", async () => {
    arm("PaytmEdc");
    const first = hold(m.edc);
    const view = mountHook();
    expect(adjust).not.toHaveBeenCalled();

    await start(view.result);
    expect(holds()).toBe(1);

    await act(async () => first.resolve(BUSY));
    await flush();
    expect(view.result.current.status).toBe("failed");
    expect(holds()).toBe(0);

    const second = hold(m.edc);
    act(() => view.result.current.retry());
    await flush();
    expect(holds()).toBe(1);

    await act(async () => second.resolve(OK_EDC));
    await flush();
    expect(m.navigate).toHaveBeenCalledTimes(1);
    expect(holds()).toBe(1); // until /receipt unmounts

    view.unmount();
    expect(holds()).toBe(0);
  });
});

describe("usePaytmCheckout — credentials stay in the request body", () => {
  it("the DQR secret and mid never reach state.payment; no secret, mid, QR, device id, phone or order_details reach analytics; no session field is logged", async () => {
    // Pass-through spies: every console call the initiates make is kept.
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));
    arm("PaytmDynamicQr");
    respond(m.dqr, http(500), { data: { qrCode: QR } });
    const { result } = mountHook();
    await start(result);
    act(() => result.current.retry());
    await flush();
    expect(body(m.dqr, 1)).toMatchObject({ secretKey: "KEY-SECRET-1", mid: "MID-SECRET-1" });

    arm("PaytmEdc");
    respond(m.edc, TIMEOUT);
    const edc = mountHook();
    await start(edc.result);
    expect(body(m.edc)).toMatchObject({ deviceId: "EDC-DEVICE-1" });
    const logged = inspect(logs.map((spy) => spy.mock.calls), { depth: 8 });
    logs.forEach((spy) => spy.mockRestore());

    const payment = JSON.stringify(st().payment);
    expect(payment).not.toContain("KEY-SECRET-1");
    expect(payment).not.toContain("MID-SECRET-1");
    expect(st().payment).toMatchObject({ paymentSetting: {}, paytmSecretKey: "", paytmMid: "" });

    expect(m.capture).toHaveBeenCalled();
    const sent = JSON.stringify(m.capture.mock.calls);
    for (const secret of ["KEY-SECRET-1", "MID-SECRET-1", QR, "upi://", "EDC-DEVICE-1", PHONE, "originalPayments"]) {
      expect(sent).not.toContain(secret);
    }
    // Never logged (F3): no session field (bill no, time, type, QR), credential or phone.
    const ids = [1, 2, 3].flatMap((n) => [BILL(n), String(TIME(n))]);
    for (const value of [...ids, "PaytmEdc", "PaytmDynamicQr", QR, "upi://", "KEY-SECRET-1", "MID-SECRET-1", "EDC-DEVICE-1", PHONE]) {
      expect(logged, `console carried ${value}`).not.toContain(value);
    }
  });
});
