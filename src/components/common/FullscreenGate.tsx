import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectMandatoryFullscreen } from "@cx-sdk/catalog/state/appSettings.slice";
import { selectCurrentToken } from "@cx-sdk/core/auth/authentication.slice";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/**
 * ponytail: calibration knob — a window that fills its screen can report a
 * pixel or two less than `screen` (fractional device-pixel ratios round);
 * raise it if a kiosk panel in --kiosk mode still shows the gate.
 */
export const FULLSCREEN_FILL_TOLERANCE_PX = 2;

/**
 * Locked = an element is fullscreen (the Fullscreen API), OR the browser
 * itself runs fullscreen (`display-mode: fullscreen`), OR the window fills
 * its screen — Chrome `--kiosk` and F11 leave `fullscreenElement` null.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the gate's predicate, pinned by its test; HMR falls back to a reload for this file
export function isFullscreenLocked(): boolean {
  if (document.fullscreenElement) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  return (
    window.innerWidth >= window.screen.width - FULLSCREEN_FILL_TOLERANCE_PX &&
    window.innerHeight >= window.screen.height - FULLSCREEN_FILL_TOLERANCE_PX
  );
}

/**
 * The fullscreen lock (audit-fixes U2; the fork's FullscreenPrompt, no Figma
 * frame — design language: the frameless offline screen). While the
 * operator's `mandatoryFullscreen` is on (default; the Activity Center turns
 * it off behind the passcode) and the kiosk is registered (a redux token —
 * Registration is never gated), a window that is not locked is covered by
 * ONE full-window button: a tap enters fullscreen and the guest is back
 * where they were. Every failure — no Fullscreen API, a refusal — takes the
 * gate down for this page load and reports it: the guest is NEVER blocked
 * (Rule 2); the next page load re-arms it. No storage (Rule 3), no
 * context-menu handling (App blocks it). ponytail: Escape / F11 still leave
 * fullscreen (browser-reserved; a kiosk has no keyboard) — the Keyboard Lock
 * API (navigator.keyboard.lock) if a USB keyboard is ever attached.
 * z-[99998]: above everything in the stage (it lives outside it), below the
 * offline overlay (z-[99999]).
 */
export default function FullscreenGate() {
  const { t } = useTranslation();
  const mandatory = Boolean(useSelector(selectMandatoryFullscreen));
  const registered = Boolean(useSelector(selectCurrentToken));
  const [locked, setLocked] = useState(isFullscreenLocked);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const recheck = () => setLocked(isFullscreenLocked());
    document.addEventListener("fullscreenchange", recheck);
    // Leaving the browser's own fullscreen (F11 / display-mode) and a window
    // that grows to fill its screen fire no fullscreenchange.
    window.addEventListener("resize", recheck);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("fullscreenchange", recheck);
      window.removeEventListener("resize", recheck);
    };
  }, []);

  if (!mandatory || !registered || locked || failed) return null;
  if (document.fullscreenEnabled === false) return null;

  const enter = async () => {
    try {
      const root = document.documentElement;
      if (typeof root.requestFullscreen !== "function") {
        throw new Error("Fullscreen API unavailable");
      }
      // Success hides the gate through fullscreenchange.
      await root.requestFullscreen();
      captureKioskEvent(KioskEventName.FullScreenEnabled);
    } catch (error) {
      if (mountedRef.current) setFailed(true);
      captureKioskEvent(KioskEventName.ErrorOccurred, {
        error_source: "fullscreen",
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // tb-fade-in: opacity-only, position-neutral on a fixed portal.
  return createPortal(
    <button
      type="button"
      data-testid="fullscreen-gate"
      onClick={() => void enter()}
      className="tb-fade-in fixed inset-0 z-[99998] flex flex-col items-center justify-center bg-tb-purple/95 p-8"
    >
      <span className="tb-display mb-4 text-center text-5xl text-tb-surface">
        {t("fullscreen.title")}
      </span>
      <span className="max-w-xl text-center text-2xl leading-relaxed text-tb-cream">
        {t("fullscreen.body")}
      </span>
    </button>,
    document.body
  );
}
