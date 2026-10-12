import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import usePayAtCounter, {
  type ReceiptPreference as ReceiptChoice,
} from "../../hooks/paymentsHooks/usePayAtCounter";
import usePaytmCheckout from "../../hooks/paymentsHooks/usePaytmCheckout";
import useAdaActive from "../../hooks/utils/useAdaActive";
import usePageEnter from "../../hooks/utils/usePageEnter";
import ErrorModal from "../../components/common/ErrorModal";
import PleaseWait from "../../components/payment/PleaseWait";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import tbBell from "../../assets/brand/tb-bell.svg";

/**
 * /receipt — "DO YOU WANT TO PRINT THE RECEIPT?" with YES / NO (Figma 1:3377,
 * print-only since 2026-10-12).
 *
 * TB-design-only: the fork has no receipt-preference screen at all. It sits
 * AFTER the payment-method tap and BEFORE the order push, so the customer
 * answers it while nothing is in flight rather than being held on a spinner
 * after ordering.
 *
 * PRINT ONLY (user request 2026-10-12): one question and two of the frame's
 * 416×416 CTA Cards (1:3382) — YES = "print", NO = "none". The frame's EMAIL
 * card (inert: no email-receipt data contract anywhere in the stack) and its
 * NO THANKS bar (CTA_Sheet_Fixed 1:3380) are gone. Design language beyond
 * the frame: client sign-off.
 *
 * THE CHOICE IS THE SCREEN'S ONLY OUTPUT. It is handed to
 * `confirmAndPush(choice)`, which carries it to /orderSuccess in router state
 * as `location.state.receipt` — see the seam note in usePayAtCounter. The
 * success screen honours "print" only when `print_bill` allows and the POS is
 * not printing the ticket itself.
 *
 * ADA (P9c, design-language, flagged — 1:3377 has no ADA variant): the
 * 1122px reach zone with the bell dropped. BACK stays at 40; title 120–229
 * (3 Arabic lines: 283) · YES / NO 292–708. The headline is Title/H2 (Exp Bl
 * 64/54.4, −3, 856 wide). The buffer and order-error surfaces are
 * page-relative, so they follow along.
 *
 * P8b PAYTM: when /payment armed a Paytm type, the choice starts the Paytm
 * INITIATE instead (usePaytmCheckout) — the COD path is untouched. While it
 * runs, PleaseWait (Figma 1:4456) covers the screen and the tiles and BACK
 * are inert; then /paymentPolling (NEW edge, Rule 1). A failure opens the
 * ErrorModal (1:6288 layout; copy and actions design-language, flagged): TRY
 * AGAIN (new ids) or PAY ANOTHER WAY → /payment, and BACK TO BAG → /cart.
 */
