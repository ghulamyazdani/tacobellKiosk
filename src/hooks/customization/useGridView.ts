import { useCallback } from "react";
import { shallowEqual, useSelector } from "react-redux";
import { gridWiseSetting } from "@cx-sdk/catalog/state/theme.slice";

/**
 * Whether the customization sheet renders in grid view.
 *
 * `useCustomization({}).isShowGridViewEnabled` is literally
 * `return selectThemeRdx` (useCustomization.ts:213-215), where `selectThemeRdx`
 * is `useSelector(gridWiseSetting, shallowEqual)` (:65). Reading it through
 * `useCustomization` costs ~181 `useSelector` calls, 18 RTK-Query hooks and
 * FOUR whole-`state.cart` subscriptions, because that hook instantiates
 * useMakeItAMeal + useMenuConverters + useLoyalty + useCartHook + useAppSettings.
 *
 * `shallowEqual` is kept to match the original exactly — the setting can arrive
 * as an object, and dropping it would re-render on every store action.
 */
const useGridView = () => {
  const gridViewRdx = useSelector(gridWiseSetting, shallowEqual);

  const isShowGridViewEnabled = useCallback(() => gridViewRdx, [gridViewRdx]);

  return { isShowGridViewEnabled };
};

export default useGridView;
