import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  markOrderStatusAsPending,
  setOrderId,
} from "@cx-sdk/ordering/state/order.slice";
import { netAmount as selectNetAmount } from "@cx-sdk/ordering/state/cart.slice";
import {
  selectKioskPaymentType,
  setKioskPaymentType,
} from "@cx-sdk/payments/state/payment.slice";
import { toPaytmKind } from "@cx-sdk/payments/gateways/paytmKiosk";
import { setShowErrorModal } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  ORDER_PUSH_MAX_ATTEMPTS,
  hasExhaustedOrderPushAttempts,
  isOrderPushOutcomeUnknown,
  orderPushRetryDelayMs,
  shouldRetryOrderPush,
} from "@cx-sdk/payments/settlement/settlementRules";
import { isTimeoutError } from "@cx-sdk/core/transport/withTimeoutRetry";
import useOrderHook from "../menuHooks/useOrderHook";
import { markClaimOrderOutcomeUnknown } from "../loyalty/orderOutcomeClaim";
import { useIdleHold } from "../utils/useIdleTimeout";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/**
 * usePayAtCounter — THE ONLY order-push path in P8a.
 *
 * Nothing in this hook (or in anything it imports) can reach a payment
 * gateway, a terminal socket or a card flow. Its entire network surface is
 * `pushOrder` from useOrderHook, i.e. one call to
 * `POST /api/onlineOrders/partner/kiosk/placeOrder`. It deliberately does
 * NOT import `usePaymentHook`, `initiateKioskPayment`, any
 * `@cx-sdk/payments/services/*` endpoint, or either socket connector — their
 * absence is what keeps the TB build peripheral-free by construction.
 *
 * ── THE SEQUENCE (brief "PUSH") ─────────────────────────────────────────
 *   setKioskPaymentType({ type: "PAY_AT_RESTAURANT" })   // pay-at-counter ONLY
 *   generateQROrderId()  ->  setOrderId(orderId)
 *   markOrderStatusAsPending()
 *   pushOrder(orderId, true, netAmount)
 *   navigate("/orderSuccess", { state: { receipt } })
 *
 * ── WHY THE BUFFER IS NOT COSMETIC ──────────────────────────────────────
 * `useOrderHook().pushOrder` closes over `selectKioskPaymentTypeRdx` at
 * RENDER time and feeds it to buildPushOrderPayload, where it decides both
 * the endpoint (three-way switch) and `payments.type`
 * ("PAY_AT_RESTAURANT" -> "COD", anything else -> "ONLINE"). Dispatching the
 * type and then calling the SAME render's `pushOrder` closure would send a
 * pay-at-counter order as ONLINE. So the type is dispatched in `start()`,
 * and the push runs from a LATER render's closure (latest-callback ref +
 * the buffer effect). Do not "simplify" that away.
 *
 * ── ARMING vs PUSHING (the /payment -> /receipt split) ──────────────────
 * TB puts the receipt choice BETWEEN the method tap and the push, so the
 * sequence is split across two screens and therefore two hook instances —
 * the hook's state is per-component and does NOT survive the navigation.
 * Redux is the only thing that crosses:
 *   /payment  `beginCheckout()`  arms (pins the payment type), pushes nothing
 *   /receipt  `confirmAndPush(choice)`  re-pins (no-op) and runs the push
 * That split is a feature: the type is already committed to the store a full
 * navigation before any pushOrder closure is built. Consequences the callers
 * must honour:
 *   - `payment-buffer` / `payment-buffer-cancel` live on /payment and cancel
 *     BEFORE anything is sent (`cancelCheckout`).
 *   - `order-error` / `order-error-retry` / `order-error-back` belong to
 *     whichever screen calls the push — /receipt for pay-at-counter,
 *     /customerName for the loyalty direct path.
 *   - The one-order-per-customer latch is per instance; it guards the screen
 *     that actually pushes, which is the screen a double tap can happen on.
 *
 * ── DIVERGENCES FROM THE FORK (deliberate, Rule 2) ──────────────────────
 * 1. Fork `usePaymentHook.pushOrderDirect` wraps the push in a bare
 *    try/catch that only `console.error`s — a failed push leaves the
 *    customer on /payment with a dead modal and no way forward. Here the
 *    push runs the settlement retry ladder
 *    (ORDER_PUSH_MAX_ATTEMPTS = 4, linear `orderPushRetryDelayMs` backoff,
 *    both imported from @cx-sdk/payments/settlement/settlementRules — the
 *    same rules Polling.tsx uses post-payment) and, on exhaustion, exposes a
 *    TERMINAL error state the screen renders with Retry + Back-to-bag.
 *    A push that TIMES OUT (or whose 2xx answer is lost mid-body) is never
 *    auto-retried (user decision U2, `shouldRetryOrderPush`): placeOrder
 *    idempotency on the client order id is unconfirmed and the order may
 *    exist, so the ladder stops at once and the panel shows the UNCERTAIN
 *    copy (`failedOnTimeout`). Only the customer's own Retry resends it.
 * 2. Fork `PaymentSelection.tsx` drives its 3s buffer from
 *    `useEffect(..., [redirectionRef.current])` — a ref in a dep array,
 *    which React never re-evaluates on mutation, so the effect fires at
 *    whatever unrelated render happens next. Here the buffer is STATE
 *    (`status`), so arming and cancelling are both deterministic.
 * 3. The retried push reuses the SAME orderId (fork Polling.tsx does the
 *    same): a retry after a network/5xx failure must not be able to create a
 *    second order id for one customer. Back-to-bag does NOT keep it: leaving
 *    the screen destroys this instance, so the next PAY mints a new id.
 *
 * ── PRESERVED QUIRK (flagged, not fixed) ────────────────────────────────
 * On the zero-bill loyalty path (`mode: "directOrder"`, from /customerName
 * when `shouldPlaceLoyaltyOrderDirectly` is true) the fork never sets a
 * payment type, so `payment.paymentType` stays "" and the payload goes out
 * as `payments.type: "ONLINE"` for an order nobody paid online. That is
 * preserved verbatim — changing it silently would change what the POS
 * settles. It needs a product decision, not a code fix.
 * ONE exception (P8b): a Paytm type ("PaytmDynamicQr" / "PaytmEdc") left
 * armed by an abandoned /payment visit is cleared back to "" first.
 * pushOrder makes NO place call for a Paytm type (the backend places those
 * orders), so the zero-bill push would show Order Complete for an order that
 * was never placed. The 0 ms buffer lets the push run from a closure that
 * has already observed the cleared type (see the closure note above).
 */

