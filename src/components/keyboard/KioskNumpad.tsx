import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import backspaceIcon from "../../assets/icons/key-backspace.svg";

const DIGIT_ROWS: string[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];

interface KioskNumpadProps {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  /** GO key — omitted when the screen provides its own primary CTA. */
  onSubmit?: () => void;
  /**
   * Phone keypads (UB5, fork NumberKeyboard parity): a FIRST "0" is ignored
   * (a trunk prefix such as UAE's "05…" would fill the cap and pass the
   * length check with a wrong number); later zeros are kept. Off by default
   * — the tent number and the edit-how-many count take any digit.
   */
  noLeadingZero?: boolean;
  /**
   * The edit-how-many cap: a digit whose next value this rejects can never
   * apply, so it renders dimmed and inert (aria-disabled — focus stays put)
   * instead of looking live and doing nothing. Omitted (phone, OTP, tent):
   * every digit stays live, as before.
   */
  accepts?: (next: string) => boolean;
}

/**
 * Numeric on-screen keypad — Figma "Rewards / enter code" (1:4174):
 * 3×3 vibrant-purple digit keys with the chunky black border (2px sides,
 * 5px base) and 40px bold glyphs, then CLEAR (grey) / 0 (purple) /
 * backspace (grey, key-backspace.svg). Key treatment, sizing rhythm and
 * prop shape deliberately mirror KioskKeyboard so the two keyboards read
 * as one family; used by the loyalty phone entry and the 4-digit OTP step.
 * All keys are ≥44px targets (Rule 4). Pressed: as KioskKeyboard (Key set
 * 1:1053 — travel plus #883ED2 digits / Grey 3 specials, no squeeze).
 */
export default function KioskNumpad({
  value,
  onChange,
  maxLength = 16,
  onSubmit,
  noLeadingZero = false,
  accepts,
}: KioskNumpadProps) {
  const { t } = useTranslation();

  const press = useCallback(
    (key: string) => {
      if (value.length >= maxLength) return;
      if (noLeadingZero && key === "0" && value.length === 0) return;
      if (accepts && !accepts(value + key)) return;
      onChange(value + key);
    },
    [value, onChange, maxLength, noLeadingZero, accepts]
  );
  const backspace = useCallback(
    () => onChange(value.slice(0, -1)),
    [value, onChange]
  );
  const clear = useCallback(() => onChange(""), [onChange]);

  const keyShape =
    "tb-no-press flex h-[90px] items-center justify-center rounded-[10px] border-2 border-b-[5px] border-black min-h-[44px] min-w-[44px]";
  const keyBase = `${keyShape} active:translate-y-[2px] active:border-b-2`;
  const digitKey = `${keyBase} w-[120px] bg-tb-purple-vibrant active:bg-tb-purple-press`;
  // A digit that cannot apply: dimmed like EDIT at 0 and the bag's capped
  // "+" (opacity-40), with no press travel or pressed fill.
  const offDigitKey = `${keyShape} w-[120px] bg-tb-purple-vibrant opacity-40`;
  const specialKey = `${keyBase} w-[120px] bg-tb-grey-4 active:bg-tb-grey-3`;

  const renderDigit = (digit: string) => {
    const off = accepts ? !accepts(value + digit) : false;
    return (
      <button
        key={digit}
        type="button"
        data-testid={`numpad-key-${digit}`}
        aria-label={digit}
        aria-disabled={off || undefined}
        onClick={() => press(digit)}
        className={off ? offDigitKey : digitKey}
      >
        <span className="text-[40px] font-bold leading-none text-tb-surface">
          {digit}
        </span>
      </button>
    );
  };

  return (
    <div
      data-testid="kiosk-numpad"
      dir="ltr"
      className="flex w-[400px] flex-col items-center gap-[20px]"
    >
      {DIGIT_ROWS.map((row, i) => (
        <div key={i} className="flex justify-center gap-[20px]">
          {row.map(renderDigit)}
        </div>
      ))}
      <div className="flex justify-center gap-[20px]">
        <button
          type="button"
          data-testid="numpad-clear"
          aria-label={t("keyboard.clear")}
          onClick={clear}
          className={specialKey}
        >
          <span className="text-[28px] font-bold uppercase leading-none text-black">
            {t("keyboard.clear")}
          </span>
        </button>
        {renderDigit("0")}
        <button
          type="button"
          data-testid="numpad-backspace"
          aria-label={t("keyboard.backspace")}
          onClick={backspace}
          className={specialKey}
        >
          <img alt="" src={backspaceIcon} className="h-[54px] w-[54px]" />
        </button>
      </div>
      {onSubmit && (
        <button
          type="button"
          data-testid="numpad-go"
          onClick={onSubmit}
          className={`${keyBase} w-[400px] bg-tb-grey-4 active:bg-tb-grey-3`}
        >
          <span className="text-[40px] font-bold uppercase leading-none text-black">
            {t("keyboard.go")}
          </span>
        </button>
      )}
    </div>
  );
}
