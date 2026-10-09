import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

/** The one flag this guard reads (null-safe on a partial test store). */
interface DetourRootState {
  menuSelections?: { recommendationDetour?: boolean };
}

/**
 * How long the stage swallows taps once a product-added suggestion LEAVES the
 * modal (ReachZone's exit-guard pattern, review R1). The modal closes at once
 * and Select a Size, the PDP or the repeat sheet takes its place under the
 * finger, so the second tap of a double tap would tick a size, pick a paid
 * option, open a pack slot or close the repeat sheet.
 */
const DETOUR_TAP_GUARD_MS = 500;

/**
 * Armed on recommendationDetour's false → true edge — only
 * Menu.leaveAddedModal sets it, in the same render that swaps the surface.
 * Mounted once in AppRoutes' InSessionOverlays, so it outlives the
 * /menu → /customization switch. z-[58]: over every page (the PDP, Select a
 * Size at 40), MIAM (45) and the repeat sheet (55); under the loyalty modals
 * (60+), the global error (95) and the idle prompt (100).
 */
export default function DetourTapGuard() {
  const detour = useSelector((state: DetourRootState) =>
    Boolean(state.menuSelections?.recommendationDetour)
  );
  // Arm on the edge (adjust state while rendering); a detour that ends
  // inside the window leaves it up.
  const [prevDetour, setPrevDetour] = useState(detour);
  const [guard, setGuard] = useState(false);
  if (prevDetour !== detour) {
    setPrevDetour(detour);
    if (detour) setGuard(true);
  }
  // Rule 5: the guard's timer never outlives it (or the host).
  useEffect(() => {
    if (!guard) return;
    const id = window.setTimeout(() => setGuard(false), DETOUR_TAP_GUARD_MS);
    return () => window.clearTimeout(id);
  }, [guard]);

  return guard ? (
    <div aria-hidden="true" data-testid="detour-tap-guard" className="absolute inset-0 z-[58]" />
  ) : null;
}