/** Receipt choice captured on /receipt, carried to /orderSuccess. */
export type ReceiptPreference = "print" | "email" | "none";

/**
 * Router state this hook hands to /orderSuccess. There is no receipt slice
 * (none exists in the fork either), so the choice travels as navigation
 * state — which doubles as a print safety net: a reload of /orderSuccess
 * loses it and therefore cannot reprint a ticket.
 */
export interface OrderSuccessLocationState {
  receipt: ReceiptPreference;
}

/**
 * "payAtCounter" = the /payment PAY AT COUNTER tile (sets the payment type).
 * "directOrder"  = the zero-bill loyalty path from /customerName (does NOT).
 */
export type PayAtCounterMode = "payAtCounter" | "directOrder";

/**
 * idle      nothing started — the CTA is live.
 * buffering pre-push grace window; Cancel is offered, NOTHING has been sent.
 * pushing   the push (and its retries) are in flight; Cancel is gone.
 * placed    the order exists; we have navigated to /orderSuccess.
 * failed    the ladder ended unplaced (exhausted, or an attempt's outcome is
 *           unknown — U2) — terminal state, Retry / Back.
 */
export type PayAtCounterStatus =
  | "idle"
  | "buffering"
  | "pushing"
  | "placed"
  | "failed";

export interface StartOrderPushOptions {
  /** Defaults to "payAtCounter". */
  mode?: PayAtCounterMode;
  /** Defaults to "none" — no receipt, no print. */
  receipt?: ReceiptPreference;
  /**
   * Buffer before the push. Defaults to {@link PAY_AT_COUNTER_BUFFER_MS} for
   * "payAtCounter" and 0 for "directOrder" (the fork pushes that one
   * immediately). 0 still defers by one macrotask — see the closure note.
   */
  bufferMs?: number;
  /**
   * Amount sent as the order's net amount. Defaults to `cart.netAmount`,
   * which BagSheet already mirrored with `setAmount(getCheckoutNetAmount(bill))`
   * before navigating into checkout.
   */
  netAmount?: number;
}

/** The exact string the payload builder maps to `payments.type: "COD"`. */
export const PAY_AT_COUNTER_PAYMENT_TYPE = "PAY_AT_RESTAURANT";

/** Fork parity: PaymentSelection's non-Geidea buffer window. */
export const PAY_AT_COUNTER_BUFFER_MS = 3000;

