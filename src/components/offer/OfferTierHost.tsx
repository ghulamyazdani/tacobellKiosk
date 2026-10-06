import { useEffect, useState } from "react";
import { useSelector, useStore } from "react-redux";
import {
  closeMakeItAMealSession,
  makeItAMealIsSessionOpen,
  MIAMTier1Open,
  tier1CustomizationSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import Customization from "../../pages/Customization";

type TierEntity = { isGetItem?: unknown; isBuyStageItem?: unknown } | null | undefined;

/** A tier session this host owns: an offer freebie or a buy-stage pick. */
const isMarkerEntity = (entity: TierEntity): boolean =>
  Boolean(entity?.isGetItem || entity?.isBuyStageItem);

/**
 * How long the vacated area swallows taps after the PDP closes (ReachZone's
 * exit-guard pattern). The close is instant and the PDP's BACK / CTA sit
 * exactly over the buy stage's BACK / CONTINUE and the picker's CONFIRM, so
 * the second tap of a double tap would roll the stage back or commit it.
 */
const CLOSE_TAP_GUARD_MS = 500;

/**
 * OFFER TIER HOST — the PDP (Figma 1:2614 / 1:2920) embedded full-bleed in
 * the bag for an in-place tier session (fork ItemSelection :129 + :572-575):
 * the freebie picker's customizable rows (isGetItem) and the buy stage's
 * customizable buy items (isBuyStageItem). Mounted once in BagSheet's open
 * branch; z-[85] covers the picker (z-[80]) and the buy stage (z-50). A
 * normal /customization session is never mirrored (it carries no marker).
 * The URL stays /cart: the embedded PDP never navigates.
 *
 * No local ErrorBoundary: a null fallback inside an inset-0 host would eat
 * every tap; the app boundary recovers instead.
 */
export default function OfferTierHost() {
  const store = useStore();
  const sessionOpen = useSelector(makeItAMealIsSessionOpen);
  const tier1Open = useSelector(MIAMTier1Open);
  const tier1Entity: TierEntity = useSelector(tier1CustomizationSelectedEntity);

  // Orphan cleanup (fork ItemSelection :141-149): the bag going away mid-tier
  // must not leave a live session that stamps isMakeItAMealItem on unrelated
  // adds. Reads the store at cleanup time; StrictMode-safe because the host
  // mounts with the bag, before any marker session exists. `store` is stable,
  // so this runs on mount/unmount only.
  useEffect(
    () => () => {
      const state = store.getState();
      if (
        makeItAMealIsSessionOpen(state) &&
        isMarkerEntity(tier1CustomizationSelectedEntity(state))
      ) {
        store.dispatch(closeMakeItAMealSession({ force: false }));
      }
    },
    [store]
  );

  const shown = Boolean(sessionOpen && tier1Open) && isMarkerEntity(tier1Entity);
  // Arm the guard on the shown → hidden edge (adjust state while rendering).
  const [prevShown, setPrevShown] = useState(shown);
  const [tapGuard, setTapGuard] = useState(false);
  if (prevShown !== shown) {
    setPrevShown(shown);
    setTapGuard(!shown);
  }
  // Rule 5: the guard's timer never outlives it (or the host).
  useEffect(() => {
    if (!tapGuard) return;
    const id = window.setTimeout(() => setTapGuard(false), CLOSE_TAP_GUARD_MS);
    return () => window.clearTimeout(id);
  }, [tapGuard]);

  if (!shown) {
    return tapGuard ? (
      <div
        aria-hidden="true"
        data-testid="offer-tier-tap-guard"
        className="absolute inset-0 z-[85]"
      />
    ) : null;
  }
  return (
    <div className="absolute inset-0 z-[85]" data-testid="offer-tier-host">
      <Customization embedded />
    </div>
  );
}
