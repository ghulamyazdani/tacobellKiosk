import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import useCartHook from "./useCartHook";
import useGridView from "../customization/useGridView";
import useMakeItAMeal from "../makeItAMeal/useMakeItAMeal";
import useTagFilter from "./useTagFilter";
import {
  buildDirectAddPayload,
  buildMakeItAMealPayload,
  buildRepeatSheetPayload,
  buildReturnNavigationState,
  buildVariantSelectionEntity,
  buildVariantTierPayload,
  classifyAddIntent,
} from "@cx-sdk/ordering/cart/addIntent";
import type {
  AddEntityOptions,
  AddIntent,
} from "@cx-sdk/ordering/cart/addIntent";
import { setSelectedEntity } from "../../redux/features/menuSelections/menuSelections.slice";
import { setRepeatItemBottomSheet } from "@cx-sdk/ordering/state/cart.slice";
import {
  closeMakeItAMealModal,
  openComboConstutientCustomizations,
  openMakeItAMealModal,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { selectShowRepeatCustomization } from "@cx-sdk/catalog/state/appSettings.slice";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";

export type { AddIntent, AddEntityOptions };

/**
 * TB-local (the SDK type is fork-shared): `preselectedVariantId` = the size
 * the guest already chose in Select-a-Size. Variant intent only; it rides
 * the tier-1 `bottomSheet` (makeItAMealTier1BottomSheet(state)
 * .preselectedVariantId) and the PDP opens with that size confirmed.
 */
export type TbAddEntityOptions = AddEntityOptions & {
  preselectedVariantId?: string;
  /**
   * Never the repeat sheet, even for an item already in the bag — a fresh
   * chooser instead (posistKiosk). For the product-added modal's suggestions
   * (the sheet's "+" writes to the bag past ADD TO ORDER) and for a size
   * already chosen in Select a Size (the sheet would drop it).
   */
  forceNewCustomization?: boolean;
};

type AddIntentOptions = Pick<TbAddEntityOptions, "forceNewCustomization">;

/**
 * Only the slices this hook reads. The store itself is untyped, so declaring
 * the narrow shape here keeps the selectors honest without pulling in a
 * repo-wide RootState that does not exist yet.
 */
interface AddEntityRootState {
  appSettings?: { kiosk_settings?: { enable_combo_upsell?: boolean } };
  makeItAMeal?: { blackListedItems?: Record<string, boolean> };
}

/**
 * The add-to-cart decision tree, extracted so callers other than the menu cards
 * can reuse it. Mirrors the branching in `components/cart/RecommendationItem`,
 * but instantiates the heavy customization/MIAM hooks ONCE per caller rather
 * than once per card, and lets the caller close itself before we navigate.
 *
 * Thin wrapper: the classification itself lives in
 * `@cx-sdk/ordering/cart/addIntent` (classifyAddIntent); this hook only
 * gathers store state into the classifier's context and executes the returned
 * intent (dispatch / navigate / cart mutation).
 */
const useAddEntityToCart = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { addItemToCart, openAddedModal, doesItemExistInCart, IncreaseItemQuantityById } =
    useCartHook();
  // Leaf hooks, NOT useCustomization({}) / useMenuConverters(). Those return
  // exactly one binding each here, and cost ~181 and ~51 useSelector calls plus
  // four and one whole-`state.cart` subscriptions respectively — every one of
  // which is re-evaluated on every store action.
  const { isShowGridViewEnabled } = useGridView();
  const { openDoubleTierModal } = useMakeItAMeal();
  const { filterByTags } = useTagFilter();

  const showRepeatCustomizationRdx = useSelector(selectShowRepeatCustomization);
  const kioskSettingsRdx = useSelector(
    (state: AddEntityRootState) => state.appSettings?.kiosk_settings,
  );
  const blackListedItemsMIAM = useSelector(
    (state: AddEntityRootState) => state.makeItAMeal?.blackListedItems,
  );

  /**
   * What tapping this entity will do, without doing it. Lets a caller render
   * the right affordance ("+" vs "customize") before the customer commits.
   */
  const getAddIntent = useCallback(
    (entity: RecommendedEntity, intentOptions: AddIntentOptions = {}): AddIntent =>
      classifyAddIntent(entity, {
        doesItemExistInCart,
        showRepeatCustomization:
          !intentOptions.forceNewCustomization && showRepeatCustomizationRdx,
        comboUpsellEnabled: kioskSettingsRdx?.enable_combo_upsell,
        blackListedItems: blackListedItemsMIAM,
        isShowGridViewEnabled,
        filterByTags,
      }),
    [
      doesItemExistInCart,
      showRepeatCustomizationRdx,
      kioskSettingsRdx,
      blackListedItemsMIAM,
      isShowGridViewEnabled,
      filterByTags,
    ],
  );

  /**
   * Executes the intent. Returns true only when the item actually landed in
   * the cart; every other branch hands the customer off to another screen.
   */
  const addEntity = useCallback(
    (entity: RecommendedEntity, options: TbAddEntityOptions = {}): boolean => {
      const intent = getAddIntent(entity, options);
      const {
        onBeforeLeave,
        suppressAddedModal,
        returnTo,
        returnPath,
        preselectedVariantId,
      } = options;
      const navigationState = buildReturnNavigationState(returnTo, returnPath);

      if (intent === "unavailable") return false;

      if (intent === "add") {
        // An item with no variants and no modifiers is always the same product,
        // so tapping it again must bump the existing row rather than punch a
        // second one. addItemToCart cannot do this itself: the reducer's
        // merge-by-id branch keys off `payload.itemType` (cart.slice.ts:65),
        // which addItemToCart never sets — it writes `type` — so the key always
        // falls through to the freshly-generated unique itemId and never
        // matches. Increment explicitly, the same way the menu cards do — and
        // confirm it like a new row (user 2026-10-14).
        if (doesItemExistInCart(entity?.id)?.itemExist) {
          const landed = IncreaseItemQuantityById(entity.id, "ITEM", "id", entity);
          if (landed && !suppressAddedModal) openAddedModal(entity);
          return landed;
        }

        return !!addItemToCart(buildDirectAddPayload(entity), "ITEM", {
          suppressAddedModal,
        });
      }

      // Everything below either stacks a sheet or navigates — let the caller
      // tear itself down first.
      onBeforeLeave?.();

      if (intent === "repeat") {
        dispatch(closeMakeItAMealModal());
        dispatch(
          setRepeatItemBottomSheet(
            buildRepeatSheetPayload(entity, returnTo, returnPath),
          ),
        );
        return false;
      }

      if (intent === "upsell") {
        dispatch(openMakeItAMealModal(buildMakeItAMealPayload(entity)));
        return false;
      }

      if (intent === "modifiers") {
        dispatch(closeMakeItAMealModal());
        openDoubleTierModal(entity, () => {}, navigationState);
        return false;
      }

      // intent === "variant"
      dispatch(closeMakeItAMealModal());
      dispatch(setSelectedEntity(buildVariantSelectionEntity(entity)));
      dispatch(openComboConstutientCustomizations());
      const payload = buildVariantTierPayload(entity);
      dispatch(
        setTier1BottomSheetAndSelectedEntity(
          preselectedVariantId
            ? {
                ...payload,
                bottomSheet: { ...payload.bottomSheet, preselectedVariantId },
              }
            : payload,
        ),
      );
      navigate(
        "/customization",
        navigationState ? { state: navigationState } : undefined,
      );
      return false;
    },
    [
      getAddIntent,
      addItemToCart,
      openAddedModal,
      doesItemExistInCart,
      IncreaseItemQuantityById,
      dispatch,
      openDoubleTierModal,
      navigate,
    ],
  );

  return { getAddIntent, addEntity };
};

export default useAddEntityToCart;
