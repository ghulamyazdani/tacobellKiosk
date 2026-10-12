import { createSelector } from "@reduxjs/toolkit";
import { useSelector } from "react-redux";
import { selectEntityMap, selectModifierMap } from "@cx-sdk/catalog/state/Menu.slice";
import { selectOutOfStockItems } from "../../redux/features/menuSelections/menuSelections.slice";
import { selectFilters } from "@cx-sdk/catalog/state/filter.slice";
import {
  buildCartUpsellBreakdown,
  collectCartUpsellEntities,
  MIN_CART_UPSELL_ITEMS,
  type CartUpsellBreakdown,
} from "./cartUpsellUtils";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import {
  toMenuSellableEntity,
  type EntityMap,
  type ModifierGroupMap,
  type OutOfStockMap,
} from "@cx-sdk/catalog/recommendation/recommendationUtils";

/*
  Port of posistKiosk's src/hooks/menuHooks/useCartUpsell.ts (P7a). Source-2
  only: the isCartRecommended engine over the redux entityMap — no S3 fetch.
*/

/**
 * Only the slices this reads. Narrowly typed on purpose — with `(state: any)` a
 * typo'd settings field reads `undefined`, goes falsy, and the surface silently
 * never appears with no type error to catch it.
 */
interface CartUpsellRootState {
  menu?: { entityMap?: EntityMap };
  menuSelections?: { outOfStockItems?: OutOfStockMap };
  filter?: { filters?: string[] };
  appSettings?: {
    kiosk_settings?: {
      enable_cart_upsell_screen?: boolean;
      enable_combo_upsell?: boolean;
    };
  };
}

const selectKioskSettings = (state: CartUpsellRootState) =>
  state.appSettings?.kiosk_settings;

const selectComboUpsellEnabled = (state: CartUpsellRootState) =>
  state.appSettings?.kiosk_settings?.enable_combo_upsell;

/**
 * The entityMap as the menu sells it (toMenuSellableEntity). EVERY suggestion
 * surface reads this, never selectEntityMap: from the raw map a dead-group
 * item opened the PDP from the bag (UB6 crash) and a dead pack sold empty.
 * Recomputed only when a menu loads.
 */
export const selectMenuSellableEntityMap = createSelector(
  [selectEntityMap, selectModifierMap],
  (entityMap: EntityMap, modifierMap: ModifierGroupMap): EntityMap => {
    if (!entityMap) return entityMap;
    const sellable: Record<string, RecommendedEntity> = {};
    for (const [id, entity] of Object.entries(entityMap)) {
      const shaped = toMenuSellableEntity(entity, modifierMap);
      if (shaped) sellable[id] = shaped;
    }
    return sellable;
  },
);

/**
 * Memoized so the scan runs only when the menu, the stock map, or the active
 * tag filters actually change — not on every render of the bag that reads it.
 */
const selectCartUpsellItems = createSelector(
  [
    selectMenuSellableEntityMap,
    selectOutOfStockItems,
    selectFilters,
    selectComboUpsellEnabled,
  ],
  collectCartUpsellEntities,
);

const selectCartUpsellBreakdown = createSelector(
  [
    selectMenuSellableEntityMap,
    selectOutOfStockItems,
    selectFilters,
    selectComboUpsellEnabled,
  ],
  buildCartUpsellBreakdown,
);

export interface CartUpsellState {
  items: RecommendedEntity[];
  /** Whether the cart upsell surface has anything worth showing. */
  shouldShowUpsell: boolean;
  /** Per-reason exclusion counts, for the suppression telemetry event. */
  getBreakdown: () => CartUpsellBreakdown;
}

/**
 * The single source of the cart-upsell decision (the bag's Complete-Your-Meal
 * rail; the rewards sheet's suggested rail reads its items).
 *
 * The setting is necessary but NOT sufficient — a gate that can render an empty
 * surface is a broken gate, so the item count is part of the condition.
 */
const useCartUpsell = (): CartUpsellState => {
  const items = useSelector(selectCartUpsellItems) as RecommendedEntity[];
  const breakdown = useSelector(selectCartUpsellBreakdown);
  const settings = useSelector(selectKioskSettings);

  return {
    items,
    // Opt-OUT, not opt-in. `enable_cart_upsell_screen` is not a field the
    // settings API sends today, so requiring `=== true` would keep the rail
    // dark forever. `!== false` means the flagged items alone are enough to
    // show it, while still letting a tenant switch it off once the flag is
    // plumbed.
    //
    // The item count remains part of the gate: a gate that can render an empty
    // surface is a broken gate.
    shouldShowUpsell:
      settings?.enable_cart_upsell_screen !== false &&
      items.length >= MIN_CART_UPSELL_ITEMS,
    getBreakdown: () => breakdown,
  };
};

export default useCartUpsell;
