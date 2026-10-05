/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart rows and the repeat-sheet payload flow through untyped from the SDK
 * cart slice / legacy converters; typed in a later domain pass. Do not add
 * NEW anys.
 */
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  closeRepeatItemBottomSheet,
  repeatItemBottomSheetData,
} from "@cx-sdk/ordering/state/cart.slice";
import {
  closeMakeItAMealModal,
  openComboConstutientCustomizations,
  openMakeItAMealModal,
  removeBlackListed,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  buildMakeItAMealPayload,
  buildReturnNavigationState,
  buildVariantSelectionEntity,
  buildVariantTierPayload,
  hasComboUpsell,
} from "@cx-sdk/ordering/cart/addIntent";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setSelectedEntity } from "../../redux/features/menuSelections/menuSelections.slice";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useGridView from "../../hooks/customization/useGridView";
import useTagFilter from "../../hooks/menuHooks/useTagFilter";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import closeIcon from "../../assets/icons/close.svg";
import plusIcon from "../../assets/icons/plus.svg";

/** Only the slices the new-customizations ladder reads (house pattern). */
interface RepeatSheetRootState {
  appSettings?: { kiosk_settings?: { enable_combo_upsell?: boolean } };
  makeItAMeal?: { blackListedItems?: Record<string, boolean> };
}

/**
 * Sheet body — mounted only while open (default export below), so the local
 * quantity mirror re-seeds from the slice's snapshot whenever the sheet
 * (re)opens (no setState-in-effect). `sheet.data` is a SNAPSHOT taken by the
 * setRepeatItemBottomSheet reducer at open time and never live-updates, hence
 * the local mirror — the same shape the fork's RepeatItem rows used.
 */
