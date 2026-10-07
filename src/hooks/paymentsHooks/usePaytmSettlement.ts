import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  paymentSettingsRdx,
  setShowErrorModal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { selectDeploymentDetails } from "@cx-sdk/core/auth/authentication.slice";
import {
  selectCart,
  selectCartAmount,
} from "@cx-sdk/ordering/state/cart.slice";
import {
  emptyPayment,
  selectPayment,
} from "@cx-sdk/payments/state/payment.slice";
import {
  useCancelPaytmEdcKioskMutation,
  useCheckPaytmDqrKioskStatusMutation,
  useCheckPaytmEdcKioskStatusMutation,
} from "@cx-sdk/payments/services/paymentSettingsFetchApi";
import {
  PAYTM_PAYMENT_TYPES,
  buildPaytmEdcVoidBody,
  buildPaytmKioskStatusBody,
  classifyPaytmEdcVoidResult,
  classifyPaytmKioskPoll,
  pickPaytmSelections,
  readOpenPaytmSession,
  type OpenPaytmSession,
  type PaytmKind,
  type PaytmSelection,
} from "@cx-sdk/payments/gateways/paytmKiosk";
import {
  PAYTM_POLL_INTERVAL_MS,
  isPaytmNotPaidDefinitive,
  paytmSessionEffects,
  reducePaytmSession,
  startPaytmSession,
  type PaytmSessionPhase,
  type PaytmSessionState,
} from "@cx-sdk/payments/settlement/paytmKioskSettlement";
import useOrderHook from "../menuHooks/useOrderHook";
import { unmarkClaimOrderOutcomeUnknown } from "../loyalty/orderOutcomeClaim";
import { PAYMENT_IDLE_HOLD_MAX_MS, useIdleHold } from "../utils/useIdleTimeout";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import type {
  OrderSuccessLocationState,
  ReceiptPreference,
} from "./usePayAtCounter";

/**
 * usePaytmSettlement — the /paymentPolling settlement loop (P8b-06) for the
 * Paytm Dynamic QR and Paytm EDC sessions that /receipt's initiate opened.
 *
 * THE BACKEND PLACES THE ORDER. The initiate parked the order payload; the
 * backend places it when Paytm reports the payment — by webhook OR by this
 * screen's own status read (a poll is itself a placement trigger). So:
 *   - the paid tail calls `recordOrderLocally` (bookkeeping only) and NEVER
 *     `pushOrder` — a kiosk-side place would be a second order;
 *   - an outcome nobody can confirm is never re-initiated: it ends on the
 *     staff panel (CHECK AGAIN = one status read; FINISH = /start, whose
 *     mount releases the session status-first).
 * Every decision (phase, deadlines, when to void, when to stop) is the pure
 * SDK reducer `reducePaytmSession`; this hook only owns the timers, the RTK
 * calls, navigation and analytics.
 *
 * - The open session is LATCHED at mount (useState initializer). That latch
 *   is what makes `emptyPayment()` then `navigate()` H1-safe here: nothing on
 *   this screen re-reads the payment slice to decide where to go. No cart
 *   count is required — after a reload the Dexie cart rehydrates async and
 *   the settlement must still resume (deadlines come from posBillTime).
 * - At most ONE status read in flight; reads poll every
 *   PAYTM_POLL_INTERVAL_MS while the reducer says so, plus one FRESH read on
 *   entering cancelling/settling. A read sent before that phase change is
 *   stale: its pending/cancelled/error answer is dropped (only "paid" — which
 *   always wins — is kept), because the DQR cancel's single re-check and the
 *   EDC void must both follow a read the customer's cancel / the expiry
 *   preceded.
 * - EDC void: at most one per session, only after a fresh "pending" read
 *   (the reducer's `sendVoid`); its success only DELIVERS the cancel to the
 *   terminal — "cancelled" still has to come from a status read.
 * - Idle is held while anything is in flight (PAYMENT_IDLE_HOLD_MAX_MS); the
 *   not-paid and unknown panels release it, so Rule 1's timeout covers them.
 * - Every await is followed by a mounted check; every timer is cleared on
 *   unmount; RTK does not abort on unmount, so late answers are ignored.
 * - Analytics carry ids and outcomes only — never the secret, mid, QR string
 *   or device id.
 */

