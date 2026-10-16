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
 * Lazy (bagLazyParts). X and the scrim cancel; EDIT is inert at 0, and a
 * digit past N or "+" at N is dimmed and inert (the frame draws no disabled
 * key — design language, flagged for sign-off).
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
  // UX-13 (R20): EDIT at 0 and "+" at N are refusals — the value leaf re-keys
  // and shakes (never the control tapped); a change re-keys it with the bump.
  // A press that changes nothing (− at 0) keeps the node.
  const [refusals, setRefusals] = useState(0);
  const [refused, setRefused] = useState(false);
  const change = (next: string) => {
    if (next === digits) return;
    setDigits(next);
    setRefused(false);
  };
  const refuse = () => {
    setRefusals((n) => n + 1);
    setRefused(true);
  };
  const setValue = (k: number) => change(k > 0 ? String(k) : "");

  // A k past N never applies: those digits (the numpad's `accepts`) and "+"
  // at N render dimmed and aria-disabled, not live-looking keys that do
  // nothing (walk 2026-10-14). The numpad hands over value + key (or the
  // CLEAR / backspace result): strip leading zeros, ignore a k past N.
  const fits = (next: string) => Number(next) <= total;
  const atMax = value >= total;
  const handleKeys = (next: string) => {
    const normalised = next.replace(/^0+/, "");
    if (!fits(normalised)) return;
    change(normalised);
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
          picker region scrolls, so EDIT never leaves reach. bg-transparent:
          the scroller's box meets the card's anti-aliased top edge, so the
          white every other scroller paints (index.css, perf PAINT-1) would
          double that edge. */}
      <div className="tb-modal-enter absolute left-1/2 top-1/2 flex max-h-[calc(100%_-_96px)] w-[680px] flex-col overflow-hidden rounded-[16px] bg-tb-surface">
        <div className="flex min-h-0 flex-col items-center gap-[54px] overflow-y-auto bg-transparent px-[24px] pt-[97px]">
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
            <div className="flex w-[394px] items-center justify-between rounded-[57px] border-[2.5px] border-tb-grey-3 bg-tb-surface px-[30px] py-[29px]">
              <button
                type="button"
                data-testid="edit-how-many-decrease"
                aria-label={t("bag.decrease")}
                onClick={() => setValue(Math.max(0, value - 1))}
                className="flex h-[44px] w-[44px] items-center justify-center"
              >
                <img alt="" src={minusIcon} className="h-[36px] w-[36px]" />
              </button>
              {/* Re-keyed per value: each change replays the bump (motion-v2
                  MV7, the BagItemRow count pattern) — and per refusal, which
                  shakes it instead (UX-13). */}
              <p
                key={`${value}:${refusals}`}
                data-testid="edit-how-many-value"
                className={`min-w-[26px] text-center text-[30px] font-black leading-[24px] text-black ${
                  refused ? "tb-shake" : "tb-bump"
                }`}
              >
                {value}
              </p>
              <button
                type="button"
                data-testid="edit-how-many-increase"
                aria-label={t("bag.increase")}
                aria-disabled={atMax}
                onClick={() => (atMax ? refuse() : setValue(Math.min(total, value + 1)))}
                className={`flex h-[44px] w-[44px] items-center justify-center ${atMax ? "opacity-40" : ""}`}
              >
                <img alt="" src={plusIcon} className="h-[36px] w-[36px]" />
              </button>
            </div>
            <KioskNumpad
              value={digits}
              onChange={handleKeys}
              maxLength={String(total).length}
              accepts={fits}
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
            onClick={() => (value > 0 ? onConfirm(value) : refuse())}
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
