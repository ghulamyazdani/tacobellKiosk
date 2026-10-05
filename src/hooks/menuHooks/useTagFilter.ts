import { useCallback } from "react";
import { useSelector } from "react-redux";
import { selectFilters } from "@cx-sdk/catalog/state/filter.slice";
import { filterEntitiesByTags } from "@cx-sdk/catalog/menu/menuUtils";

/**
 * The veg/non-veg filter, and nothing else.
 *
 * `useMenuConverters()` also returns `filterByTags`, but instantiating it costs
 * ~51 `useSelector` calls, 7 RTK-Query hooks and a subscription to the whole
 * `state.cart` — because it pulls in `useOfferHook`, which pulls in
 * `useCartHook`. On the menu that price is paid once per rendered item card.
 *
 * This hook subscribes to one leaf array (`state.filter.filters`) and delegates
 * to the same pure function `useMenuConverters` now uses, so the two can never
 * drift.
 */
const useTagFilter = () => {
  const filtersRdx = useSelector(selectFilters) as string[] | undefined;

  // Stable across renders for a given filter set, so callers can safely put it
  // in a useCallback/useMemo dependency array.
  const filterByTags = useCallback(
    <T,>(items: T[] | undefined) => filterEntitiesByTags(filtersRdx, items),
    [filtersRdx],
  );

  return { filterByTags };
};

export default useTagFilter;
