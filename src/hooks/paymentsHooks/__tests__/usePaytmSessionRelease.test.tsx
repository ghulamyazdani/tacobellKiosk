import { inspect } from "node:util";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CookiesProvider } from "react-cookie";
import { setPaymentSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setAutenticationDetails } from "@cx-sdk/core/auth/authentication.slice";
import {
  emptyPayment,
  setBillPaymentInfo,
  setKioskPaymentType,
  setPaytmQrCode,
} from "@cx-sdk/payments/state/payment.slice";
import { setOrderId } from "@cx-sdk/ordering/state/order.slice";
import storage from "redux-persist/es/storage";
import { persistor, store } from "../../../redux/app/store";
import StartScreen from "../../../pages/StartScreen";
import usePaytmSessionRelease from "../usePaytmSessionRelease";
import "../../../i18n";

/*
  P8b-12 — /start's teardown releases a Paytm session that is still open:
  ONE status read, and — EDC only, only after a fresh "pending" — ONE void;
  then ONE staff event. Fire-and-forget, built from the store at CALL time,
  because StartScreen runs it right before resetSession("full") empties the
  payment slice. The triggers snapshot the payment slice at call time.
*/

type Endpoint = "dqrStatus" | "edcStatus" | "edcVoid";
interface Call {
  endpoint: Endpoint;
  body: Record<string, unknown>;
  paymentAtCall: { posBillNo: string; paymentType: string };
}

const h = vi.hoisted(() => ({
  calls: [] as Array<{ endpoint: string; body: unknown; paymentAtCall: unknown }>,
  replies: {} as Record<string, () => Promise<unknown>>,
  capture: vi.fn(),
  paymentNow: (): unknown => ({}),
}));

vi.mock("@cx-sdk/payments/services/paymentSettingsFetchApi", async (importOriginal) => {
  const trigger = (endpoint: string) => (body: unknown) => {
    h.calls.push({ endpoint, body, paymentAtCall: h.paymentNow() });
    return h.replies[endpoint]?.() ?? Promise.resolve({ data: { status: "pending" } });
  };
  // Stable per hook, like RTK's memoised trigger.
  const dqr = [trigger("dqrStatus")];
  const edc = [trigger("edcStatus")];
  const cancel = [trigger("edcVoid")];
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useCheckPaytmDqrKioskStatusMutation: () => dqr,
    useCheckPaytmEdcKioskStatusMutation: () => edc,
    useCancelPaytmEdcKioskMutation: () => cancel,
  };
});
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => h.capture(...args),
}));

const EDC_OPTION = {
  _id: "pay_edc",
  tenant_id: "tenant1",
  deployment_id: "dep1",
  setting_label: "PaytmEdc",
  value: [
    { id: "activate", value: true },
    { id: "paytm_device_id", value: "EDC-DEVICE-1" },
  ],
};
const DQR_OPTION = {
  _id: "pay_dqr",
  tenant_id: "tenant1",
  deployment_id: "dep1",
  setting_label: "PaytmDynamicQr",
  value: [
    { id: "activate", value: true },
    { id: "paytm_dqr_merchant_guid", value: "MID-SECRET-1" },
    { id: "paytm_dqr_secret_key", value: "KEY-SECRET-1" },
  ],
};
const EDC_BILL = "1700000000123";
const DQR_BILL = "1700000000777";
const BILL_TIME = 1_700_000_000_000;
const QR = "upi://pay?pa=tb@paytm&am=9.00";

const calls = () => h.calls as Call[];
const endpoints = () => calls().map((call) => call.endpoint);
const payment = () => (store.getState() as unknown as { payment: Call["paymentAtCall"] }).payment;
const releaseEvents = () =>
  h.capture.mock.calls
    .map(([, props]) => props as Record<string, unknown>)
    .filter((props) => props?.error_source === "paytm_session_released");
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });

const openEdc = () => {
  store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
  store.dispatch(setBillPaymentInfo({ posBillNo: EDC_BILL, posBillTime: BILL_TIME }));
};
const openDqr = () => {
  store.dispatch(setKioskPaymentType({ type: "PaytmDynamicQr" }));
  store.dispatch(setBillPaymentInfo({ posBillNo: DQR_BILL, posBillTime: BILL_TIME }));
  store.dispatch(setPaytmQrCode(QR));
};