export interface UsePaytmSettlement {
  /** null ⇒ no open Paytm session at mount: the hook redirects (once). */
  session: PaytmSessionState | null;
  kind: PaytmKind | null;
  /** DQR only (payment.paytmQrCode, latched); "" for EDC. */
  qrCode: string;
  /** Whole seconds to the payment window's deadline (≥ 0). */
  secondsLeft: number;
  /** Last 5 of posBillNo — the number staff and the ticket use. */
  orderRef: string;
  amount: number;
  /** A status read is in flight for CHECK AGAIN (unknown panel note). */
  checking: boolean;
  /** Customer confirmed CANCEL PAYMENT (awaiting only). */
  confirmCancel: () => void;
  /** Unknown panel: ONE status read — never an initiate. */
  checkAgain: () => void;
  /** Unknown panel: navigate("/start") ONLY — /start owns teardown + release. */
  finish: () => void;
  /** Not-paid panel: emptyPayment() then /payment. */
  tryAgain: () => void;
  /** Not-paid panel: emptyPayment() then /cart. */
  backToBag: () => void;
}

/**
 * The SDK service is typed `any`; at this boundary a trigger takes a body and
 * resolves to an RTK envelope that is only ever classified, never read.
 */
type KioskCall = (body: Record<string, unknown>) => PromiseLike<unknown>;

interface CartLike {
  cartItems?: unknown[];
}

interface LatchedSession {
  open: OpenPaytmSession | null;
  /** The configured gateway row for `open.kind`; null ⇒ cannot poll. */
  selection: PaytmSelection | null;
}

