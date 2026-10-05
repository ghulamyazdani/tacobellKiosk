import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  closeAccessibilityMode,
  selectAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import useAdaActive from "../../hooks/utils/useAdaActive";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import {
  ADA_BRAND_ZONE_HEIGHT,
  ADA_REACH_ZONE_HEIGHT,
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from "./KioskStage";
import bgTexture from "../../assets/splash/bg-texture.png";
import plasticOverlay from "../../assets/splash/plastic-overlay.jpg";
import tbLogoLockup from "../../assets/brand/tb-logo-lockup.svg";

/**
 * Boot, operator and attract screens never render inside the zone. /start
 * especially: its mount runs resetSession("full"), which closes ADA one
 * commit AFTER the splash first paints — exempting it keeps that frame
 * full-stage instead of flashing the splash inside the zone.
 */
const ADA_EXEMPT_PATHS = new Set(["/", "/LoadingResources", "/start"]);

/**
 * How long the vacated panel area swallows taps after a tap-to-exit. The
 * switch is instant (no tap delay either: user-scalable=no), so the second
 * tap of a double tap would land on whatever the full-height page now paints
 * there — a ForYou/Menu card adds to the bag, /customerName's CONTINUE
 * submits. The fork's 0.5 s height transition absorbed it by accident.
 */
const EXIT_TAP_GUARD_MS = 500;

/**
 * ADA reach-zone view (Figma 1:5392 / 1:5413 / 1:5445): the app renders
 * UNSCALED into the bottom ADA_REACH_ZONE_HEIGHT px of the stage, under a
 * purple brand panel. Mounted once, as Router > KioskStage > ReachZone >
 * AppRoutes.
 *
 * STABLE TREE. The container below is the SAME element in both modes — only
 * its height changes (1920 → 1122, anchored to the stage bottom) — and the
 * brand zone is a conditional SIBLING ahead of it, which React reconciles
 * positionally (the `false` slot keeps the container at index 1). Never make
 * the container a conditional wrapper and never key it on the mode: either
 * remounts every route on a toggle — the PDP's tier-1 session, ForYou's
 * frozen snapshot, the OrderSuccess countdown/print latch, scroll positions.
 *
 * `contain: layout paint` makes the container the containing block for
 * absolute AND fixed descendants (OfferRemovalNotice is `fixed inset-0`), a
 * stacking context and a clip, so every overlay lands inside the zone with
 * no transform (Tailwind translates stack with transforms — one owner per
 * element). Deliberately no overflow-hidden: that makes a scroll container,
 * which the browser scrolls to reveal a focused descendant and never scrolls
 * back; paint containment clips without being scrollable.
 *
 * The switch is instant: animating the height (the fork) relayouts the whole
 * app every frame.
 */
export function ReachZone({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { pathname } = useLocation();
  const mode = Boolean(useSelector(selectAccessibilityMode));
  const active = useAdaActive() && !ADA_EXEMPT_PATHS.has(pathname);

  // Fork App.tsx parity: one event per flip of the RAW flag (resets that
  // close ADA included), never for the value the app booted with.
  const lastModeRef = useRef(mode);
  useEffect(() => {
    if (lastModeRef.current === mode) return;
    lastModeRef.current = mode;
    captureKioskEvent(
      mode
        ? KioskEventName.AccessibilityOptionSelected
        : KioskEventName.AccessibilityOptionDeselected,
      { accessibility_mode_enabled: mode }
    );
  }, [mode]);

  // Rule 5: the guard's timer never outlives it (or the component).
  const [exitGuard, setExitGuard] = useState(false);
  useEffect(() => {
    if (!exitGuard) return;
    const id = window.setTimeout(() => setExitGuard(false), EXIT_TAP_GUARD_MS);
    return () => window.clearTimeout(id);
  }, [exitGuard]);

  return (
    <>
      {active && (
        // Tap anywhere on the panel to exit (fork parity; Figma draws no
        // affordance — flagged for client sign-off). closeAccessibilityMode
        // is idempotent, so a double tap can never toggle ADA back on, and
        // the exit guard keeps its second tap off the page. The panel is
        // never scrimmed: overlays live inside the zone below.
        <button
          type="button"
          data-testid="ada-brand-zone"
          aria-label={t("ada.exit")}
          onClick={() => {
            setExitGuard(true);
            dispatch(closeAccessibilityMode());
          }}
          className="absolute left-0 top-0 flex items-center justify-center overflow-hidden bg-tb-purple"
          style={{ width: STAGE_WIDTH, height: ADA_BRAND_ZONE_HEIGHT }}
        >
          {/* The splash/second backdrop, cropped to the panel: texture tile
              from top-left, plastic sheen at FULL-stage size so its
              object-cover crop matches what the guest just saw. */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${bgTexture})`,
              backgroundSize: "240px 240px",
              backgroundPosition: "top left",
            }}
          />
          <img
            alt=""
            src={plasticOverlay}
            className="absolute left-0 top-0 object-cover opacity-40 mix-blend-soft-light"
            style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}
          />
          {/* Lockup 1:5394, centred in the panel (Figma x434 y245 at the
              798 calibration) — `relative` so it paints above the layers. */}
          <img
            alt=""
            src={tbLogoLockup}
            className="relative h-[308.758px] w-[212.205px]"
          />
        </button>
      )}
      <div
        data-testid="reach-zone"
        className="absolute bottom-0 left-0"
        style={{
          width: STAGE_WIDTH,
          height: active ? ADA_REACH_ZONE_HEIGHT : STAGE_HEIGHT,
          contain: "layout paint",
        }}
      >
        {children}
      </div>
      {/* Transparent but hit-testable, over the vacated panel area. LAST so
          it paints above the container's whole stacking context and the
          container keeps its index (no remount). */}
      {exitGuard && (
        <div
          aria-hidden
          data-testid="ada-exit-guard"
          className="absolute left-0 top-0"
          style={{ width: STAGE_WIDTH, height: ADA_BRAND_ZONE_HEIGHT }}
        />
      )}
    </>
  );
}
