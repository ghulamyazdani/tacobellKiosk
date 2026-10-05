/* eslint-disable @typescript-eslint/no-explicit-any --
 * MIAM entities/combos flow untyped from the legacy converters + makeItAMeal
 * slice; typed in later domain passes. Do not add NEW anys.
 */
import { useMemo } from "react";
import { shallowEqual, useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  closeMakeItAMealModal,
  closeMakeItAMealSession,
  closeSessioAndMakeItAMealModal,
  closeTier2ModalBottomSheet,
  makeItAMealIsOpen,
  makeItMealSelectedItem,
  openComboConstutientCustomizations,
  primaryMakeItAMeal,
  pushToMiamBlacklistItems,
  removeMakeItAMealItem,
  selectIsForceOpenMakeItAMealModal,
  setIsForceOpenMakeItAMealModal,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  buildVariantSelectionEntity,
  buildVariantTierPayload,
} from "@cx-sdk/ordering/cart/addIntent";
import {
  checkCustomizationType,
  truncateString,
} from "@cx-sdk/catalog/menu/menuUtils";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  closeBottomSheet,
  setSelectedEntity,
} from "../../redux/features/menuSelections/menuSelections.slice";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import useTagFilter from "../../hooks/menuHooks/useTagFilter";
import closeIcon from "../../assets/icons/close.svg";

/**
 * Direct-add payload for the declined original item / a plain upsell combo.
 * Shape per the fork's OptionsUpSell decline branch: total_price for the
 * slice's subTotal reducer, quantity 1, subCategoryId normalized from either
 * casing the converters emit.
 */
const buildMiamDirectAddPayload = (entity: any) => ({
  ...entity,
  total_price: entity?.price,
  quantity: 1,
  subCategoryId: entity?.subcategoryId ?? entity?.subCategoryId,
});

/**
 * MIAM upsell prompt — "Would you like to make it a meal?" (no Figma frame;
 * design-language modal per P6c brief, flagged for client sign-off).
 *
 * Opens via the SDK addIntent executor: `addEntity` on an `"upsell"` intent
 * dispatches `openMakeItAMealModal({isOpen, selectedItem, availableCombos})`,
 * which also force-stamps `isForceOpenMakeItAMealModal` — so EVERY close path
 * here clears that latch too (fork's MakeItAMealModal.closeMakeItAMeal dance).
 *
 * Lifecycle mirrored from the fork's MakeItAMealModal / MainSelectionMIAM /
 * OptionsUpSell / UpsellMeals stack:
 * - combo tap (accept): customizable → openDoubleTierModal (its
 *   openComboConstutientCustomizations closes the prompt's isOpen and keeps
 *   the MIAM session live for /customization); variant → manual tier-1 seed
 *   (planDoubleTierModal returns null for variant shapes); plain → straight
 *   add + full close.
 * - decline: original item added by shape; plain adds also blacklist the id
 *   so the next tap classifies as "add", not "upsell".
 * - X: fork close dance + removeMakeItAMealItem.
 * Backdrop tap intentionally does NOT close (fork parity — its handler is
 * commented out).
 */
