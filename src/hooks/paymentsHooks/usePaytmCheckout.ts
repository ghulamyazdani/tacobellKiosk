import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useNavigate } from "react-router-dom";
import { setOrderId } from "@cx-sdk/ordering/state/order.slice";
import { netAmount as selectNetAmount } from "@cx-sdk/ordering/state/cart.slice";
import { paymentSettingsRdx } from "@cx-sdk/catalog/state/appSettings.slice";
import { selectCustomerPhone } from "@cx-sdk/core/customer/customerInfo.slice";
import {
  selectKioskPaymentType,
  setBillPaymentInfo,
  setPaytmQrCode,
} from "@cx-sdk/payments/state/payment.slice";
import { generatePaymentIds } from "@cx-sdk/payments/gateways/paymentSession";
import {
  buildPaytmDqrKioskInitiatePayload,
  buildPaytmEdcKioskInitiatePayload,
} from "@cx-sdk/payments/gateways/paytm";
import {
  decidePaytmInitiate,
  isPaytmOrderDetailsConsistent,
  pickPaytmSelections,
  toPaytmKind,
  type PaytmKind,
} from "@cx-sdk/payments/gateways/paytmKiosk";
import {
  useInitiatePaytmDqrKioskMutation,
  useInitiatePaytmEdcKioskMutation,
} from "@cx-sdk/payments/services/paymentSettingsFetchApi";
import { persistor } from "../../redux/app/store";
import useOrderHook from "../menuHooks/useOrderHook";
import { useIdleHold } from "../utils/useIdleTimeout";
import {
  markClaimOrderOutcomeUnknown,
  unmarkClaimOrderOutcomeUnknown,
} from "../loyalty/orderOutcomeClaim";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import type {
  OrderSuccessLocationState,
  ReceiptPreference,
} from "./usePayAtCounter";

/**
 * usePaytmCheckout — the Paytm INITIATE on /receipt (P8b-05). Paytm Dynamic
 * QR and Paytm EDC only (user decision 2026-10-05); /payment armed the type,
 * /paymentPolling settles. The backend places the order from the
 * `order_details` frozen here, so nothing on this path ever calls placeOrder.
 *
 * ── THE SEQUENCE (one initiate per tap; contract §P8b-05) ─────────────────
 *   refuse (modal, never a silent return — fork usePaymentHook.ts:349-351 is
 *     NOT ported) when no usable selection or netAmount <= 0
 *   generatePaymentIds() -> setOrderId + setBillPaymentInfo   BEFORE the call
 *     -> persistor.flush()                                     (on disk too)
 *   getPushOrderData(posBillNo) -> H-c guard (refuse on mismatch)
 *   S7 mark -> PaymentInitiated -> initiate (no unwrap) -> decidePaytmInitiate
 *   await: DQR stores the QR; both -> /paymentPolling {receipt}
 *   fail:  clear the ids (and flush), un-mark S7, modal (TRY AGAIN = NEW ids)
 *
 * ── MONEY RULES ──────────────────────────────────────────────────────────
 * - The ids are stored before the call (TB divergence: the fork stored them
 *   on success only), so an EDC initiate whose outcome is unknown can be
 *   settled by status with the SAME ids, and /start's release can find it.
 * - An EDC outcome-unknown is an `await`: the terminal MAY be armed, so it
 *   goes to /paymentPolling and is NEVER initiated again (user decision 3).
 *   Every DQR failure is retryable — the QR was never shown, so nobody can
 *   have paid it. All classification lives in the SDK (decidePaytmInitiate).
 * - Credentials are read from `appSettings.paymentSettings` at CALL time and
 *   go only into the request body — never setPaymentSetting / setPaytmInfo
 *   (the payment slice is persisted; D11).
 * - `getPushOrderData` builds `order_details` from useOrderHook's RENDER-time
 *   `payment.paymentType` (the closure note in usePayAtCounter). /payment
 *   armed it a whole navigation earlier, so it is current; the H-c guard
 *   (isPaytmOrderDetailsConsistent) refuses to park anything else.
 * - Every await is followed by a mounted check: RTK never aborts, and a late
 *   answer must not write into the next session. If the screen dies with an
 *   EDC request out, the stored ids let /start's release settle it.
 * - Analytics never carry the secret, mid, QR, device id, order_details or
 *   the phone.
 */

export type PaytmCheckoutStatus = "idle" | "initiating" | "failed";

export interface UsePaytmCheckout {
  /** toPaytmKind(payment.paymentType) — null means a COD checkout. */
  kind: PaytmKind | null;
  status: PaytmCheckoutStatus;
  failure: { reason: "busy" | "rejected" | "unknown"; retryable: boolean } | null;
  /** Exactly one initiate per tap. */
  start: (receipt: ReceiptPreference) => void;
  /** failed + retryable only: NEW ids, same receipt. */
  retry: () => void;
  /** failed -> idle, so the screen can leave. */
  dismiss: () => void;
}

type Failure = NonNullable<UsePaytmCheckout["failure"]>;

/** A local refusal: nothing was sent, and the same state would refuse again. */
const REFUSED: Failure = { reason: "rejected", retryable: false };

