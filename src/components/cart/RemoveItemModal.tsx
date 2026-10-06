import { useTranslation } from "react-i18next";

interface RemoveItemModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * REMOVE ITEM confirm — Figma "remove item" (1:4533): centered white card
 * over a purple wash, outlined "NO, BACK TO CART" + red filled "YES,
 * DELETE" (bg-tb-red token, added in the P7a index.css pass).
 *
 * Purely presentational (reusable confirm shape — CancelOrderModal is its
 * sibling): the caller owns what confirm/cancel actually dispatch. Centered
 * modal, so the shared position-dependent tb-modal-enter keyframe applies.
 */
export default function RemoveItemModal({
  open,
  onCancel,
  onConfirm,
}: RemoveItemModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-50"
      data-testid="remove-item-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-item-title"
    >
      <button
        type="button"
        aria-label={t("removeItem.cancel")}
        onClick={onCancel}
        className="absolute inset-0 h-full w-full bg-tb-purple/60"
      />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 w-[760px] rounded-[16px] bg-tb-surface px-[48px] pb-[56px] pt-[72px] text-center">
        <h2
          id="remove-item-title"
          className="tb-display mb-[24px] text-[40px] leading-[40px] tracking-[-1px] text-tb-purple"
        >
          {t("removeItem.title")}
        </h2>
        <p className="mx-auto mb-[56px] max-w-[520px] text-[26px] leading-[34px] text-black">
          {t("removeItem.body")}
        </p>
        <div className="flex items-center justify-center gap-[24px]">
          <button
            type="button"
            data-testid="remove-item-cancel"
            onClick={onCancel}
            className="tb-display min-h-[64px] min-w-[280px] rounded-[4px] border border-tb-purple px-[32px] py-[20px] text-[18px] leading-[20px] text-tb-purple"
          >
            {t("removeItem.cancel")}
          </button>
          <button
            type="button"
            data-testid="remove-item-confirm"
            onClick={onConfirm}
            className="tb-display min-h-[64px] min-w-[280px] rounded-[4px] bg-tb-red px-[32px] py-[20px] text-[18px] leading-[20px] text-tb-surface"
          >
            {t("removeItem.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
