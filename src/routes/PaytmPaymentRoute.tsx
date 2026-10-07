import { useEffect, useState } from "react";
import { useStore } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { readOpenPaytmSession } from "@cx-sdk/payments/gateways/paytmKiosk";
import { selectPayment } from "@cx-sdk/payments/state/payment.slice";
import ErrorModal from "../components/common/ErrorModal";
import PleaseWait from "../components/payment/PleaseWait";
import { PAYMENT_IDLE_HOLD_MAX_MS, useIdleHold } from "../hooks/utils/useIdleTimeout";
import {
  loadedPaytmScreen,
  loadPaytmScreen,
  type PaytmScreen,
} from "../pages/PaytmPayment/loadPaytmScreen";

/**
 * The chunk did not arrive (a resumed session on a page with no network and
 * no service-worker copy). Nothing here can poll or void, so it is the panel
 * the screen itself ends on when an outcome is unknown — don't pay again, the
 * order number for staff — with FINISH only: /start's mount releases the
 * session status-first (one read; an EDC void only after a fresh "pending").
 * Never a reload here: a payment may be live on the terminal (the loader has
 * flagged one for the next splash).
 */
function PaytmScreenUnavailable() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const store = useStore();
  // Latched at mount, like the screen's own session latch.
  const [orderRef] = useState(
    () => readOpenPaytmSession(selectPayment(store.getState()))?.posBillNo.slice(-5) ?? ""
  );
  return (
    <div data-testid="paytm-unavailable-screen" className="relative h-full w-[1080px] bg-tb-pink">
      <ErrorModal
        testId="paytm-unavailable"
        title={t("paytm.unknown.title")}
        message={t("paytm.unknown.message", { order: orderRef })}
        primary={{
          label: t("paytm.unknown.finish"),
          onClick: () => navigate("/start"),
          testId: "paytm-unavailable-finish",
        }}
      />
    </div>
  );
}

/**
 * /paymentPolling off the boot path (P8b × the P9f 355 KiB budget): the
 * settlement screen, its hook, the SDK reducer and react-qr-code are the
 * lazy paytmRuntime chunk (loadPaytmScreen). usePaytmCheckout loads it
 * BEFORE the initiate, so a checkout lands here with the screen in hand;
 * only a session resumed after a reload (here, or via PaytmResumeGuard)
 * loads it here.
 * Until it arrives: PleaseWait ("Setting up your payment") — never a blank
 * screen — with idle HELD: the terminal may be armed, and the screen's own
 * hold takes over once it renders (the staff panel releases it).
 *
 * Plain state, not React.lazy + Suspense: Suspense throttles the reveal
 * after a fallback with a 300 ms TIMER — a stalled timer queue would hold a
 * live payment behind PleaseWait (the e2e freezes the clock before every
 * initiate).
 */
export default function PaytmPaymentRoute() {
  const { t } = useTranslation();
  // undefined = loading · null = the chunk failed.
  const [screen, setScreen] = useState<PaytmScreen | null | undefined>(
    () => loadedPaytmScreen() ?? undefined
  );
  useIdleHold(screen === undefined, PAYMENT_IDLE_HOLD_MAX_MS);

  useEffect(() => {
    if (screen !== undefined) return;
    let live = true;
    const load = async () => {
      const loaded = await loadPaytmScreen();
      if (live) setScreen(() => loaded);
    };
    void load();
    return () => { live = false; };
  }, [screen]);

  if (screen === undefined) {
    return <PleaseWait testId="paytm-loading" subtitle={t("paytm.wait.preparing")} />;
  }
  if (screen === null) return <PaytmScreenUnavailable />;
  const Loaded = screen;
  return <Loaded />;
}
