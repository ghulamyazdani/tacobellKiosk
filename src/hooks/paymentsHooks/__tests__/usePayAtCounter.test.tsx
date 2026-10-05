/* eslint-disable @typescript-eslint/no-explicit-any --
 * Store reads mirror the untyped SDK slices this hook writes (payment, order,
 * cart); typed with those slices, not here. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setAmount, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  resetLoyaltySession,
  setClaimedCoupon,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import { ORDER_PUSH_MAX_ATTEMPTS } from "@cx-sdk/payments/settlement/settlementRules";
import { store } from "../../../redux/app/store";
import { IdleHoldContext } from "../../utils/useIdleTimeout";
import usePayAtCounter, {
  PAY_AT_COUNTER_BUFFER_MS,
  PAY_AT_COUNTER_PAYMENT_TYPE,
  type ReceiptPreference,
} from "../usePayAtCounter";
import "../../../i18n";

/*
  HOUSE STYLE: real store + Provider + MemoryRouter + RESET_STATE + i18n.

  Two things are mocked, both for the same reason — they are the hook's only
  outside edges and the test needs to drive them:

  - useOrderHook. The real one builds a whole order payload out of a converted
    menu and fires RTK Query mutations; what THIS hook owns is the SEQUENCE
    around `generateQROrderId` / `pushOrder`, so those two are spies. The
    pushOrder spy also snapshots the store AT PUSH TIME, which is how the
    "payment type is committed before the payload is built" contract is
    asserted behaviourally rather than by counting dispatches.
  - useNavigate, so `/orderSuccess` + its router state are assertable (there
    is no receipt slice — navigation state is the only carrier).

  Everything else is real: the real reducers decide what `payment.paymentType`,
  `order.orderId` and `order.orderStatus` end up as, and the real
  settlementRules ladder decides how many attempts there are.
*/

const mockNavigate = vi.fn();
const mockPushOrder = vi.fn();
const mockGenerateQROrderId = vi.fn();
const mockCapture = vi.fn();

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
    pushOrder: (...args: unknown[]) => mockPushOrder(...args),
    generateQROrderId: (...args: unknown[]) => mockGenerateQROrderId(...args),
  }),
}));

const state = () => store.getState() as any;

/** What the store looked like the instant `pushOrder` was entered. */
interface PushSnapshot {
  paymentType: string;
  orderId: string;
  orderStatus: string;
  args: unknown[];
}

let pushSnapshots: PushSnapshot[] = [];

/**
 * How an attempt ends. The P9b failures are thrown the way the real
 * useOrderHook.pushOrder rethrows an RTK rejection — `Error(err, { cause: err })`
 * — so the hook's classifiers read the same `cause` chain they do in the app.
 */
type PushOutcome =
  | "ok"
  /** A clean failure with no cause (the pre-P9b fixture). */
  | "fail"
  /** No response headers inside the transport budget. */
  | "timeout"
  /** RTK 2.12: the server answered, the body ran past the budget. */
  | "bodyTimeout"
  /** 2xx with an unreadable body — the order may well exist. */
  | "lostBody"
  /** A malformed 5xx body — the server refused; a clean failure. */
  | "badGateway"
  /** Offline / refused — a clean failure. */
  | "network";

