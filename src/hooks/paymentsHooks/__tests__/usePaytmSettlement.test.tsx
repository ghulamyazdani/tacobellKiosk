import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  emptyPayment,
  setBillPaymentInfo,
  setKioskPaymentType,
  setPaytmQrCode,
} from "@cx-sdk/payments/state/payment.slice";
import { setPaymentSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setAutenticationDetails } from "@cx-sdk/core/auth/authentication.slice";
import { setClaimedCoupon } from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../../redux/app/store";
import {
  IDLE_HOLD_MAX_MS,
  IdleHoldContext,
  PAYMENT_IDLE_HOLD_MAX_MS,
} from "../../utils/useIdleTimeout";
import usePaytmSettlement from "../usePaytmSettlement";

/*
  usePaytmSettlement — the /paymentPolling settlement loop (P8b-06), a MONEY
  PATH. Real store, real SDK reducer, real hook; mocked edges: the three
  Paytm RTK triggers, useOrderHook (recordOrderLocally / pushOrder spies),
  navigate and analytics.

  Two harnesses:
  - "at the payment deadline" (P8b fix stage, review M1/M2): the hook's
    timers are CAPTURED, not scheduled, so each test fires the 3 s poll and
    the 1 Hz tick by hand; and React runs OUTSIDE act()
    (IS_REACT_ACT_ENVIRONMENT = false), so the tick's setInterval update
    renders in a LATER task and its passive effects later still — the
    browser's ordering, which act() would collapse. A status read's answer
    is released by the test between those tasks.
  - "the settlement loop": vitest fake timers (Date included), stepped in
    1 s acts — React runs no effects inside one act, so one long advance
    would freeze the self-rescheduling poll chain.
*/

type Envelope = { data?: unknown; error?: unknown };
type Timer = { id: number; cb: () => void; ms: number; live: boolean };

const mockNavigate = vi.fn();
const mockCapture = vi.fn();
const mockRecord = vi.fn();
const mockPushOrder = vi.fn();
const statusCalls: Record<string, unknown>[] = [];
const voidCalls: Record<string, unknown>[] = [];
const answers: Array<(envelope: Envelope) => void> = [];
/** Every gateway call, in order. */
const calls: Array<"status" | "void"> = [];
/** How the next status read / void answers (set per test). */
let statusImpl: () => Promise<Envelope>;
let voidImpl: () => Promise<Envelope>;

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));
vi.mock("../../menuHooks/useOrderHook", () => ({
  default: () => ({
    recordOrderLocally: (...args: unknown[]) => mockRecord(...args),
    pushOrder: (...args: unknown[]) => mockPushOrder(...args),
  }),
}));
vi.mock("@cx-sdk/payments/services/paymentSettingsFetchApi", () => {
  const status = (body: Record<string, unknown>) => {
    statusCalls.push(body);
    calls.push("status");
    return statusImpl();
  };
  const cancel = (body: Record<string, unknown>) => {
    voidCalls.push(body);
    calls.push("void");
    return voidImpl();
  };
  return {
    useCheckPaytmDqrKioskStatusMutation: () => [status],
    useCheckPaytmEdcKioskStatusMutation: () => [status],
    useCancelPaytmEdcKioskMutation: () => [cancel],
  };
});

beforeEach(() => {
  [mockNavigate, mockCapture, mockRecord, mockPushOrder].forEach((fn) => fn.mockReset());
  mockRecord.mockResolvedValue(undefined);
  statusCalls.length = 0;
  voidCalls.length = 0;
  answers.length = 0;
  calls.length = 0;
  // Default: every read waits for the test to answer it (answers[]).
  statusImpl = () => new Promise<Envelope>((resolve) => answers.push(resolve));
  voidImpl = () => Promise.resolve({ data: { success: true } });
});

const EDC_ENTITY = {
  _id: "pay_edc",
  tenant_id: "tenant1",
  deployment_id: "dep1",
  setting_label: "PaytmEdc",
  value: [
    { id: "activate", value: true },
    { id: "paytm_device_id", value: "EDC-T-1" },
  ],
};
const BILL = "17280000000001234";
const T0 = 1_800_000_000_000;
/** posBillTime + the 180 s EDC window = T0 + 5 s. */
const DEADLINE = T0 + 5_000;

