import { useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import CountryCodes from "@cx-sdk/core/data/CountryCodes";
import {
  selectCountryCode,
  setCountryCode,
} from "@cx-sdk/core/auth/authentication.slice";
import KioskKeyboard from "../keyboard/KioskKeyboard";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import { isolate, isRtl } from "../../i18n";
// Lazy-only copy (country.*): registered when this chunk evaluates.
import "../../i18n/lazyCopy";
import closeIcon from "../../assets/icons/close.svg";
import inputClear from "../../assets/icons/input-clear.svg";
// ?no-inline: emitted as a precached file (SlotSelectionSheet's D7 precedent).
import radioCheckIcon from "../../assets/icons/radio-check.svg?no-inline";

export interface CountryPickerSheetProps {
  onClose: () => void;
}

/** One pickable country: what `auth.selectedCountryCode` stores, plus its names. */
interface CountryRow {
  code: string;
  name: string;
  /** "+NN…" with the table's embedded spaces removed. */
  dialCode: string;
  min: number;
  max: number;
}

interface ShownRow extends CountryRow {
  /** The localized name the row shows (else the table name). */
  label: string;
  /** Folded search keys: the localized, English (Intl) and table names. */
  keys: string[];
}

/** The search box never needs more than a country name. */
const SEARCH_MAX_LENGTH = 32;

/**
 * The SDK table, made pickable: entries whose space-stripped dial code is not
 * `+digits` (Antarctica's null, Åland's "") or that have no code are dropped,
 * and one row is kept per ISO code (Israel is listed twice) — 239 rows.
 */
const COUNTRY_ROWS: readonly CountryRow[] = (() => {
  const seen = new Set<string>();
  const rows: CountryRow[] = [];
  for (const entry of CountryCodes) {
    const dialCode = String(entry.dial_code ?? "").replace(/\s/g, "");
    if (!/^\+\d+$/.test(dialCode) || !entry.code || seen.has(entry.code)) continue;
    seen.add(entry.code);
    rows.push({
      code: entry.code,
      name: entry.name,
      dialCode,
      min: Number(entry.min) || 0,
      max: Number(entry.max) || 0,
    });
  }
  return rows;
})();

/** Case-, accent- and space-insensitive form for matching. */
const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s/g, "");

/** Intl region names; null when the runtime cannot build them (Rule 2). */
const regionNames = (lang: string) => {
  try {
    return new Intl.DisplayNames([lang], { type: "region", fallback: "none" });
  } catch {
    return null;
  }
};

const regionName = (names: Intl.DisplayNames | null, code: string) => {
  try {
    return names?.of(code);
  } catch {
    return undefined;
  }
};