const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
const release = () => renderHook(() => usePaytmSessionRelease(), { wrapper });

const EDC_STATUS_BODY = {
  deployment_id: "dep1",
  order_id: EDC_BILL,
  posBillNo: EDC_BILL,
  posBillTime: BILL_TIME,
  deviceId: "EDC-DEVICE-1",
};
const EDC_VOID_BODY = { deployment_id: "dep1", posBillNo: EDC_BILL, posBillTime: BILL_TIME, deviceId: "EDC-DEVICE-1" };

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setPaymentSettings([EDC_OPTION, DQR_OPTION]));
  store.dispatch(
    setAutenticationDetails({ deploymentDetails: { _id: "dep1", tenant_id: "tenant1" }, licenseDetails: {} }),
  );
  h.calls = [];
  h.replies = {};
  h.capture.mockReset();
  h.paymentNow = () => ({ ...payment() });
});

describe("usePaytmSessionRelease", () => {
  it("no open session → no request, no event", async () => {
    const { result } = release();
    result.current();
    await flush();
    expect(h.calls).toEqual([]);
    expect(releaseEvents()).toEqual([]);
  });

  it("EDC pending: the status read FIRST, the void only after its answer — one each, one event", async () => {
    openEdc();
    const status = deferred();
    h.replies.edcStatus = () => status.promise;
    h.replies.edcVoid = () => Promise.resolve({ data: { success: true } });
    const { result } = release();
    result.current();
    await flush();
    expect(endpoints()).toEqual(["edcStatus"]);

    await act(async () => status.resolve({ data: { status: "pending" } }));
    await flush();
    expect(endpoints()).toEqual(["edcStatus", "edcVoid"]);
    expect(calls()[0].body).toEqual(EDC_STATUS_BODY);
    expect(calls()[1].body).toEqual(EDC_VOID_BODY);
    expect(releaseEvents()).toEqual([
      {
        error_source: "paytm_session_released",
        order_id: EDC_BILL,
        payment_type: "PaytmEdc",
        last_status: "pending",
        void_outcome: "voided",
      },
    ]);
    expect(JSON.stringify(h.capture.mock.calls)).not.toContain("EDC-DEVICE-1");
  });

  it.each([
    ["paid", "paid", () => Promise.resolve({ data: { status: "paid" } })],
    ["cancelled", "cancelled", () => Promise.resolve({ data: { status: "cancelled" } })],
    ["a 504", "error", () => Promise.resolve({ error: { status: 504, data: {} } })],
    ["a 401", "error", () => Promise.resolve({ error: { status: 401, data: {} } })],
    ["a timeout", "error", () => Promise.resolve({ error: { status: "TIMEOUT_ERROR" } })],
    ["a throwing trigger", "error", () => Promise.reject(new Error("boom"))],
  ])("EDC status %s → NO void; last_status %s", async (_label, lastStatus, reply) => {
    openEdc();
    h.replies.edcStatus = reply;
    const { result } = release();
    result.current();
    await flush();
    expect(endpoints()).toEqual(["edcStatus"]);
    expect(releaseEvents()).toEqual([
      expect.objectContaining({ order_id: EDC_BILL, last_status: lastStatus, void_outcome: "none" }),
    ]);
  });

  it.each([
    ["a 500 (it may have reached the terminal)", { error: { status: 500 } }, "unknown"],
    ["a 400", { error: { status: 400 } }, "error"],
    ["void_in_progress", { data: { status: "void_in_progress" } }, "voidInProgress"],
  ])("the void's own answer is reported: %s → %s", async (_label, reply, outcome) => {
    openEdc();
    h.replies.edcVoid = () => Promise.resolve(reply);
    const { result } = release();
    result.current();
    await flush();
    expect(endpoints()).toEqual(["edcStatus", "edcVoid"]);
    expect(releaseEvents()).toEqual([expect.objectContaining({ last_status: "pending", void_outcome: outcome })]);
  });

  it("a void trigger that THROWS is reported as void_outcome unknown — it may have reached the terminal", async () => {
    openEdc();
    h.replies.edcVoid = () => Promise.reject(new Error("boom"));
    const { result } = release();
    result.current();
    await flush();
    expect(endpoints()).toEqual(["edcStatus", "edcVoid"]);
    expect(releaseEvents()).toEqual([
      expect.objectContaining({ order_id: EDC_BILL, last_status: "pending", void_outcome: "unknown" }),
    ]);
  });

  it("DQR: the status read only — never a void, even on pending; mid + secret ride in the body, never the event", async () => {
    openDqr();
    const { result } = release();
    result.current();
    await flush();
    expect(endpoints()).toEqual(["dqrStatus"]);
    expect(calls()[0].body).toEqual({
      deployment_id: "dep1",
      order_id: DQR_BILL,
      mid: "MID-SECRET-1",
      secretKey: "KEY-SECRET-1",
    });
    expect(releaseEvents()).toEqual([
      {
        error_source: "paytm_session_released",
        order_id: DQR_BILL,
        payment_type: "PaytmDynamicQr",
        last_status: "pending",
        void_outcome: "none",
      },
    ]);
    const sent = JSON.stringify(h.capture.mock.calls);
    for (const secret of ["MID-SECRET-1", "KEY-SECRET-1", QR, "upi://"]) expect(sent).not.toContain(secret);
  });

  it("a DQR without its QR is not an open session: nothing at all", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmDynamicQr" }));
    store.dispatch(setBillPaymentInfo({ posBillNo: DQR_BILL, posBillTime: BILL_TIME }));
    const { result } = release();
    result.current();
    await flush();
    expect(h.calls).toEqual([]);
    expect(releaseEvents()).toEqual([]);
  });

  it("no selection (the settings changed): no request — the event only", async () => {
    openEdc();
    store.dispatch(setPaymentSettings([DQR_OPTION]));
    const { result } = release();
    result.current();
    await flush();
    expect(h.calls).toEqual([]);
    expect(releaseEvents()).toEqual([
      {
        error_source: "paytm_session_released",
        order_id: EDC_BILL,
        payment_type: "PaytmEdc",
        last_status: "no_selection",
        void_outcome: "none",
      },
    ]);
  });

  it("junk persisted state never throws; the callback is stable across renders", async () => {
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    store.dispatch(setBillPaymentInfo({ posBillNo: EDC_BILL, posBillTime: 1 }));
    store.dispatch(setPaymentSettings("junk"));
    const { result, rerender } = release();
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(() => result.current()).not.toThrow();
    await flush();
    expect(h.calls).toEqual([]);
  });

  it("the bodies are built at CALL time: a reset right after changes nothing that is sent", async () => {
    openEdc();
    const status = deferred();
    h.replies.edcStatus = () => status.promise;
    const { result } = release();
    result.current();
    store.dispatch(emptyPayment());
    await act(async () => status.resolve({ data: { status: "pending" } }));
    await flush();
    expect(endpoints()).toEqual(["edcStatus", "edcVoid"]);
    expect(calls()[1].body).toEqual(EDC_VOID_BODY);
  });
});

