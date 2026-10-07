import { useState } from "react";
import { useTranslation } from "react-i18next";
import KioskNumpad from "../keyboard/KioskNumpad";
import useLocalized from "../../hooks/utils/useLocalized";
import closeIcon from "../../assets/icons/close.svg";
import minusIcon from "../../assets/icons/qty-minus.svg";
import plusIcon from "../../assets/icons/qty-plus.svg";
import "../../i18n/lazyCopy";

interface EditHowManyModalProps {
  /** The paid bag row being edited (quantity N > 1). */
  row: unknown;
  onCancel: () => void;
  /** k in [1, N]: edit k of the row's N units (k = N = today's whole-row edit). */
  onConfirm: (editQuantity: number) => void;
}

/**
 * "EDIT HOW MANY" — Figma 'My Bag / Order Summary / Edit' (1:4460): "You have
 * N × name — choose how many you want to edit", a 0…N quantity pill and the
 * 1:4174 numpad family (KioskNumpad). A SPLIT edit, not a quantity setter.
 * Figma draws it over the menu; it opens inside the bag (z-50, like
 * RemoveItemModal) — design-language placement, flagged for sign-off.
 * Lazy (bagLazyParts). X and the scrim cancel; EDIT is inert at 0.
 */
export default function EditHowManyModal({
  row,
  onCancel,
  onConfirm,
}: EditHowManyModalProps) {
  const { t } = useTranslation();
  const { name } = useLocalized();
  const total = Math.max(
    0,
    Math.trunc(Number((row as { quantity?: unknown } | null)?.quantity) || 0),
  );
  // "" is 0: a leading "0" would fill KioskNumpad's maxLength (it counts
  // characters) and block the first key of a one-digit N.
  const [digits, setDigits] = useState("");
  const value = Number(digits);
  const setValue = (k: number) => setDigits(k > 0 ? String(k) : "");

  // The numpad hands over value + key (or the CLEAR / backspace result):
  // strip leading zeros and ignore a key that would pass N.
  const handleKeys = (next: string) => {
    const normalised = next.replace(/^0+/, "");
    if (Number(normalised) > total) return;
    setDigits(normalised);
  };

  return (
    <div
      className="absolute inset-0 z-50"
      data-testid="edit-how-many"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-how-many-title"
      aria-describedby="edit-how-many-body"
    >
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={onCancel}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* Capped by the bag (the 1122 reach zone in ADA): only the copy +
          picker region scrolls, so EDIT never leaves reach. */}
      <div className="tb-modal-enter absolute left-1/2 top-1/2 flex max-h-[calc(100%_-_96px)] w-[680px] flex-col overflow-hidden rounded-[16px] bg-tb-surface">
        <div className="flex min-h-0 flex-col items-center gap-[54px] overflow-y-auto px-[24px] pt-[97px]">
          <div className="flex w-[504px] flex-col items-center gap-[16px] text-center">
            <h2
              id="edit-how-many-title"
              className="tb-display text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
            >
              {t("bag.editHowMany.title", { qty: total, name: name(row) })}
            </h2>
            <p
              id="edit-how-many-body"
              className="text-[28px] leading-[32px] text-tb-ink-purple"
            >
              {t("bag.editHowMany.body")}
            </p>
          </div>
          <div className="flex w-[632px] flex-col items-center gap-[42px]">
            {/* 2 + 29 + 44 + 29 + 2 = Figma's 106 px pill (the 2.5 px border renders 2). */}
            <div className="flex w-[394px] items-center justify-between rounded-[57px] border-[2.5px] border-[#b9b9b9] bg-tb-surface px-[30px] py-[29px]">
              <button
                type="button"
                data-testid="edit-how-many-decrease"
                aria-label={t("bag.decrease")}
                onClick={() => setValue(Math.max(0, value - 1))}
                className="flex h-[44px] w-[44px] items-center justify-center"
              >
                <img alt="" src={minusIcon} className="h-[36px] w-[36px]" />
              </button>
              <p
                data-testid="edit-how-many-value"
                className="min-w-[26px] text-center text-[30px] font-black leading-[24px] text-black"
              >
                {value}
              </p>
              <button
                type="button"
                data-testid="edit-how-many-increase"
                aria-label={t("bag.increase")}
                onClick={() => setValue(Math.min(total, value + 1))}
                className="flex h-[44px] w-[44px] items-center justify-center"
              >
                <img alt="" src={plusIcon} className="h-[36px] w-[36px]" />
              </button>
            </div>
            <KioskNumpad
              value={digits}
              onChange={handleKeys}
              maxLength={String(total).length}
            />
          </div>
        </div>
        <div className="shrink-0 px-[24px] pb-[24px] pt-[54px]">
          {/* autoFocus: the dialog takes focus (aria-disabled stays focusable). */}
          <button
            type="button"
            data-testid="edit-how-many-confirm"
            autoFocus
            aria-disabled={value === 0}
            onClick={() => {
              if (value > 0) onConfirm(value);
            }}
            className={`tb-display h-[96px] w-full rounded-[8px] bg-tb-purple text-center text-[24px] leading-[32px] text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)] ${
              value === 0 ? "opacity-40" : ""
            }`}
          >
            {t("bag.edit")}
          </button>
        </div>
        <button
          type="button"
          data-testid="edit-how-many-close"
          aria-label={t("language.close")}
          onClick={onCancel}
          className="absolute right-[25px] top-[25px] h-[48px] w-[48px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>
      </div>
    </div>
  );
}
