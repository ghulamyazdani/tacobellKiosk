import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import shiftIcon from "../../assets/icons/key-shift.svg";
import backspaceIcon from "../../assets/icons/key-backspace.svg";

const LETTER_ROWS: string[][] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
];
const LETTER_ROW3 = ["z", "x", "c", "v", "b", "n", "m"];
const DIGIT_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["-", "_", "@", ".", ",", "!", "&", "#", "+"],
];
const DIGIT_ROW3 = ["*", "(", ")", "'", ":", ";", "/"];

interface KioskKeyboardProps {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  /** GO key — omitted when the screen provides its own primary CTA. */
  onSubmit?: () => void;
}

/**
 * On-screen keyboard — Figma "Email Receipt" keyboard (1:3383 / 1:4231):
 * vibrant-purple letter keys with the chunky black border (2px sides,
 * 5px base), grey special keys (shift / backspace / 123 / GO), 40px bold
 * glyphs, QWERTY + digit/symbol layer. All keys ≥44px targets (Rule 4).
 */
export default function KioskKeyboard({
  value,
  onChange,
  maxLength = 64,
  onSubmit,
}: KioskKeyboardProps) {
  const { t } = useTranslation();
  const [shift, setShift] = useState(false);
  const [digits, setDigits] = useState(false);

  const press = useCallback(
    (key: string) => {
      if (value.length >= maxLength) return;
      onChange(value + (shift ? key.toUpperCase() : key));
      if (shift) setShift(false); // single-shot shift, like a phone keyboard
    },
    [value, onChange, maxLength, shift]
  );
  const backspace = useCallback(
    () => onChange(value.slice(0, -1)),
    [value, onChange]
  );

  const keyBase =
    "flex h-[90px] items-center justify-center rounded-[10px] border-2 border-b-[5px] border-black min-h-[44px] min-w-[44px] active:translate-y-[2px] active:border-b-2";
  const letterKey = `${keyBase} w-[70px] bg-tb-purple-vibrant`;
  const specialKey = `${keyBase} bg-tb-grey-4`;

  const rows = digits ? DIGIT_ROWS : LETTER_ROWS;
  const row3 = digits ? DIGIT_ROW3 : LETTER_ROW3;

  const renderCharKey = (key: string) => (
    <button
      key={key}
      type="button"
      aria-label={key}
      onClick={() => press(key)}
      className={letterKey}
    >
      <span className="text-[40px] font-bold uppercase leading-none text-tb-surface">
        {shift ? key.toUpperCase() : key}
      </span>
    </button>
  );

  return (
    <div data-testid="kiosk-keyboard" className="flex w-full flex-col items-center gap-[23px]">
      {rows.map((row, i) => (
        <div key={i} className="flex justify-center gap-[16px]">
          {row.map(renderCharKey)}
        </div>
      ))}
      <div className="flex justify-center gap-[16px]">
        <button
          type="button"
          aria-label={t("keyboard.shift")}
          aria-pressed={shift}
          onClick={() => setShift((s) => !s)}
          className={`${specialKey} w-[113px] ${shift ? "bg-tb-yellow" : ""}`}
        >
          <img alt="" src={shiftIcon} className="h-[54px] w-[54px]" />
        </button>
        {row3.map(renderCharKey)}
        <button
          type="button"
          aria-label={t("keyboard.backspace")}
          onClick={backspace}
          className={`${specialKey} w-[113px]`}
        >
          <img alt="" src={backspaceIcon} className="h-[54px] w-[54px]" />
        </button>
      </div>
      <div className="flex w-[844px] items-center justify-between">
        <button
          type="button"
          aria-label={t("keyboard.layerToggle")}
          onClick={() => setDigits((d) => !d)}
          className={`${specialKey} w-[199px]`}
        >
          <span className="text-[40px] font-bold uppercase leading-none text-black">
            {digits ? "abc" : "123"}
          </span>
        </button>
        {onSubmit && (
          <button
            type="button"
            data-testid="keyboard-go"
            onClick={onSubmit}
            className={`${specialKey} w-[199px]`}
          >
            <span className="text-[40px] font-bold uppercase leading-none text-black">
              {t("keyboard.go")}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
