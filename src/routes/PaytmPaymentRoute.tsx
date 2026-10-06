import { useEffect, useState, type ComponentType } from "react";
import { useStore } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { readOpenPaytmSession } from "@cx-sdk/payments/gateways/paytmKiosk";
import { selectPayment } from "@cx-sdk/payments/state/payment.slice";
import ErrorModal from "../components/common/ErrorModal";
import PleaseWait from "../components/payment/PleaseWait";
import { captureKioskEvent, KioskEventName } from "../utils/analytics";

type Screen = ComponentType;

/** The screen once its chunk has arrived: every later mount renders it at once. */
let loadedScreen: Screen | null = null;
let pendingLoad: Promise<Screen | null> | null = null;

/**
 * Starts (or joins) the chunk load; never rejects — null = it failed, and a
 * failure is not kept: the next mount tries again. `await import()`, NEVER
 * `import().then()` (see trackEvent.ts): in a build a failed chunk fires
 * vite:preloadError, chunkRecovery prevents it WITHOUT a reload
 * (/paytmRuntime/) and the import RESOLVES undefined; the dev server rejects.
 */
function loadScreen(): Promise<Screen | null> {
  pendingLoad ??= (async () => {
    try {
      const chunk: { default?: Screen } | undefined = await import(
        "../pages/PaytmPayment/paytmRuntime"
      );
      if (chunk?.default) return (loadedScreen = chunk.default);
    } catch {
      // The dev server's rejected import.
    }
    pendingLoad = null;
    captureKioskEvent(KioskEventName.ErrorOccurred, { error_source: "paytm_chunk" });
    return null;
  })();
  return pendingLoad;
}

/**
 * The chunk did not arrive (a deploy race with no service-worker copy, a dead
 * network). Nothing here can poll or void, so it is the panel the screen
 * itself ends on when an outcome is unknown — don't pay again, the order
 * number for staff — with FINISH only: /start's mount releases the session
 * status-first (one read; an EDC void only after a fresh "pending"). Never a
 * reload: a payment may be live on the terminal.
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
 * lazy paytmRuntime chunk, fetched on the first Paytm payment. Until it
 * arrives: PleaseWait ("Setting up your payment", the frame the initiate on
 * /receipt just showed) — never a blank screen.
 *
 * Plain state, not React.lazy + Suspense: Suspense throttles the reveal
 * after a fallback with a 300 ms TIMER — a stalled timer queue would hold a
 * live payment behind PleaseWait (the e2e freezes the clock before every
 * initiate) — and React.lazy keeps a failure for the page's lifetime.
 */
export default function PaytmPaymentRoute() {
  const { t } = useTranslation();
  // undefined = loading · null = the chunk failed.
  const [screen, setScreen] = useState<Screen | null | undefined>(
    () => loadedScreen ?? undefined
  );

  useEffect(() => {
    if (screen !== undefined) return;
    let live = true;
    const load = async () => {
      const loaded = await loadScreen();
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
