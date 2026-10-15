import { useCallback } from "react";
import { useSelector } from "react-redux";
import { selectModifierMap } from "@cx-sdk/catalog/state/Menu.slice";
import { selectAllowMultiplePunch } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  toMenuSellableEntity,
  type ModifierGroupMap,
} from "@cx-sdk/catalog/recommendation/recommendationUtils";
import { markUncompletable } from "@cx-sdk/catalog/oos/optionStock";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { selectOutOfStockItems } from "../../redux/features/menuSelections/menuSelections.slice";
import useTagFilter from "../menuHooks/useTagFilter";

/**
 * The meal combos a guest can buy from an item's `upsellItems`: the tag
 * filter's, as the menu sells them (UB6 F1 — upsellItems embed RAW entities:
 * a dead pack would sell empty, a dead plain item is one-tap) and as stock
 * sells them (walk-oos 2 — one no guest can complete is out): active and in
 * stock. ONE list for the meal prompt and for the add decision that opens it
 * (the classifier's `filterByTags`), so the prompt never opens with no meal
 * on it. Re-evaluated when PAY's stock map, the modifiers or the multi-punch
 * setting move.
 */
const useSellableCombos = () => {
  const { filterByTags } = useTagFilter();
  const modifierMap = useSelector(selectModifierMap) as ModifierGroupMap;
  const stock = useSelector(selectOutOfStockItems);
  const multiPunch = Boolean(useSelector(selectAllowMultiplePunch));

  const sellableCombos = useCallback(
    (items: unknown[] | undefined): RecommendedEntity[] =>
      ((filterByTags(items) ?? []) as RecommendedEntity[])
        .map((combo) =>
          markUncompletable(toMenuSellableEntity(combo, modifierMap), modifierMap, stock, multiPunch)
        )
        .filter((combo): combo is RecommendedEntity => Boolean(combo?.isActive && !combo?.outOfStock)),
    [filterByTags, modifierMap, stock, multiPunch]
  );

  return { sellableCombos };
};

export default useSellableCombos;
