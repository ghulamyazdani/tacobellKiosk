import { useCallback } from "react";
import { useSelector } from "react-redux";
import { selectAllowMultiplePunch } from "@cx-sdk/catalog/state/appSettings.slice";

/**
 * Whether modifier groups read their `multiplePunchMin`/`multiplePunchMax`
 * instead of `min`/`max`.
 *
 * `useMenuConverters().isAllowMultiplePunch` is literally
 * `return allowMultiplePunchRdx || false` (useMenuConverters.ts:331-333), but
 * reaching it instantiates that 2,172-line hook: ~63 store subscriptions, a
 * `useGetMenuMutation`, a `useGetOutOfStockMutation`, a
 * `useLazyGetServerTimeQuery`, and a second subscription to the whole
 * `state.cart` (via useOfferHook → useCartHook). `useMakeItAMeal` is
 * instantiated once per `ItemCard`, so on /menu that bill was paid ~120 times
 * over for one boolean.
 *
 * `useMenuConverters` now delegates here, so there is one implementation.
 *
 * Kept CALLABLE on purpose: all ~30 call sites invoke it as
 * `isAllowMultiplePunch()`, and some do so during render
 * (ItemCustomizationContainerWithoutMultiPunch.tsx:101-104), where a plain
 * boolean would throw into the app-level ErrorBoundary mid-order.
 */
const useAllowMultiplePunch = () => {
  const allowMultiplePunchRdx = useSelector(selectAllowMultiplePunch);

  // Stable for a given setting value, so callers can put it in a dependency
  // array (GroupItemMIAM.tsx:115 already does).
  const isAllowMultiplePunch = useCallback(
    () => allowMultiplePunchRdx || false,
    [allowMultiplePunchRdx],
  );

  return { isAllowMultiplePunch };
};

export default useAllowMultiplePunch;
