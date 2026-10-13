import { useCallback, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { selectIdealTimeout } from "@cx-sdk/catalog/state/appSettings.slice";
import { currentOrder, selectOrderId } from "@cx-sdk/ordering/state/order.slice";
import { toPaytmKind } from "@cx-sdk/payments/gateways/paytmKiosk";
import { selectKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import usePayAtCounter, {
  type OrderSuccessLocationState,
  type ReceiptPreference as ReceiptChoice,
} from "../../hooks/paymentsHooks/usePayAtCounter";
import useAdaActive from "../../hooks/utils/useAdaActive";
import usePageEnter from "../../hooks/utils/usePageEnter";
import { resolveIdleSeconds, useIdleHold } from "../../hooks/utils/useIdleTimeout";
import { ORDER_SUCCESS_COUNTDOWN_SECONDS } from "../OrderSuccess";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import tbBell from "../../assets/brand/tb-bell.svg";

/**
 * /receipt — "DO YOU WANT TO PRINT THE RECEIPT?" with YES / NO (Figma 1:3377,
 * print-only since 2026-10-12).
 *
 * TB-design-only: the fork has no receipt-preference screen at all (it prints
 * on its success screen). It sits BEFORE the push for pay-at-counter — the
 * customer answers it while nothing is in flight — and AFTER the payment for
 * Paytm (user 2026-10-13: "it should be after that"). Client sign-off.
 *
 * PRINT ONLY (user request 2026-10-12): one question and two of the frame's
 * 416×416 CTA Cards (1:3382) — YES = "print", NO = "none". The frame's EMAIL
 * card (inert: no email-receipt data contract anywhere in the stack) and its
 * NO THANKS bar (CTA_Sheet_Fixed 1:3380) are gone. Design language beyond
 * the frame: client sign-off.
 *
 * THE CHOICE IS THE SCREEN'S ONLY OUTPUT. It reaches /orderSuccess in router
 * state as `location.state.receipt` — through `confirmAndPush(choice)` for
 * COD (see the seam note in usePayAtCounter), directly for a paid Paytm
 * order. The success screen honours "print" only when `print_bill` allows
 * and the POS is not printing the ticket itself.
 *
 * ADA (P9c, design-language, flagged — 1:3377 has no ADA variant): the
 * 1122px reach zone with the bell dropped. BACK (COD only) stays at 40;
 * title 120–229 (3 Arabic lines: 283) · YES / NO 292–708. The headline is
 * Title/H2 (Exp Bl 64/54.4, −3, 856 wide). The buffer and order-error
 * surfaces are page-relative, so they follow along.
 *
 * POST-PAYMENT (a Paytm type — only /paymentPolling's paid tail reaches
 * /receipt with one): the order is placed and paid, so the screen has no
 * BACK (the frame draws none — FIGMA_UI_GUIDE row 1:3377 "the top-left BACK
 * is ours"), never pushes or initiates, and its only exit is /orderSuccess —
 * by YES / NO or, idle held, by itself (NO) at T − 20 s, so Order Complete's
 * 20 s still lands Splash at T (Rule 1). Order Complete's own hold takes over
 * in the same commit. It is never asked when YES could not print: a reload
 * here drops the paid tail's local order record (order.currentOrder is not
 * persisted, and Order Complete prints only THAT order's record) — then it
 * renders nothing and goes on as NO at once (review 1 F1).
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

  // POST-PAYMENT mode (2026-10-13): only the paid tail reaches /receipt with a
  // Paytm type (PaymentSelection pins COD before its hop). Read from the
  // PERSISTED type — the value the print gate and the ticket read — so a
  // reload or a relaunch keeps the mode; a navigation may forget router state.
  const paid = toPaytmKind(useSelector(selectKioskPaymentType)) !== null;
  // YES prints only from the paid tail's local record of THIS order — Order
  // Complete's own test; a reload drops it (order.currentOrder is not persisted).
  const orderId = (useSelector(selectOrderId) as string | undefined) ?? "";
  const recordedId = (useSelector(currentOrder) as { orderId?: string } | undefined)?.orderId;
  const recorded = orderId !== "" && recordedId === orderId;
  const autoAnswerMs =
    (resolveIdleSeconds(useSelector(selectIdealTimeout)) - ORDER_SUCCESS_COUNTDOWN_SECONDS) * 1000;
  // Paid: never the idle prompt ("continue ordering / start again") over a
  // paid order, never Splash before Order Complete. Released on leaving.
  useIdleHold(paid);
  const answeredRef = useRef(false);
  const answerPaid = useCallback(
    (choice: ReceiptChoice, reason?: "timeout" | "no_local_record") => {
      if (answeredRef.current) return; // double tap / tap + timer: once
      answeredRef.current = true;
      captureKioskEvent(KioskEventName.other, {
        screen: "receipt",
        receipt_preference: choice,
        ...(reason ? { reason } : {}),
      });
      const state: OrderSuccessLocationState = { receipt: choice };
      navigate("/orderSuccess", { state });
    },
    [navigate]
  );
  // No answer: NO, when Order Complete's 20 s still lands Splash at T (Rule 1).
  // A touch does not extend it (Order Complete's precedent). No record: NO at
  // once — the question is never shown (below).
  useEffect(() => {
    if (!paid) return;
    const id = window.setTimeout(
      () => answerPaid("none", recorded ? "timeout" : "no_local_record"),
      recorded ? autoAnswerMs : 0
    );
    return () => window.clearTimeout(id);
  }, [answerPaid, autoAnswerMs, paid, recorded]);

  const choose = useCallback(
    (choice: ReceiptChoice) => {
      if (paid) {
        answerPaid(choice);
        return;
      }
      // In-flight guard on top of the hook's own latch: a double tap while
      // the push is running must never queue a second order (Rule 2). Once
      // the ladder has failed the tiles are inert as well — the panel below
      // is the only live surface until Retry or Back to bag is taken.
      if (isPushing || hasFailed) return;
      captureKioskEvent(KioskEventName.other, {
        screen: "receipt",
        receipt_preference: choice,
      });
      confirmAndPush(choice);
    },
    [answerPaid, confirmAndPush, hasFailed, isPushing, paid]
  );

  /** Nothing has been pushed yet, so returning to the method choice is safe. */
  const handleBack = useCallback(() => {
    if (isPushing || hasFailed) return;
    navigate("/payment");
  }, [hasFailed, isPushing, navigate]);

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

  // Paid with no local record: a question whose YES could not print is never
  // shown (the timer above goes on as NO at once).
  if (paid && !recorded) return null;

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

      {/* Paid: no way back to an unpaid screen (Order Complete's precedent). */}
      {!paid && (
        <button
          type="button"
          data-testid="receipt-back"
          onClick={handleBack}
          className="tb-display absolute left-[40px] top-[40px] min-h-[64px] min-w-[120px] rounded-[8px] border-2 border-tb-surface px-[32px] py-[18px] text-[20px] leading-[20px] text-tb-surface"
        >
          {t("receipt.back")}
        </button>
      )}

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

    </div>
  );
}
