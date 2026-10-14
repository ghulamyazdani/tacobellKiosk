import { useTranslation } from "react-i18next";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

interface CancelOrderModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * NO's label. Figma's NO, BACK TO MENU (the default) is true over the menu;
   * a checkout step NO returns to passes cancelOrder.back, NO, BACK (user
   * 2026-10-14: on the phone screen "the button should say back not back to
   * menu").
   */
  keepLabel?: string;
}

/**
 * "CONFIRM CANCELLATION" — Figma cancel-order (1:4552).
 * Purely presentational confirm dialog: the caller owns the open state, the
 * teardown (resetSession("full") + navigate("/start")) lives in the confirm
 * handler passed in — this component never touches Redux (P7a locked
 * decision 4: no teardown without confirm).
 * Centered modal, so the shared `tb-modal-enter` keyframe (which ends at
 * translate(-50%,-50%)) is the correct entrance. CSS entrance only.
 * Analytics (audit-fixes B3, fork StartOverConfirmationModal): YES sends
 * StartOverAffirmFromFooter + KioskReset, NO and the backdrop
 * StartOverCancelFromFooter + AccountSignoutCancel — before the callbacks.
 * Focus moves in on NO (NO, BACK TO MENU, or the host's keepLabel): the safe
 * choice (WAI-ARIA APG), so a keypad Enter never wipes the order.
 */
export default function CancelOrderModal({
  open,
  onConfirm,
  onCancel,
  keepLabel,
}: CancelOrderModalProps) {
  const { t } = useTranslation();
  const keepText = keepLabel ?? t("cancelOrder.cancel");

  if (!open) return null;

  const confirm = () => {
    const route_path = window.location.pathname;
    captureKioskEvent(KioskEventName.StartOverAffirmFromFooter, { route_path });
    captureKioskEvent(KioskEventName.KioskReset, {
      reason: "user_start_over",
      route_path,
    });
    onConfirm();
  };
  const keep = () => {
    captureKioskEvent(KioskEventName.StartOverCancelFromFooter, {});
    captureKioskEvent(KioskEventName.AccountSignoutCancel, {});
    onCancel();
  };

  return (
    <div
      className="absolute inset-0 z-50"
      data-testid="cancel-order-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-order-title"
    >
      {/* Backdrop tap = keep the order (same dismiss affordance as NO). */}
      <button
        type="button"
        aria-label={keepText}
        onClick={keep}
        className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70"
      />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 w-[676px] rounded-[12px] bg-tb-surface px-[44px] pb-[44px] pt-[56px] text-center">
        <h2
          id="cancel-order-title"
          className="tb-display mb-[24px] text-[40px] leading-[1.1] tracking-[-1px] text-tb-purple"
        >
          {t("cancelOrder.title")}
        </h2>
        <p className="mb-[48px] text-[26px] leading-[1.3] text-black">
          {t("cancelOrder.body")}
        </p>
        <div className="flex items-stretch justify-center gap-[20px]">
          <button
            type="button"
            data-testid="cancel-order-cancel"
            autoFocus
            onClick={keep}
            className="min-h-[56px] min-w-[280px] rounded-[6px] border-2 border-tb-purple bg-tb-surface px-[24px] py-[14px] text-[20px] font-bold uppercase tracking-[1px] text-tb-purple"
          >
            {keepText}
          </button>
          <button
            type="button"
            data-testid="cancel-order-confirm"
            onClick={confirm}
            className="min-h-[56px] min-w-[280px] rounded-[6px] bg-tb-red active:bg-tb-red-press px-[24px] py-[14px] text-[20px] font-bold uppercase tracking-[1px] text-tb-surface"
          >
            {t("cancelOrder.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