function SheetBody({ sheet }: { sheet: any }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { getTranslated } = useAppSettings();
  const {
    IncreaseItemQuantityById,
    decreaseItemQuantityById,
    getAllCustomizationList,
  } = useCartHook();
  const { isShowGridViewEnabled } = useGridView();
  const { filterByTags } = useTagFilter();
  const { openDoubleTierModal } = useMakeItAMeal();
  const comboUpsellEnabled = useSelector(
    (state: RepeatSheetRootState) =>
      state.appSettings?.kiosk_settings?.enable_combo_upsell,
  );
  const blackListedItemsMIAM = useSelector(
    (state: RepeatSheetRootState) => state.makeItAMeal?.blackListedItems,
  );
  const currencySettings = useSelector(selectCurrency) as any;

  const rows: any[] = Array.isArray(sheet?.data) ? sheet.data : [];
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    rows.forEach((row: any) => {
      seed[String(row?.itemId)] = Number(row?.quantity ?? 0);
    });
    return seed;
  });

  const currency =
    currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";
  const visibleRows = rows.filter(
    (row: any) => (quantities[String(row?.itemId)] ?? 0) > 0,
  );

  const close = () => dispatch(closeRepeatItemBottomSheet());

  const increase = (row: any) => {
    // DP max-quantity gate: the hook returns false (and raises the global
    // error modal) when the bump is refused — mirror redux only on success.
    if (IncreaseItemQuantityById(row.itemId, row.type, "itemId", row)) {
      setQuantities((prev) => ({
        ...prev,
        [String(row.itemId)]: (prev[String(row.itemId)] ?? 0) + 1,
      }));
    }
  };

  const decrease = (row: any) => {
    const current = quantities[String(row?.itemId)] ?? 0;
    if (current <= 0) return;
    // Fire-and-forget like the fork; at qty 1 the reducer DELETES the row
    // (never dispatch again for this itemId — trap 1).
    void decreaseItemQuantityById(row.itemId, row.type, "itemId");
    setQuantities((prev) => ({
      ...prev,
      [String(row.itemId)]: current - 1,
    }));
    if (current === 1) {
      const anyLeft = rows.some(
        (other: any) =>
          other?.itemId !== row?.itemId &&
          (quantities[String(other?.itemId)] ?? 0) > 0,
      );
      if (!anyLeft) {
        // Last row hit 0 → close, and (fork parity) un-blacklist the base
        // item so the MIAM upsell may offer it again next time.
        dispatch(closeRepeatItemBottomSheet());
        // Payload cast matches the house pattern (useCartIndexedDb.ts):
        // the SDK reducer types its action `any`, so RTK infers `{id} & void`.
        dispatch(removeBlackListed({ id: row?.id } as any));
      }
    }
  };

  /** Fork's flattened summary: "Addon, Nested, Addon2" (2 levels). */
  const summaryFor = (row: any): string => {
    const list: any[] = getAllCustomizationList(row?.customizations) ?? [];
    if (list.length === 0) return t("repeat.noCustomizations");
    return list
      .map((customization: any) => {
        const mainTitle = getTranslated(customization, "TITLE");
        const nestedTitles = customization?.customizations
          ?.map((inner: any) => getTranslated(inner, "TITLE"))
          ?.join(", ");
        return nestedTitles ? `${mainTitle}, ${nestedTitles}` : mainTitle;
      })
      .join(", ");
  };

  /**
   * "+ NEW CUSTOMIZATIONS" — close the sheet, then re-run the same ladder
   * Menu.handleEntityAction runs for the baseItem (the addEntity executor's
   * variant/modifier branches, minus the repeat short-circuit that opened
   * this sheet), honoring the sheet's returnTo/returnPath so a detour opened
   * from the bag returns to /cart (trap 7), not /menu.
   */
  const openNewCustomizations = () => {
    const baseItem = sheet?.baseItem;
    const navState = buildReturnNavigationState(
      sheet?.returnTo,
      sheet?.returnPath,
    );
    dispatch(closeRepeatItemBottomSheet());
    if (!baseItem) return;

    const upsellCtx = { comboUpsellEnabled, isShowGridViewEnabled, filterByTags };
    const upsellWins =
      hasComboUpsell(baseItem, upsellCtx) &&
      !blackListedItemsMIAM?.[baseItem?.id];

    if (baseItem?.hasVariant && !baseItem?.isVariant) {
      if (upsellWins) {
        dispatch(openMakeItAMealModal(buildMakeItAMealPayload(baseItem)));
        return;
      }
      // Menu's variant ladder (useAddEntityToCart's executor branch).
      dispatch(closeMakeItAMealModal());
      dispatch(setSelectedEntity(buildVariantSelectionEntity(baseItem)));
      dispatch(openComboConstutientCustomizations());
      dispatch(setTier1BottomSheetAndSelectedEntity(buildVariantTierPayload(baseItem)));
      navigate("/customization", navState ? { state: navState } : undefined);
      return;
    }

    if ((baseItem?.modifiers?.length ?? 0) > 0) {
      if (upsellWins) {
        dispatch(openMakeItAMealModal(buildMakeItAMealPayload(baseItem)));
        return;
      }
      dispatch(closeMakeItAMealModal());
      // Navigates to /customization itself, carrying navState.
      openDoubleTierModal(baseItem, () => {}, navState);
    }
  };

  // Render helper, NOT a component (react-hooks/static-components).
  const renderRow = (row: any) => {
    const qty = quantities[String(row?.itemId)] ?? 0;
    const title =
      row?.type === "VARIANT"
        ? getTranslated(row?.selectedVariant, "TITLE")
        : getTranslated(row, "TITLE");

    return (
      <div
        key={String(row?.itemId)}
        data-testid={`repeat-row-${row?.itemId}`}
        className="flex items-center gap-[20px] border-b border-tb-grey-4 px-[24px] py-[20px]"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[22px] font-medium capitalize leading-[26px] text-black">
            {title}
          </p>
          <p className="mt-[4px] text-[18px] leading-[22px] text-tb-ink-purple/70">
            {summaryFor(row)}
          </p>
        </div>
        <p className="w-[130px] shrink-0 text-right text-[24px] font-medium text-black">
          {currency}
          {(Number(row?.total_price ?? 0) * qty).toFixed(2)}
        </p>
        <div className="flex h-[72px] w-[188px] shrink-0 items-center justify-between rounded-full border-2 border-tb-grey-4 bg-tb-surface px-[6px]">
          <button
            type="button"
            data-testid={`repeat-dec-${row?.itemId}`}
            aria-label={t("repeat.decrease")}
            onClick={() => decrease(row)}
            className="flex h-[56px] w-[56px] min-h-[44px] min-w-[44px] items-center justify-center text-tb-purple"
          >
            <svg viewBox="0 0 16 16" className="h-[16px] w-[16px]" aria-hidden="true">
              <path
                d="M2 8h12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <p className="text-[20px] font-bold text-black">{qty}</p>
          <button
            type="button"
            data-testid={`repeat-inc-${row?.itemId}`}
            aria-label={t("repeat.increase")}
            onClick={() => increase(row)}
            className="flex h-[56px] w-[56px] min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <img alt="" src={plusIcon} className="h-[16px] w-[16px]" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-[60]" data-testid="repeat-sheet">
      {/* Position-neutral bottom-sheet entrance — tb-modal-enter is reserved
          for centered modals (SlotSelectionSheet precedent). */}
      <style>{`@keyframes tbRepeatSheetEnter{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={close}
        className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70"
      />
      <div
        className="absolute bottom-0 left-0 flex max-h-[1200px] w-[1080px] flex-col rounded-t-[24px] bg-tb-surface pt-[44px]"
        style={{ animation: "tbRepeatSheetEnter 0.2s ease-out both" }}
      >
        <h2 className="tb-display mb-[20px] px-[96px] text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple">
          {t("repeat.title")}
        </h2>
        <button
          type="button"
          data-testid="repeat-sheet-close"
          aria-label={t("language.close")}
          onClick={close}
          className="absolute right-[32px] top-[36px] h-[48px] w-[48px] min-h-[44px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[8px]">
          {visibleRows.map(renderRow)}
        </div>

        <div className="px-[24px] pb-[32px] pt-[16px]">
          <button
            type="button"
            data-testid="repeat-new-customizations"
            onClick={openNewCustomizations}
            className="tb-display w-full min-h-[44px] rounded-[8px] border-2 border-tb-purple bg-tb-surface py-[24px] text-center text-[22px] text-tb-purple"
          >
            + {t("repeat.newCustomizations")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Repeat-customization sheet (contract B2) — reads
 * `state.cart.repeatItembottomSheet` (opened by useAddEntityToCart's "repeat"
 * branch), renders null while closed. Keyed by base item so switching targets
 * re-seeds the quantity mirror.
 */
export default function RepeatItemSheet() {
  const sheet = useSelector(repeatItemBottomSheetData);
  if (!sheet?.isOpen) return null;
  return <SheetBody key={String(sheet?.baseItem?.id ?? "")} sheet={sheet} />;
}
