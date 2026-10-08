import type { planSplitEditCommit } from "@cx-sdk/ordering/cart/splitEdit";
import type PdpIncompleteWarning from "../../components/customization/PdpIncompleteWarning";
import type Tier2CustomizationSheet from "../../components/customization/Tier2CustomizationSheet";

/**
 * The PDP's lazy parts — all in the ONE lazy UI chunk, bagLazyParts. The
 * split-edit planner is handed INTO useCustomization from here: the hook may
 * not import the chunk itself (the tier-2 page inside it uses the hook).
 */
export interface PdpLazyParts {
  PdpIncompleteWarning: typeof PdpIncompleteWarning;
  Tier2CustomizationSheet: typeof Tier2CustomizationSheet;
  planSplitEditCommit: typeof planSplitEditCommit;
}

/** Once their code has arrived, every later PDP renders them at once. */
let loadedParts: PdpLazyParts | null = null;
let pendingLoad: Promise<PdpLazyParts | null> | null = null;

export const loadedPdpParts = (): PdpLazyParts | null => loadedParts;

/**
 * Starts (or joins) the load; null = the code did not arrive. The PDP starts
 * it at MOUNT, never at a tap (G2c): a tap must not be what discovers a dead
 * chunk, and without the parts the PDP keeps working — an incomplete ADD TO
 * BAG shows the ring alone, and tier-2 shows a named scrim that closes it
 * (the tier-1 picks stay). The chunk is normally warm already: the menu's
 * always-mounted rewards sheet loads it at /menu entry.
 * Plain state + `await import()` (loadActivityModal's pattern), never
 * `.then` and never React.lazy: a prevented `vite:preloadError` resolves the
 * import to undefined, and Suspense's reveal timer stalls under a frozen e2e
 * clock. A failure clears the pending load, so only the NEXT PDP mount
 * retries (Chromium remembers a failed module fetch for the page's life;
 * chunkRecovery owns the healing reload).
 */
export function loadPdpLazyParts(): Promise<PdpLazyParts | null> {
  pendingLoad ??= (async () => {
    try {
      const parts: Partial<PdpLazyParts> | undefined = await import(
        "../../components/cart/bagLazyParts"
      );
      if (
        parts?.PdpIncompleteWarning &&
        parts.Tier2CustomizationSheet &&
        parts.planSplitEditCommit
      ) {
        loadedParts = {
          PdpIncompleteWarning: parts.PdpIncompleteWarning,
          Tier2CustomizationSheet: parts.Tier2CustomizationSheet,
          planSplitEditCommit: parts.planSplitEditCommit,
        };
        return loadedParts;
      }
    } catch {
      // The dev server's rejected import (a build resolves undefined instead).
    }
    pendingLoad = null;
    return null;
  })();
  return pendingLoad;
}