const comparer = (lang: string): ((a: string, b: string) => number) => {
  try {
    return new Intl.Collator(lang).compare;
  } catch {
    return (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  }
};

/**
 * Country-code picker — /phone's "+91" pill and the rewards-login modal's
 * chip open it (audit-fixes UB5). No Figma frame: design language on the
 * Select Language (1:4488) and selection-sheet (1:2814) shells, flagged for
 * client sign-off. The host (CountryPicker) sets the layer and loads this
 * file through the ONE lazy chunk (bagLazyParts).
 *
 * Rows come from the SDK table (COUNTRY_ROWS), labelled in the UI language
 * by `Intl.DisplayNames` (the table name when Intl has none), the selected
 * country first, then A→Z by `Intl.Collator`. No flags: a runtime flag CDN
 * breaks offline (the fork's flagsapi.com). Search is a display box driven by
 * the on-screen keyboard (Rule 5): it matches the localized name, the English
 * name or the dial digits ("971" / "+971"), ignoring case, accents and spaces
 * — so the keyboard needs no space key, and an Arabic session finds a
 * country by typing its English name.
 *
 * A row tap stores `{code, dialCode, min, max, picked: true}` — the keypad
 * cap, the length check and every Xeno call follow it; `picked` keeps the
 * deployment default from overwriting it (useAppSettings) and the session
 * reset ends it with the guest. The typed digits are the host's and stay
 * (fork parity). Scrim / X close without writing anything.
 */
export default function CountryPickerSheet({ onClose }: CountryPickerSheetProps) {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const selected = useSelector(selectCountryCode) as { code?: string } | undefined;
  const selectedCode = selected?.code;
  const lang = i18n.language || "en";
  const rtl = isRtl(lang);

  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<ShownRow[]>(() => {
    const localNames = regionNames(lang);
    const englishNames = regionNames("en");
    const compare = comparer(lang);
    const shown = COUNTRY_ROWS.map((row) => {
      const label = regionName(localNames, row.code) ?? row.name;
      const english = regionName(englishNames, row.code) ?? row.name;
      return { ...row, label, keys: [label, english, row.name].map(fold) };
    });
    return shown.sort((a, b) =>
      a.code === selectedCode ? -1 : b.code === selectedCode ? 1 : compare(a.label, b.label)
    );
  }, [lang, selectedCode]);

  const needle = fold(query);
  const digits = needle.replace(/^\+/, "");
  const matches = !digits
    ? rows
    : rows.filter(
        (row) =>
          row.keys.some((key) => key.includes(needle)) ||
          (/^\d+$/.test(digits) && row.dialCode.slice(1).startsWith(digits))
      );

  const changeQuery = (next: string) => {
    setQuery(next);
    // A new search starts at the top of its results.
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const dismiss = () => {
    captureKioskEvent(KioskEventName.CountryCodeSelectionDismissed, {});
    onClose();
  };

  const pick = (row: ShownRow) => {
    captureKioskEvent(KioskEventName.CountryCodeSelected, {
      country_code: row.code,
      dial_code: row.dialCode,
    });
    dispatch(
      setCountryCode({
        code: row.code,
        dialCode: row.dialCode,
        min: row.min,
        max: row.max,
        picked: true,
      })
    );
    onClose();
  };

  // Render helper, NOT a component (react-hooks/static-components).
  const renderRow = (row: ShownRow) => {
    const isPicked = row.code === selectedCode;
    return (
      <button
        key={row.code}
        type="button"
        data-testid={`country-${row.code}`}
        aria-pressed={isPicked}
        onClick={() => pick(row)}
        className="flex min-h-[96px] w-full items-center gap-[24px] border-t border-tb-grey-4 px-[24px] py-[16px]"
      >
        {/* A shrink-to-fit dir="auto" leaf (P9f S2): an Arabic name keeps
            the list's left edge instead of hugging the dial code. */}
        <span className="min-w-0 flex-1">
          <span
            dir="auto"
            className="block w-fit max-w-full text-start text-[32px] font-medium leading-[36px] tracking-[-1px] text-black"
          >
            {rtl ? isolate(row.label) : row.label}
          </span>
        </span>
        <span
          dir="ltr"
          className="shrink-0 text-[28px] font-medium leading-[32px] text-tb-ink-purple"
        >
          {row.dialCode}
        </span>
        {/* Figma Radio 1:401/1:402 (SlotSelectionSheet): 36 px; a 1 px purple
            ring, or the purple fill with the exported check at 24 px. */}
        <span
          aria-hidden="true"
          className={`flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full ${
            isPicked ? "bg-tb-purple" : "border border-tb-purple bg-tb-surface"
          }`}
        >
          {isPicked && <img alt="" src={radioCheckIcon} className="tb-pop-in h-[24px] w-[24px]" />}
        </span>
      </button>
    );
  };

  return (
    <div
      className="absolute inset-0"
      data-testid="country-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="country-sheet-title"
    >
      {/* Pure-CSS entrance: the panel rises (tb-sheet-enter); the scrim never
          animates (motion D-M3). The sheet unmounts at once on close. */}
      <button
        type="button"
        data-testid="country-sheet-scrim"
        aria-label={t("language.close")}
        onClick={dismiss}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* A fixed height, not max-h: the title and the search box must not
          jump while the results shrink under the guest's typing. The cap is
          1:2814's — 1500 on the 1920 stage, 1026 in the 1122 ADA zone; only
          the list scrolls. */}
      <div className="tb-sheet-enter absolute bottom-0 left-0 flex h-[min(1500px,calc(100%_-_96px))] w-[1080px] flex-col gap-[24px] rounded-t-[60px] bg-tb-surface px-[24px] pb-[24px] pt-[54px]">
        <h2
          id="country-sheet-title"
          className="tb-display px-[72px] text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
        >
          {t("country.title")}
        </h2>
        <button
          type="button"
          data-testid="country-sheet-close"
          aria-label={t("language.close")}
          onClick={dismiss}
          className="absolute right-[44px] top-[44px] h-[48px] w-[48px] min-h-[44px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div className="flex h-[88px] shrink-0 items-center gap-[16px] rounded-[10px] border-2 border-tb-purple-vibrant px-[28px]">
          <span
            data-testid="country-search"
            role="textbox"
            aria-readonly="true"
            aria-label={t("country.search")}
            className="min-w-0 flex-1 truncate text-start text-[28px] font-medium leading-[32px] text-black"
          >
            {query || <span className="text-black/55">{t("country.search")}</span>}
          </span>
          {query.length > 0 && (
            <button
              type="button"
              data-testid="country-search-clear"
              aria-label={t("keyboard.clear")}
              onClick={() => changeQuery("")}
              className="h-[44px] w-[44px] shrink-0 p-[10px]"
            >
              <img alt="" src={inputClear} className="h-full w-full" />
            </button>
          )}
        </div>

        <div
          ref={listRef}
          data-testid="country-list"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {matches.length > 0 ? (
            matches.map(renderRow)
          ) : (
            <p
              data-testid="country-no-results"
              className="px-[24px] py-[32px] text-center text-[28px] leading-[36px] text-tb-ink-purple"
            >
              {t("country.noResults", { query })}
            </p>
          )}
        </div>

        <div className="shrink-0">
          <KioskKeyboard
            value={query}
            onChange={changeQuery}
            maxLength={SEARCH_MAX_LENGTH}
          />
        </div>
      </div>
    </div>
  );
}