/** A start() request, frozen at the moment the customer committed. */
interface PendingPush {
  mode: PayAtCounterMode;
  receipt: ReceiptPreference;
  bufferMs: number;
  netAmount: number;
}

export interface UsePayAtCounter {
  /** Full state machine — see {@link PayAtCounterStatus}. */
  status: PayAtCounterStatus;
  /** Buffer modal (`payment-buffer`) is up. */
  isBuffering: boolean;
  /** Push in flight, including backoff waits. */
  isPushing: boolean;
  /** Ladder ended unplaced — render `order-error`. */
  hasFailed: boolean;
  /**
   * `hasFailed`, and an attempt for this order id TIMED OUT or lost its 2xx
   * answer (this ladder or an earlier Retry's): the order may exist, so
   * `order-error` must use the uncertain copy, never "didn't reach the
   * restaurant".
   */
  failedOnTimeout: boolean;
  /** Cancel (`payment-buffer-cancel`) may be shown. */
  canCancel: boolean;
  /** 1-based attempt number, for a "trying again…" line. 0 before the first. */
  attempt: number;
  /** ORDER_PUSH_MAX_ATTEMPTS, re-exported so the UI need not import the SDK. */
  maxAttempts: number;
  /** The id this push is placing/placed, once generated ("" before that). */
  orderId: string;
  /** Begin the buffer -> push -> /orderSuccess sequence. Idempotent. */
  start: (options?: StartOrderPushOptions) => void;
  /** Abort during the buffer only. Nothing has been sent at that point. */
  cancel: () => void;
  /** Re-run the ladder for the same order id after a terminal failure. */
  retry: () => void;
  /** Drop the terminal state so the screen can leave (Back to bag). */
  dismissError: () => void;

  // ── /payment + /receipt split (see "ARMING vs PUSHING" above) ──────────
  /**
   * /payment PAY AT COUNTER tile. ARMS the order — pins
   * `payment.paymentType = "PAY_AT_RESTAURANT"` — and pushes NOTHING, so the
   * screen may run its own buffer + Cancel and then navigate to /receipt.
   * Safe to call more than once.
   */
  beginCheckout: () => void;
  /**
   * /payment buffer Cancel. Nothing has been sent at that point, so this is
   * pure bookkeeping; it refuses once a push is in flight or done.
   */
  cancelCheckout: () => void;
  /**
   * /receipt tiles. Re-pins the payment type (idempotent) and runs the full
   * guarded push with the chosen receipt preference, landing on
   * /orderSuccess. THE SCREEN THAT CALLS THIS OWNS THE `order-error` PANEL —
   * see `hasFailed` / `retry` / `dismissError`.
   */
  confirmAndPush: (receipt: ReceiptPreference) => void;
}

