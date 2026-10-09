import { useState } from "react";
import { useTranslation } from "react-i18next";
import KioskKeyboard from "../keyboard/KioskKeyboard";
import closeIcon from "../../assets/icons/close.svg";
import "../../i18n/lazyCopy";

/** Fork parity (KioskInstructions): a 100-character note. */
const MAX_LENGTH = 100;

/** Fork parity: whitespace runs collapse to one space; never past the cap. */
const tidy = (text: string) => text.replace(/\s+/g, " ").slice(0, MAX_LENGTH);

export interface InstructionsSheetProps {
  /** The saved note — the draft starts from it. */
  initialValue: string;
  /** SAVE: the trimmed draft ("" removes the note). */
  onSave: (text: string) => void;
  /** X or the scrim: the draft is discarded. */
  onClose: () => void;
}

/**
 * Cooking instructions (audit-fixes U3) — design language, no frame
 * (sign-off): the 1:2814 SlotSelectionSheet shell over the purple 80 %
 * scrim, the CustomerName input box and the 1:3383 keyboard with its
 * opt-in space bar. The note rides `special_instructions` on both order
 * paths (orderBuilder.buildPushOrderPayload). Lazy (bagLazyParts), mounted
 * by BagSheet at z-50 inside the bag's z-40 context; ≈ 920 px tall, so it
 * fits the 1026 px ADA cap. Arabic sessions type Latin (the keyboard has
 * no Arabic layer — recorded).
 */
export default function InstructionsSheet({
  initialValue,
  onSave,
  onClose,
}: InstructionsSheetProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => tidy(initialValue));

  return (
    <div className="absolute inset-0 z-50" data-testid="instructions-sheet">
      {/* The scrim never animates (motion D-M3); the panel rises (tb-sheet-enter). */}
      <button
        type="button"
        data-testid="instructions-scrim"
        aria-label={t("language.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="instructions-title"
        className="tb-sheet-enter absolute bottom-0 left-0 flex max-h-[min(1500px,calc(100%_-_96px))] w-[1080px] flex-col items-center gap-[40px] rounded-t-[60px] bg-tb-surface px-[24px] pb-[24px] pt-[54px]"
      >
        <h2
          id="instructions-title"
          className="tb-display px-[72px] text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
        >
          {t("bag.instructions.title")}
        </h2>
        <button
          type="button"
          data-testid="instructions-close"
          aria-label={t("language.close")}
          onClick={onClose}
          className="absolute right-[44px] top-[44px] h-[48px] w-[48px] min-h-[44px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div className="flex w-[844px] flex-col items-end gap-[12px]">
          {/* The keyboard-driven field (house pattern: loyalty-phone-display,
              country-search). dir="auto" only for the guest's note: the
              placeholder keeps the box's left edge in Arabic, like the
              CustomerName and /phone boxes (P9f S2). */}
          <p
            data-testid="instructions-input"
            role="textbox"
            aria-readonly="true"
            aria-label={t("bag.instructions.title")}
            aria-describedby="instructions-counter"
            dir={draft ? "auto" : undefined}
            className="min-h-[100px] w-full rounded-[10px] border-2 border-tb-purple-vibrant bg-tb-surface px-[28px] py-[30px] text-start text-[32px] font-medium leading-[36px] text-black [overflow-wrap:anywhere]"
          >
            {draft || (
              <span className="text-black/55">
                {t("bag.instructionsSheet.placeholder")}
              </span>
            )}
          </p>
          <p
            id="instructions-counter"
            data-testid="instructions-counter"
            className="text-[20px] leading-[24px] text-tb-ink-purple"
          >
            {t("bag.instructionsSheet.counter", {
              count: draft.length,
              max: MAX_LENGTH,
            })}
          </p>
        </div>

        <KioskKeyboard
          value={draft}
          onChange={(next) => setDraft(tidy(next))}
          maxLength={MAX_LENGTH}
          space
        />

        <div className="flex w-full gap-[24px]">
          <button
            type="button"
            data-testid="instructions-clear"
            onClick={() => setDraft("")}
            className="tb-display min-h-[44px] flex-1 rounded-[8px] border border-tb-purple py-[32px] text-center text-[24px] leading-[32px] text-tb-purple"
          >
            {t("keyboard.clear")}
          </button>
          <button
            type="button"
            data-testid="instructions-save"
            onClick={() => onSave(draft.trim())}
            className="tb-display min-h-[44px] flex-1 rounded-[8px] bg-tb-purple py-[32px] text-center text-[24px] leading-[32px] text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)]"
          >
            {t("bag.instructionsSheet.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