const realSetTimeout = setTimeout;
/** Let the scheduler run: render, commit, passive effects, RTK promises. */
const macrotasks = async (n = 6) => {
  for (let i = 0; i < n; i += 1) {
    await new Promise((resolve) => realSetTimeout(resolve, 5));
  }
};
const reactOutsideAct = (on: boolean) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = !on;
};

let clock = T0;
let timers: Timer[] = [];
let nextId = 900_000;
const fire = (ms: number) => {
  const timer = timers.find((t) => t.live && t.ms === ms);
  if (!timer) throw new Error(`no live ${ms} ms timer`);
  timer.cb();
};

function Harness() {
  const api = usePaytmSettlement();
  return (
    <div>
      <span data-testid="phase">{api.session?.phase ?? "none"}</span>
      <span data-testid="reason">{api.session?.reason ?? ""}</span>
      <span data-testid="prompt">{api.session?.terminalPrompt ?? ""}</span>
      <span data-testid="secs">{api.secondsLeft}</span>
      <span data-testid="checking">{String(api.checking)}</span>
      <span data-testid="ref">{api.orderRef}</span>
      <span data-testid="qr">{api.qrCode}</span>
      <button type="button" data-testid="cancel" onClick={api.confirmCancel}>c</button>
      <button type="button" data-testid="check" onClick={api.checkAgain}>k</button>
      <button type="button" data-testid="finish" onClick={api.finish}>f</button>
      <button type="button" data-testid="retry" onClick={api.tryAgain}>r</button>
      <button type="button" data-testid="bag" onClick={api.backToBag}>b</button>
    </div>
  );
}
const phase = () => screen.getByTestId("phase").textContent;

/** Mounted in "awaiting", with the 3 s poll's read SENT at T0 + 3 s (before the deadline) and unanswered. */
function mountWithPreDeadlineRead() {
  render(
    <Provider store={store}>
      <IdleHoldContext.Provider value={() => undefined}>
        <MemoryRouter
          initialEntries={[{ pathname: "/paymentPolling", state: { receipt: "none" } }]}
        >
          <Harness />
        </MemoryRouter>
      </IdleHoldContext.Provider>
    </Provider>,
  );
  expect(phase()).toBe("awaiting");
  clock = T0 + 3_000;
  act(() => fire(3_000));
  expect(statusCalls).toHaveLength(1);
  reactOutsideAct(true);
}

describe("usePaytmSettlement at the payment deadline", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    timers = [];
    clock = T0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const capture = (cb: () => void, ms: number) => {
      nextId += 1;
      timers.push({ id: nextId, cb, ms, live: true });
      return nextId;
    };
    const clear = (id: number) => {
      for (const t of timers) if (t.id === id) t.live = false;
    };
    vi.spyOn(window, "setInterval").mockImplementation(capture as never);
    vi.spyOn(window, "setTimeout").mockImplementation(capture as never);
    vi.spyOn(window, "clearInterval").mockImplementation(clear as never);
    vi.spyOn(window, "clearTimeout").mockImplementation(clear as never);

    store.dispatch(
      setCartItems([
        { id: "cw", itemId: "cw-1", name: "CW", quantity: 1, type: "ITEM", total_price: 9 },
      ]),
    );
    store.dispatch(setAmount(9));
    store.dispatch(
      setAutenticationDetails({
        deploymentDetails: { _id: "dep1", tenant_id: "tenant1" },
        licenseDetails: {},
      }),
    );
    store.dispatch(setPaymentSettings([EDC_ENTITY]));
    store.dispatch(setKioskPaymentType({ type: "PaytmEdc" }));
    store.dispatch(
      setBillPaymentInfo({ posBillNo: BILL, posBillTime: DEADLINE - 180_000 }),
    );
  });

  afterEach(() => {
    reactOutsideAct(false);
    vi.restoreAllMocks();
  });

  it("a read SENT before the deadline never licenses the EDC void, even when its 'pending' lands before React renders the tick", async () => {
    mountWithPreDeadlineRead();
    // The deadline tick fires (a non-discrete update, rendered a task later)
    // and the pre-deadline read answers in between.
    clock = DEADLINE;
    fire(1_000);
    answers[0]({ data: { status: "pending" } });
    await macrotasks();

    expect(phase()).toBe("settling");
    expect(statusCalls).toHaveLength(2); // the fresh read is out ...
    expect(voidCalls).toHaveLength(0); // ... and the stale pending licensed nothing

    answers[1]({ data: { status: "pending" } });
    await macrotasks();
    expect(voidCalls).toHaveLength(1); // the void follows the FRESH pending
    expect(voidCalls[0]).toMatchObject({ posBillNo: BILL, deviceId: "EDC-T-1" });
  });

  it("a stale read answering 'paid' at the deadline ends the status reads: no read after paid", async () => {
    mountWithPreDeadlineRead();
    clock = DEADLINE;
    fire(1_000);
    await macrotasks(); // settling committed; the fresh read waits on the stale one

    answers[0]({ data: { status: "paid" } });
    await macrotasks();

    expect(phase()).toBe("paid");
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/orderSuccess", {
      state: { receipt: "none" },
    });
    expect(statusCalls).toHaveLength(1);
    expect(voidCalls).toHaveLength(0);
  });
});

