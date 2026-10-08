import { useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { CountryPickerSheetProps } from "./CountryPickerSheet";

type CountryPickerSheetComponent = ComponentType<CountryPickerSheetProps>;

/** The sheet once its code has arrived: every later open renders it at once. */
let loadedSheet: CountryPickerSheetComponent | null = null;
let pendingLoad: Promise<CountryPickerSheetComponent | null> | null = null;

/**
 * Starts (or joins) the sheet's load from the ONE lazy UI chunk; null = it did
 * not arrive. Plain `await import()` (loadPdpLazyParts' pattern), never
 * `.then` and never React.lazy: a prevented `vite:preloadError` resolves the
 * import to undefined, and Suspense's reveal timer stalls under a frozen e2e
 * clock. A chunk WITHOUT the export (other suites mock it) counts as not
 * loaded. A failure clears the pending load, so only the next host mount
 * retries; chunkRecovery owns the healing reload.
 */
function loadCountryPickerSheet(): Promise<CountryPickerSheetComponent | null> {
  pendingLoad ??= (async () => {
    try {
      const parts: { CountryPickerSheet?: CountryPickerSheetComponent } | undefined =
        await import("../cart/bagLazyParts");
      if (parts?.CountryPickerSheet) return (loadedSheet = parts.CountryPickerSheet);
    } catch {
      // The dev server's rejected import (a build resolves undefined instead).
    }
    pendingLoad = null;
    return null;
  })();
  return pendingLoad;
}

interface CountryPickerProps {
  open: boolean;
  onClose: () => void;
  /** The host's z layer: z-40 on /phone, z-[70] over the rewards login (z-60). */
  layerClass: string;
}

/**
 * The country picker's boot-path host (audit-fixes UB5): /phone and the
 * rewards-login modal render it always, so the sheet's code starts loading
 * when the host shows — never at the tap. Until it arrives (or if it never
 * does) an open picker is a named scrim that closes on tap, and the current
 * country (+91 by default) keeps working.
 */
export default function CountryPicker({ open, onClose, layerClass }: CountryPickerProps) {
  const { t } = useTranslation();
  const [Sheet, setSheet] = useState<CountryPickerSheetComponent | null>(() => loadedSheet);

  useEffect(() => {
    if (Sheet) return;
    let live = true;
    const load = async () => {
      const sheet = await loadCountryPickerSheet();
      if (live && sheet) setSheet(() => sheet);
    };
    void load();
    return () => {
      live = false;
    };
  }, [Sheet]);

  if (!open) return null;
  return (
    <div className={`absolute inset-0 ${layerClass}`}>
      {Sheet ? (
        <Sheet onClose={onClose} />
      ) : (
        <button
          type="button"
          data-testid="country-loading"
          aria-label={t("language.close")}
          onClick={onClose}
          className="absolute inset-0 h-full w-full bg-tb-purple/80"
        />
      )}
    </div>
  );
}