describe("StartScreen teardown — the release runs inside the latch, before the reset", () => {
  const renderStart = () =>
    render(
      <CookiesProvider>
        <Provider store={store}>
          <MemoryRouter initialEntries={["/start"]}>
            <Routes>
              <Route path="/start" element={<StartScreen />} />
            </Routes>
          </MemoryRouter>
        </Provider>
      </CookiesProvider>,
      { reactStrictMode: true },
    );

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}) })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("StrictMode runs it ONCE, and its snapshot is taken BEFORE resetSession wipes the payment slice", async () => {
    openEdc();
    renderStart();
    await flush();

    expect(endpoints().filter((endpoint) => endpoint === "edcStatus")).toHaveLength(1);
    expect(calls()[0].paymentAtCall).toMatchObject({ posBillNo: EDC_BILL, paymentType: "PaytmEdc" });
    expect(calls()[0].body).toEqual(EDC_STATUS_BODY);
    expect(payment()).toMatchObject({ posBillNo: "", paymentType: "" });
    expect(releaseEvents()).toHaveLength(1);
  });

  it("a hung release never holds the reset or the splash", async () => {
    openEdc();
    h.replies.edcStatus = () => new Promise(() => undefined);
    renderStart();
    await flush();

    expect(endpoints()).toEqual(["edcStatus"]);
    expect(payment()).toMatchObject({ posBillNo: "", paymentType: "" });
    expect(screen.getByTestId("start-screen")).toBeInTheDocument();
    expect(releaseEvents()).toEqual([]);
  });

  it("Rule 3 (F3): once the release has its snapshot, no Paytm session field survives /start — in memory or in the persisted copy", async () => {
    openDqr();
    store.dispatch(setOrderId(DQR_BILL)); // usePaytmCheckout mirrors posBillNo here
    // Read back through the store's own engine (no raw storage access).
    const persisted = async () => {
      await persistor.flush();
      const raw = (await storage.getItem("persist:root")) as string | null;
      return JSON.parse(raw ?? "{}") as Record<string, string>;
    };
    // In-session crash recovery: the open session IS on disk before /start.
    expect((await persisted()).payment).toContain(QR);

    renderStart();
    await flush();

    expect(endpoints()).toEqual(["dqrStatus"]);
    expect(calls()[0].paymentAtCall).toMatchObject({ posBillNo: DQR_BILL, paymentType: "PaytmDynamicQr" });
    const cleared = { posBillNo: "", posBillTime: "", paymentType: "", paytmQrCode: "" };
    expect(payment()).toMatchObject(cleared);
    expect((store.getState() as unknown as { order: { orderId: string } }).order.orderId).toBe("");

    const root = await persisted();
    expect(JSON.parse(root.payment)).toMatchObject(cleared);
    expect(JSON.parse(root.order)).toMatchObject({ orderId: "" });
    expect(root.payment).not.toContain(QR);
  });

  it("Rule 3 (F3): every event the /start teardown sends carries the ids only as order_id + payment_type — never posBillTime, the QR, mid, secret or device id — and it logs no session field at all", async () => {
    // [key, value] of every leaf of every payload — nested fields count too.
    const leaves = (node: unknown, key = ""): Array<[string, unknown]> =>
      node !== null && typeof node === "object"
        ? Object.entries(node).flatMap(([k, v]) => leaves(v, k))
        : [[key, node]];
    // Pass-through spies: every console call the teardowns make is kept.
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));
    h.replies.edcVoid = () => Promise.resolve({ data: { success: true } });
    openDqr(); // pending → the status read only
    renderStart().unmount();
    await flush();
    openEdc(); // pending → the status read, then the void
    renderStart();
    await flush();
    const logged = inspect(logs.map((spy) => spy.mock.calls), { depth: 8 });
    logs.forEach((spy) => spy.mockRestore());
    expect(endpoints()).toEqual(["dqrStatus", "edcStatus", "edcVoid"]);
    expect(releaseEvents()).toHaveLength(2);

    // Every event of both teardowns, not only the release's own.
    const sent = leaves(h.capture.mock.calls.map(([, props]) => props as unknown));
    expect(new Set(sent.filter(([, v]) => v === EDC_BILL || v === DQR_BILL).map(([k]) => k))).toEqual(
      new Set(["order_id"]),
    );
    expect(
      new Set(sent.filter(([, v]) => v === "PaytmEdc" || v === "PaytmDynamicQr").map(([k]) => k)),
    ).toEqual(new Set(["payment_type"]));
    expect(sent.filter(([, v]) => v === BILL_TIME || v === String(BILL_TIME))).toEqual([]);
    const text = JSON.stringify(sent);
    for (const secret of [QR, "upi://", "MID-SECRET-1", "KEY-SECRET-1", "EDC-DEVICE-1"]) {
      expect(text).not.toContain(secret);
    }
    // Never logged: no session field (bill no, time, type, QR) and no credential.
    for (const value of [EDC_BILL, DQR_BILL, String(BILL_TIME), "PaytmEdc", "PaytmDynamicQr", QR, "upi://", "MID-SECRET-1", "KEY-SECRET-1", "EDC-DEVICE-1"]) {
      expect(logged, `console carried ${value}`).not.toContain(value);
    }
  });

  it("no open session: the splash makes no Paytm call", async () => {
    renderStart();
    await flush();
    expect(h.calls).toEqual([]);
  });
});