export default function MakeItAMealPrompt() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { addItemToCart } = useCartHook();
  const { openDoubleTierModal } = useMakeItAMeal();
  const { filterByTags } = useTagFilter();

  const isOpen = useSelector(makeItAMealIsOpen, shallowEqual);
  const isForceOpen = useSelector(selectIsForceOpenMakeItAMealModal);
  const item = useSelector(makeItMealSelectedItem, shallowEqual);
  const primaryText = useSelector(primaryMakeItAMeal);
  const currencySettings = useSelector(selectCurrency) as any;
  const currency =
    currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";

  const combos: any[] = useMemo(() => {
    const resolved = (filterByTags(item?.upsellItems) ?? []) as any[];
    return resolved.filter((c: any) => c?.isActive && !c?.outOfStock);
  }, [item, filterByTags]);

  if (!(isOpen || isForceOpen)) return null;

  /** Fork MakeItAMealModal.closeMakeItAMeal — verbatim dispatch set. */
  const closeDance = () => {
    dispatch(closeMakeItAMealSession({ force: false }));
    dispatch(closeSessioAndMakeItAMealModal());
    dispatch(setIsForceOpenMakeItAMealModal(false));
    dispatch(closeBottomSheet());
    dispatch(closeTier2ModalBottomSheet());
  };

  const handleClose = () => {
    closeDance();
    dispatch(removeMakeItAMealItem());
  };

  /** Combo card tap = accept. */
  const handleAccept = (combo: any) => {
    const shape = checkCustomizationType(combo);
    if (shape === "item") {
      // Fork UpsellMeals plain branch (add + close modal); session teardown
      // added so the latched session/force flags can't leak past the prompt.
      addItemToCart(buildMiamDirectAddPayload(combo), "ITEM");
      dispatch(closeMakeItAMealModal());
      dispatch(removeMakeItAMealItem());
      dispatch(closeMakeItAMealSession({ force: false }));
      return;
    }
    // Non-plain: the customization detour clears the session at commit/back
    // (useCustomization.closeModalStates) — only the force latch must go now,
    // since openComboConstutientCustomizations leaves it standing.
    dispatch(setIsForceOpenMakeItAMealModal(false));
    if (shape === "variant") {
      // Fork OptionsUpSell variant branch == addEntity's variant executor.
      dispatch(closeMakeItAMealModal());
      dispatch(closeMakeItAMealSession({ force: false }));
      dispatch(setSelectedEntity(buildVariantSelectionEntity(combo)));
      dispatch(openComboConstutientCustomizations());
      dispatch(setTier1BottomSheetAndSelectedEntity(buildVariantTierPayload(combo)));
      navigate("/customization");
      return;
    }
    // customizableItem — the combo meal path. openDoubleTierModal seeds the
    // MIAM tier-1 session and navigates to /customization itself.
    dispatch(closeMakeItAMealModal());
    openDoubleTierModal(combo);
  };

  /** "No thanks" = add the ORIGINAL item, by shape. */
  const handleDecline = () => {
    const shape = checkCustomizationType(item);
    if (shape === "customizableItem") {
      // Fork keeps the MIAM session alive here — the tier-1 state that
      // openDoubleTierModal just seeded must survive the navigation.
      dispatch(setIsForceOpenMakeItAMealModal(false));
      dispatch(closeMakeItAMealModal());
      openDoubleTierModal(item);
      return;
    }
    if (shape === "variant") {
      dispatch(setIsForceOpenMakeItAMealModal(false));
      dispatch(closeMakeItAMealModal());
      dispatch(closeMakeItAMealSession({ force: false }));
      dispatch(setSelectedEntity(buildVariantSelectionEntity(item)));
      dispatch(openComboConstutientCustomizations());
      dispatch(setTier1BottomSheetAndSelectedEntity(buildVariantTierPayload(item)));
      navigate("/customization");
      return;
    }
    // Plain: add + blacklist (so the next tap on this item classifies as a
    // straight "add"), then the brief's close pair. isGetItem guard = fork
    // parity (freebies never blacklist).
    addItemToCart(buildMiamDirectAddPayload(item), "ITEM");
    if (!item?.isGetItem) {
      dispatch(pushToMiamBlacklistItems({ id: item?.id } as any));
    }
    dispatch(closeMakeItAMealModal());
    dispatch(closeMakeItAMealSession({ force: false }));
    dispatch(closeSessioAndMakeItAMealModal());
  };

  const subText = truncateString(
    String(item?.makeItMeal?.subText || item?.description || ""),
    250,
  );

  return (
    <div className="absolute inset-0 z-40" data-testid="miam-prompt">
      {/* Backdrop — non-interactive on purpose (fork parity: its onClick is
          commented out; the only exits are a combo, decline, or the X). */}
      <div className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70" />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 max-h-[1500px] w-[860px] overflow-y-auto rounded-[16px] bg-tb-surface p-[48px]">
        <h2 className="tb-display mb-[16px] px-[56px] text-center text-[36px] leading-[1.1] tracking-[-1px] text-tb-purple-vibrant">
          {primaryText || t("miam.title")}
        </h2>
        {subText && (
          <p className="mb-[24px] text-center text-[20px] font-medium leading-[1.3] text-tb-ink-purple">
            {subText}
          </p>
        )}
        <button
          type="button"
          aria-label={t("language.close")}
          data-testid="miam-close"
          onClick={handleClose}
          className="absolute right-[32px] top-[32px] h-[48px] w-[48px] min-h-[44px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div className="mb-[32px] flex max-h-[980px] flex-wrap justify-center gap-[16px] overflow-y-auto">
          {combos.map((combo: any) => (
            <button
              key={combo?.id}
              type="button"
              data-testid={`miam-combo-${combo?.id}`}
              onClick={() => handleAccept(combo)}
              className="flex w-[240px] flex-col overflow-hidden rounded-[8px] bg-tb-grey-6 text-left"
            >
              {combo?.image_url && (
                <img
                  alt=""
                  src={combo.image_url}
                  className="mt-[16px] h-[140px] w-full object-contain"
                />
              )}
              <div className="flex-1 px-[16px] pb-[12px] pt-[8px]">
                <p className="text-[19px] font-medium capitalize leading-[22px] text-black">
                  {combo?.name}
                </p>
                <p className="text-[15px] text-tb-ink-purple">
                  {currency}
                  {Number(combo?.price ?? 0).toFixed(2)}
                </p>
              </div>
              <span className="tb-display block w-full bg-tb-purple px-[8px] py-[14px] text-center text-[16px] leading-[1.1] text-tb-surface min-h-[44px]">
                {item?.makeItMeal?.buttonText1 || t("miam.accept")}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          data-testid="miam-decline"
          onClick={handleDecline}
          className="w-full rounded-[8px] border-2 border-tb-purple py-[20px] text-center text-[20px] font-bold text-tb-purple min-h-[44px]"
        >
          {item?.makeItMeal?.buttonText2 || t("miam.decline")} ({currency}
          {Number(item?.price ?? 0).toFixed(2)})
        </button>
      </div>
    </div>
  );
}
