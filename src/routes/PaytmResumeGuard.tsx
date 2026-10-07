import { useEffect, useRef, useState } from "react";
import { useDispatch, useStore } from "react-redux";
import { Outlet, useNavigate } from "react-router-dom";
import { readOpenPaytmSession } from "@cx-sdk/payments/gateways/paytmKiosk";
import {
  selectPayment,
  selectPosBillNo,
  setBillPaymentInfo,
} from "@cx-sdk/payments/state/payment.slice";
import type { OrderSuccessLocationState } from "../hooks/paymentsHooks/usePayAtCounter";

/** The receipt choice was router state and died with the reload. */
const RESUME_STATE: OrderSuccessLocationState = { receipt: "none" };

/**
 * PaytmResumeGuard — pathless layout route around /payment and /receipt
 * (P8b follow-up F1, a money path).
 *
 * A reload keeps the route (ProtectedRoute only checks the token). Mid-EDC-
 * initiate it remounted /receipt IDLE over persisted ids whose terminal may be
 * armed: a re-tap minted NEW ids, a "busy" answer cleared them, and the first
 * terminal transaction was orphaned — payable on the machine while the guest
 * paid another way. Now a Paytm session still open when this layout MOUNTS
 * resumes on /paymentPolling, which settles it by status with the SAME ids.
 * "Open" is readOpenPaytmSession, the one definition /paymentPolling and
 * /start's release share. EDC-only by construction: a DQR session needs its
 * QR, stored only with the navigation to /paymentPolling, and only the Paytm
 * initiate writes posBillNo (COD never does).
 *
 * - Decided ONCE per mount (state + ref latch), never reactive: the initiate
 *   on /receipt opens a session under this layout and must never be bounced
 *   or swept mid-call. /payment ↔ /receipt keeps the layout mounted.
 * - Loop-free: /paymentPolling sends a guest here only after emptyPayment(),
 *   or from its no-session redirect, which reads the same definition.
 * - Navigates only (hazard H1); the page never mounts under a redirect.
 * - Accepted trade-off: an initiate that never left shows the EDC screen
 *   until the window ends, then the unknown (staff) panel.
 * - Ids with no open session (an interrupted DQR initiate: its QR was never
 *   shown, so nobody can pay it) are dropped here — otherwise re-arming EDC
 *   over them would read as an open session and strand the guest on a
 *   phantom terminal (and /start's release could void it). Only the ids
 *   seen dead at the first render: a tap that beat this effect stores FRESH
 *   ids, which must survive.
 */
export default function PaytmResumeGuard() {
  const store = useStore();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  // Read at the first render, before the page (or a tap on it) exists.
  const [{ resume, deadBillNo }] = useState(() => {
    const state = store.getState();
    const open = readOpenPaytmSession(selectPayment(state)) !== null;
    const billNo: unknown = selectPosBillNo(state);
    return { resume: open, deadBillNo: open ? "" : billNo };
  });
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (resume) {
      navigate("/paymentPolling", { replace: true, state: RESUME_STATE });
      return;
    }
    const billNo: unknown = selectPosBillNo(store.getState());
    if (deadBillNo && billNo === deadBillNo) {
      dispatch(setBillPaymentInfo({ posBillNo: "", posBillTime: "" }));
    }
  }, [deadBillNo, dispatch, navigate, resume, store]);

  return resume ? null : <Outlet />;
}