export default function usePaytmCheckout(): UsePaytmCheckout {
  const dispatch = useDispatch();
  const store = useStore();
  const navigate = useNavigate();
  const { getPushOrderData } = useOrderHook();
  const [initiateDqr] = useInitiatePaytmDqrKioskMutation();
  const [initiateEdc] = useInitiatePaytmEdcKioskMutation();
  const kind = toPaytmKind(useSelector(selectKioskPaymentType));

  const [status, setStatus] = useState<PaytmCheckoutStatus>("idle");
  const [failure, setFailure] = useState<Failure | null>(null);

  // Idle must never end the session under a request that may arm a terminal.
  // Bounded by the SDK endpoint timeout (10 s); the failure modal releases it.
  useIdleHold(status === "initiating");

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const receiptRef = useRef<ReceiptPreference>("none");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fail = (paymentType: string, result: Failure, posBillNo: string) => {
    if (posBillNo) {
      dispatch(setBillPaymentInfo({ posBillNo: "", posBillTime: "" }));
      // Off disk at once too: refused ids left there would resume after a
      // reload as a phantom EDC session (PaytmResumeGuard).
      void persistor.flush();
      unmarkClaimOrderOutcomeUnknown(store.getState, dispatch, posBillNo);
    }
    captureKioskEvent(KioskEventName.PaymentFailedToInitiate, {
      payment_type: paymentType,
      reason: result.reason,
    });
    inFlightRef.current = false;
    setFailure({ reason: result.reason, retryable: result.retryable });
    setStatus("failed");
  };

  const refuse = (paymentType: string, why: string, posBillNo: string) => {
    captureKioskEvent(KioskEventName.ErrorOccurred, {
      error_source: "paytm_initiate",
      reason: why,
    });
    fail(paymentType, REFUSED, posBillNo);
  };

  const run = async (receipt: ReceiptPreference) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const state = store.getState();
    const paymentType: unknown = selectKioskPaymentType(state);
    const callKind = toPaytmKind(paymentType);
    const selection = pickPaytmSelections(paymentSettingsRdx(state)).find(
      (option) => option.kind === callKind,
    );
    const netAmount = Number(selectNetAmount(state));
    if (!selection) {
      refuse(typeof paymentType === "string" ? paymentType : "", "no_selection", "");
      return;
    }
    if (!(netAmount > 0)) {
      refuse(selection.paymentType, "zero_amount", "");
      return;
    }

    setFailure(null);
    setStatus("initiating");

    let posBillNo = "";
    let apiResponse: unknown;
    try {
      const ids = await generatePaymentIds();
      if (!mountedRef.current) return;
      posBillNo = ids.posBillNo;
      dispatch(setOrderId(posBillNo));
      dispatch(setBillPaymentInfo({ posBillNo, posBillTime: ids.posBillTime }));
      // On disk BEFORE the request can leave: redux-persist alone writes ~10 ms
      // after it, and a crash/reload in that gap lost ids whose terminal may be
      // armed — PaytmResumeGuard can only resume what is on disk (F1).
      await persistor.flush();
      if (!mountedRef.current) return;

      const { toPush } = await getPushOrderData(posBillNo);
      if (!mountedRef.current) return;
      if (!isPaytmOrderDetailsConsistent(toPush, selection.paymentType)) {
        refuse(selection.paymentType, "order_details_mismatch", posBillNo);
        return;
      }

      const claimIds = markClaimOrderOutcomeUnknown(store.getState, dispatch, posBillNo);
      captureKioskEvent(KioskEventName.PaymentInitiated, {
        order_id: posBillNo,
        net_amount: netAmount,
        payment_type: selection.paymentType,
        provider: "paytm",
        ...claimIds,
      });

      const args = {
        paymentInfo: selection.paymentInfo,
        paymentSettings: selection.paymentSettings,
        posBillNo,
        netAmount,
        customerPhone: selectCustomerPhone(store.getState()),
        orderDetails: toPush,
      };
      const isDqr = selection.kind === "paytmDqr";
      const body = isDqr
        ? // D10 (user decision 2026-10-06): the SDK stamps the QR expiryDate in
          // kiosk-LOCAL time with no offset. Correct because the deployment is
          // India / IST — ops: the kiosk OS timezone MUST be Asia/Kolkata, or
          // every QR is born expired.
          buildPaytmDqrKioskInitiatePayload(args)
        : buildPaytmEdcKioskInitiatePayload({ ...args, posBillTime: ids.posBillTime });
      try {
        // No unwrap: RTK resolves {data} | {error}. Anything thrown is handed
        // to the same SDK classifier rather than judged here.
        apiResponse = await (isDqr ? initiateDqr : initiateEdc)(body);
      } catch (error) {
        apiResponse = { error };
      }
    } catch {
      // A local step threw before anything was sent.
      refuse(selection.paymentType, "local_error", posBillNo);
      return;
    }
    if (!mountedRef.current) return;

    const decision = decidePaytmInitiate(selection.kind, apiResponse);
    if (decision.action === "fail") {
      fail(selection.paymentType, decision, posBillNo);
      return;
    }
    if (decision.qrCode) dispatch(setPaytmQrCode(decision.qrCode));
    if (decision.outcomeUnknown) {
      captureKioskEvent(KioskEventName.ErrorOccurred, {
        error_source: "paytm_initiate",
        initiate_outcome_unknown: true,
        order_id: posBillNo,
        payment_type: selection.paymentType,
      });
    }
    // The in-flight latch stays set: this instance never initiates again.
    const pollingState: OrderSuccessLocationState = { receipt };
    navigate("/paymentPolling", { state: pollingState });
  };

  // Plain functions on purpose: they only run from event handlers, so each
  // call uses the latest render's getPushOrderData closure.
  const start = (receipt: ReceiptPreference) => {
    if (inFlightRef.current || status !== "idle") return;
    receiptRef.current = receipt;
    void run(receipt);
  };

  const retry = () => {
    if (inFlightRef.current || status !== "failed" || !failure?.retryable) return;
    void run(receiptRef.current);
  };

  const dismiss = () => {
    if (inFlightRef.current || status !== "failed") return;
    setFailure(null);
    setStatus("idle");
  };

  return { kind, status, failure, start, retry, dismiss };
}
