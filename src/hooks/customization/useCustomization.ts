/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useCustomization wrapper (customization
 * vertical port). The anys are inherited; typed in later domain passes. Do not
 * add NEW anys.
 */
import { shallowEqual, useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { gridWiseSetting } from "@cx-sdk/catalog/state/theme.slice";
import {
  selectMinMaxErroredBaseItems,
  selectModifierMap,
  selectUpdatedBaseItems,
  setMinMaxErroredBaseItems,
  setUpdatedBaseItems,
} from "@cx-sdk/catalog/state/Menu.slice";
import { setBottomSheet } from "../../redux/features/menuSelections/menuSelections.slice";

import {
  checkCustomizationQuantity,
  generateString,
} from "@cx-sdk/catalog/menu/menuUtils";
import useLoyalty from "../loyalty/useLoyalty";
import useCartHook from "../menuHooks/useCartHook";
import { resolveCustomizationReturnPath } from "../../utils/customizationReturn";
import useMenuConverters from "../menuHooks/useMenuConverters";
import { useCallback, useState } from "react";
import useAppSettings from "../utils/useAppSettings";
import useGlobalTriggerServices from "../globals/useGlobalTriggerServices";
import AutoScroll from "../../utils/autoScroll";
import { useTranslation } from "react-i18next";
import {
  decreaseTier1selectedEntityQuantity,
  increaseTier1selectedEntityQuantity,
  makeItAMealIsSessionOpen,
  makeItMealSelectedItem,
  MIAMTier1Open,
  MIAMTier2Open,
  pushToMiamBlacklistItems,
  removeMakeItAMealItem,
  selectIsForceOpenMakeItAMealModal,
  tier1CustomizationSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";

import { closeTier1Modal } from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { closeTier2Modal } from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  setTier1BottomSheet,
  setTier2BottomSheet,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { closeMakeItAMealSession } from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  selectQuickCustomizatonMode,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import useMakeItAMeal from "../makeItAMeal/useMakeItAMeal";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import {
  applyDecreaseCustomization,
  applyIncreaseCustomization,
  applyMultiPunchSelection,
  applyQuantityUpdate,
  applySinglePunchSelection,
  checkCustomizationCount,
  insertLeadingItemsAfterModifier,
  type ContradictoryDelta,
} from "@cx-sdk/ordering/customization/selectionRules";
import {
  checkIfAllVariantIds,
  findFirstMinMaxViolation,
  isGroupMinMaxSatisfied,
  sortModifierIdsByOrder,
  validateVariantSelections,
} from "@cx-sdk/ordering/customization/groupCompletion";
import {
  getAccumulatedQuantity,
  getTotalValue,
  getTotalValueWithApplyAddonPrice,
} from "@cx-sdk/ordering/customization/pricing";
import {
  buildCartUpdatePayload,
  buildCustomizableCommitPayload,
  buildVariantCommitPayload,
  mergeCustomizations,
  stripBuyStageMarkers,
} from "@cx-sdk/ordering/customization/commitPayload";
import {
  buildEmptySelectionsForModifiers,
  convertModifiersAccordingly,
  findVariantModifier,
  getAvailableConstituentItems,
  locateModifierGroup,
} from "@cx-sdk/ordering/customization/sessionState";

const useCustomization = ({
  isOpenBottomSheet,
  setSelectedCustomizations,
  selectedCustomizations,
  SelectedEntity,
  addTier2CustomizationToMIAMCart,
}: any) => {
  // console.log("Customization");
  // const makeItMealRdx = useSelector(modalMakeItAMeal);
  const navigate = useNavigate();
  const selectThemeRdx = useSelector(gridWiseSetting, shallowEqual);
  const { state } = useLocation();
  const updatedBaseItemListRdx = useSelector(
    selectUpdatedBaseItems,
    shallowEqual,
  );
  const minMaxErroredBaseItemRdx = useSelector(
    selectMinMaxErroredBaseItems,
    shallowEqual,
  );
  const selectModifiersRdx = useSelector(selectModifierMap, shallowEqual);
  const MIAMSession = useSelector(makeItAMealIsSessionOpen, shallowEqual);
  const MIAMSelectedItem = useSelector(makeItMealSelectedItem, shallowEqual);
  const tier1CustOpen = useSelector(MIAMTier1Open);
  const tier2CustOpen = useSelector(MIAMTier2Open);
  /*
    Whether the ACTIVE tier session belongs to an offer freebie.

    Read off the tier-1 entity rather than this hook's `SelectedEntity`,
    because tier-2 is instantiated with the constituent it is customizing —
    which carries no freebie marker even when the session as a whole is one.
  */
  const tier1SelectedEntityRdx = useSelector(tier1CustomizationSelectedEntity);
  const isGetItemSession = Boolean(
    SelectedEntity?.isGetItem || tier1SelectedEntityRdx?.isGetItem,
  );
  /*
    The BOGO buy stage hosts the same tiers in-modal for PAID buy items
    (openBuyItemTierModal). Same read-off-tier-1 reasoning as isGetItemSession;
    kept as a separate marker because the commit destination differs — paid
    cart, not the freebie staging area.
  */
  const isBuyStageSession = Boolean(
    SelectedEntity?.isBuyStageItem || tier1SelectedEntityRdx?.isBuyStageItem,
  );
  const [contradictoryItems, setContradictoryItems] = useState({});
  const isForceOpenMakeItAMealModal = useSelector(
    selectIsForceOpenMakeItAMealModal,
  );
  const quickCustomizationRdx = useSelector(selectQuickCustomizatonMode);
  // Verbatim parity: the original destructured `findAppropriateVariantForSelectedItem`
  // (unused). The bare call keeps hook order and store subscriptions identical.
  useMakeItAMeal();
  const {
    isCheckBoxRequiredFunction,
    fetchModifierProperties,
    isAllowMultiplePunch,
    isStepperRequired,
  } = useMenuConverters();

  // const groupIDTier2 = useSelector(tier2MIAMGroupID);
  // const groupIDTier1 = useSelector(tier1MIAMGroupID);

  const MIAMSelectedCustomizationRdx = {};

  // const isOpenBottomSheet = useSelector(isBottomSheetOpen);
  // const selectedEntity = useSelector(selectCustomizations);
  const { triggerNotification } = useGlobalTriggerServices();

  const { t } = useTranslation();

  // const setIsOpenBottomSheet = (openType: any, status: any) => {
  //   dispatch(
  //     setBottomSheet({
  //       isOpen: openType,
  //       type: status,
  //     }),
  //   );
  // };

  // getTotalValueWithApplyAddonPrice now lives in
  // @cx-sdk/ordering/customization/pricing (imported above).

  const setIsOpenBottomSheet = (
    openType: any,
    status: any,
    whichModal: any,
  ) => {
    // console.log("Value", isOpenBottomSheet);
    dispatch(
      setBottomSheet({
        isOpen: openType,
        type: status,
        openType: whichModal,
      }),
    );
  };

  const setTier1BottomSheetInRdx = (
    openType: any,
    status: any,
    whichModal: any,
  ) => {
    // console.log("Value", isOpenBottomSheet);
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
    // console.log("Value", isOpenBottomSheet);
    dispatch(
      setTier2BottomSheet({
        isOpen: openType,
        type: status,
        openType: whichModal,
      }),
    );
  };

  function isShowGridViewEnabled() {
    return selectThemeRdx;
  }
  // const generateUniqueId = (id: any) => {
  //   return Date.now() + "_" + id;
  // };

  //cehck min and max for the whole customizations
  // Decision logic lives in the engine (findFirstMinMaxViolation); this
  // wrapper applies the error state + scroll effect for the first violation —
  // the original also only ever errored/scrolled once (it broke at the first
  // failing group).
  const checkMinMaxForWholeCustomizations = (customizations: any) => {
    const violation = findFirstMinMaxViolation(
      customizations,
      fetchModifierProperties,
      isAllowMultiplePunch(),
    );

    if (violation) {
      setErroredSection({
        id: violation.modifierID,
        name: violation.name,
      });

      AutoScroll(
        document.getElementById(
          tier1CustOpen && tier2CustOpen
            ? "scrollCustomizableItem2"
            : "scrollCustomizableItem",
        ),
        document.getElementById(violation.modifierID)?.offsetTop,
        450,
      );
      return false;
    }
    return true;
  };

  // const addNestedCustomizationToRelatedConstituentItem = () => {
  //   var checksForMinMax = checkMinMaxForWholeCustomizations(
  //     selectedCustomizations,
  //   ) as any;

  //   if (checksForMinMax) {
  //     const groupID = makeItMealRdx?.nestedCustomizations?.selectedGroup?._id;

  //     //generate unique id
  //     var itemID = generateUniqueId(
  //       makeItMealRdx?.nestedCustomizations?.selectedConstituentItem?.id,
  //     );

  //     //check for min max

  //     //check the min max for the groups
  //     dispatch(
  //       addSelectedCustomizations({
  //         groupID: groupID,
  //         customization: selectedCustomizations,
  //         customizationMeta: {
  //           nestedCustomizationID: itemID,
  //           type: "VARIANT",
  //           baseItem: SelectedEntity?.customizations?.selectedEntity,
  //           allAddonsPrice: getTotalValue(selectedCustomizations),
  //           priceWithBaseVariant:
  //             getTotalValue(selectedCustomizations) + selectedVariant?.price,
  //           priceWithConstituentItem: getTotalValue(selectedCustomizations),
  //           quantity: quantity,
  //         },
  //       } as any),
  //     );
  //     return true;
  //   } else {
  //     triggerNotification("Please Select Appropriate Customization");
  //     return false;
  //   }
  // };

  const dispatch = useDispatch();

  const { redeemItem } = useLoyalty();

  const {
    addItemToCart,
    updateItemCart,
    generateUniqueId,
    addGetItemToRdx,
    addLoyaltyItemToCart,
  } = useCartHook();
  // const SelectedEntity = useSelector(selectMenuSelections);

  const [isScrollingDown, setIsScrollingDown] = useState(false);
  const { calculationWrapper } = useAppSettings();
  const [disablePrevious, setDisabledPrevious] = useState(false);
  const disablePreviousButton = () => {
    setDisabledPrevious(true);
  };
  const enableDisablePreviousButton = () => {
    setDisabledPrevious(false);
  };
  //state to gryaout all the customizations if the modifier has reached its min and max
  const [grayOutAllCustomizations, setGrayOutAllCustomizations] = useState<any>(
    {
      isEnabled: false,
      modifierID: [],
    },
  );

  const setFalseGrayOut = (modifierIdToRemove: any) => {
    setGrayOutAllCustomizations((prevState: any) => ({
      isEnabled: prevState?.modifierID.length > 1,
      modifierID: prevState?.modifierID.filter(
        (id: any) => id !== modifierIdToRemove,
      ),
    }));
  };

  /**function if the item is of type variant
   * 1. Go the modifiers and get the values from it
   * 2. Show variants accordingly from the entity
   * */

  const [selectedModifier, setSelectedModifier] = useState<any>("");
  const [selectedVariant, setSelectedVariant] = useState<any>({});
  const [fetchedModifierGroups, setFetchModifierGroups] = useState<any>([]);
  const [erroredSection, setErroredSection] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [allCheckPassed, setAllCheckPassed] = useState(false);
  const [isFlippedToShowSubTotal, setIsFlippedToShowSubTotal] = useState(false);
  const [flippedModalData, setIsFlippedModalData] = useState<any>();
  const [sortedModifiers, setSortedModifiers] = useState<any>([]);

  //functions for functional group wise view elements
  //completed modifiers
  const [completedModifiers, setCompletedModifiers] = useState<any>([]);
  // useEffect(() => {
  //   // console.log("This is the completed modifiers", completedModifiers);
  // }, [completedModifiers]);
  //function to check wether the modifier group min max condition is satisfied or not
  const checkMinMaxConditionsForGroup = (modifierGroup: any) => {
    return isGroupMinMaxSatisfied({
      modifierGroup,
      selectedItems: selectedCustomizations[modifierGroup?._id],
      allowMultiplePunch: isAllowMultiplePunch(),
      tier1CustOpen,
      tier2CustOpen,
    });
  };
  //quantity related operations
  const increaseQuantity = () => {
    setQuantity(quantity + 1);
    captureKioskEvent(KioskEventName.ItemQuantityIncreaseViaCustomization, {
      item_id: SelectedEntity?.id,
      new_quantity: quantity + 1,
    });
  };

  // //useEffect to set quantity if edit modal opened
  // useEffect(() => {
  //   if (isOpenBottomSheet?.openType === "edit") {
  //     setConfirmedVariant(true);
  //     setQuantity(isOpenBottomSheet?.editCustomizationContent?.quantity);
  //     setLoaderVariantEdit(false);
  //   }
  // }, [isOpenBottomSheet]);

  const decreaseQuantity = () => {
    if (quantity > 1) {
      setQuantity(quantity - 1);
      captureKioskEvent(KioskEventName.ItemQuantityDecreaseViaCustomization, {
        item_id: SelectedEntity?.id,
        new_quantity: quantity - 1,
      });
    }
    //close the modal if quantity is less than 1
    else {
      closeModalStates();
      dispatch(closeMakeItAMealSession());
    }
  };

  // useEffect(() => {
  //   // alert("Selected Entity");
  //   //mark the selected customizations
  //   const customizationsInitial = {} as any;
  //   SelectedEntity?.customizations?.selectedEntity?.modifiers?.forEach(
  //     (modifier: any) => {
  //       customizationsInitial[modifier] = [];
  //     },
  //   );
  // }, [selectedVariant]);

  //useEffect for checking the selectedCustomizations
  // useEffect(() => {
  //   //empty the selected customizations
  //   if (
  //     Object.keys(selectedVariant).length > 0 &&
  //     isOpenBottomSheet?.openType === "new"
  //   ) {
  //     var modifierProperties = fetchModifierProperties(
  //       selectedVariant?.modifiers,
  //       menu?.modifiers,
  //     );
  //     //go through every modifier properties check if it is active and add it to selected customizations with empty object =
  //     var returnableObject = {} as any;
  //     {
  //       modifierProperties?.length > 0 &&
  //         modifierProperties.forEach((modifier: any) => {
  //           if (modifier?.isActive && modifier) {
  //             returnableObject[modifier._id] = [];
  //           }
  //         });
  //     }
  //     setSelectedCustomizations(returnableObject);
  //   }
  // }, [selectedVariant]);

  const closeModalStates = async () => {
    try {
      if (isForceOpenMakeItAMealModal) {
        dispatch(
          closeMakeItAMealSession({
            force: false,
          }),
        );
      } else {
        dispatch(
          closeMakeItAMealSession({
            force: false,
          }),
        );
      }
      setSelectedVariant({});
      setSelectedModifier("");
      setFetchModifierGroups([]);
      dispatch(setSelectedCustomizations({}));
      setQuantity(1);
      setAllCheckPassed(false);
      setErroredSection({});
      setCompletedModifiers([]);
      setConfirmedVariant(false);
      enableDisablePreviousButton();
      dispatch(closeTier1Modal());
      dispatch(closeTier2Modal());

      // A freebie is customized IN PLACE inside the offers picker on /cart, so
      // there is no /customization route to return from. Navigating here would
      // send the customer to /menu (the default when no router state was set)
      // and unmount the picker mid-selection. The buy stage hosts its paid
      // tier sessions the same way, so it gets the same exemption.
      if (!isGetItemSession && !isBuyStageSession) {
        navigate(resolveCustomizationReturnPath(state));
      }

      // dispatch(closeSelectedEntity());
    } catch (error) {
      console.error(error);
    }
  };
  // getTotalValue and checkIfAllVariantIds now live in the engine
  // (@cx-sdk/ordering/customization/pricing and .../groupCompletion).

  //close backdrop with selected variants or addons or variants
  const closeDependentOnAddonsOrVariants = () => {
    // alert(JSON.stringify(selectedVariant));

    if (SelectedEntity?.hasVariant) {
      //check if the variant exixts
      if (Object.keys(selectedVariant)?.length > 0) {
        return;
      } else {
        closeModalStates();
      }
      return;
    } else {
      if (!checkIfAllVariantIds(selectedCustomizations)) {
        closeModalStates();
      } else {
        return;
      }
    }
  };

  //function to check for each modifier
  const setErroredSectionForModifier = (modifier: any) => {
    const modifierProperties = fetchModifierProperties([modifier]);
    if (modifierProperties?.length > 0 && modifierProperties[0]?.isActive) {
      setErroredSection({
        id: modifier,
        name: modifier.name,
      });
      return false;
    } else {
      return true;
    }
  };

  // Applies the contradictory-item bookkeeping an engine transform reports.
  // Removal is applied before addition, matching the original call order.
  const applyContradictoryOutcome = (outcome: ContradictoryDelta) => {
    if (outcome.contradictoryToRemove) {
      const keyToRemove = outcome.contradictoryToRemove;
      setContradictoryItems((prev: any) => {
        const newState = { ...prev };
        delete newState[keyToRemove];
        return newState;
      });
    }
    if (outcome.contradictoryToAdd) {
      const keyToAdd = outcome.contradictoryToAdd;
      setContradictoryItems((prev: any) => ({
        ...prev,
        [keyToAdd]: true,
      }));
    }
  };

  // The quick-customization "advance to next group" state update. This exact
  // closure appeared verbatim at every auto-advance site in handleMultiPunch,
  // increaseCustomization and handleSinglePunch's flexible branch (the
  // single-slot branch keeps its own variant that respects re-sorted leading
  // modifiers and skips setCompletedModifiers on the non-zero path).
  const advanceQuickCustomizationIndex = (prev: any) => {
    if (prev === 0) {
      setCompletedModifiers((modifiers: any) => {
        return [...modifiers, selectedGroup];
      });
      setSelectedGroup(sortedModifiers[currentIndex + 1]);
      if (prev + 1 === sortedModifiers?.length) {
        setSelectedGroup(null);
        return;
      }

      return 1;
    } else {
      const currentPrev = prev;
      setSelectedGroup(sortedModifiers[currentIndex + 1]);

      setCompletedModifiers((modifiers: any) => {
        return [...modifiers, selectedGroup];
      });

      if (currentPrev + 1 === sortedModifiers?.length) {
        setSelectedGroup(null);
        return;
      }
      return prev + 1;
    }
  };

  const handleMultiPunch = (
    modifier: any,
    item: any,
    availableModifiers?: any,
    handleMultiAutoSelect?: any,
    selectedCustomizationsObject?: any,
    nextModifier?: any,
  ) => {
    let customizations = handleMultiAutoSelect
      ? JSON.parse(JSON.stringify(selectedCustomizationsObject))
      : JSON.parse(JSON.stringify(selectedCustomizations));

    // The selection/deselection list math and contradictory-item deltas live
    // in the engine; this wrapper keeps the quick-customization advancement,
    // scrolling and mid-flow cart commits on exactly the branches the
    // original ran them on (keyed off the outcome's branch/action tags).
    const outcome = applyMultiPunchSelection({
      customizations,
      modifier,
      item,
      allowMultiplePunch: isAllowMultiplePunch(),
      generateUniqueId,
    });
    customizations = outcome.customizations;
    applyContradictoryOutcome(outcome);

    const max = isAllowMultiplePunch()
      ? modifier?.multiplePunchMax
      : modifier?.max;

    if (outcome.branch === "single-slot") {
      if (quickCustomizationRdx) {
        if (
          checkCustomizationCount(customizations, modifier?._id) === max &&
          !item?.isAllModifersOptional
        ) {
          //add customization

          setCurrentIndex(advanceQuickCustomizationIndex);
          if (currentIndex === availableModifiers?.length - 1) {
            if (tier1CustOpen && !tier2CustOpen) {
              addCustomizationToCart(customizations);
              // closeModalStates();
              return customizations;
            }
          }

          if (
            !isShowGridViewEnabled() &&
            // !SelectedEntity?.hasSecondTier &&
            checkCustomizationQuantity(customizations, modifier?.id, max)
          ) {
            if (nextModifier) {
              AutoScroll(
                document.getElementById(
                  tier1CustOpen && tier2CustOpen
                    ? "scrollCustomizableItem2"
                    : "scrollCustomizableItem",
                ),
                document.getElementById(nextModifier?._id)?.offsetTop,
                450,
              );
            } else if (isOpenBottomSheet?.openType !== "edit") {
              if (tier2CustOpen) {
                addTier2CustomizationToMIAMCart(customizations);
              } else {
                addCustomizationToCart(customizations);
                // closeModalStates();
                return customizations;
              }
            }
          }
        }
      }
    } else if (outcome.branch === "accumulate" && outcome.action === "added") {
      if (quickCustomizationRdx) {
        if (
          checkCustomizationCount(customizations, modifier?._id) == max &&
          !item?.isAllModifersOptional
        ) {
          //add customization

          setCurrentIndex(advanceQuickCustomizationIndex);

          if (currentIndex === availableModifiers?.length - 1) {
            if (tier1CustOpen && !tier2CustOpen) {
              addCustomizationToCart(customizations);
              // closeModalStates();
              return customizations;
            } else {
              // verbatim: the original left this branch empty
            }
          }

          if (
            !isShowGridViewEnabled() &&
            // !SelectedEntity?.hasSecondTier &&
            checkCustomizationQuantity(customizations, modifier?.id, max)
          ) {
            if (nextModifier) {
              AutoScroll(
                document.getElementById(
                  tier1CustOpen && tier2CustOpen
                    ? "scrollCustomizableItem2"
                    : "scrollCustomizableItem",
                ),
                document.getElementById(nextModifier?._id)?.offsetTop,
                450,
              );
            } else if (isOpenBottomSheet?.openType !== "edit") {
              if (tier2CustOpen) {
                addTier2CustomizationToMIAMCart(customizations);
              } else {
                addCustomizationToCart(customizations);
                // closeModalStates();
                return customizations;
              }
            }
          }
        }
      }
    } else if (outcome.branch === "first-add") {
      if (quickCustomizationRdx) {
        console.log(
          "next modifier",
          nextModifier,
          checkCustomizationCount(customizations, modifier?._id),
          max,
          modifier,
        );

        if (
          checkCustomizationCount(customizations, modifier?._id) == max &&
          !item?.isAllModifersOptional
        ) {
          //add customization

          setCurrentIndex(advanceQuickCustomizationIndex);

          if (currentIndex === availableModifiers?.length - 1) {
            if (tier1CustOpen && !tier2CustOpen) {
              addCustomizationToCart(customizations);
              // closeModalStates();
              return customizations;
            } else {
              // verbatim: the original left this branch empty
            }
          }

          if (
            !isShowGridViewEnabled() &&
            // !SelectedEntity?.hasSecondTier &&
            // !tier1CustOpen &&
            checkCustomizationQuantity(customizations, modifier?.id, max)
          ) {
            if (nextModifier && !item?.isAllModifersOptional) {
              AutoScroll(
                document.getElementById(
                  tier1CustOpen && tier2CustOpen
                    ? "scrollCustomizableItem2"
                    : "scrollCustomizableItem",
                ),
                document.getElementById(nextModifier?._id)?.offsetTop,
                450,
              );
            } else if (isOpenBottomSheet?.openType !== "edit") {
              if (tier2CustOpen) {
                addTier2CustomizationToMIAMCart(customizations);
              } else {
                addCustomizationToCart(customizations);
                // closeModalStates();
                return customizations;
              }
            }
          }
        }
      }
    }

    // Return the modified object to update the state

    if (handleMultiAutoSelect) {
      selectedCustomizationsObject[modifier._id] = [
        ...customizations[modifier._id],
      ];
    }

    dispatch(setSelectedCustomizations(customizations));
    return customizations;
  };

  const increaseCustomization = (
    modifier: any,
    item: any,
    availableModifiers: any,
    nextModifier: any,
  ) => {
    // Stepper math lives in the engine; the quick-customization advancement,
    // scrolling and mid-flow commits below run only when it actually
    // incremented — the same paths the original took.
    const increaseOutcome = applyIncreaseCustomization(
      selectedCustomizations,
      modifier,
      item,
    );
    const customizations = increaseOutcome.customizations;

    if (increaseOutcome.increased) {
      const max = isAllowMultiplePunch()
        ? modifier?.multiplePunchMax
        : modifier?.max;
      if (quickCustomizationRdx) {
        if (
          checkCustomizationCount(customizations, modifier?._id) === max &&
          !item?.isAllModifersOptional
        ) {
          //add customization

          setCurrentIndex(advanceQuickCustomizationIndex);
          if (currentIndex === availableModifiers?.length - 1) {
            if (tier1CustOpen && !tier2CustOpen) {
              addCustomizationToCart(customizations);
              // closeModalStates();
              return customizations;
            } else {
              // verbatim: the original left this branch empty
            }
          }

          console.log(
            "hello world in the world",
            !isShowGridViewEnabled(),
            // !SelectedEntity?.hasSecondTier,
            checkCustomizationQuantity(customizations, modifier?.id, max),
          );

          if (
            !isShowGridViewEnabled() &&
            // !SelectedEntity?.hasSecondTier &&
            checkCustomizationQuantity(customizations, modifier?.id, max)
          ) {
            if (nextModifier) {
              AutoScroll(
                document.getElementById(
                  tier1CustOpen && tier2CustOpen
                    ? "scrollCustomizableItem2"
                    : "scrollCustomizableItem",
                ),
                document.getElementById(nextModifier?._id)?.offsetTop,
                450,
              );
            } else if (isOpenBottomSheet?.openType !== "edit") {
              if (tier2CustOpen) {
                addTier2CustomizationToMIAMCart(customizations);
              } else {
                addCustomizationToCart(customizations);
                // closeModalStates();
                return customizations;
              }
            }
          }
        }
      }
    } else {
      // toast.error(t("toast.alreadyReachedMaximumLimit"));
      triggerNotification(t("toast.alreadyReachedMaximumLimit"));
    }
    dispatch(setSelectedCustomizations(customizations));
    // Return the modified object to update the state
    return customizations;
  };

  const decreaseCustomization = (modifier: any, item: any) => {
    // Stepper math lives in the engine; removal at quantity 1 also clears the
    // item's contradictory mark, which the wrapper applies here.
    const decreaseOutcome = applyDecreaseCustomization(
      selectedCustomizations,
      modifier,
      item,
    );
    applyContradictoryOutcome(decreaseOutcome);

    dispatch(setSelectedCustomizations(decreaseOutcome.customizations));
    // Return the modified object to update the state
    return decreaseOutcome.customizations;
  };

  const addCustomizations = (
    modifier: any,
    item: any,
    availableModifiers: any,
    nextModifier: any,
    forceSelected: any,
    handleMultiAutoSelect?: any,
    selectedCustomizationsObject?: any,
  ) => {
    //to be changed later
    // if (isAllowMultiplePunch()) {
    // alert("Multi punch");

    captureKioskEvent(KioskEventName.ModifierSelected, {
      item_id: SelectedEntity?.id,
      modifier_id: item?.id,
      modifier_name: item?.name,
      modifier_group: modifier?._id,
    });

    if (modifier?.multiplePunchMaxItem > 1 && tier1CustOpen && !tier2CustOpen) {
      return handleMultiPunch(
        modifier,
        item,
        availableModifiers,
        handleMultiAutoSelect,
        selectedCustomizationsObject,
        nextModifier,
      );
    } else {
      // return handleSinglePunch(modifier, item, {}, forceSelected);
      return handleSinglePunch(
        modifier,
        item,
        availableModifiers,
        nextModifier,
        forceSelected,
        handleMultiAutoSelect,
        selectedCustomizationsObject,
      );
    }

    // }
    // else {
    //   console.log("Single Punch");
    //   return handleSinglePunch(modifier, item, {}, forceSelected);
    // }
    // });
  };

  // mergeCustomizations now lives in
  // @cx-sdk/ordering/customization/commitPayload (imported above).

  const updateCustomizableItemInCart = (
    selectedEntity: any,
    selectedVariant: any,
    tier1Customizations: any,
    tier2Customizations: any,
    isMakeItAMealSessionActive: boolean,
  ) => {
    // Helper function to handle notifications
    const notifyError = (message: string) => {
      triggerNotification(message);
      return false;
    };

    // Payload shape lives in the engine (buildCartUpdatePayload); the
    // closured quantity / variant price / MIAM flag now travel as explicit
    // parameters carrying the same values. sortModifierIdsByOrder keeps the
    // legacy in-place sort side effect of the old processModifiers.

    // Validate customizations
    const validateCustomizations = () => {
      if (!checkMinMaxForWholeCustomizations(selectedCustomizations)) {
        return notifyError("Please select all the customizations");
      }
      return true;
    };

    if (selectedEntity?.customizations?.selectedEntity?.hasVariant) {
      // Variant case
      if (Object.keys(selectedVariant).length === 0) {
        notifyError("Please select the variant first");
        return;
      }

      const itemToUpdate = buildCartUpdatePayload({
        baseItem: {
          ...selectedEntity.customizations.selectedEntity,
          selectedVariantId: selectedVariant.id,
          selectedVariantName: selectedVariant?.name,
        },
        type: "VARIANT",
        customizations: mergeCustomizations(
          selectedCustomizations,
          MIAMSelectedCustomizationRdx,
        ),
        quantity,
        selectedVariantPrice: selectedVariant?.price,
        isMakeItAMealItem: isMakeItAMealSessionActive,
        additionalFields: {
          variantPrice: selectedVariant?.price,
          selectedVariantModifiers: selectedVariant?.modifiers,
        },
      });

      sortModifierIdsByOrder(fetchModifierProperties(selectedVariant.modifiers));

      if (!validateCustomizations()) return false;

      // Update the item in the cart
      updateItemCart(itemToUpdate);
      setIsFlippedToShowSubTotal(true);
      setIsFlippedModalData({
        mainHeading: "Item Updated Successfully",
        subHeading: `Item worth ${
          getTotalValue(selectedCustomizations) + selectedVariant?.price
        } updated in the cart`,
      });

      return true;
    }

    if (selectedEntity?.customizations?.selectedEntity?.modifiers?.length > 0) {
      // Customizable case
      const itemToUpdate = buildCartUpdatePayload({
        baseItem: selectedEntity.customizations.selectedEntity,
        type: "CUSTOMIZABLE",
        customizations: mergeCustomizations(
          tier1Customizations,
          tier2Customizations,
        ),
        quantity,
        selectedVariantPrice: selectedVariant?.price,
        isMakeItAMealItem: isMakeItAMealSessionActive,
        additionalFields: {
          // nestedCustomizations: makeItMealRdx || {},
        },
      });

      sortModifierIdsByOrder(
        fetchModifierProperties(
          selectedEntity.customizations.selectedEntity.modifiers,
        ),
      );

      if (!validateCustomizations()) return false;

      // Update the item in the cart
      updateItemCart(itemToUpdate);
      closeModalStates();

      return true;
    }

    return false;
  };

  const openRepeatItemModalForRespectiveItem = (_entity: any, _group: any) => {};

  // const addTier2CustomizationToMIAMCart = () => {
  //   var baseCustomizations = JSON.parse(
  //     JSON.stringify(
  //       MIAMTier1Customization.customizations.selectedCustomizations,
  //     ),
  //   );
  //   const generateUniqueId = (id: any) => {
  //     return Date.now() + "_" + id;
  //   };
  //   // create a unique id for repeat item
  //   const uniqueId = generateUniqueId(
  //     SelectedEntity.customizations.selectedEntity?.id,
  //   );

  //   if (baseCustomizations[MIAMTier2Customization?.groupId]) {
  //     baseCustomizations[MIAMTier2Customization?.groupId] = [
  //       ...baseCustomizations[MIAMTier2Customization.groupId],
  //       {
  //         ...SelectedEntity.customizations.selectedEntity,
  //         quantity: SelectedEntity.customizations.selectedEntity?.quantity,
  //         itemId: uniqueId,
  //         isActive: true,
  //         isConfigurationError: false,
  //         // price: 0,
  //         customizations:
  //           MIAMTier2Customization.customizations.selectedCustomizations,
  //       },
  //     ];

  //     dispatch(addTier2CustomizationsToTier1(baseCustomizations));
  //     dispatch(closeTier2Modal());
  //   }

  //   // var mergCustomizations = mergeCustomizations(
  //   //   ,
  //   //   makeItMealRdx.tier2CustomizationModal.customizations
  //   //     .selectedCustomizations,
  // };

  // const updateTier2CustomizationToMIAMCart = (itemId: any) => {
  //   var baseCustomizations = JSON.parse(
  //     JSON.stringify(
  //       MIAMTier1Customization.customizations.selectedCustomizations,
  //     ),
  //   );
  //   if (baseCustomizations[MIAMTier2Customization?.groupId]) {
  //     baseCustomizations[MIAMTier2Customization?.groupId] = baseCustomizations[
  //       MIAMTier2Customization.groupId
  //     ].map((entity: any) => {
  //       if (entity.itemId === itemId) {
  //         return {
  //           ...SelectedEntity.customizations.selectedEntity,
  //           quantity: SelectedEntity.customizations.selectedEntity.quantity,
  //           isActive: true,
  //           isConfigurationError: false,
  //           // price: 0,
  //           customizations:
  //             MIAMTier2Customization.customizations.selectedCustomizations,
  //         };
  //       } else {
  //         return entity;
  //       }
  //     });
  //   }
  //   // console.log("Base Customizations", baseCustomizations);
  //   dispatch(addTier2CustomizationsToTier1(baseCustomizations));
  //   dispatch(closeTier2Modal());
  // };

  const updateMIAMCart = (_entity: any) => {
    // if (MIAMTier2Customization?.isOpen) {
    //   updateTier2CustomizationToMIAMCart(entity.itemId);
    // } else {
    // alert("Update Tier 1");
    addTier1CustomizationToMIAMCart();
    // }
  };

  const addCustomizationToCart = (customization: any) => {
    try {
      // `addTier1CustomizationToMIAMCart` returns `true` only when the item is
      // actually committed to the cart. It returns `false` (and shows an error
      // modal) when validation fails — no variant selected, or min/max not met.
      const wasAdded = customization
        ? addTier1CustomizationToMIAMCart(customization)
        : addTier1CustomizationToMIAMCart();
      dispatch(removeMakeItAMealItem());

      if (!MIAMSession && !SelectedEntity?.isGetItem) {
        dispatch(
          pushToMiamBlacklistItems({
            id: SelectedEntity?.id,
          } as any),
        );
      }

      // Only record the add when it genuinely succeeded, so the conversion
      // metric is not inflated by rejected/failed customization attempts.
      // A freebie is not a purchase decision and the legacy get-item sheet
      // never emitted this, so it stays out of the item-added funnel.
      if (wasAdded === true && !SelectedEntity?.isGetItem) {
        captureKioskEvent(KioskEventName.ItemAddedToCart, {
          item_id: SelectedEntity?.id,
          item_name: SelectedEntity?.name,
          // What actually lands on the row: the engine's commit builders
          // (buildVariantCommitPayload / buildCustomizableCommitPayload)
          // spread SelectedEntity AFTER their own quantity field, so the
          // committed quantity is the redux entity's (the visible stepper),
          // not this hook's local state — which stays 1 for in-modal tier
          // sessions.
          quantity: SelectedEntity?.quantity ?? quantity,
          item_price: SelectedEntity?.price,
          customized: true,
        });
      }
    } catch (error) {
      console.error("addCustomizationToCart failed", error);
    }
  };

  const addTier1CustomizationToMIAMCart = (customization?: any) => {
    // helper: get merged customizations (prefer explicit arg)
    const getMergedCustomizations = () =>
      customization ? customization : selectedCustomizations;

    // helper: scroll & set errored state. The validation scan itself lives in
    // the engine (validateVariantSelections) — it stops at the first failing
    // modifier, exactly where the original applied this effect mid-scan.
    const handleErroredModifier = (modifier: any) => {
      setErroredSection({
        id: modifier,
        name: modifier?.name,
      });
      AutoScroll(
        document.getElementById("scrollCustomizableItem"),
        document.getElementById(modifier)?.offsetTop,
        450,
      );
      setIsScrollingDown(true);
    };

    // --- Start main flow ---
    if (SelectedEntity?.hasVariant) {
      // require variant selection
      if (Object.keys(selectedVariant).length === 0) {
        dispatch(
          setShowErrorModalGlobal({
            showErrorModal: true,
            errorMessage: t("toast.selectVariantFirst"),
          }),
        );
        return false;
      }

      const mergedCustomizations = getMergedCustomizations();

      // build the returnable object once (shape lives in the engine)
      const returnableFinalObject = buildVariantCommitPayload({
        selectedEntity: SelectedEntity,
        selectedVariant,
        mergedCustomizations,
        quantity,
        isMakeItAMealItem: MIAMSession,
        makeItAMealSelectedItem: MIAMSession ? MIAMSelectedItem : {},
      });

      console.log(
        "Returnable Object of variant",
        returnableFinalObject,
        selectedVariant,
      );

      // prepare modifier properties for the variant and run min/max checks
      const properties =
        fetchModifierProperties(selectedVariant.modifiers) || [];
      const idsModifiers = sortModifierIdsByOrder(properties);

      const verdict = validateVariantSelections({
        modifierIds: idsModifiers,
        mergedCustomizations,
        fetchModifierProperties,
        allowMultiplePunch: isAllowMultiplePunch(),
      });

      if (!verdict.allPassed) {
        handleErroredModifier(verdict.errorModifierId);
        dispatch(
          setShowErrorModalGlobal({
            showErrorModal: true,
            errorMessage: t("toast.selectAllCustomizations"),
          }),
        );
        return false;
      }

      // EDIT vs ADD flows preserved exactly
      if (isOpenBottomSheet?.openType === "edit") {
        console.log("Edit mode for variant item", returnableFinalObject);
        updateItemCart(returnableFinalObject);
        setIsFlippedToShowSubTotal(true);
        setIsFlippedModalData({
          mainHeading: "Item Updated SuccessFully",
          subHeading: `Item worth ${
            getTotalValue(mergedCustomizations) + selectedVariant?.price
          } updated in the cart `,
        });
      } else {
        // An offer freebie stages into cart.getItems, never the paid cart —
        // the same commit the legacy "getNew" sheet made. Without this branch
        // a customized freebie is billed at full price and the offer never
        // sees the item it gave away.
        if (SelectedEntity?.isGetItem) {
          addGetItemToRdx(returnableFinalObject, "VARIANT");
        } else if (SelectedEntity?.isLoyaltyItem) {
          // DELIBERATE FORK DIVERGENCE (P7c decision 10): the fork calls
          // redeemItem() and DROPS its return, so a customizable XENO reward
          // is priced and then thrown away — it never reaches the cart. Commit
          // the priced row the same way the redemption sheet does
          // (LoyaltyItemsModal.tsx:200 — addLoyaltyItemToCart(item, item.type)).
          const redeemedLoyaltyRow = redeemItem(returnableFinalObject);
          addLoyaltyItemToCart(
            redeemedLoyaltyRow,
            redeemedLoyaltyRow?.type ?? "ITEM",
          );
        } else if (SelectedEntity?.isBuyStageItem) {
          // Buy-stage commit: an ordinary PAID row (marker-stripping lives in
          // the engine's stripBuyStageMarkers), and the added-modal is
          // suppressed so it cannot pop over the offers modal hosting this
          // tier.
          addItemToCart(stripBuyStageMarkers(returnableFinalObject), "VARIANT", {
            suppressAddedModal: true,
          });
        } else {
          console.log("Adding item to cart variant", returnableFinalObject);
          addItemToCart(returnableFinalObject, "VARIANT");
        }
      }

      closeModalStates();
      return true;
    } else if (SelectedEntity?.modifiers?.length > 0) {
      // CUSTOMIZABLE (non-variant) branch

      const mergedCustomizations = mergeCustomizations(
        getMergedCustomizations(),
        MIAMSelectedCustomizationRdx,
      );

      // shape lives in the engine (base returnable + CUSTOMIZABLE overrides)
      const returnableFinalObject = buildCustomizableCommitPayload({
        selectedEntity: SelectedEntity,
        mergedCustomizations,
        quantity,
        isMakeItAMealItem: MIAMSession,
        makeItAMealSelectedItem: MIAMSession ? MIAMSelectedItem : {},
      });

      // fetch and prepare properties (keeps original ordering behavior)
      const properties =
        fetchModifierProperties(SelectedEntity?.modifiers) || [];
      sortModifierIdsByOrder(properties);

      // existing helper used: checkMinMaxForWholeCustomizations (unchanged)

      const allCheckPassed = checkMinMaxForWholeCustomizations(
        getMergedCustomizations(),
      );

      console.log("All check passed", allCheckPassed);

      if (!allCheckPassed) {
        console.log("Checks failed ", selectedCustomizations);
        dispatch(
          setShowErrorModalGlobal({
            showErrorModal: true,
            errorMessage: t("toast.fillCustomizationFields"),
          }),
        );
        return false;
      }

      if (isOpenBottomSheet?.openType === "edit") {
        updateItemCart(returnableFinalObject);

        const newUpdatedItem = updatedBaseItemListRdx.filter(
          (id: any) => id !== returnableFinalObject?.itemId,
        );
        const newMinMaxIds = minMaxErroredBaseItemRdx.filter(
          (id: any) => id !== returnableFinalObject?.itemId,
        );
        dispatch(
          setMinMaxErroredBaseItems({
            minMaxErroredBaseItems: newMinMaxIds,
          }),
        );
        dispatch(
          setUpdatedBaseItems({
            updatedBaseItems: newUpdatedItem,
          }),
        );

        closeModalStates();
      } else {
        // See the VARIANT branch above — freebies stage into cart.getItems.
        if (SelectedEntity?.isGetItem) {
          addGetItemToRdx(returnableFinalObject, "CUSTOMIZABLE");
        } else if (SelectedEntity?.isLoyaltyItem) {
          // Same deliberate fork divergence as the VARIANT branch above
          // (P7c decision 10) — commit the priced reward row instead of
          // discarding redeemItem's return.
          const redeemedLoyaltyRow = redeemItem(returnableFinalObject);
          addLoyaltyItemToCart(
            redeemedLoyaltyRow,
            redeemedLoyaltyRow?.type ?? "ITEM",
          );
        } else if (SelectedEntity?.isBuyStageItem) {
          // Buy-stage commit — see the VARIANT branch above.
          addItemToCart(
            stripBuyStageMarkers(returnableFinalObject),
            "CUSTOMIZABLE",
            { suppressAddedModal: true },
          );
        } else {
          console.log(
            "returnableFinalObjectaksdjasdjkjkasdj",
            returnableFinalObject,
          );
          addItemToCart(returnableFinalObject, "CUSTOMIZABLE");
        }

        closeModalStates();
        return true;
      }

      return true;
    }

    // fallback: close and exit (same as original end)
    closeModalStates();
  };

  // const updateTier1ToMIAMCart = () => {
  //   const baseCustomizations = JSON.parse(
  //     JSON.stringify(
  //       makeItMealRdx.tier1CustomizationModal.customizations
  //         .selectedCustomizations,
  //     ),
  //   );
  //   const generateUniqueId = (id: any) => {
  //     return Date.now() + "_" + id;
  //   };
  //   // create a unique id for repeat item
  //   const uniqueId = generateUniqueId(
  //     SelectedEntity.customizations.selectedEntity?.id,
  //   );

  //   if (baseCustomizations[makeItMealRdx?.tier1CustomizationModal?.groupId]) {
  //     baseCustomizations[makeItMealRdx?.tier1CustomizationModal?.groupId] = [
  //       ...baseCustomizations[makeItMealRdx?.tier1CustomizationModal.groupId],
  //       {
  //         ...SelectedEntity.customizations.selectedEntity,
  //         quantity: 1,
  //         itemId: uniqueId,
  //         isActive: true,
  //         isConfigurationError: false,
  //         // price: 0,
  //         customizations:
  //           makeItMealRdx.tier1CustomizationModal.customizations
  //             .selectedCustomizations,
  //       },
  //     ];

  //     // dispatch(addTier1CustomizationsToTier1(baseCustomizations));
  //     dispatch(closeTier1Modal());
  //   }
  // };
  //fetch variant modifier
  const getVariantProperties = (entity: any) => {
    const modifier = findVariantModifier(entity, selectModifiersRdx);
    setSelectedModifier(modifier);
    return modifier;
  };

  // insertLeadingItemsAfterModifier and checkCustomizationCount now live in
  // @cx-sdk/ordering/customization/selectionRules (imported above).

  //change sorting of items according to the leading modiifer  chrome

  //function to add the customizations handling the min max and also adding the modifier id
  const handleSinglePunch = (
    modifier: any,
    item: any,
    availableModifiers?: any,
    nextModifier?: any,
    selectionConfirmed?: any,
    handleMultiAutoSelect?: any,
    selectedCustomizationsObject?: any,
  ) => {
    const modifierMax = isAllowMultiplePunch()
      ? modifier.multiplePunchMax
      : modifier.max;
    // Reset any previous errors
    setErroredSection({});

    // Create a copy of the selectedCustomizations state
    let customizations: any = handleMultiAutoSelect
      ? JSON.parse(JSON.stringify(selectedCustomizationsObject))
      : JSON.parse(JSON.stringify(selectedCustomizations));

    // The selection/deselection list math and contradictory-item deltas live
    // in the engine; this wrapper keeps the leading-modifier re-sort, the
    // quick-customization advancement, scrolling, mid-flow cart commits and
    // gray-out state on exactly the branches the original ran them on.
    const outcome = applySinglePunchSelection({
      customizations,
      modifier,
      item,
      allowMultiplePunch: isAllowMultiplePunch(),
      selectionConfirmed,
    });
    customizations = outcome.customizations;
    applyContradictoryOutcome(outcome);

    if (outcome.branch === "single-slot") {
      // Case 1: Modifier requires exactly one item from many options
      let newModifiers: any;
      if (modifier?.isLeadingGrp) {
        console.log(
          "Modifier groups sidharth",
          sortedModifiers,
          modifier?._id,
          item?.id,
          insertLeadingItemsAfterModifier(
            sortedModifiers,
            item?.id,
            modifier?._id,
          ),
        );
        newModifiers = insertLeadingItemsAfterModifier(
          sortedModifiers,
          item?.id,
          modifier?._id,
        );
        setSortedModifiers(newModifiers);
      }

      if (
        quickCustomizationRdx &&
        !handleMultiAutoSelect &&
        !item?.isAllModifersOptional
      ) {
        if (customizations[modifier._id].length === modifierMax) {
          console.log("Modifier groups sidharth", modifier);

          //add customization

          //perform operations to change the modifier groups according to the leading modifiers

          setCurrentIndex((prev: any) => {
            if (prev === 0) {
              setCompletedModifiers((modifiers: any) => {
                return [...modifiers, selectedGroup];
              });
              setSelectedGroup(
                newModifiers
                  ? newModifiers[currentIndex + 1]
                  : sortedModifiers[currentIndex + 1],
              );
              if (prev + 1 === sortedModifiers?.length) {
                setSelectedGroup(null);
                return;
              }

              return 1;
            } else {
              const currentPrev = prev;
              setSelectedGroup(
                newModifiers
                  ? newModifiers[currentIndex + 1]
                  : sortedModifiers[currentIndex + 1],
              );

              if (currentPrev + 1 === sortedModifiers?.length) {
                setSelectedGroup(null);
                return;
              }
              return prev + 1;
            }
          });

          if (currentIndex === availableModifiers?.length - 1) {
            if (tier1CustOpen && !tier2CustOpen) {
              addCustomizationToCart(customizations);
              // dispatch(closeMakeItAMealSession());
              // closeModalStates();
              return customizations;
            } else if (tier2CustOpen) {
              // alert("From second tier");
            }
          }
        }

        if (
          !isShowGridViewEnabled() &&
          // !SelectedEntity?.hasSecondTier &&
          // !tier1CustOpen &&
          checkCustomizationQuantity(customizations, modifier?.id, modifierMax)
        ) {
          if (nextModifier) {
            AutoScroll(
              document.getElementById(
                tier1CustOpen && tier2CustOpen
                  ? "scrollCustomizableItem2"
                  : "scrollCustomizableItem",
              ),
              document.getElementById(nextModifier?._id)?.offsetTop,
              450,
            );
          } else if (isOpenBottomSheet?.openType !== "edit") {
            if (tier2CustOpen) {
              addTier2CustomizationToMIAMCart(customizations);
            } else {
              addCustomizationToCart(customizations);
              // closeModalStates();
              return customizations;
            }
          }
        }
      }
      setFalseGrayOut(modifier?._id);
    } else if (outcome.branch === "toggle") {
      // Case 2: Modifier allows toggling items (min and max are both 0) —
      // the engine already added/removed; both paths cleared the gray-out.
      setFalseGrayOut(modifier?._id);
    } else {
      // Case 3: Modifier has variable min and max limits
      if (outcome.action === "removed") {
        setFalseGrayOut(modifier?._id);
      } else if (outcome.action === "added") {
        if (quickCustomizationRdx && !handleMultiAutoSelect) {
          //grid wise setting should be handled here
          if (
            customizations[modifier._id].length === modifierMax &&
            !item?.isAllModifersOptional
          ) {
            //find the apprpriate variant

            //add customization

            setCurrentIndex(advanceQuickCustomizationIndex);
            if (currentIndex === availableModifiers?.length - 1) {
              if (tier1CustOpen && !tier2CustOpen) {
                addCustomizationToCart(customizations);
                // dispatch(closeMakeItAMealSession());
                // closeModalStates();
                return customizations;
              }
            }
          }

          if (
            !isShowGridViewEnabled() &&
            // !SelectedEntity?.hasSecondTier &&
            checkCustomizationQuantity(
              customizations,
              modifier?.id,
              modifierMax,
            )
          ) {
            if (nextModifier) {
              AutoScroll(
                document.getElementById(
                  (tier1CustOpen && tier2CustOpen) || tier2CustOpen
                    ? "scrollCustomizableItem2"
                    : "scrollCustomizableItem",
                ),
                document.getElementById(nextModifier?._id)?.offsetTop,
                450,
              );
              console.log(
                "Items for testing",
                document.getElementById(
                  tier1CustOpen && tier2CustOpen
                    ? "scrollCustomizableItem2"
                    : "scrollCustomizableItem",
                ),
                document.getElementById(nextModifier?._id)?.offsetTop,
                nextModifier,
                (tier1CustOpen && tier2CustOpen) || tier2CustOpen,
              );
            } else if (isOpenBottomSheet?.openType !== "edit") {
              if (tier2CustOpen) {
                addTier2CustomizationToMIAMCart(customizations);
              } else {
                addCustomizationToCart(customizations);
                // dispatch(closeMakeItAMealSession());
                // closeModalStates();
                return customizations;
                // closeModalStates();
              }
            }
          }
        }

        setFalseGrayOut(modifier?._id);
      } else if (outcome.action === "max-limit") {
        // Display error if max limit is reached
        dispatch(
          setShowErrorModalGlobal({
            showErrorModal: true,
            errorMessage: `Maximum selection  limit reached`,
          }),
        );

        if (nextModifier) {
          AutoScroll(
            document.getElementById("scrollCustomizableItem"),
            document.getElementById(nextModifier?._id)?.offsetTop,
            450,
          );
        }
      }
      // action === "noop": item already selected with a confirmed selection —
      // the original did nothing here.
    }

    if (handleMultiAutoSelect) {
      selectedCustomizationsObject[modifier._id] = [
        ...customizations[modifier._id],
      ];
    }

    dispatch(setSelectedCustomizations(customizations));

    // Return updated customizations object to update state
    return customizations;
  };

  const [swipeDirection, setSwipeDirection] = useState<any | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Record<
    string,
    any
  > | null>(null);

  // useEffect(() => {
  //   console.log("SelectedGroup", selectedGroup);
  // }, [selectedGroup]);

  const [currentIndex, setCurrentIndex] = useState<number>(1);
  const [confirmedVariant, setConfirmedVariant] = useState(false);
  const [closeRendering, setCloseRendering] = useState(false);
  const [loaderVariantEdit, setLoaderVariantEdit] = useState(false);
  const [visitedModifierGroups, setVisitedModifierGroups] = useState<any>([]);

  // convertModifiersAccordingly now lives in
  // @cx-sdk/ordering/customization/sessionState (imported above).

  const fetchPreviousModifierGroup = useCallback(
    (currentModifierGroup: any, currentModifiers: any[]) => {
      const indexField = currentModifiers.findIndex(
        (entity) => entity?._id === currentModifierGroup._id,
      );

      const availableModifiers = getAvailableConstituentItems(
        currentModifiers[indexField - 1],
      );

      // // console.log(
      //   "Sidharth modifiers",
      //   currentModifiers[indexField - 1]?.min,
      //   currentModifiers[indexField - 1]?.max,
      //   availableModifiers.length,
      // );
      // skip the modifier groups if min = max = constituent items length
      // (verbatim note: the original computed unused `min`/`max` locals here
      // from isAllowMultiplePunch(); removed under noUnusedLocals — the
      // predicate is a pure settings read, so behavior is unchanged.)

      if (isOpenBottomSheet?.type === "variant") {
        if (currentModifiers[indexField - 1]) {
          // if (
          //   min === max &&
          //   availableModifiers.length === min &&
          //   currentIndex > 0
          // ) {
          //   console.log("Previous selected");
          //   return;
          // }
        }

        setSwipeDirection("right");

        setCloseRendering(true);
        // setSelectedGroup(currentModifiers[indexField - 1]);
        // if (indexField - 1 === 0) {
        //   alert(indexField - 1);
        setSelectedGroup(
          currentModifiers[indexField - 1]
            ? currentModifiers[indexField - 1]
            : null,
        );
        // } else {
        //   alert("Condition" + indexField);
        //   setSelectedGroup(currentModifiers[indexField]);
        // }
        // alert("Current index")
        setCurrentIndex(indexField - 1);

        if (indexField - 1 < 0) {
          // setSelectedGroup(null);
          // setSelectedVariant({});
          setCloseRendering(true);

          console.log("Sorted Modifiers", sortedModifiers);

          //if we want normal flow we can again set sortedModifiers and make it 0
          setSelectedGroup(sortedModifiers[0] ? sortedModifiers[0] : null);
          setConfirmedVariant(false);
          setCurrentIndex(-1);
          return;
        }
      }

      //need to be checkeed please check all the cases or uncomment it

      if (
        currentModifiers[indexField - 1]?.min ===
          currentModifiers[indexField - 1]?.max &&
        availableModifiers.length === currentModifiers[indexField - 1]?.min &&
        currentIndex > 0
      ) {
        return;
      }

      if (indexField !== -1) {
        // alert("helo world")
        if (indexField - 1 >= 0) {
          setSwipeDirection("right");
          setSelectedGroup(
            currentModifiers[indexField - 1]
              ? currentModifiers[indexField - 1]
              : null,
          );
          // alert("Current index")
          setCurrentIndex(indexField - 1);
        }
      }
    },
    [isOpenBottomSheet],
  );

  const fetchNextModifierGroup = (
    currentModifierGroup: any,
    currentModifiers: any[],
  ) => {
    const indexField = currentModifiers.findIndex(
      (entity) => entity?._id === currentModifierGroup._id,
    );
    if (indexField !== -1) {
      const modifierMinMaxCheck =
        checkMinMaxConditionsForGroup(currentModifierGroup);
      console.log(
        "Fetch next",
        currentModifierGroup,
        currentModifiers,
        modifierMinMaxCheck,
      );
      if (modifierMinMaxCheck) {
        // Only add to completedModifiers if it is not already present
        if (
          !completedModifiers.some(
            (mod: any) => mod._id === currentModifierGroup._id,
          )
        ) {
          setCompletedModifiers((prev: any) => [...prev, currentModifierGroup]);
          // setVisitedModifierGroups((prev: any) => [
          //   ...prev,
          //   currentModifierGroup,
          // ]);
        }

        if (indexField + 1 < currentModifiers.length) {
          setSwipeDirection("left");
          setSelectedGroup(
            currentModifiers[indexField + 1]
              ? currentModifiers[indexField + 1]
              : null,
          );
          setCurrentIndex(indexField + 1);
          enableDisablePreviousButton();
        } else {
          setSelectedGroup(null);
          setCurrentIndex(indexField + 1);
        }
      } else {
        // Handle min/max error
        // dispatch(
        //   setShowErrorModalGlobal({
        //     showErrorModal: true,
        //     errorMessage: `Please Select Valid Customizations`,
        //   }),
        // );
        triggerNotification("Please Select Valid Customizations");
      }
    } else {
      console.error("No Modifier present in the list.");
    }
  };

  const updateQuantity = (
    modifier: any,
    item: any,
    quantityToBeUpdated?: number,
  ) => {
    // Quantity math lives in the engine; an invalid modifier id returns the
    // untouched clone without dispatching, matching the original's early
    // return before its dispatch.
    const customizations = applyQuantityUpdate(
      selectedCustomizations,
      modifier,
      item,
      quantityToBeUpdated,
    );

    if (!modifier?._id) return customizations;

    dispatch(setSelectedCustomizations(customizations));
    return customizations;
  };

  //function to set the setSelected Variant to true and fetching the related addons if available
  const fetchAddonsForSelectedVariant = (variant: any) => {
    // alert("Fetch Addons");
    //first remove all the selected fields
    // alert("Fetch Addons"+ JSON.stringify(variant));

    if (selectedVariant != variant) {
      dispatch(setSelectedCustomizations({}));
      setGrayOutAllCustomizations({
        isEnabled: false,
        modifierID: [],
      });
    }

    //setting the selected variant
    setSelectedVariant(variant);
    setContradictoryItems({});

    //set emtpy modifiers for selected customizations (built in the engine)
    const returnableObject = buildEmptySelectionsForModifiers(variant?.modifiers);
    dispatch(setSelectedCustomizations(returnableObject));
    console.log("Returnable object", returnableObject);
    //fetching the addons for the selected variant
    if (variant?.modifiers?.length > 0) {
      const modifierGroups = fetchModifierProperties(variant?.modifiers);
      setFetchModifierGroups(modifierGroups);
    } else {
      setFetchModifierGroups([]);
    }
  };

  const [functionLoading, setFunctionLoading] = useState<boolean>(false);
  // getAccumulatedQuantity now lives in
  // @cx-sdk/ordering/customization/pricing (imported above).

  // add this inside useCustomization (near fetchNextModifierGroup / fetchPreviousModifierGroup)
  const goToModifierGroupById = (modifierId: string) => {
    if (!modifierId) return false;

    // Group lookup (sortedModifiers → fetchedModifierGroups → entity ids)
    // lives in the engine; the navigation state, swipe hint and scrolling
    // below stay here.
    const located = locateModifierGroup({
      modifierId,
      sortedModifiers,
      fetchedModifierGroups,
      entityModifierIds:
        SelectedEntity?.customizations?.selectedEntity?.modifiers,
      fetchModifierProperties,
    });

    if (!located) {
      return false; // not found
    }
    const { index, sourceList } = located;

    // set navigation state
    const prevIndex = currentIndex;
    setSelectedGroup(sourceList[index] ? sourceList[index] : null);
    setCurrentIndex(index);

    // set swipeDirection to hint animators / consumers
    if (prevIndex === -1) {
      setSwipeDirection("left");
    } else if (index > prevIndex) {
      setSwipeDirection("left");
    } else if (index < prevIndex) {
      setSwipeDirection("right");
    } else {
      setSwipeDirection(null);
    }

    // ensure previous button enabled/disabled state is correct
    if (index > 0) enableDisablePreviousButton();

    // scroll to the modifier DOM node (container id respects tier flags like other code)
    try {
      const containerId =
        tier1CustOpen && tier2CustOpen
          ? "scrollCustomizableItem2"
          : "scrollCustomizableItem";
      const container = document.getElementById(containerId);
      const target = document.getElementById(modifierId);
      if (container && target) {
        AutoScroll(container, target.offsetTop, 450);
      } else if (target) {
        // fallback: scroll the window to the element
        target.scrollIntoView({ behavior: "smooth", block: "start" } as any);
      }
    } catch (e) {
      console.warn("goToModifierGroupById: scrolling failed", e);
    }

    return true;
  };

  //find quantity excluding current quantity
  // var findQuantityForConstituentItemExcludedCurrent = (
  //   selectedItem: any,
  //   groupId: any,
  // ) => {
  //   var quantity = 0;
  //   tier1Customizations?.customizations?.selectedCustomizations[
  //     groupId
  //   ]?.forEach((entity: any) => {
  //     if (entity?.itemId != selectedItem?.itemId) {
  //       quantity += entity?.quantity;
  //     }
  //   });
  //   return quantity;
  // };

  const increaseQuantity1 = () => {
    dispatch(increaseTier1selectedEntityQuantity());
  };
  const decreaseQuantity1 = () => {
    dispatch(decreaseTier1selectedEntityQuantity());
  };

  //return the functions
  return {
    closeModalStates,
    updateCustomizableItemInCart,
    //all states
    selectedModifier,
    selectedVariant,
    fetchedModifierGroups,
    selectedCustomizations,
    erroredSection,
    quantity,
    allCheckPassed,
    isFlippedToShowSubTotal,
    flippedModalData,
    completedModifiers,
    selectedGroup,
    sortedModifiers,
    currentIndex,
    confirmedVariant,
    closeRendering,
    loaderVariantEdit,
    visitedModifierGroups,
    functionLoading,
    //set functions
    setQuantity,
    setFalseGrayOut,
    setSelectedModifier,
    setSelectedVariant,
    setFetchModifierGroups,

    setErroredSection,
    setAllCheckPassed,
    setIsFlippedToShowSubTotal,
    setIsFlippedModalData,
    setCompletedModifiers,
    setSelectedGroup,
    setSortedModifiers,
    setCurrentIndex,
    setConfirmedVariant,
    setCloseRendering,
    setLoaderVariantEdit,
    setVisitedModifierGroups,
    setFunctionLoading,
    //functions
    addCustomizations,
    addCustomizationToCart,
    increaseQuantity,
    decreaseQuantity,
    fetchAddonsForSelectedVariant,
    fetchNextModifierGroup,
    fetchPreviousModifierGroup,
    convertModifiersAccordingly,
    checkIfAllVariantIds,
    closeDependentOnAddonsOrVariants,
    getTotalValue,
    checkMinMaxConditionsForGroup,
    setErroredSectionForModifier,
    getVariantProperties,
    //useCustomization
    isScrollingDown,
    setIsScrollingDown,
    isShowGridViewEnabled,
    grayOutAllCustomizations,

    //useSelectors
    selectThemeRdx,
    isOpenBottomSheet,
    SelectedEntity,
    calculationWrapper,

    //hooks functions
    AutoScroll,
    addItemToCart,
    redeemItem,
    updateItemCart,
    fetchModifierProperties,
    navigate,
    dispatch,
    // setShowErrorModalGlobal,
    isCheckBoxRequiredFunction,
    setGrayOutAllCustomizations,
    generateString,
    swipeDirection,
    disablePrevious,
    disablePreviousButton,
    setIsOpenBottomSheet,
    increaseCustomization,
    decreaseCustomization,
    setTier1BottomSheetInRdx,
    setTier2BottomSheetInRdx,

    //nested customizations
    // addNestedCustomizationToRelatedConstituentItem,
    updateQuantity,
    openRepeatItemModalForRespectiveItem,
    updateMIAMCart,
    getAccumulatedQuantity,
    // increaseQuantity2,
    // decreaseQuantity2,
    // findQuantityForConstituentItem,
    increaseQuantity1,
    decreaseQuantity1,
    isAllowMultiplePunch,
    isStepperRequired,
    getTotalValueWithApplyAddonPrice,
    // testFunction,
    contradictoryItems,

    goToModifierGroupById,
    setContradictoryItems,
  };
};

export default useCustomization;