export default function usePaytmSettlement(): UsePaytmSettlement {
  const dispatch = useDispatch();
  const store = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { recordOrderLocally } = useOrderHook();
  const [checkDqrStatus] = useCheckPaytmDqrKioskStatusMutation() as [KioskCall];
  const [checkEdcStatus] = useCheckPaytmEdcKioskStatusMutation() as [KioskCall];
  const [voidEdc] = useCancelPaytmEdcKioskMutation() as [KioskCall];
  const amount = Number(useSelector(selectCartAmount) ?? 0);
  const cartCount =
    (useSelector(selectCart) as CartLike | undefined)?.cartItems?.length ?? 0;

  const [{ open, selection }] = useState((): LatchedSession => {
    const state = store.getState();
    const session = readOpenPaytmSession(selectPayment(state));
    if (!session) return { open: null, selection: null };
    // Credentials are read at call time from the device-scoped settings,
    // never copied into the persisted payment slice (D11).
    const row = pickPaytmSelections(paymentSettingsRdx(state)).find(
      (candidate) => candidate.kind === session.kind,
    );
    return { open: session, selection: row ?? null };
  });
  const [receipt] = useState(
    (): ReceiptPreference =>
      (location.state as OrderSuccessLocationState | null)?.receipt ?? "none",
  );

  const [session, dispatchSession] = useReducer(
    reducePaytmSession,
    undefined,
    (): PaytmSessionState => {
      const started = startPaytmSession(
        open?.kind ?? "paytmEdc",
        open?.posBillTime ?? 0,
        Date.now(),
      );
      // No open session (the screen redirects) → inert. An open session with
      // no usable credentials cannot poll → the unknown (staff) panel at once.
      return open && selection ? started : { ...started, phase: "unknown" };
    },
  );
  const effects = paytmSessionEffects(session);
  useIdleHold(effects.holdIdle, PAYMENT_IDLE_HOLD_MAX_MS);

  const [now, setNow] = useState(() => Date.now());
  // Bumped on every completed read; re-arms the poll timer.
  const [pollSeq, setPollSeq] = useState(0);
  const [checking, setChecking] = useState(false);

  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Phase epoch: a read answers for the epoch it was SENT in.
  const epochRef = useRef(0);
  // The committed phase, for the tick task (see the 1 Hz clock).
  const phaseRef = useRef(session.phase);
  useEffect(() => { phaseRef.current = session.phase; });
  // A "paid" read ends the reads: nothing may poll after it (each status read
  // is a backend placement trigger).
  const paidRef = useRef(false);
  const freshForRef = useRef<PaytmSessionPhase | null>(null);
  const voidSentRef = useRef(false);
  // paid / notPaid side effects run once (they are mutually exclusive).
  const settledRef = useRef(false);
  const unknownReportedRef = useRef(false);
  const exitRef = useRef(false);
  const redirectedRef = useRef(false);
  // Latest-closure ref: useOrderHook rebuilds its functions every render.
  const recordRef = useRef(recordOrderLocally);
  useEffect(() => { recordRef.current = recordOrderLocally; });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // No open session at mount (stale URL, reload after the session ended).
  useEffect(() => {
    if (open || redirectedRef.current) return;
    redirectedRef.current = true;
    navigate(cartCount > 0 ? "/payment" : "/menu", { replace: true });
  }, [cartCount, navigate, open]);

  /**
   * One status read. Joins the read already in flight instead of sending a
   * second one. The result is applied in a `.then`, which always runs after
   * `inFlightRef` holds this promise — even if the call throws synchronously.
   */
  const pollOnce = useCallback((): Promise<void> => {
    if (!open || !selection || paidRef.current) return Promise.resolve();
    if (inFlightRef.current) return inFlightRef.current;
    const epoch = epochRef.current;
    const read = async (): Promise<ReturnType<typeof classifyPaytmKioskPoll>> => {
      try {
        const call = open.kind === "paytmDqr" ? checkDqrStatus : checkEdcStatus;
        const body = buildPaytmKioskStatusBody(
          open,
          selection,
          selectDeploymentDetails(store.getState()),
        );
        return classifyPaytmKioskPoll(await call(body));
      } catch {
        return "error";
      }
    };
    const run = read().then((outcome) => {
      inFlightRef.current = null;
      if (outcome === "paid") paidRef.current = true;
      if (!mountedRef.current) return;
      if (outcome === "paid" || epoch === epochRef.current) {
        dispatchSession({ type: "poll", outcome, now: Date.now() });
      }
      setPollSeq((seq) => seq + 1);
    });
    inFlightRef.current = run;
    return run;
  }, [checkDqrStatus, checkEdcStatus, open, selection, store]);

  // Poll cadence: a self-rescheduling timeout, re-armed by every completed read.
  useEffect(() => {
    if (!effects.poll) return;
    const timer = window.setTimeout(() => {
      void pollOnce();
    }, PAYTM_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [effects.poll, pollOnce, pollSeq]);

  // Entering cancelling/settling: one FRESH read now (after any stale one).
  useEffect(() => {
    const phase = session.phase;
    if (phase !== "cancelling" && phase !== "settling") return;
    if (freshForRef.current === phase) return; // StrictMode re-run
    freshForRef.current = phase;
    epochRef.current += 1;
    const stale = inFlightRef.current ?? Promise.resolve();
    void stale.then(() => {
      if (mountedRef.current) void pollOnce();
    });
  }, [pollOnce, session.phase]);

  // 1 Hz clock: deadlines (reducer) + the countdown.
  // The deadline crossing (awaiting → settling) is decided HERE, in the tick
  // task: an interval update renders a task later and its passive effects
  // later still, so a read SENT before the deadline could answer "pending" in
  // between and — with the epoch bumped only by the effect above — license
  // the EDC void. Bumping now makes that read stale on arrival.
  useEffect(() => {
    if (!effects.poll) return;
    const timer = window.setInterval(() => {
      const at = Date.now();
      if (phaseRef.current === "awaiting" && at >= session.deadlineAt) {
        epochRef.current += 1;
      }
      setNow(at);
      dispatchSession({ type: "tick", now: at });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [effects.poll, session.deadlineAt]);

  // EDC void — at most once, only when the reducer asks (fresh pending read).
  useEffect(() => {
    if (!effects.sendVoid || !open || !selection || voidSentRef.current) return;
    voidSentRef.current = true;
    dispatchSession({ type: "voidSent" });
    const sendVoid = async (): Promise<
      ReturnType<typeof classifyPaytmEdcVoidResult>
    > => {
      try {
        const body = buildPaytmEdcVoidBody(
          open,
          selection,
          selectDeploymentDetails(store.getState()),
        );
        return classifyPaytmEdcVoidResult(await voidEdc(body));
      } catch {
        // It may have left the kiosk: never assume it did not.
        return "unknown";
      }
    };
    void sendVoid().then((outcome) => {
      if (mountedRef.current) {
        dispatchSession({ type: "void", outcome, now: Date.now() });
      }
    });
  }, [effects.sendVoid, open, selection, store, voidEdc]);

  // PAID — exactly once: local bookkeeping, analytics, then Order Complete.
  // Payment state is NOT cleared here: /orderSuccess prints with it and
  // /start's reset clears it.
  useEffect(() => {
    if (session.phase !== "paid" || !open || settledRef.current) return;
    settledRef.current = true;
    const orderId = open.posBillNo;
    const settlePaid = async () => {
      try {
        await recordRef.current(orderId, false, 0);
      } catch {
        // The order exists (the backend placed it): a bookkeeping failure is
        // never a payment failure — clear the global error flag and go on.
        captureKioskEvent(KioskEventName.ErrorOccurred, {
          error_source: "paytm_record_local",
          order_id: orderId,
        });
        dispatch(setShowErrorModal({ showErrorModal: false, errorMessage: "" }));
      }
      captureKioskEvent(KioskEventName.PaymentSuccessful, {
        order_id: orderId,
        payment_type: PAYTM_PAYMENT_TYPES[open.kind],
        net_amount: Number(selectCartAmount(store.getState()) ?? 0),
      });
      if (!mountedRef.current) return;
      const successState: OrderSuccessLocationState = { receipt };
      navigate("/orderSuccess", { state: successState });
    };
    void settlePaid();
  }, [dispatch, navigate, open, receipt, session.phase, store]);

  // NOT PAID — once. Only a definitive answer may undo the S7 claim mark.
  useEffect(() => {
    if (session.phase !== "notPaid" || !open || settledRef.current) return;
    settledRef.current = true;
    const ids = {
      order_id: open.posBillNo,
      payment_type: PAYTM_PAYMENT_TYPES[open.kind],
    };
    if (isPaytmNotPaidDefinitive(session)) {
      unmarkClaimOrderOutcomeUnknown(store.getState, dispatch, open.posBillNo);
    }
    if (session.reason === "cancelledByCustomer") {
      captureKioskEvent(KioskEventName.PaymentCancelledByUser, ids);
      dispatch(emptyPayment());
      navigate("/payment");
      return;
    }
    captureKioskEvent(KioskEventName.PaymentFailed, {
      ...ids,
      reason: session.reason,
    });
  }, [dispatch, navigate, open, session, store]);

  // UNKNOWN — reported once; the S7 mark stays (the order may exist).
  useEffect(() => {
    if (session.phase !== "unknown" || !open || unknownReportedRef.current) return;
    unknownReportedRef.current = true;
    captureKioskEvent(KioskEventName.ErrorOccurred, {
      error_source: "paytm_settlement",
      outcome_unknown: true,
      order_id: open.posBillNo,
      payment_type: PAYTM_PAYMENT_TYPES[open.kind],
      last_poll: session.lastPoll,
      void_requested: session.voidRequested,
    });
  }, [open, session]);

  const confirmCancel = useCallback(() => {
    // The reducer ignores a cancel outside "awaiting".
    dispatchSession({ type: "cancel", now: Date.now() });
  }, []);

  const checkAgain = useCallback(() => {
    if (session.phase !== "unknown") return;
    setChecking(true);
    void pollOnce().then(() => {
      if (mountedRef.current) setChecking(false);
    });
  }, [pollOnce, session.phase]);

  const finish = useCallback(() => {
    if (session.phase !== "unknown" || exitRef.current) return;
    exitRef.current = true;
    navigate("/start");
  }, [navigate, session.phase]);

  const leaveNotPaid = useCallback(
    (to: "/payment" | "/cart") => {
      if (session.phase !== "notPaid" || exitRef.current) return;
      exitRef.current = true;
      dispatch(emptyPayment());
      navigate(to);
    },
    [dispatch, navigate, session.phase],
  );
  const tryAgain = useCallback(() => leaveNotPaid("/payment"), [leaveNotPaid]);
  const backToBag = useCallback(() => leaveNotPaid("/cart"), [leaveNotPaid]);

  return {
    session: open ? session : null,
    kind: open?.kind ?? null,
    qrCode: open?.qrCode ?? "",
    secondsLeft: Math.max(0, Math.ceil((session.deadlineAt - now) / 1000)),
    orderRef: open ? open.posBillNo.slice(-5) : "",
    amount,
    checking,
    confirmCancel,
    checkAgain,
    finish,
    tryAgain,
    backToBag,
  };
}
