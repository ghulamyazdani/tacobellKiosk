/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-wrapper-object-types --
 * Verbatim copy of the posistKiosk useMakeItAMeal wrapper (customization
 * vertical port). The anys (and one `Boolean` parameter type) are inherited;
 * typed in later domain passes. Do not add NEW anys.
 */
// Thin wrapper over the MIAM rules engine (@cx-sdk/ordering/makeItAMeal/miamRules).
// This hook now only gathers Redux state, delegates every decision/transform to
// the engine, and performs the shell-side effects: modal-state dispatches,
// navigation, and DOM scrolling. Exported API and observable behavior are
// unchanged from the pre-extraction hook.
import {
  kiosSettingsRdx,
  selectHideComboConstituentAddons,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { shallowEqual, useDispatch, useSelector } from "react-redux";
import {
  makeItAMealIsSessionOpen,
  makeItAMealTier1BottomSheet,
  makeItMealSelectedItem,
  MIAMTier1Open,
  MIAMTier2Open,
  openComboConstutientCustomizations,
  setNestedAvailableAddons,
  setRemovePreviousCustomizationAndSelectNew,
  setTier1BottomSheet,
  setTier1BottomSheetAndSelectedEntity,
  setTier2BottomSheet,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  selectEntityMenuObject,
  selectInActiveEntities,
  selectInActiveVariants,
  selectModifierMap,
  selectVariantObject,
} from "@cx-sdk/catalog/state/Menu.slice";
import {
  setBottomSheet,
  setSelectedEntity,
} from "../../redux/features/menuSelections/menuSelections.slice";

import { useNavigate } from "react-router-dom";
import AutoScroll from "../../utils/autoScroll";
import { gridWiseSetting } from "@cx-sdk/catalog/state/theme.slice";
import useAllowMultiplePunch from "../customization/useAllowMultiplePunch";
import {
  shouldOpenMakeItAMealModal as shouldOpenMakeItAMealModalRule,
  isMakeItAMealEnabled as isMakeItAMealEnabledRule,
  checkCombo as checkComboRule,
  buildVariantEntityForComboSelection,
  findAppropriateVariantForSelectedItem as findAppropriateVariantForSelectedItemRule,
  makingItemInActiveAsBaseNotFound as makingItemInActiveAsBaseNotFoundRule,
  renderAppropriateConstituentItems as renderAppropriateConstituentItemsRule,
  findAppropriateConstituentItemsForMakeItAMeal as findAppropriateConstituentItemsForMakeItAMealRule,
  removeCustomization as removeCustomizationRule,
  updateQuantityForSelectedCustomization as updateQuantityForSelectedCustomizationRule,
  removeSelectedCustomizationConstituentItems as removeSelectedCustomizationConstituentItemsRule,
  updateQuantityCustomization as updateQuantityCustomizationRule,
  planStagedTierModal,
  planDoubleTierModal,
  evaluateReplaceItem,
} from "@cx-sdk/ordering/makeItAMeal/miamRules";

function useMakeItAMeal() {
  const kioskSettingsRdx = useSelector(kiosSettingsRdx);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  // This hook is instantiated once per ItemCard (ItemCard.tsx:85), so reaching
  // `isAllowMultiplePunch` through useMenuConverters cost ~63 store
  // subscriptions, three RTK Query hooks and a second whole-`state.cart`
  // subscription on every one of the ~120 mounted cards. The leaf hook is the
  // same implementation the converter now delegates to.
  const { isAllowMultiplePunch } = useAllowMultiplePunch();
  const MIAMSelectedItem = useSelector(makeItMealSelectedItem);
  const makeItAMealSession = useSelector(makeItAMealIsSessionOpen);
  const tier1CustOpen = useSelector(MIAMTier1Open);
  const tier2CustOpen = useSelector(MIAMTier2Open);
  const entityMap = useSelector(selectEntityMenuObject);
  const variantMap = useSelector(selectVariantObject);
  const selectModifiersRdx = useSelector(selectModifierMap);
  const inActiveEntitiesRdx = useSelector(selectInActiveEntities);
  const inActiveVariantsRdx = useSelector(selectInActiveVariants);

  const MIAMSession = useSelector(makeItAMealIsSessionOpen);
  const MIAMBottomsheet1 = useSelector(makeItAMealTier1BottomSheet);
  const hideComboConstituentAddonsRdx = useSelector(
    selectHideComboConstituentAddons,
  );
  const selectThemeRdx = useSelector(gridWiseSetting, shallowEqual);

  function isShowGridViewEnabled() {
    return selectThemeRdx;
  }

  const shouldOpenMakeItAMealModal = (entity: any) => {
    return shouldOpenMakeItAMealModalRule(
      kioskSettingsRdx,
      isShowGridViewEnabled(),
      entity,
    );
  };

  const isMakeItAMealEnabled = () => {
    return isMakeItAMealEnabledRule(kioskSettingsRdx, isShowGridViewEnabled());
  };

  const setTier1BottomSheetInRdx = (
    openType: any,
    status: any,
    whichModal: any,
  ) => {
    dispatch(
      setTier1BottomSheet({
        isOpen: openType,
        type: status,
        openType: whichModal,
      }),
    );
  };

  const setTier2BottomSheetInRdx = (
    openType: any,
    status: any,
    whichModal: any,
  ) => {
    dispatch(
      setTier2BottomSheet({
        isOpen: openType,
        type: status,
        openType: whichModal,
      }),
    );
  };

  const checkIfCustomizationAvailableForComboItems = (_entity: any) => {};

  //function to add to nestedObject
  const openNestedCustomizations = (
    isOpen: Boolean,
    selectedGroup: any,
    selectedConstituentItem: any,
    previousSelectedEntity: any,
  ) => {
    //assuming that it should only work in the make it a meal setting
    if (makeItAMealSession) {
      //open the variant based item if present

      dispatch(
        setNestedAvailableAddons({
          isOpen: isOpen,
          selectedGroup: selectedGroup,
          selectedConstituentItem: selectedConstituentItem,
          previousSelectedEntity: previousSelectedEntity,
        } as any),
      );
      return;
    }
    return;
  };

  const setIsOpenBottomSheet = (
    openType: any,
    status: any,
    whichModal: any,
  ) => {
    dispatch(
      setBottomSheet({
        isOpen: openType,
        type: status,
        openType: whichModal,
      }),
    );
  };

  const getVariantPropertiesWithoutState = (_entity: any) => {
    return;
  };

  const openCustomizationSheetForMakeItMeal = (currentEntity: any) => {
    // Assuming the selected entity is the variant item
    const selectedEntity = MIAMSelectedItem;

    const newEntity = buildVariantEntityForComboSelection(
      selectedEntity,
      currentEntity,
    );

    // Base item has no variants — the original implementation fell through
    // and returned undefined.
    if (newEntity === undefined) return;
    // Variants exist but none matched currentEntity.
    if (newEntity === null) return false;

    dispatch(
      setSelectedEntity({
        ...newEntity,
        subCategoryId: newEntity?.subCategoryId,
      }),
    );

    dispatch(openComboConstutientCustomizations());
    dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: {
          isOpen: true,
          type: "variant",
          openType: "new",
        },
        selectedEntity: {
          ...newEntity,
          quantity: 1,
          subCategoryId: newEntity?.subCategoryId,
          hasSecondTier: false,
        },
      }),
    );

    return true;
  };

  //find the variant from the entity/variant maps
  const findAppropriateVariantForSelectedItem = (variantItem: any) => {
    return findAppropriateVariantForSelectedItemRule(
      {
        hideComboConstituentAddons: hideComboConstituentAddonsRdx,
        entityMap,
        variantMap,
        modifierMap: selectModifiersRdx,
        isAllowMultiplePunch,
      },
      variantItem,
    );
  };

  //remove the customization accoriding to the id given
  const removeCustomization = (
    modifier: any,
    selectedCustomization: any,
    entityToBeRemoved: any,
  ) => removeCustomizationRule(modifier, selectedCustomization, entityToBeRemoved);

  const updateQuantityForSelectedCustomization = (
    selectedCustomization: any,
    modifierID: any,
    quantity: number,
    constituentItem: any,
  ) =>
    updateQuantityForSelectedCustomizationRule(
      selectedCustomization,
      modifierID,
      quantity,
      constituentItem,
    );

  //function to rmeove the data from the selected custmoization
  const removeSelectedCustomizationConstituentItems = (
    constituentItem: any,
    group: any,
    selectedCustomizations: any,
  ) =>
    removeSelectedCustomizationConstituentItemsRule(
      constituentItem,
      group,
      selectedCustomizations,
    );

  //increase quanitty for nested customization
  const updateQuantityCustomization = (
    selectedCustomization: any,
    groupID: any,
    itemID: any,
    typeOfUpdate: "increase" | "decrease",
  ) =>
    updateQuantityCustomizationRule(
      selectedCustomization,
      groupID,
      itemID,
      typeOfUpdate,
    );

  //find the appropriate constituents items and update the combo object with the new one for make it a meal
  const findAppropriateConstituentItemsForMakeItAMeal = (
    baseVariant: any,
    comboItemToBeUpdated: any,
  ) =>
    findAppropriateConstituentItemsForMakeItAMealRule(
      baseVariant,
      comboItemToBeUpdated,
    );

  const makingItemInActiveAsBaseNotFound = (constituentItems: any) =>
    makingItemInActiveAsBaseNotFoundRule(
      {
        entityMap,
        variantMap,
        inActiveEntities: inActiveEntitiesRdx,
        inActiveVariants: inActiveVariantsRdx,
      },
      constituentItems,
    );

  const renderAppropriateConstituentItems = (constituentItems: any) =>
    renderAppropriateConstituentItemsRule(
      {
        miamSessionOpen: MIAMSession,
        tier1SheetOpen: MIAMBottomsheet1?.isOpen,
        selectedItem: MIAMSelectedItem,
        entityMap,
        variantMap,
        inActiveEntities: inActiveEntitiesRdx,
        inActiveVariants: inActiveVariantsRdx,
      },
      constituentItems,
    );

  const checkCombo = (entity: any) => checkComboRule(entity);

  /**
   * The same multi-tier customization flow as `openDoubleTierModal`, opened
   * IN PLACE for an offer freebie — no `/customization` hop.
   *
   * The freebie picker (`ItemSelection`) keeps its open state in local React
   * state on `/cart`, so navigating away and back would drop the customer's
   * selection context (single-select target, and-offer groups, group-wise cap).
   * The tier modals are pure Redux-driven components, so the picker hosts them
   * itself and this opener only seeds the state they read.
   *
   * `isGetItem` on the selected entity is the marker the whole freebie path
   * keys off: the commit branch in `useCustomization` stages into
   * `cart.getItems` instead of the paid cart, the bottom bar hides the quantity
   * stepper (one freebie per pick, exactly as the legacy `getNew` sheet did),
   * and `addCustomizationToCart` skips the MIAM blacklist push.
   *
   * `openType` stays `"new"` on purpose — the tier components gate most of
   * their initialization on `openType === "new"`, so the legacy `"getNew"`
   * marker would leave them uninitialised.
   *
   * @returns true when a tier modal was opened, false when the entity needs no
   * customization and the caller should stage it directly.
   */
  const openGetItemTierModal = (entity: any) => {
    const plan = planStagedTierModal(
      entityMap,
      variantMap,
      selectModifiersRdx,
      entity,
      "isGetItem",
    );
    if (plan) {
      dispatch(openComboConstutientCustomizations());
      dispatch(setTier1BottomSheetAndSelectedEntity(plan));
      return true;
    }
    return false;
  };

  /**
   * `openGetItemTierModal`'s PAID twin, for the BOGO buy stage. Identical
   * in-place tier hosting (no `/customization` hop — the buy stage keeps its
   * open state in local React state on `/cart`), but the entity is stamped
   * `isBuyStageItem` instead of `isGetItem`: the commit lands in the paid
   * cart via `addItemToCart` (with the added-modal suppressed and the false
   * MIAM stamps stripped), and `useCustomization` treats the session as
   * in-modal — no return navigation — without touching the freebie path.
   *
   * @returns true when a tier modal was opened, false when the entity needs
   * no customization and the caller should add it to the cart directly.
   */
  const openBuyItemTierModal = (entity: any) => {
    const plan = planStagedTierModal(
      entityMap,
      variantMap,
      selectModifiersRdx,
      entity,
      "isBuyStageItem",
    );
    if (plan) {
      dispatch(openComboConstutientCustomizations());
      dispatch(setTier1BottomSheetAndSelectedEntity(plan));
      return true;
    }
    return false;
  };

  /**
   * @param navigationState optional router state for the /customization hop.
   * Pass `{ direction: "cart" }` when the customer should land on the cart
   * afterwards rather than the menu — the return trip reads `state.direction`
   * (useCustomization.ts:520, CustomizationPage.tsx:82) and defaults to /menu,
   * which silently teleports the customer backwards when the flow started
   * somewhere other than the menu.
   */
  const openDoubleTierModal = (
    entity: any,
    setBannerModalOpen?: any,
    navigationState?: any,
  ) => {
    const plan = planDoubleTierModal(
      entityMap,
      variantMap,
      selectModifiersRdx,
      entity,
    );
    if (plan) {
      dispatch(openComboConstutientCustomizations());
      dispatch(setTier1BottomSheetAndSelectedEntity(plan));
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- verbatim short-circuit call from the fork
      setBannerModalOpen && setBannerModalOpen(false);
    }
    navigate(
      "/customization",
      navigationState ? { state: navigationState } : undefined,
    );
  };

  const scrollModifier = (modifierId: any, scrollTop: any) => {
    return AutoScroll(
      document.getElementById(
        (tier1CustOpen && tier2CustOpen) || tier2CustOpen
          ? "scrollCustomizableItem2"
          : "scrollCustomizableItem",
      ),
      document.getElementById(modifierId)?.offsetTop,
      scrollTop,
    );
  };

  //check for opening replace item
  const checkReplaceItem = (
    min: any,
    max: any,
    selectedCustomizations: any,
    group: any,
    entity: any,
  ) => {
    const decision = evaluateReplaceItem(
      min,
      max,
      selectedCustomizations,
      group,
      entity,
    );
    if (!decision) return;
    console.log(
      "Selected Customizations",
      selectedCustomizations,
      decision.anyCustomizationPresent,
      entity?.id,
    );
    if (decision.shouldPromptReplace) {
      //open the remove
      dispatch(
        setRemovePreviousCustomizationAndSelectNew({
          isOpen: true,
          entityToBeAdded: entity,
          entityToBeRemoved: decision.existingItem,
          group: group,
        }) as any,
      );
      return;
    }
  };

  return {
    shouldOpenMakeItAMealModal,
    isMakeItAMealEnabled,
    checkIfCustomizationAvailableForComboItems,
    openNestedCustomizations,
    openCustomizationSheetForMakeItMeal,
    setIsOpenBottomSheet,
    findAppropriateVariantForSelectedItem,
    removeCustomization,
    updateQuantityCustomization,
    updateQuantityForSelectedCustomization,
    findAppropriateConstituentItemsForMakeItAMeal,
    removeSelectedCustomizationConstituentItems,
    renderAppropriateConstituentItems,
    makingItemInActiveAsBaseNotFound,
    openDoubleTierModal,
    openGetItemTierModal,
    openBuyItemTierModal,
    setTier2BottomSheetInRdx,
    setTier1BottomSheetInRdx,
    getVariantPropertiesWithoutState,
    checkCombo,
    scrollModifier,
    checkReplaceItem,
  };
}

export default useMakeItAMeal;
