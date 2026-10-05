import { useEffect, useState, type ReactNode } from "react";

export const STAGE_WIDTH = 1080;
export const STAGE_HEIGHT = 1920;

/*
 * ADA ("accessibility") reach-zone geometry — Figma ADA Home 1:5392, ADA
 * Customization 1:5413, ADA Order recap 1:5445. The view renders the app
 * UNSCALED into the bottom ADA_REACH_ZONE_HEIGHT px; the top
 * ADA_BRAND_ZONE_HEIGHT px becomes the brand panel (ReachZone.tsx). Nothing
 * shrinks, so every touch target keeps its size.
 *
 * ADA_BRAND_ZONE_HEIGHT is THE calibration knob (Rule 5). The reach line is
 * physical — ADA 2010 §308 puts the high forward reach at 48 in above the
 * floor — so the right value depends on the cabinet's panel size and mounting
 * height. Retune only this one; the reach zone, the overlay caps and the
 * flex pages (Menu, PDP, ForYou) follow it. LOWERING it is always safe.
 * RAISING it past 816 is not: the frameless pages' ADA tops are tuned to the
 * 1122 zone (CustomerPhone's skip meets the footer above 816, Tent 822,
 * CustomerName 837 — see their `ponytail:` notes) and must be re-derived.
 */
export const ADA_BRAND_ZONE_HEIGHT = 798;
/** 1122 at the Figma calibration. */
export const ADA_REACH_ZONE_HEIGHT = STAGE_HEIGHT - ADA_BRAND_ZONE_HEIGHT;
/** Figma 1:5465: the ADA bag sheet, 765 tall (top at stage y 1155). */
export const ADA_SHEET_HEIGHT = 765;
/** Centred-modal cap in the ADA view: the zone minus 24px top/bottom margins
 *  (1074; design language — Figma has no ADA modal frame). */
export const ADA_MODAL_MAX_HEIGHT = ADA_REACH_ZONE_HEIGHT - 48;

/**
 * Fixed 1080×1920 design stage, scaled uniformly to fit the real viewport.
 *
 * The kiosk hardware IS 1080×1920 portrait (scale = 1 in production); the
 * scaling exists so development and E2E at other window sizes render the
 * same layout proportionally. Screens are laid out in design pixels against
 * this stage — deliberately no vh/vw units (posistKiosk's ~113 vh/vw call
 * sites are what made its layout unverifiable off-device).
 */
export function KioskStage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(() => computeScale());

  useEffect(() => {
    const onResize = () => setScale(computeScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden">
      <div
        data-testid="kiosk-stage"
        className="relative shrink-0 overflow-hidden"
        style={{
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function computeScale(): number {
  return Math.min(
    window.innerWidth / STAGE_WIDTH,
    window.innerHeight / STAGE_HEIGHT
  );
}