const RTK_ERRORS: Record<Exclude<PushOutcome, "ok" | "fail">, unknown> = {
  timeout: { status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" },
  bodyTimeout: {
    status: "PARSING_ERROR",
    originalStatus: 200,
    data: "",
    error: "TimeoutError: signal timed out",
  },
  lostBody: {
    status: "PARSING_ERROR",
    originalStatus: 200,
    data: "",
    error: "SyntaxError: Unexpected end of JSON input",
  },
  badGateway: {
    status: "PARSING_ERROR",
    originalStatus: 502,
    data: "<html>",
    error: "SyntaxError: Unexpected token '<'",
  },
  network: { status: "FETCH_ERROR", error: "TypeError: Failed to fetch" },
};

/** pushOrder implementation that records the store and then settles. */
const pushImplementation = (outcomes: PushOutcome[]) => {
  let call = 0;
  return async (...args: unknown[]) => {
    pushSnapshots.push({
      paymentType: state().payment.paymentType,
      orderId: state().order.orderId,
      orderStatus: state().order.orderStatus,
      args,
    });
    const outcome = outcomes[Math.min(call, outcomes.length - 1)];
    call += 1;
    if (outcome === "fail") throw new Error("placeOrder 500");
    if (outcome !== "ok") {
      const rtkError = RTK_ERRORS[outcome];
      throw new Error(String(rtkError), { cause: rtkError });
    }
    return { ok: true };
  };
};

/**
 * Harness. Every member of the hook's surface is reachable from the DOM so
 * the tests drive the real component lifecycle (effects, unmount cleanup)
 * rather than calling the hook out of band.
 */
function Harness({ receipt = "none" }: { receipt?: ReceiptPreference }) {
  const api = usePayAtCounter();
  return (
    <div>
      <span data-testid="status">{api.status}</span>
      <span data-testid="attempt">{String(api.attempt)}</span>
      <span data-testid="max-attempts">{String(api.maxAttempts)}</span>
      <span data-testid="order-id">{api.orderId}</span>
      <span data-testid="failed-on-timeout">{String(api.failedOnTimeout)}</span>
      <span data-testid="flags">
        {[
          api.isBuffering ? "buffering" : "",
          api.isPushing ? "pushing" : "",
          api.hasFailed ? "failed" : "",
          api.canCancel ? "cancellable" : "",
        ]
          .filter(Boolean)
          .join(",")}
      </span>
      <button type="button" data-testid="fire-start" onClick={() => api.start()}>
        start
      </button>
      <button
        type="button"
        data-testid="fire-start-direct"
        onClick={() => api.start({ mode: "directOrder" })}
      >
        start direct
      </button>
      <button
        type="button"
        data-testid="fire-begin"
        onClick={() => api.beginCheckout()}
      >
        begin
      </button>
      <button
        type="button"
        data-testid="fire-cancel-checkout"
        onClick={() => api.cancelCheckout()}
      >
        cancel checkout
      </button>
      <button
        type="button"
        data-testid="fire-confirm"
        onClick={() => api.confirmAndPush(receipt)}
      >
        confirm
      </button>
      <button
        type="button"
        data-testid="fire-cancel"
        onClick={() => api.cancel()}
      >
        cancel
      </button>
      <button type="button" data-testid="fire-retry" onClick={() => api.retry()}>
        retry
      </button>
      <button
        type="button"
        data-testid="fire-dismiss"
        onClick={() => api.dismissError()}
      >
        dismiss
      </button>
    </div>
  );
}

const mount = (receipt?: ReceiptPreference) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/receipt"]}>
        <Harness receipt={receipt} />
      </MemoryRouter>
    </Provider>
  );

const tap = (testId: string) => {
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

/**
 * Flush everything that is due RIGHT NOW without moving the clock forward:
 * the zero-delay buffer hop (`confirmAndPush` uses bufferMs 0, and 0 still
 * defers by one macrotask on purpose — see the closure note in the hook) plus
 * the promise chain inside runPush. Deliberately does NOT advance far enough
 * to release a retry backoff; those are stepped explicitly with `advance`.
 */
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
};

/** Move the fake clock and flush whatever that released. */
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const status = () => screen.getByTestId("status").textContent;
const flags = () => screen.getByTestId("flags").textContent ?? "";

const seedCart = (netAmount = 24.5) => {
  store.dispatch(
    setCartItems([
      {
        id: "crunchwrap",
        itemId: "cw-1",
        name: "Crunchwrap Supreme",
        quantity: 1,
        type: "ITEM",
        total_price: netAmount,
      },
    ])
  );
  store.dispatch(setAmount(netAmount));
};

