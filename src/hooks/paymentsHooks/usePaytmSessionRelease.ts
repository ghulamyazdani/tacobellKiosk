import { useCallback } from "react";
import { useStore } from "react-redux";
import { paymentSettingsRdx } from "@cx-sdk/catalog/state/appSettings.slice";
import { selectDeploymentDetails } from "@cx-sdk/core/auth/authentication.slice";
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
} from "@cx-sdk/payments/gateways/paytmKiosk";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/**
 * An RTK mutation trigger of the SDK service (typed `any` there): resolves
 * `{ data } | { error }`, never rejects for a failed request.
 */
type PaytmTrigger = (body: Record<string, unknown>) => PromiseLike<unknown>;

/**
 * P8b-12 — /start's teardown releases a Paytm session that is still open.
 * Reached after the unknown panel's FINISH, idle on an end panel, a crash
 * recovery or a relaunch (the ids and the type are persisted). The returned
 * callback is stable, and StartScreen calls it inside its teardown latch
 * BEFORE resetSession("full"): everything it needs is read at CALL time.
 *
 *   1. ONE status read (the endpoint's own 5 s budget) — the read can itself
 *      make the backend place a paid order, so it is never skipped.
 *   2. EDC only, and only after a FRESH "pending": ONE void (10 s). Never
 *      after "error": what a void does to an already-paid transaction is
 *      unknown (backend Q3).
 *   3. ONE ErrorOccurred for staff: error_source "paytm_session_released",
 *      order_id, payment_type, last_status, void_outcome ("none" = no void
 *      sent). An open session whose selection is gone (settings changed)
 *      cannot be read without credentials: last_status "no_selection".
 *
 * Fire-and-forget: the splash never waits on it (Rule 2). It never throws,
 * never dispatches app state, never retries — and never logs the mid,
 * secret, device id or QR string (only the order id leaves).
 */
export default function usePaytmSessionRelease(): () => void {
  const store = useStore();
  const [checkDqrStatus] = useCheckPaytmDqrKioskStatusMutation() as [
    PaytmTrigger,
  ];
  const [checkEdcStatus] = useCheckPaytmEdcKioskStatusMutation() as [
    PaytmTrigger,
  ];
  const [voidEdc] = useCancelPaytmEdcKioskMutation() as [PaytmTrigger];

  return useCallback(() => {
    try {
      const state = store.getState() as { payment?: unknown };
      const session = readOpenPaytmSession(state.payment);
      if (!session) return;

      const report = (lastStatus: string, voidOutcome: string) =>
        captureKioskEvent(KioskEventName.ErrorOccurred, {
          error_source: "paytm_session_released",
          order_id: session.posBillNo,
          payment_type: PAYTM_PAYMENT_TYPES[session.kind],
          last_status: lastStatus,
          void_outcome: voidOutcome,
        });

      const selection = pickPaytmSelections(paymentSettingsRdx(state)).find(
        (candidate) => candidate.kind === session.kind,
      );
      if (!selection) {
        report("no_selection", "none");
        return;
      }

      // Both bodies are built NOW — the reset right after this call empties
      // the payment slice.
      const deployment = selectDeploymentDetails(state);
      const statusBody = buildPaytmKioskStatusBody(session, selection, deployment);
      const voidBody =
        session.kind === "paytmEdc"
          ? buildPaytmEdcVoidBody(session, selection, deployment)
          : null;
      const checkStatus =
        session.kind === "paytmDqr" ? checkDqrStatus : checkEdcStatus;

      void (async () => {
        let lastStatus = "error";
        let voidOutcome = "none";
        try {
          lastStatus = classifyPaytmKioskPoll(await checkStatus(statusBody));
          if (voidBody && lastStatus === "pending") {
            voidOutcome = "unknown"; // until the void answers
            voidOutcome = classifyPaytmEdcVoidResult(await voidEdc(voidBody));
          }
        } catch {
          // A trigger resolves { error } rather than rejecting; a throw here
          // is unexpected — report what is known, never retry.
        }
        report(lastStatus, voidOutcome);
      })();
    } catch {
      // Junk persisted state must never break the splash teardown.
    }
  }, [store, checkDqrStatus, checkEdcStatus, voidEdc]);
}