function usePayAtCounter(): UsePayAtCounter {
  const dispatch = useDispatch();
  const store = useStore();
  const navigate = useNavigate();
  const { pushOrder, generateQROrderId } = useOrderHook();
  const cartNetAmount = Number(useSelector(selectNetAmount) ?? 0);

  const [status, setStatus] = useState<PayAtCounterStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const [orderId, setLocalOrderId] = useState("");
  // The committed request. STATE, not a ref: the buffer effect keys off it,
  // and a ref would not re-run that effect (fork divergence 2).
  const [pending, setPending] = useState<PendingPush | null>(null);
  // Sticky for this instance (= this order id): a later clean failure does
  // not prove a timed-out attempt never landed. Per customer by construction
  // — the instance dies with the screen, long before /start's reset.
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);

  // Idle must never end the session under an order on its way out — a late
  // success would write this order into the NEXT customer's session. Same
  // predicate the screens use to refuse Back/Cancel. Each attempt is bounded
  // by the transport (TB's apiSlice: 10 s), so a clean-failure ladder
  // releases in ≤ 46 s (4 × 10 s + 1+2+3 s backoff) and a timeout ends it
  // after that one attempt; the hold's cap (IDLE_HOLD_MAX_MS) is a backstop.
  useIdleHold(status === "buffering" || status === "pushing");

  // `placeOrderTimes`-style latch: flipped only once a push has RESOLVED.
  // After that no start()/retry() can ever push again for this customer.
  const placedRef = useRef(false);
  // Re-entry guard for the whole push routine (double-tap, effect re-run).
  const inFlightRef = useRef(false);
  // Generated once, reused by every retry (divergence 3).
  const orderIdRef = useRef("");
  // Backoff sleep, so unmount can cut it.
  const retryTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  /** Backoff sleep that is abandoned (never resolves) if we unmount. */
  const waitBeforeRetry = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          resolve();
        }, ms);
      }),
    [],
  );

  /**
   * The push itself. Never called directly by consumers — only through the
   * latest-callback ref below, so it always runs from a render that has
   * already observed the dispatched payment type.
   */
  const runPush = async (request: PendingPush) => {
    if (placedRef.current || inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      if (!orderIdRef.current) {
        const generated: string = await generateQROrderId();
        orderIdRef.current = generated;
        dispatch(setOrderId(generated));
        if (mountedRef.current) setLocalOrderId(generated);
      }
      dispatch(markOrderStatusAsPending());
    } catch {
      // Id generation is local and cannot realistically fail, but a throw
      // here must still land in the terminal state rather than a dead modal.
      inFlightRef.current = false;
      if (!mountedRef.current) return;
      setStatus("failed");
      return;
    }

    let attempts = 0;
    while (!hasExhaustedOrderPushAttempts(attempts)) {
      attempts++;
      if (mountedRef.current) setAttempt(attempts);
      try {
        await pushOrder(orderIdRef.current, true, request.netAmount);
        // Latch BEFORE anything else: from here the order exists and must
        // never be sent again, whatever the UI does next.
        placedRef.current = true;
        inFlightRef.current = false;
        if (!mountedRef.current) return;
        setStatus("placed");
        const successState: OrderSuccessLocationState = {
          receipt: request.receipt,
        };
        navigate("/orderSuccess", { state: successState });
        return;
      } catch (error) {
        // U2: a timed-out push (or a 2xx whose body was lost) may have
        // placed the order, so it ends the ladder at once — only the
        // customer's own Retry (same id) resends. pushOrder rethrows with the
        // RTK error as `cause`, which is what the classifiers read.
        if (!shouldRetryOrderPush(attempts, error)) {
          const uncertain = isOrderPushOutcomeUnknown(error);
          // User decision 2026-10-01 (P9d S7): the order may exist, so a Xeno
          // reward claimed for it must never be auto-refunded — the mark makes
          // checkAndRevokeLoyaltyReward skip the undo (orderOutcomeClaim.ts,
          // shared with Paytm since P8b). Only when the reward row rode in
          // THIS push, read fresh even after unmount; nothing here unmarks it
          // — a later clean failure does not prove this attempt never landed.
          // Success still clears the claim (useOrderHook.pushOrder).
          const claimIds = uncertain
            ? markClaimOrderOutcomeUnknown(
                store.getState,
                dispatch,
                orderIdRef.current,
              )
            : null;
          captureKioskEvent(KioskEventName.ErrorOccurred, {
            error_source: "order_push",
            attempts,
            mode: request.mode,
            timed_out: isTimeoutError(error),
            outcome_unknown: uncertain,
            // Reconciliation ids at mark time: the claim is not persisted, so
            // a crash or power loss before /start's teardown would otherwise
            // drop it with no record (never the phone or the apikey).
            ...claimIds,
          });
          inFlightRef.current = false;
          if (!mountedRef.current) return;
          if (uncertain) setOutcomeUnknown(true);
          setStatus("failed");
          return;
        }
        await waitBeforeRetry(orderPushRetryDelayMs(attempts));
        if (!mountedRef.current) {
          inFlightRef.current = false;
          return;
        }
      }
    }

    // Unreachable (the loop always returns), but leaving the latch set would
    // wedge the screen forever, so release it defensively.
    inFlightRef.current = false;
  };

  // Latest-callback ref: re-synced on EVERY render, deliberately without a
  // dep array. The push effect below reads it, so the push always uses the
  // freshest pushOrder closure (see the payment-type closure note above).
  const runPushRef = useRef(runPush);
  useEffect(() => {
    runPushRef.current = runPush;
  });

  // Buffer window. Cancelling or unmounting clears the timer, so nothing is
  // ever sent for a customer who backed out.
  useEffect(() => {
    if (status !== "buffering" || !pending) return;
    const timer = window.setTimeout(() => {
      setStatus("pushing");
    }, pending.bufferMs);
    return () => window.clearTimeout(timer);
  }, [status, pending]);

  // Push trigger. Fires on every entry into "pushing" — the first time and
  // once per retry(); runPush's own in-flight latch makes a duplicate entry
  // a no-op.
  useEffect(() => {
    if (status !== "pushing" || !pending) return;
    void runPushRef.current(pending);
  }, [status, pending]);

  const start = useCallback(
    (options?: StartOrderPushOptions) => {
      // Idempotency: one order per customer, one push per tap.
      if (placedRef.current || inFlightRef.current) return;
      if (status !== "idle") return;

      const mode: PayAtCounterMode = options?.mode ?? "payAtCounter";
      const request: PendingPush = {
        mode,
        receipt: options?.receipt ?? "none",
        bufferMs:
          options?.bufferMs ??
          (mode === "payAtCounter" ? PAY_AT_COUNTER_BUFFER_MS : 0),
        netAmount: options?.netAmount ?? cartNetAmount,
      };

      // A stale error from an earlier attempt must not ride along.
      dispatch(setShowErrorModal({ showErrorModal: false, errorMessage: "" }));

      // Pay-at-counter ONLY. The loyalty direct path leaves paymentType
      // untouched on purpose — except a stale Paytm type, which would place
      // NOTHING (see the preserved-quirk note in the header).
      if (mode === "payAtCounter") {
        dispatch(setKioskPaymentType({ type: PAY_AT_COUNTER_PAYMENT_TYPE }));
      } else if (toPaytmKind(selectKioskPaymentType(store.getState())) !== null) {
        dispatch(setKioskPaymentType({ type: "" }));
      }

      setAttempt(0);
      setPending(request);
      setStatus("buffering");
    },
    [cartNetAmount, dispatch, status, store],
  );

  const cancel = useCallback(() => {
    // Only meaningful while buffering; once the push starts there is nothing
    // safe to cancel, so the affordance is gone by then.
    if (status !== "buffering") return;
    captureKioskEvent(KioskEventName.PaymentIniatiationCancelled, {
      payment_type: PAY_AT_COUNTER_PAYMENT_TYPE,
      net_amount: pending?.netAmount ?? 0,
    });
    setPending(null);
    setStatus("idle");
    setAttempt(0);
  }, [pending, status]);

  const retry = useCallback(() => {
    if (status !== "failed" || !pending || placedRef.current) return;
    setAttempt(0);
    // Same orderId, same request — straight back into the ladder.
    setStatus("pushing");
  }, [pending, status]);

  const dismissError = useCallback(() => {
    if (status !== "failed") return;
    setPending(null);
    setAttempt(0);
    setStatus("idle");
  }, [status]);

  /**
   * ARMING ONLY — see the interface docs. Deliberately changes no hook state:
   * /payment owns its own buffer UI, and arming a screen ahead of the push
   * also gives the payment-type dispatch a whole navigation to settle before
   * any pushOrder closure is built.
   */
  const beginCheckout = useCallback(() => {
    if (placedRef.current || inFlightRef.current) return;
    dispatch(setShowErrorModal({ showErrorModal: false, errorMessage: "" }));
    dispatch(setKioskPaymentType({ type: PAY_AT_COUNTER_PAYMENT_TYPE }));
  }, [dispatch]);

  const cancelCheckout = useCallback(() => {
    // Never cancellable once anything has left the kiosk.
    if (status === "pushing" || status === "placed") return;
    captureKioskEvent(KioskEventName.PaymentIniatiationCancelled, {
      payment_type: PAY_AT_COUNTER_PAYMENT_TYPE,
      net_amount: cartNetAmount,
    });
    // FORK PARITY (flagged): the fork's cancel does not roll
    // payment.paymentType back either. Leaving it pinned is the safe
    // direction — it can only make a later payload MORE COD, never less —
    // and emptyPayment() in useSessionReset clears it with the customer.
    setPending(null);
    setAttempt(0);
    setStatus("idle");
  }, [cartNetAmount, status]);

  const confirmAndPush = useCallback(
    (receipt: ReceiptPreference) => {
      start({ mode: "payAtCounter", receipt, bufferMs: 0 });
    },
    [start],
  );

  return {
    status,
    isBuffering: status === "buffering",
    isPushing: status === "pushing",
    hasFailed: status === "failed",
    failedOnTimeout: status === "failed" && outcomeUnknown,
    canCancel: status === "buffering",
    attempt,
    maxAttempts: ORDER_PUSH_MAX_ATTEMPTS,
    orderId,
    start,
    cancel,
    retry,
    dismissError,
    beginCheckout,
    cancelCheckout,
    confirmAndPush,
  };
}

export default usePayAtCounter;
