import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import usePayAtCounter, {
  type ReceiptPreference as ReceiptChoice,
} from "../../hooks/paymentsHooks/usePayAtCounter";
import useAdaActive from "../../hooks/utils/useAdaActive";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import tbBell from "../../assets/brand/tb-bell.svg";

/**
 * /receipt — "DO YOU NEED THE RECEIPT?" (Figma 1:3377).
 *
 * TB-design-only: the fork has no receipt-preference screen at all. It sits
 * AFTER the payment-method tap and BEFORE the order push, so the customer
 * answers it while nothing is in flight rather than being held on a spinner
 * after ordering.
 *
 * THE CHOICE IS THE SCREEN'S ONLY OUTPUT. It is handed to
 * `confirmAndPush(choice)`, which carries it to /orderSuccess in router state
 * as `location.state.receiptPreference` — see the seam note in
 * usePayAtCounter. The success screen honours "print" only when `print_bill`
 * allows and the POS is not printing the ticket itself.
 *
 * ⚠️ EMAIL IS INERT AND FLAGGED. There is NO data contract for an emailed
 * receipt anywhere in the stack: the fork has no email-receipt path,
 * `customerInfo.email` is never written and never reaches the order payload,
 * and `POST /placeOrder` carries no field for it. Collecting an address we
 * cannot transmit would be a privacy liability for a promise the kiosk cannot
 * keep, so the tile renders with the established coming-soon treatment, is
 * disabled at the DOM level, and collects nothing. Flagged for a data
 * contract before it is enabled.
 *
 * ADA (P9c, design-language, flagged — 1:3377 has no ADA variant): the
 * 1122px reach zone with the bell dropped. BACK stays at 40; title 120–232 ·
 * tiles 292–704 · NO THANKS keeps its 18px bottom distance (1012–1104). The
 * buffer and order-error surfaces are page-relative, so they follow along.
 */
export default function ReceiptPreferenceScreen() {
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

  const choose = useCallback(
    (choice: ReceiptChoice) => {
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
    [confirmAndPush, hasFailed, isPushing]
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

  return (
    <div
      data-testid="receipt-screen"
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
          className="absolute left-1/2 top-[135px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}

      <h1
        className={`tb-display absolute left-1/2 ${ada ? "top-[120px]" : "top-[666px]"} w-[880px] -translate-x-1/2 text-center text-[58px] leading-[56px] tracking-[-1.5px] text-tb-surface`}
      >
        {t("receipt.title")}
      </h1>

      <div
        className={`absolute left-1/2 ${ada ? "top-[292px]" : "top-[838px]"} flex -translate-x-1/2 gap-[24px]`}
      >
        <button
          type="button"
          data-testid="receipt-print"
          onClick={() => choose("print")}
          className="flex h-[412px] w-[412px] items-center justify-center rounded-[10px] bg-tb-surface px-[32px]"
        >
          <span className="tb-display text-center text-[36px] leading-[40px] tracking-[-1px] text-tb-purple">
            {t("receipt.print")}
          </span>
        </button>

        {/* EMAIL — INERT (see the header note): no handler, no input, no
            address collected. */}
        <div
          data-testid="receipt-email"
          aria-disabled="true"
          className="flex h-[412px] w-[412px] flex-col items-center justify-center gap-[16px] rounded-[10px] bg-tb-surface px-[32px] opacity-50"
        >
          <span className="tb-display text-center text-[36px] leading-[40px] tracking-[-1px] text-tb-purple">
            {t("receipt.email")}
          </span>
          <span className="text-center text-[22px] leading-[26px] font-bold uppercase tracking-[1px] text-tb-purple/70">
            {t("receipt.comingSoon")}
          </span>
        </div>
      </div>

      <button
        type="button"
        data-testid="receipt-none"
        onClick={() => choose("none")}
        className={`tb-display absolute left-[24px] ${ada ? "bottom-[18px]" : "top-[1810px]"} h-[92px] w-[1032px] rounded-[8px] border-2 border-tb-surface text-center text-[28px] leading-[28px] tracking-[1px] text-tb-surface`}
      >
        {t("receipt.none")}
      </button>

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
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-[40px] bg-tb-ink-purple/95 px-[90px] text-center"
        >
          <h2 className="tb-display text-[64px] leading-[60px] tracking-[-2px] text-tb-surface">
            {t(failedOnTimeout ? "orderError.uncertainTitle" : "orderError.title")}
          </h2>
          <p className="max-w-[820px] text-[30px] leading-[40px] text-tb-cream">
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