export default function ReceiptPreferenceScreen() {
  const enter = usePageEnter();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ada = useAdaActive();

  // The guarded push (payment type → order id → pending → pushOrder →
  // /orderSuccess, with the retry ladder and the idempotency latch) lives
  // entirely in the hook. This screen supplies the receipt choice only — but
  // it is also the screen that CALLS the push, so it owns the terminal state
  // that ladder can end in (see the order-error panel at the bottom). Without
  // it an exhausted ladder leaves /receipt looking normal and behaving inert:
  // `isPushing` drops, the buffer disappears, and every tile is dead because
  // the hook refuses to start again from "failed" — the exact Rule 2 dead end
  // this vertical exists to avoid.
  const {
    confirmAndPush,
    isPushing,
    hasFailed,
    failedOnTimeout,
    retry: retryOrderPush,
    dismissError,
  } = usePayAtCounter();
  const paytm = usePaytmCheckout();
  const paytmBusy = paytm.status !== "idle";
  const { kind: paytmKind, start: startPaytm, dismiss: dismissPaytm } = paytm;

  const choose = useCallback(
    (choice: ReceiptChoice) => {
      // In-flight guard on top of the hook's own latch: a double tap while
      // the push is running must never queue a second order (Rule 2). Once
      // the ladder has failed the tiles are inert as well — the panel below
      // is the only live surface until Retry or Back to bag is taken.
      if (isPushing || hasFailed || paytmBusy) return;
      captureKioskEvent(KioskEventName.other, {
        screen: "receipt",
        receipt_preference: choice,
      });
      if (paytmKind) startPaytm(choice);
      else confirmAndPush(choice);
    },
    [confirmAndPush, hasFailed, isPushing, paytmBusy, paytmKind, startPaytm]
  );

  /** Nothing has been pushed yet, so returning to the method choice is safe. */
  const handleBack = useCallback(() => {
    if (isPushing || hasFailed || paytmBusy) return;
    navigate("/payment");
  }, [hasFailed, isPushing, navigate, paytmBusy]);

  /** Paytm failure exits: nothing is in flight once the modal is up. */
  const handlePaytmOtherWay = useCallback(() => {
    dismissPaytm();
    navigate("/payment");
  }, [dismissPaytm, navigate]);

  const handlePaytmBackToBag = useCallback(() => {
    dismissPaytm();
    navigate("/cart");
  }, [dismissPaytm, navigate]);

  /**
   * Terminal-failure exit. `dismissError()` returns the hook to "idle" so the
   * bag's PAY is live again. The order id is NOT kept: leaving unmounts this
   * screen's hook instance, so a later PAY mints a new id — only the panel's
   * Retry reuses it.
   */
  const handleOrderErrorBack = useCallback(() => {
    dismissError();
    navigate("/cart");
  }, [dismissError, navigate]);

  return (
    // Motion §2.7: the title and the YES / NO row arrive (.tb-enter); texture,
    // BACK, bell and the overlays stay.
    <div
      data-testid="receipt-screen"
      data-enter={enter}
      className="relative h-full w-[1080px] overflow-hidden bg-tb-purple"
    >
      {/* Full-bleed purple texture — the SAME asset as the splash screen
          (bg-texture.png is byte-identical to the Figma fill), tiled at 540px
          so the horizontal repeat lands exactly on the 1080px frame edges. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${bgTexture})`,
          backgroundSize: "540px 540px",
          backgroundPosition: "top left",
        }}
      />

      <button
        type="button"
        data-testid="receipt-back"
        onClick={handleBack}
        className="tb-display absolute left-[40px] top-[40px] min-h-[64px] min-w-[120px] rounded-[8px] border-2 border-tb-surface px-[32px] py-[18px] text-[20px] leading-[20px] text-tb-surface"
      >
        {t("receipt.back")}
      </button>

      {!ada && (
        <img
          alt="Taco Bell"
          src={tbBell}
          className="absolute left-1/2 top-[128px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}

      <h1
        className={`tb-enter [--i:0] tb-display absolute left-1/2 ${ada ? "top-[120px]" : "top-[666px]"} w-[856px] -translate-x-1/2 text-center text-[64px] leading-[54.4px] tracking-[-3px] text-tb-surface`}
      >
        {t("receipt.title")}
      </h1>

      <div
        className={`tb-enter [--i:1] absolute left-1/2 ${ada ? "top-[292px]" : "top-[838px]"} flex -translate-x-1/2 gap-[24px]`}
      >
        {/* The testids keep the choices' names (print / none), which every
            checkout flow clicks. */}
        {(
          [
            ["receipt-print", "print", "receipt.yes"],
            ["receipt-none", "none", "receipt.no"],
          ] as const
        ).map(([testId, choice, label]) => (
          <button
            key={testId}
            type="button"
            data-testid={testId}
            onClick={() => choose(choice)}
            className="flex h-[416px] w-[416px] items-center justify-center rounded-[10px] bg-tb-surface px-[32px]"
          >
            <span className="tb-compressed text-center text-[48px] leading-[44px] text-tb-purple">
              {t(label)}
            </span>
          </button>
        ))}
      </div>

      {/* Same buffer surface as /payment, WITHOUT the cancel affordance — the
          push has started and cannot be recalled (brief: "once the push
          starts, Cancel disappears"). */}
      {isPushing && (
        <div
          data-testid="payment-buffer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="receipt-placing-title"
          className="absolute inset-0 z-50"
        >
          <div aria-hidden className="absolute inset-0 bg-tb-ink-purple/70" />
          <div className="tb-modal-enter absolute left-1/2 top-1/2 w-[676px] rounded-[12px] bg-tb-surface px-[44px] py-[56px] text-center">
            <h2
              id="receipt-placing-title"
              className="tb-display text-[40px] leading-[1.1] tracking-[-1px] text-tb-purple"
            >
              {t("payment.placingOrder")}
            </h2>
            {/* The house indeterminate sweep (motion-v2 MV3): no silent wait. */}
            <div aria-hidden className="mx-auto mt-[32px] h-[8px] w-[420px] overflow-hidden rounded-full bg-tb-lilac">
              <div className="tb-indeterminate h-full w-1/3 rounded-full bg-tb-purple" />
            </div>
          </div>
        </div>
      )}

      {/* TERMINAL PUSH FAILURE (Rule 2) — the same panel /customerName renders,
          because this screen can reach the same exhausted ladder. The fork's
          equivalent path only console.errors and strands the customer on the
          payment screen; here it surfaces with two live exits. z-[60] clears
          the in-session overlay wrappers (z-45 / z-55) mounted by AppRoutes,
          so nothing can paint over it. After a TIMEOUT the order may exist,
          so the copy switches to the uncertain variant (design-language,
          flagged for client sign-off). */}
      {hasFailed && (
        <div
          data-testid="order-error"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="order-error-title"
          aria-describedby="order-error-message"
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-[40px] bg-tb-ink-purple/95 px-[90px] text-center"
        >
          <h2
            id="order-error-title"
            className="tb-display text-[64px] leading-[60px] tracking-[-2px] text-tb-surface"
          >
            {t(failedOnTimeout ? "orderError.uncertainTitle" : "orderError.title")}
          </h2>
          <p
            id="order-error-message"
            className="max-w-[820px] text-[30px] leading-[40px] text-tb-cream"
          >
            {t(
              failedOnTimeout
                ? "orderError.uncertainMessage"
                : "orderError.message"
            )}
          </p>
          <button
            type="button"
            data-testid="order-error-retry"
            onClick={retryOrderPush}
            className="tb-display min-h-[104px] w-[600px] rounded-[8px] bg-tb-pink py-[32px] text-[28px] leading-[24px] text-tb-ink-purple"
          >
            {t("orderError.retry")}
          </button>
          <button
            type="button"
            data-testid="order-error-back"
            onClick={handleOrderErrorBack}
            className="tb-display min-h-[88px] w-[600px] rounded-[8px] border-2 border-tb-surface py-[26px] text-[24px] leading-[24px] text-tb-surface"
          >
            {t("orderError.backToBag")}
          </button>
        </div>
      )}

      {paytm.status === "initiating" && (
        <PleaseWait testId="paytm-preparing" subtitle={t("paytm.wait.preparing")} />
      )}

      {paytm.status === "failed" && paytm.failure && (
        <ErrorModal
          testId="paytm-initiate-failed"
          title={t("paytm.failed.title")}
          message={t(
            paytm.failure.reason === "busy" ? "paytm.failed.busy" : "paytm.failed.start"
          )}
          primary={
            paytm.failure.retryable
              ? {
                  label: t("paytm.failed.tryAgain"),
                  onClick: paytm.retry,
                  testId: "paytm-initiate-retry",
                }
              : {
                  label: t("paytm.failed.payAnotherWay"),
                  onClick: handlePaytmOtherWay,
                  testId: "paytm-initiate-other",
                }
          }
          secondary={{
            label: t("orderError.backToBag"),
            onClick: handlePaytmBackToBag,
            testId: "paytm-initiate-bag",
          }}
        />
      )}
    </div>
  );
}