describe("usePayAtCounter — the only order-push path in P8a", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockNavigate.mockReset();
    mockPushOrder.mockReset();
    mockGenerateQROrderId.mockReset();
    mockCapture.mockReset();
    pushSnapshots = [];

    mockGenerateQROrderId.mockResolvedValue("TB-ORDER-ABCDE12345");
    mockPushOrder.mockImplementation(pushImplementation(["ok"]));

    store.dispatch({ type: "RESET_STATE" });
    seedCart();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the sequence — type, id, pending, push, navigate", () => {
    it("runs every step in order and only then navigates", async () => {
      mount("print");
      tap("fire-confirm");
      await settle();

      // Everything the payload builder reads was already committed to the
      // store when pushOrder was entered. This is the guard that keeps a
      // pay-at-counter order from going out as payments.type "ONLINE".
      expect(pushSnapshots).toHaveLength(1);
      expect(pushSnapshots[0].paymentType).toBe(PAY_AT_COUNTER_PAYMENT_TYPE);
      expect(pushSnapshots[0].orderId).toBe("TB-ORDER-ABCDE12345");
      expect(pushSnapshots[0].orderStatus).toBe("pending");

      expect(pushSnapshots[0].args).toEqual(["TB-ORDER-ABCDE12345", true, 24.5]);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/orderSuccess", {
        state: { receipt: "print" },
      });
      expect(status()).toBe("placed");
    });

    it("never navigates before the push resolves", async () => {
      let release: (() => void) | undefined;
      mockPushOrder.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );

      mount();
      tap("fire-confirm");
      await settle();

      expect(mockPushOrder).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(status()).toBe("pushing");
      expect(flags()).toContain("pushing");
      // Cancel is gone the moment anything has left the kiosk.
      expect(flags()).not.toContain("cancellable");

      await act(async () => {
        release?.();
        await Promise.resolve();
      });

      expect(mockNavigate).toHaveBeenCalledWith("/orderSuccess", {
        state: { receipt: "none" },
      });
    });

    it("carries the receipt choice as router state, not redux", async () => {
      mount("email");
      tap("fire-confirm");
      await settle();

      expect(mockNavigate.mock.calls[0][1]).toEqual({
        state: { receipt: "email" },
      });
    });

    it("sends the cart's net amount with useIncomingNetAmount = true", async () => {
      store.dispatch(setAmount(9));
      mount();
      tap("fire-confirm");
      await settle();

      expect(mockPushOrder).toHaveBeenCalledWith(
        "TB-ORDER-ABCDE12345",
        true,
        9
      );
    });
  });

  describe("payment type — PAY_AT_RESTAURANT for the counter, nothing for the loyalty path", () => {
    it("pins PAY_AT_RESTAURANT on the pay-at-counter push", async () => {
      mount();
      tap("fire-confirm");
      await settle();

      expect(state().payment.paymentType).toBe("PAY_AT_RESTAURANT");
    });

    it("pins PAY_AT_RESTAURANT from beginCheckout without pushing anything", async () => {
      mount();
      tap("fire-begin");
      await settle();

      expect(state().payment.paymentType).toBe("PAY_AT_RESTAURANT");
      expect(mockGenerateQROrderId).not.toHaveBeenCalled();
      expect(mockPushOrder).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(status()).toBe("idle");
    });

    it("leaves the payment type untouched on the directOrder path (preserved quirk)", async () => {
      // The zero-bill loyalty order deliberately keeps paymentType "" so the
      // payload says payments.type: "ONLINE". Flagged, not fixed — this test
      // exists so nobody "fixes" it by accident.
      mount();
      tap("fire-start-direct");
      await advance(0);
      await settle();

      expect(state().payment.paymentType).toBe("");
      expect(pushSnapshots).toHaveLength(1);
      expect(pushSnapshots[0].paymentType).toBe("");
      expect(mockNavigate).toHaveBeenCalledWith("/orderSuccess", {
        state: { receipt: "none" },
      });
    });

    it("does not clobber a payment type the counter path already pinned", async () => {
      store.dispatch(setKioskPaymentType({ type: PAY_AT_COUNTER_PAYMENT_TYPE }));
      mount();
      tap("fire-start-direct");
      await advance(0);
      await settle();

      expect(state().payment.paymentType).toBe("PAY_AT_RESTAURANT");
    });
  });

  describe("idempotency — one order per customer", () => {
    it("pushes once for a double tap", async () => {
      mount();
      tap("fire-confirm");
      tap("fire-confirm");
      await settle();

      expect(mockPushOrder).toHaveBeenCalledTimes(1);
      expect(mockGenerateQROrderId).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("refuses a second push after the first one was placed", async () => {
      mount();
      tap("fire-confirm");
      await settle();
      expect(status()).toBe("placed");

      tap("fire-confirm");
      tap("fire-start");
      await advance(PAY_AT_COUNTER_BUFFER_MS);
      await settle();

      expect(mockPushOrder).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("refuses a double tap that arrives while the push is in flight", async () => {
      let release: (() => void) | undefined;
      mockPushOrder.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );

      mount();
      tap("fire-confirm");
      await settle();
      tap("fire-confirm");
      await settle();

      expect(mockPushOrder).toHaveBeenCalledTimes(1);

      await act(async () => {
        release?.();
        await Promise.resolve();
      });
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("generates exactly one order id, even across a retry", async () => {
      mockPushOrder.mockImplementation(
        pushImplementation(["fail", "fail", "ok"])
      );

      mount();
      tap("fire-confirm");
      await settle();
      await advance(1000);
      await advance(2000);
      await settle();

      expect(mockGenerateQROrderId).toHaveBeenCalledTimes(1);
      const ids = new Set(pushSnapshots.map((snapshot) => snapshot.args[0]));
      expect(ids.size).toBe(1);
      expect(state().order.orderId).toBe("TB-ORDER-ABCDE12345");
    });
  });

  describe("the buffer — cancel is always strictly before anything is sent", () => {
    it("pushes nothing until the buffer elapses", async () => {
      mount();
      tap("fire-start");
      await settle();

      expect(status()).toBe("buffering");
      expect(flags()).toContain("cancellable");
      expect(mockPushOrder).not.toHaveBeenCalled();

      await advance(PAY_AT_COUNTER_BUFFER_MS - 1);
      expect(mockPushOrder).not.toHaveBeenCalled();

      await advance(1);
      await settle();
      expect(mockPushOrder).toHaveBeenCalledTimes(1);
    });

    it("cancel during the buffer sends nothing, ever", async () => {
      mount();
      tap("fire-start");
      await settle();
      tap("fire-cancel");
      await settle();

      expect(status()).toBe("idle");

      await advance(PAY_AT_COUNTER_BUFFER_MS * 3);
      await settle();

      expect(mockPushOrder).not.toHaveBeenCalled();
      expect(mockGenerateQROrderId).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("cancelCheckout clears the armed state but refuses once pushing", async () => {
      let release: (() => void) | undefined;
      mockPushOrder.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );

      mount();
      tap("fire-confirm");
      await settle();
      expect(status()).toBe("pushing");

      tap("fire-cancel-checkout");
      await settle();
      // Still pushing — there is nothing safe to cancel any more.
      expect(status()).toBe("pushing");

      await act(async () => {
        release?.();
        await Promise.resolve();
      });
      tap("fire-cancel-checkout");
      expect(status()).toBe("placed");
    });

    it("unmounting during the buffer sends nothing", async () => {
      const view = mount();
      tap("fire-start");
      await settle();
      view.unmount();

      await advance(PAY_AT_COUNTER_BUFFER_MS * 2);

      expect(mockPushOrder).not.toHaveBeenCalled();
    });
  });

  describe("the retry ladder (settlementRules)", () => {
    it("re-exposes ORDER_PUSH_MAX_ATTEMPTS so the screen need not import the SDK", () => {
      mount();
      expect(screen.getByTestId("max-attempts").textContent).toBe(
        String(ORDER_PUSH_MAX_ATTEMPTS)
      );
    });

    it("fails twice, waits the linear backoff, then succeeds", async () => {
      mockPushOrder.mockImplementation(
        pushImplementation(["fail", "fail", "ok"])
      );

      mount();
      tap("fire-confirm");
      await settle();
      expect(mockPushOrder).toHaveBeenCalledTimes(1);

      // 1000ms * attempt — nothing happens a tick early.
      await advance(999);
      expect(mockPushOrder).toHaveBeenCalledTimes(1);
      await advance(1);
      await settle();
      expect(mockPushOrder).toHaveBeenCalledTimes(2);

      await advance(1999);
      expect(mockPushOrder).toHaveBeenCalledTimes(2);
      await advance(1);
      await settle();
      expect(mockPushOrder).toHaveBeenCalledTimes(3);

      expect(status()).toBe("placed");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("gives up after ORDER_PUSH_MAX_ATTEMPTS and lands in the terminal state", async () => {
      mockPushOrder.mockImplementation(pushImplementation(["fail"]));

      mount();
      tap("fire-confirm");
      await settle();
      await advance(1000);
      await advance(2000);
      await advance(3000);
      await settle();

      expect(mockPushOrder).toHaveBeenCalledTimes(ORDER_PUSH_MAX_ATTEMPTS);
      expect(status()).toBe("failed");
      expect(flags()).toContain("failed");
      // No success screen for an order that does not exist.
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.getByTestId("attempt").textContent).toBe(
        String(ORDER_PUSH_MAX_ATTEMPTS)
      );
    });

    it("retry() re-runs the ladder on the SAME order id and can still succeed", async () => {
      mockPushOrder.mockImplementation(pushImplementation(["fail"]));

      mount();
      tap("fire-confirm");
      await settle();
      await advance(6000);
      await settle();
      expect(status()).toBe("failed");

      mockPushOrder.mockImplementation(pushImplementation(["ok"]));
      tap("fire-retry");
      await settle();

      expect(status()).toBe("placed");
      expect(mockGenerateQROrderId).toHaveBeenCalledTimes(1);
      expect(mockPushOrder).toHaveBeenLastCalledWith(
        "TB-ORDER-ABCDE12345",
        true,
        24.5
      );
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("dismissError() clears the terminal state so the screen can leave", async () => {
      mockPushOrder.mockImplementation(pushImplementation(["fail"]));

      mount();
      tap("fire-confirm");
      await settle();
      await advance(6000);
      await settle();
      expect(status()).toBe("failed");

      tap("fire-dismiss");
      expect(status()).toBe("idle");
      expect(flags()).not.toContain("failed");
    });

    it("lands in the terminal state when the order id cannot be generated", async () => {
      mockGenerateQROrderId.mockRejectedValue(new Error("no id"));

      mount();
      tap("fire-confirm");
      await settle();

      expect(status()).toBe("failed");
      expect(mockPushOrder).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("stops retrying when the screen unmounts mid-ladder", async () => {
      mockPushOrder.mockImplementation(pushImplementation(["fail"]));

      const view = mount();
      tap("fire-confirm");
      await settle();
      expect(mockPushOrder).toHaveBeenCalledTimes(1);

      view.unmount();
      await advance(10000);

      expect(mockPushOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe("U2 — a push whose outcome is unknown is never auto-retried (P9b R4)", () => {
    const failedOnTimeout = () =>
      screen.getByTestId("failed-on-timeout").textContent;
    /** The terminal order_push analytics event. */
    const pushEvents = () =>
      mockCapture.mock.calls
        .map(([, props]) => props as Record<string, unknown> | undefined)
        .filter((props) => props?.error_source === "order_push");

    /** Confirm on /receipt and let every due step (and nothing else) run. */
    const confirm = async (outcomes: PushOutcome[]) => {
      mockPushOrder.mockImplementation(pushImplementation(outcomes));
      mount();
      tap("fire-confirm");
      await settle();
    };

    it("a TIMEOUT ends the ladder after ONE attempt — no backoff armed — with the uncertain flag", async () => {
      await confirm(["timeout"]);

      expect(status()).toBe("failed");
      expect(mockPushOrder).toHaveBeenCalledTimes(1);
      expect(failedOnTimeout()).toBe("true");

      // A whole ladder's worth of backoff later: still the one attempt.
      await advance(60_000);
      expect(mockPushOrder).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(pushEvents()).toEqual([
        {
          error_source: "order_push",
          attempts: 1,
          mode: "payAtCounter",
          timed_out: true,
          outcome_unknown: true,
        },
      ]);
    });

    it("an RTK 2.12 mid-body timeout (PARSING_ERROR + TimeoutError) is a timeout too", async () => {
      await confirm(["bodyTimeout"]);
      await advance(60_000);

      expect(mockPushOrder).toHaveBeenCalledTimes(1);
      expect(status()).toBe("failed");
      expect(failedOnTimeout()).toBe("true");
      expect(pushEvents()[0]).toMatchObject({ timed_out: true, outcome_unknown: true });
    });

    it("a 2xx whose body was lost is uncertain without being a timeout", async () => {
      await confirm(["lostBody"]);
      await advance(60_000);

      expect(mockPushOrder).toHaveBeenCalledTimes(1);
      expect(failedOnTimeout()).toBe("true");
      expect(pushEvents()[0]).toMatchObject({ timed_out: false, outcome_unknown: true });
    });

    it("a timeout mid-ladder cuts it short: fail, fail, timeout → 3 attempts, then the uncertain panel", async () => {
      await confirm(["fail", "fail", "timeout"]);
      await advance(1000);
      await advance(2000);
      await settle();

      expect(mockPushOrder).toHaveBeenCalledTimes(3);
      expect(status()).toBe("failed");
      expect(failedOnTimeout()).toBe("true");

      await advance(60_000);
      expect(mockPushOrder).toHaveBeenCalledTimes(3);
      expect(pushEvents()).toHaveLength(1);
      expect(pushEvents()[0]).toMatchObject({ attempts: 3, timed_out: true });
    });

    it("clean failures keep the full ladder: network down ×4 (1/2/3 s backoff) → ordinary copy", async () => {
      await confirm(["network"]);
      await advance(1000);
      await advance(2000);
      await advance(3000);
      await settle();

      expect(mockPushOrder).toHaveBeenCalledTimes(ORDER_PUSH_MAX_ATTEMPTS);
      expect(status()).toBe("failed");
      expect(failedOnTimeout()).toBe("false");
      expect(pushEvents()).toEqual([
        {
          error_source: "order_push",
          attempts: ORDER_PUSH_MAX_ATTEMPTS,
          mode: "payAtCounter",
          timed_out: false,
          outcome_unknown: false,
        },
      ]);
    });

    it("a malformed 5xx body is a clean refusal — the full ladder runs", async () => {
      await confirm(["badGateway"]);
      await advance(6000);
      await settle();

      expect(mockPushOrder).toHaveBeenCalledTimes(ORDER_PUSH_MAX_ATTEMPTS);
      expect(failedOnTimeout()).toBe("false");
    });

    it("Retry after a timeout resends the SAME order id and lands on /orderSuccess", async () => {
      await confirm(["timeout", "ok"]);
      expect(status()).toBe("failed");

      tap("fire-retry");
      await settle();

      expect(status()).toBe("placed");
      expect(mockPushOrder).toHaveBeenCalledTimes(2);
      expect(mockGenerateQROrderId).toHaveBeenCalledTimes(1);
      expect(pushSnapshots.map((snapshot) => snapshot.args[0])).toEqual([
        "TB-ORDER-ABCDE12345",
        "TB-ORDER-ABCDE12345",
      ]);
      expect(state().order.orderId).toBe("TB-ORDER-ABCDE12345");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/orderSuccess", {
        state: { receipt: "none" },
      });
    });

    it("the doubt sticks to the order id: timeout → Retry → clean failures still show the uncertain copy", async () => {
      await confirm(["timeout", "fail"]);
      expect(failedOnTimeout()).toBe("true");

      tap("fire-retry");
      await settle();
      // Flag down while the Retry's ladder runs (the panel is gone).
      expect(status()).toBe("pushing");
      expect(failedOnTimeout()).toBe("false");

      await advance(6000);
      await settle();

      // The Retry ran the full clean ladder (U2 only stops unknown outcomes)…
      expect(mockPushOrder).toHaveBeenCalledTimes(1 + ORDER_PUSH_MAX_ATTEMPTS);
      expect(status()).toBe("failed");
      // …but its clean failures cannot prove the first attempt never landed.
      expect(failedOnTimeout()).toBe("true");
    });

    it("dismissError() drops the uncertain flag with the terminal state", async () => {
      await confirm(["timeout"]);
      expect(failedOnTimeout()).toBe("true");

      tap("fire-dismiss");

      expect(status()).toBe("idle");
      expect(failedOnTimeout()).toBe("false");
    });

    /*
      P9d S7 (user decision 2026-10-01): the order may exist, reward included,
      so a Xeno reward that rode in an outcome-unknown push is never
      auto-refunded. The ladder MARKS the claim (/start's revoke then skips
      the undo) and order_push carries the non-PII claim ids. Only when the
      reward row is in the pushed cart (F1), read fresh from the store, and
      nothing unmarks it.
    */
    describe("S7 — never auto-refund a reward whose order may exist (P9d)", () => {
      /** BagSheetLoyalty's claim ledger and reward row. */
      const CLAIMED = {
        couponCode: "static6562",
        claimedPoints: 3000,
        availedCouponCode: "static6562",
        datetime: "2026-09-30%2010%3A00%3A00",
        phoneNumber: "9953833675",
        merchantId: "xeno-merchant-uuid-1",
      };
      const MARKED = { isClaimed: true, couponData: { ...CLAIMED, orderOutcomeUnknown: true } };
      const REWARD_ROW = {
        id: "5dd1093829754a432f2c32e2",
        itemId: "lr-1",
        name: "Greek Salad",
        quantity: 1,
        type: "ITEM",
        isLoyaltyItem: true,
        isRedeemed: true,
        coupon_code: "static6562",
        total_price: 0,
      };
      const claim = () => state().loyalty.claimedCoupon;

      /** A claim, and (by default) its reward row in the cart beside the paid row. */
      const seedClaim = ({ rewardInCart = true } = {}) => {
        store.dispatch(setClaimedCoupon(CLAIMED));
        if (rewardInCart) {
          store.dispatch(setCartItems([...state().cart.cartItems, REWARD_ROW]));
        }
      };

      it.each<PushOutcome>(["timeout", "bodyTimeout", "lostBody"])(
        "S1: %s with the reward row aboard MARKS the claim",
        async (outcome) => {
          seedClaim();
          await confirm([outcome]);

          expect(status()).toBe("failed");
          expect(claim()).toEqual(MARKED);
        }
      );

      it("S1: order_push names the claim for staff — never the phone or the apikey", async () => {
        seedClaim();
        await confirm(["timeout"]);

        expect(pushEvents()).toEqual([
          {
            error_source: "order_push",
            attempts: 1,
            mode: "payAtCounter",
            timed_out: true,
            outcome_unknown: true,
            reward_id: "static6562",
            claim_datetime: CLAIMED.datetime,
            points: 3000,
          },
        ]);
        // Staff find it under error_occurred.
        expect(mockCapture).toHaveBeenCalledWith("error_occurred", pushEvents()[0]);
        const sent = JSON.stringify(mockCapture.mock.calls);
        expect(sent).not.toContain(CLAIMED.phoneNumber);
        expect(sent).not.toContain(CLAIMED.merchantId);
      });

      it("S1: a timeout after clean failures (fail, fail, timeout) still marks — that attempt may have landed", async () => {
        seedClaim();
        await confirm(["fail", "fail", "timeout"]);
        await advance(1000);
        await advance(2000);
        await settle();

        expect(mockPushOrder).toHaveBeenCalledTimes(3);
        expect(status()).toBe("failed");
        expect(claim()).toEqual(MARKED);
        expect(pushEvents()).toEqual([
          expect.objectContaining({ attempts: 3, outcome_unknown: true, reward_id: "static6562" }),
        ]);
      });

      it("S1: the zero-bill loyalty push (directOrder, the order IS the reward) marks too", async () => {
        store.dispatch(setCartItems([REWARD_ROW]));
        store.dispatch(setAmount(0));
        store.dispatch(setClaimedCoupon(CLAIMED));
        mockPushOrder.mockImplementation(pushImplementation(["timeout"]));
        mount();
        tap("fire-start-direct");
        await advance(0);
        await settle();

        expect(status()).toBe("failed");
        expect(claim()).toEqual(MARKED);
        expect(pushEvents()).toEqual([
          {
            error_source: "order_push",
            attempts: 1,
            mode: "directOrder",
            timed_out: true,
            outcome_unknown: true,
            reward_id: "static6562",
            claim_datetime: CLAIMED.datetime,
            points: 3000,
          },
        ]);
      });

      it("S2: no reward row in the pushed cart (removed earlier, its undo failed) → NOT marked, no ids", async () => {
        seedClaim({ rewardInCart: false });
        await confirm(["timeout"]);

        expect(status()).toBe("failed");
        // That claim keeps its /start refund: the reward was not in the order.
        expect(claim()).toEqual({ isClaimed: true, couponData: CLAIMED });
        expect(pushEvents()).toEqual([
          {
            error_source: "order_push",
            attempts: 1,
            mode: "payAtCounter",
            timed_out: true,
            outcome_unknown: true,
          },
        ]);
      });

      it.each<PushOutcome>(["fail", "badGateway", "network"])(
        "S3: a clean failure (%s, ladder exhausted) never marks — the refund stands",
        async (outcome) => {
          seedClaim();
          await confirm([outcome]);
          await advance(1000);
          await advance(2000);
          await advance(3000);
          await settle();

          expect(mockPushOrder).toHaveBeenCalledTimes(ORDER_PUSH_MAX_ATTEMPTS);
          expect(status()).toBe("failed");
          expect(claim()).toEqual({ isClaimed: true, couponData: CLAIMED });
          expect(pushEvents()).toHaveLength(1);
          expect(pushEvents()[0]).not.toHaveProperty("reward_id");
        }
      );

      it("S4: an outcome-unknown push with no claim creates none", async () => {
        store.dispatch(setCartItems([...state().cart.cartItems, REWARD_ROW]));
        await confirm(["timeout"]);

        expect(status()).toBe("failed");
        expect(claim().isClaimed).toBe(false);
        expect(claim().couponData).not.toHaveProperty("orderOutcomeUnknown");
        expect(pushEvents()[0]).not.toHaveProperty("reward_id");
      });

      /** confirm() with a push the test fails by hand, mid-flight. */
      const confirmHeld = async () => {
        let fail!: (error: unknown) => void;
        mockPushOrder.mockImplementation(
          () =>
            new Promise((_resolve, reject) => {
              fail = reject;
            })
        );
        const view = mount();
        tap("fire-confirm");
        await settle();
        expect(mockPushOrder).toHaveBeenCalledTimes(1);
        const timeOut = async () => {
          await act(async () => {
            fail(new Error("[object Object]", { cause: RTK_ERRORS.timeout }));
          });
          await settle();
        };
        return { view, timeOut };
      };

      it("S4: a claim the session reset wiped mid-push is never resurrected (read fresh, not from the render)", async () => {
        seedClaim();
        const push = await confirmHeld();

        act(() => {
          store.dispatch(resetLoyaltySession());
        });
        await push.timeOut();

        expect(claim().isClaimed).toBe(false);
        expect(claim().couponData).not.toHaveProperty("orderOutcomeUnknown");
      });

      it("the mark is written even if the screen unmounted mid-push", async () => {
        seedClaim();
        const push = await confirmHeld();

        push.view.unmount();
        await push.timeOut();

        expect(claim()).toEqual(MARKED);
      });

      it("S7: a later clean failure (Retry → ladder exhausted) never unmarks", async () => {
        seedClaim();
        await confirm(["timeout", "fail"]);
        expect(claim()).toEqual(MARKED);

        tap("fire-retry");
        await settle();
        await advance(6000);
        await settle();

        expect(mockPushOrder).toHaveBeenCalledTimes(1 + ORDER_PUSH_MAX_ATTEMPTS);
        expect(status()).toBe("failed");
        expect(claim()).toEqual(MARKED);
        expect(pushEvents()).toHaveLength(2);
        expect(pushEvents()[1]).not.toHaveProperty("reward_id");
      });
    });
  });

  describe("idle hold (P9a) — idle never ends a session under an order on its way out", () => {
    const hold = vi.fn<(delta: 1 | -1) => void>();
    const held = () => hold.mock.calls.reduce((sum, [delta]) => sum + delta, 0);

    const mountHeld = () =>
      render(
        <IdleHoldContext.Provider value={hold}>
          <Provider store={store}>
            <MemoryRouter initialEntries={["/receipt"]}>
              <Harness />
            </MemoryRouter>
          </Provider>
        </IdleHoldContext.Provider>
      );

    beforeEach(() => {
      hold.mockReset();
    });

    it("holds from the buffer through the push — no gap between them — and lets go once it lands", async () => {
      let release: (() => void) | undefined;
      mockPushOrder.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      mountHeld();
      expect(hold).not.toHaveBeenCalled();

      tap("fire-start");
      await settle();
      expect(status()).toBe("buffering");
      expect(held()).toBe(1);

      await advance(PAY_AT_COUNTER_BUFFER_MS);
      await settle();
      expect(status()).toBe("pushing");
      expect(hold.mock.calls).toEqual([[1]]);

      await act(async () => {
        release?.();
        await Promise.resolve();
      });
      expect(status()).toBe("placed");
      expect(held()).toBe(0);
    });

    it("a cancelled buffer lets go at once", async () => {
      mountHeld();
      tap("fire-start");
      await settle();
      expect(held()).toBe(1);

      tap("fire-cancel");

      expect(status()).toBe("idle");
      expect(held()).toBe(0);
    });

    it("a timed-out push lets go at once — no ladder is coming", async () => {
      mockPushOrder.mockImplementation(pushImplementation(["timeout"]));
      mountHeld();
      tap("fire-confirm");
      await settle();

      expect(status()).toBe("failed");
      expect(held()).toBe(0);
    });

    it("an exhausted ladder lets go — the failure screen is the customer's again", async () => {
      mockPushOrder.mockImplementation(pushImplementation(["fail"]));
      mountHeld();
      tap("fire-confirm");
      await settle();
      expect(held()).toBe(1);

      await advance(6000);
      await settle();

      expect(status()).toBe("failed");
      expect(held()).toBe(0);
    });
  });
});
