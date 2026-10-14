import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

/** The two flags this guard reads (null-safe on a partial test store). */
interface DetourRootState {
  menuSelections?: { recommendationDetour?: boolean; addToCartModal?: { isOpen?: boolean } };
}

/**
 * How long the stage swallows taps once a product-added suggestion LEAVES the
 * modal (ReachZone's exit-guard pattern, review R1). The modal hides at once
 * and Select a Size or the PDP takes its place under the finger, so the
 * second tap of a double tap would tick a size, pick a paid option or open a
 * pack slot. The way BACK is the same: the detour's end brings the modal
 * back under the chooser's CONTINUE / ADD TO BAG / X, and its ADD TO ORDER
 * buys the picks while its X throws them away. So are the modal's own open
 * and close, now on every menu add (user 2026-10-14): it opens in the commit
 * of a card tap, its scrim under the finger (the second half closed it), and
 * its GOT IT / X hand the menu back (the second half added the card beneath).
 */
const DETOUR_TAP_GUARD_MS = 500;

/**
 * Armed on each recommendationDetour edge — Menu.handleSuggestionAdd sets it,
 * in the same render that swaps the surface; each chooser exit clears it —
 * and on each open / close edge of the product-added modal.
 * Mounted once in AppRoutes' InSessionOverlays, so it outlives the
 * /menu → /customization switch. z-[58]: over every page (the PDP, Select a
 * Size at 40), MIAM (45) and the repeat sheet (55); under the loyalty modals
 * (60+), the global error (95) and the idle prompt (100).
 */
export default function DetourTapGuard() {
  const detour = useSelector((state: DetourRootState) =>
    Boolean(state.menuSelections?.recommendationDetour)
  );
  const added = useSelector((state: DetourRootState) =>
    Boolean(state.menuSelections?.addToCartModal?.isOpen)
  );
  // Arm on any edge (adjust state while rendering). An end inside the
  // window keeps the first timer — no tap can end a detour that early.
  const [prev, setPrev] = useState({ detour, added });
  const [guard, setGuard] = useState(false);
  if (prev.detour !== detour || prev.added !== added) {
    setPrev({ detour, added });
    setGuard(true);
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