describe("usePaytmSettlement — the settlement loop", () => {
  const DQR_ENTITY = {
    _id: "pay_dqr",
    tenant_id: "tenant1",
    deployment_id: "dep1",
    setting_label: "PaytmDynamicQr",
    value: [
      { id: "activate", value: true },
      { id: "paytm_dqr_merchant_guid", value: "MID-T-1" },
      { id: "paytm_dqr_secret_key", value: "SECRET-T-1" },
    ],
  };
  const QR = "upi://pay?pa=tb@paytm&am=9.00";
  const CW = { id: "cw", itemId: "cw-1", name: "CW", quantity: 1, type: "ITEM", total_price: 9 };
  const REWARD = { id: "rw", itemId: "lr-1", name: "Salad", quantity: 1, type: "ITEM", isLoyaltyItem: true, total_price: 0 };
  const CLAIMED = { couponCode: "RW-1", datetime: "2026-10-06", claimedPoints: 50 };

  const adjust = vi.fn<(delta: 1 | -1) => void>();
  const holds = () => adjust.mock.calls.reduce((sum, [delta]) => sum + delta, 0);
  const read = () =>
    store.getState() as unknown as {
      payment: { paymentType: string; posBillNo: string; paytmQrCode: string };
      loyalty: { claimedCoupon: { isClaimed: boolean; couponData: Record<string, unknown> } };
    };
  const answer = (value: string): Promise<Envelope> => Promise.resolve({ data: { status: value } });
  const failWith = (status: unknown): Promise<Envelope> => Promise.resolve({ error: { status } });

  const seed = (kind: "edc" | "dqr", billTime = Date.now(), settings: unknown[] = [EDC_ENTITY, DQR_ENTITY]) => {
    store.dispatch(setCartItems([CW]));
    store.dispatch(setAmount(9));
    store.dispatch(
      setAutenticationDetails({ deploymentDetails: { _id: "dep1", tenant_id: "tenant1" }, licenseDetails: {} }),
    );
    store.dispatch(setPaymentSettings(settings));
    store.dispatch(setKioskPaymentType({ type: kind === "edc" ? "PaytmEdc" : "PaytmDynamicQr" }));
    store.dispatch(setBillPaymentInfo({ posBillNo: BILL, posBillTime: billTime }));
    if (kind === "dqr") store.dispatch(setPaytmQrCode(QR));
  };
  const mount = (reactStrictMode = false) =>
    render(
      <Provider store={store}>
        <IdleHoldContext.Provider value={adjust}>
          <MemoryRouter initialEntries={[{ pathname: "/paymentPolling", state: { receipt: "print" } }]}>
            <Harness />
          </MemoryRouter>
        </IdleHoldContext.Provider>
      </Provider>,
      { reactStrictMode },
    );
  const tap = (testId: string) =>
    act(() => {
      fireEvent.click(screen.getByTestId(testId));
    });
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  /** Long spans in 1 s acts: React runs the re-armed poll chain between them, as a browser does. */
  const step = async (ms: number) => {
    for (let left = ms; left > 0; left -= 1000) await advance(Math.min(1000, left));
  };
  const text = (testId: string) => screen.getByTestId(testId).textContent;
  const events = (name: string) =>
    mockCapture.mock.calls.filter(([event]) => event === name).map(([, props]) => props as Record<string, unknown>);
  const settlementEvents = () => events("error_occurred").filter((p) => p.error_source === "paytm_settlement");
  const noSecretsInAnalytics = () => {
    const sent = JSON.stringify(mockCapture.mock.calls);
    for (const secret of ["EDC-T-1", "MID-T-1", "SECRET-T-1", QR, "upi://"]) expect(sent).not.toContain(secret);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    store.dispatch({ type: "RESET_STATE" });
    adjust.mockReset();
    statusImpl = () => answer("pending");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the latched guard", () => {
    it("no open session: ONE replace-redirect — /payment with a bag, /menu without — and no read ever", async () => {
      store.dispatch(setCartItems([CW]));
      const first = mount(true);
      await advance(0);
      expect(mockNavigate.mock.calls).toEqual([["/payment", { replace: true }]]);
      expect(text("phase")).toBe("none");
      // Later store changes never re-fire it (the latch, not the slice, decides).
      act(() => {
        store.dispatch(emptyPayment());
        store.dispatch(setCartItems([]));
      });
      await step(10_000);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      first.unmount();

      store.dispatch({ type: "RESET_STATE" });
      mockNavigate.mockReset();
      mount();
      await step(10_000);
      expect(mockNavigate.mock.calls).toEqual([["/menu", { replace: true }]]);
      expect(statusCalls).toHaveLength(0);
      expect(holds()).toBe(0);
    });

    it("an open session survives its own emptyPayment: TRY AGAIN navigates ONCE, never a guard redirect", async () => {
      seed("dqr");
      mount();
      await step(135_000 + 30_000);
      expect(text("reason")).toBe("expired");

      tap("retry");
      tap("retry");
      await step(5_000);
      expect(read().payment.posBillNo).toBe("");
      expect(mockNavigate.mock.calls).toEqual([["/payment"]]);
    });

    it("a reload resumes the SAME session: same posBillNo, the deadline from the persisted posBillTime", async () => {
      const billTime = Date.now() - 60_000;
      seed("edc", billTime);
      mount();
      expect(text("phase")).toBe("awaiting");
      expect(text("secs")).toBe("120");
      expect(text("ref")).toBe(BILL.slice(-5));

      await advance(3000);
      expect(statusCalls).toEqual([
        { deployment_id: "dep1", order_id: BILL, posBillNo: BILL, posBillTime: billTime, deviceId: "EDC-T-1" },
      ]);
    });

    it("a reload past the deadline starts settling with ONE fresh read of the same order", async () => {
      seed("dqr", Date.now() - 400_000);
      mount();
      expect(text("phase")).toBe("settling");
      await advance(0);
      expect(statusCalls).toEqual([{ deployment_id: "dep1", order_id: BILL, mid: "MID-T-1", secretKey: "SECRET-T-1" }]);
      expect(text("qr")).toBe(QR);
    });

    it("an open session whose credentials are gone: the unknown panel at once, never a read", async () => {
      seed("edc", Date.now(), [DQR_ENTITY]);
      mount();
      expect(text("phase")).toBe("unknown");
      await step(10_000);
      tap("check");
      await advance(0);
      expect(statusCalls).toHaveLength(0);
      expect(holds()).toBe(0);
    });
  });

  it("polls every 3 s with at most ONE read in flight", async () => {
    seed("edc");
    const pending: Array<(envelope: Envelope) => void> = [];
    statusImpl = () => new Promise<Envelope>((resolve) => pending.push(resolve));
    mount();

    await advance(2999);
    expect(statusCalls).toHaveLength(0);
    await advance(1);
    expect(statusCalls).toHaveLength(1);
    await step(9000); // the read hangs: no second one queues behind it
    expect(statusCalls).toHaveLength(1);

    await act(async () => pending[0]({ data: { status: "pending" } }));
    await advance(2999);
    expect(statusCalls).toHaveLength(1);
    await advance(1);
    expect(statusCalls).toHaveLength(2);
  });

  describe("a read IN FLIGHT when the guest cancels answers for the phase it was sent in", () => {
    const heldReads = () => {
      const pending: Array<(envelope: Envelope) => void> = [];
      statusImpl = () => new Promise<Envelope>((resolve) => pending.push(resolve));
      return pending;
    };

    it("EDC: its 'pending' never licenses the void — the void follows the FRESH read", async () => {
      seed("edc");
      const pending = heldReads();
      mount();
      await advance(3000);
      expect(statusCalls).toHaveLength(1); // sent while awaiting
      tap("cancel");
      await advance(0);
      expect(statusCalls).toHaveLength(1); // the fresh read waits for it, never doubles it

      await act(async () => pending[0]({ data: { status: "pending" } }));
      await advance(0);
      expect(voidCalls).toHaveLength(0);
      expect(statusCalls).toHaveLength(2); // now the fresh read is out

      await act(async () => pending[1]({ data: { status: "pending" } }));
      await advance(0);
      expect(calls).toEqual(["status", "status", "void"]);
    });

    it("DQR: its 'pending' never ends the cancel — only the fresh read does", async () => {
      seed("dqr");
      const pending = heldReads();
      mount();
      await advance(3000);
      tap("cancel");
      await advance(0);

      await act(async () => pending[0]({ data: { status: "pending" } }));
      await advance(0);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(text("phase")).toBe("cancelling");
      expect(statusCalls).toHaveLength(2);

      await act(async () => pending[1]({ data: { status: "pending" } }));
      await advance(0);
      expect(mockNavigate.mock.calls).toEqual([["/payment"]]);
    });

    it("a stale 'paid' still wins (paid always wins)", async () => {
      seed("edc");
      const pending = heldReads();
      mount();
      await advance(3000);
      tap("cancel");
      await advance(0);

      await act(async () => pending[0]({ data: { status: "paid" } }));
      await advance(0);
      expect(text("phase")).toBe("paid");
      expect(statusCalls).toHaveLength(1); // nothing reads after paid
      expect(voidCalls).toHaveLength(0);
      expect(mockNavigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "print" } }]]);
    });
  });

  describe("paid", () => {
    it("records locally ONCE, never pushes, navigates ONCE with the receipt, and stops reading", async () => {
      seed("edc");
      const replies = ["pending", "paid"];
      statusImpl = () => answer(replies.shift() ?? "paid");
      mount();
      await advance(3000);
      await advance(3000);

      expect(text("phase")).toBe("paid");
      expect(mockRecord.mock.calls).toEqual([[BILL, false, 0]]);
      expect(mockPushOrder).not.toHaveBeenCalled();
      expect(mockNavigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "print" } }]]);
      expect(events("payment_successful")).toEqual([{ order_id: BILL, payment_type: "PaytmEdc", net_amount: 9 }]);
      expect(voidCalls).toHaveLength(0);
      expect(read().payment.paymentType).toBe("PaytmEdc"); // /start's reset clears it, not this screen

      await step(15_000);
      expect(statusCalls).toHaveLength(2);
      expect(mockRecord).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      noSecretsInAnalytics();
    });

    it("a recordOrderLocally throw is not a payment failure: reported, then Order Complete", async () => {
      seed("edc");
      statusImpl = () => answer("paid");
      mockRecord.mockRejectedValue(new Error("dexie"));
      mount();
      await advance(3000);

      expect(events("error_occurred")).toEqual([{ error_source: "paytm_record_local", order_id: BILL }]);
      expect(events("payment_failed")).toEqual([]);
      expect(events("payment_successful")).toHaveLength(1);
      expect(mockNavigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "print" } }]]);
    });
  });

  describe("EDC", () => {
    it("customer cancel: status, void, pressYes, cancelled — then emptyPayment and /payment", async () => {
      seed("edc");
      const atNavigate: string[] = [];
      mockNavigate.mockImplementation(() => atNavigate.push(read().payment.paymentType));
      mount();
      tap("cancel");
      await advance(0);

      expect(text("phase")).toBe("cancelling");
      expect(calls).toEqual(["status", "void"]);
      expect(voidCalls).toEqual([{ deployment_id: "dep1", posBillNo: BILL, posBillTime: expect.any(Number), deviceId: "EDC-T-1" }]);
      expect(text("prompt")).toBe("pressYes");
      expect(holds()).toBe(1);

      statusImpl = () => answer("cancelled");
      await advance(3000);

      expect(calls).toEqual(["status", "void", "status"]);
      expect(text("reason")).toBe("cancelledByCustomer");
      expect(mockNavigate.mock.calls).toEqual([["/payment"]]);
      expect(atNavigate).toEqual([""]); // emptied BEFORE the navigation
      expect(events("payment_cancelled_by_user")).toEqual([{ order_id: BILL, payment_type: "PaytmEdc" }]);
      expect(holds()).toBe(0);
      noSecretsInAnalytics();
    });

    it("the cancel race: a paid answer to the post-cancel read wins — no void, Order Complete", async () => {
      seed("edc");
      statusImpl = () => answer("paid");
      mount();
      tap("cancel");
      await advance(0);

      expect(text("phase")).toBe("paid");
      expect(voidCalls).toHaveLength(0);
      expect(mockRecord).toHaveBeenCalledTimes(1);
      expect(mockNavigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "print" } }]]);
    });

    it("an errored post-cancel read never voids; the window ends on the unknown panel", async () => {
      seed("edc");
      statusImpl = () => failWith(504);
      mount();
      tap("cancel");
      await step(30_000);

      expect(voidCalls).toHaveLength(0);
      expect(text("phase")).toBe("unknown");
    });

    it("expiry: ONE void after the fresh pending read, then cancelled → the failure panel (expired)", async () => {
      seed("edc");
      mount();
      await step(180_000);
      expect(text("phase")).toBe("settling");
      expect(voidCalls).toHaveLength(1);
      expect(text("prompt")).toBe("pressYes");

      statusImpl = () => answer("cancelled");
      await step(3000);
      expect(text("phase")).toBe("notPaid");
      expect(text("reason")).toBe("expired");
      expect(events("payment_failed")).toEqual([{ order_id: BILL, payment_type: "PaytmEdc", reason: "expired" }]);
      expect(mockNavigate).not.toHaveBeenCalled(); // the panel, not a navigation
      expect(holds()).toBe(0);
      expect(voidCalls).toHaveLength(1);

      tap("bag");
      expect(mockNavigate.mock.calls).toEqual([["/cart"]]);
      expect(read().payment.paymentType).toBe("");
    });

    it("expiry: a FRESH settling read that outlives a tick (a 5 s read is normal) still licenses the void", async () => {
      // The deadline falls between two polls, so a tick crosses it and the fresh read is sent at once.
      const billTime = Date.now() - 1_500;
      const deadline = billTime + 180_000;
      seed("edc", billTime);
      const held: Array<(envelope: Envelope) => void> = [];
      statusImpl = () =>
        Date.now() >= deadline ? new Promise<Envelope>((resolve) => held.push(resolve)) : answer("pending");
      mount();
      await step(179_000);
      expect(text("phase")).toBe("settling");
      expect(held).toHaveLength(1);

      await step(2_000); // ticks keep running while the read is out
      expect(voidCalls).toHaveLength(0);
      await act(async () => held[0]({ data: { status: "pending" } }));
      await advance(0);

      expect(voidCalls).toHaveLength(1);
      expect(calls.slice(-2)).toEqual(["status", "void"]);
    });

    it("expiry with a void 500: unknown after the window, reported once with the last read", async () => {
      seed("edc");
      voidImpl = () => failWith(500);
      mount();
      await step(180_000);
      expect(voidCalls).toHaveLength(1);
      await step(30_000);

      expect(text("phase")).toBe("unknown");
      expect(settlementEvents()).toEqual([
        {
          error_source: "paytm_settlement",
          outcome_unknown: true,
          order_id: BILL,
          payment_type: "PaytmEdc",
          last_poll: "pending",
          void_requested: true,
        },
      ]);
      expect(holds()).toBe(0);
      expect(voidCalls).toHaveLength(1);
    });
  });

  describe("DQR", () => {
    it("cancel is ONE status read, then emptyPayment and /payment — never a void", async () => {
      seed("dqr");
      mount();
      tap("cancel");
      await advance(0);

      expect(statusCalls).toEqual([{ deployment_id: "dep1", order_id: BILL, mid: "MID-T-1", secretKey: "SECRET-T-1" }]);
      expect(mockNavigate.mock.calls).toEqual([["/payment"]]);
      expect(read().payment.paytmQrCode).toBe("");
      await step(10_000);
      expect(statusCalls).toHaveLength(1);
      expect(voidCalls).toHaveLength(0);
      noSecretsInAnalytics();
    });

    it("an expiry that reads pending shows the expired panel", async () => {
      seed("dqr");
      mount();
      await step(135_000);
      expect(text("phase")).toBe("settling");
      await step(30_000);

      expect(text("phase")).toBe("notPaid");
      expect(text("reason")).toBe("expired");
      expect(events("payment_failed")).toEqual([{ order_id: BILL, payment_type: "PaytmDynamicQr", reason: "expired" }]);
      expect(voidCalls).toHaveLength(0);
      noSecretsInAnalytics();
    });

    it("an expiry whose reads all error is NOT expired: the unknown panel", async () => {
      seed("dqr");
      statusImpl = () => failWith("TIMEOUT_ERROR");
      mount();
      await step(135_000 + 30_000);

      expect(text("phase")).toBe("unknown");
      expect(events("payment_failed")).toEqual([]);
    });
  });

  it("the unknown panel: CHECK AGAIN is ONE read (a double tap joins it); FINISH only navigates to /start", async () => {
    seed("edc");
    statusImpl = () => failWith("FETCH_ERROR");
    mount();
    await step(180_000 + 30_000);
    expect(text("phase")).toBe("unknown");
    const before = statusCalls.length;
    await step(20_000);
    expect(statusCalls).toHaveLength(before); // no polling on the panel

    let release: ((envelope: Envelope) => void) | undefined;
    statusImpl = () => new Promise<Envelope>((resolve) => { release = resolve; });
    tap("check");
    tap("check");
    expect(statusCalls).toHaveLength(before + 1);
    expect(text("checking")).toBe("true");
    await act(async () => release?.({ data: { status: "pending" } }));
    await advance(0);
    expect(text("checking")).toBe("false");
    expect(text("phase")).toBe("unknown");

    const dispatched = vi.fn();
    const unsubscribe = store.subscribe(dispatched);
    tap("finish");
    tap("finish");
    unsubscribe();
    expect(mockNavigate.mock.calls).toEqual([["/start"]]);
    expect(dispatched).not.toHaveBeenCalled(); // /start's mount owns the reset (H1)
    expect(read().payment).toMatchObject({ paymentType: "PaytmEdc", posBillNo: BILL });
    expect(voidCalls).toHaveLength(0);
  });

  it("the unknown panel resolves: CHECK AGAIN answering paid → Order Complete (recorded once, never voided)", async () => {
    seed("edc", Date.now() - 400_000); // resumed long after the deadline
    statusImpl = () => failWith("FETCH_ERROR");
    mount();
    await advance(0);
    expect(statusCalls).toHaveLength(1); // the fresh read at mount
    await step(30_000);
    expect(text("phase")).toBe("unknown");
    expect(voidCalls).toHaveLength(0); // never a void after errors

    statusImpl = () => answer("paid");
    tap("check");
    await advance(0);
    expect(text("phase")).toBe("paid");
    expect(mockRecord.mock.calls).toEqual([[BILL, false, 0]]);
    expect(mockNavigate.mock.calls).toEqual([["/orderSuccess", { state: { receipt: "print" } }]]);
    expect(voidCalls).toHaveLength(0);
  });

  it("idle: held while in flight and on paid, released on the panels; the cap is 240 s, not the 120 s default", async () => {
    seed("edc");
    statusImpl = () => answer("paid");
    mockRecord.mockReturnValue(new Promise(() => undefined)); // the bookkeeping hangs
    mount();
    expect(holds()).toBe(1);
    await advance(3000);
    expect(text("phase")).toBe("paid");
    expect(mockNavigate).not.toHaveBeenCalled();

    await advance(IDLE_HOLD_MAX_MS);
    expect(holds()).toBe(1);
    await advance(PAYMENT_IDLE_HOLD_MAX_MS - IDLE_HOLD_MAX_MS - 3000 - 1);
    expect(holds()).toBe(1);
    await advance(1);
    expect(holds()).toBe(0);
  });

  describe("S7 — only a definitive not-paid of the SAME order un-marks the claim", () => {
    const MARK = { orderOutcomeUnknown: true, outcomeUnknownOrderId: BILL };
    const markClaim = (orderId = BILL) => {
      store.dispatch(setCartItems([CW, REWARD]));
      store.dispatch(setClaimedCoupon({ ...CLAIMED, ...MARK, outcomeUnknownOrderId: orderId }));
    };
    const coupon = () => read().loyalty.claimedCoupon.couponData;

    it("a cancelled read (EDC, before the deadline) un-marks", async () => {
      seed("edc");
      markClaim();
      statusImpl = () => answer("cancelled");
      mount();
      await advance(3000);
      expect(text("reason")).toBe("cancelled");
      expect(coupon()).toEqual(CLAIMED);
    });

    it("an EDC customer cancel confirmed by a cancelled read un-marks", async () => {
      seed("edc");
      markClaim();
      mount();
      tap("cancel");
      await advance(0);
      statusImpl = () => answer("cancelled");
      await advance(3000);
      expect(text("reason")).toBe("cancelledByCustomer");
      expect(coupon()).toEqual(CLAIMED);
    });

    it("a DQR expiry (pending at the end of the window) un-marks", async () => {
      seed("dqr");
      markClaim();
      mount();
      await step(135_000 + 30_000);
      expect(text("reason")).toBe("expired");
      expect(coupon()).toEqual(CLAIMED);
    });

    it("a DQR customer cancel inferred from 'pending' keeps the mark (the QR may still be paid)", async () => {
      seed("dqr");
      markClaim();
      mount();
      tap("cancel");
      await advance(0);
      expect(mockNavigate).toHaveBeenCalledWith("/payment");
      expect(coupon()).toMatchObject(MARK);
    });

    it("the unknown panel keeps the mark", async () => {
      seed("edc");
      markClaim();
      statusImpl = () => failWith(500);
      mount();
      await step(180_000 + 30_000);
      expect(text("phase")).toBe("unknown");
      expect(coupon()).toMatchObject(MARK);
    });

    it("a mark another order set is never un-marked", async () => {
      seed("edc");
      markClaim("ANOTHER-ORDER");
      statusImpl = () => answer("cancelled");
      mount();
      await advance(3000);
      expect(text("reason")).toBe("cancelled");
      expect(coupon()).toMatchObject({ orderOutcomeUnknown: true, outcomeUnknownOrderId: "ANOTHER-ORDER" });
    });
  });

  describe("no timer survives unmount", () => {
    it("mid-read: every timer is gone and a late paid answer writes and navigates nothing", async () => {
      seed("edc");
      const pending: Array<(envelope: Envelope) => void> = [];
      statusImpl = () => new Promise<Envelope>((resolve) => pending.push(resolve));
      const view = mount();
      await advance(3000);
      expect(statusCalls).toHaveLength(1);

      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
      expect(holds()).toBe(0);

      const dispatched = vi.fn();
      const unsubscribe = store.subscribe(dispatched);
      await act(async () => pending[0]({ data: { status: "paid" } }));
      await advance(10_000);
      unsubscribe();
      expect(dispatched).not.toHaveBeenCalled();
      expect(mockRecord).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(statusCalls).toHaveLength(1);
    });

    it("on the unknown panel, and under StrictMode (one fresh read, one void at a settling mount)", async () => {
      seed("edc", Date.now() - 400_000);
      const strict = mount(true);
      await advance(0);
      expect(statusCalls).toHaveLength(1);
      expect(voidCalls).toHaveLength(1);
      await step(30_000);
      expect(text("phase")).toBe("unknown");
      strict.unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
