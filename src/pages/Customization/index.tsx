/* eslint-disable @typescript-eslint/no-explicit-any --
 * Entities/groups flow untyped from the legacy converters + makeItAMeal
 * slice; typed in later domain passes. Do not add NEW anys.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  makeItAMealIsSessionOpen,
  makeItAMealTier1BottomSheet,
  openTier2EditModal,
  setTeir2SelectedEntity,
  tier1CustomizationSelectedEntity,
  tier1SelectedCustomization,
  setTier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { buildTier2NewEntity } from "@cx-sdk/ordering/customization/nestedCardLogic";
import useCustomization from "../../hooks/customization/useCustomization";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import PackSlotCard from "../../components/customization/PackSlotCard";
import SlotSelectionSheet from "../../components/customization/SlotSelectionSheet";
import Tier2CustomizationSheet from "../../components/customization/Tier2CustomizationSheet";
import FooterBar from "../../components/chrome/FooterBar";
import LanguageSheet from "../../components/language/LanguageSheet";
import CancelOrderModal from "../../components/common/CancelOrderModal";
import { resolveCustomizationReturnPath } from "../../utils/customizationReturn";
import { resolveEntityImage } from "../../utils/entityImage";
import backspaceIcon from "../../assets/icons/key-backspace.svg";

/**
 * PDP / customization — Figma "PDP - Single Product" (1:2614) + "PDP -
 * Builder" (1:2856 family), bound to the ported useCustomization the way
 * posistKiosk's CustomizationTier1 binds it (the hook's only real driver):
 *   args {cartRef, isOpenBottomSheet, SelectedEntity, selectedCustomizations
 *   (Redux tier1SelectedCustomization), setSelectedCustomizations (the slice
 *   ACTION CREATOR — the hook dispatches it)}.
 * Lifecycle mirrored from CustomizationTier1's mount effect ("new" branches,
 * plus the openType==="edit" branches for edit-from-bag — P7a):
 *   customizableItem → seed selections → setFetchModifierGroups(
 *     fetchModifierProperties(entity.modifiers))
 *   variant         → getVariantProperties(entity); groups arrive via
 *     fetchAddonsForSelectedVariant(variant) on size pick
 * then on [fetchedModifierGroups]: sortedModifiers/selectedGroup/currentIndex.
 * Figma layout renders ALL groups in one scroll (id="scrollCustomizableItem",
 * sections id={group._id} — the hook's error-AutoScroll contract).
 * Commit = addCustomizationToCart() (validates min/max, adds VARIANT/
 * CUSTOMIZABLE row, closeModalStates() navigates the return path).
 *
 * P9c: the Figma "Footer bottom" strip (CANCEL ORDER · ADA DISPLAY ·
 * language) sits under the ADD TO BAG bar, as on the menu — 1:2614 / 1:2920
 * / 1:5413 draw it in BOTH modes, and without it an ADA guest on the PDP
 * could neither leave the view nor cancel.
 *
 * `embedded` (offers lane): the same PDP hosted IN PLACE inside the bag by
 * OfferTierHost for an offer freebie (isGetItem) or buy-stage (isBuyStageItem)
 * tier session. It never navigates (the no-session guard is off;
 * closeModalStates is exempt for both markers) and renders no footer strip,
 * language sheet or CANCEL ORDER — the bag owns those (hazard H1). A freebie
 * hides the qty stepper (one per pick) and its CTA carries no price claim.
 */
export default function Customization({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const cartRef = useRef(null);

  const sessionOpen = useSelector(makeItAMealIsSessionOpen);
  const isOpenBottomSheet = useSelector(makeItAMealTier1BottomSheet);
  const SelectedEntity = useSelector(tier1CustomizationSelectedEntity);
  const selectedCustomizations = useSelector(tier1SelectedCustomization);
  const currencySettings = useSelector(selectCurrency) as any;
  const currency = currencySettings?.symbol ?? "";

  const {
    fetchedModifierGroups,
    setFetchModifierGroups,
    fetchModifierProperties,
    convertModifiersAccordingly,
    sortedModifiers,
    setSortedModifiers,
    setSelectedGroup,
    setCurrentIndex,
    erroredSection,
    addCustomizations,
    increaseCustomization,
    decreaseCustomization,
    addCustomizationToCart,
    closeModalStates,
    getTotalValueWithApplyAddonPrice,
    getVariantProperties,
    selectedVariant,
    setSelectedVariant,
    fetchAddonsForSelectedVariant,
    confirmedVariant,
    setConfirmedVariant,
    increaseQuantity1,
    decreaseQuantity1,
  } = useCustomization({
    cartRef,
    isOpenBottomSheet,
    SelectedEntity,
    selectedCustomizations,
    setSelectedCustomizations: setTier1SelectedCustomization,
  });

  const {
    findAppropriateVariantForSelectedItem,
    renderAppropriateConstituentItems,
    setTier2BottomSheetInRdx,
  } = useMakeItAMeal();

  const [showFullDescription, setShowFullDescription] = useState(false);
  // Which pack slot group's SELECT sheet is open (null = closed) — the one
  // SlotSelectionSheet instance is driven by this id.
  const [openSlotGroupId, setOpenSlotGroupId] = useState<string | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  const initialisedFor = useRef<string | null>(null);

  const isVariantFlow = isOpenBottomSheet?.type === "variant";
  const isEditMode = isOpenBottomSheet?.openType === "edit";

  // ---- Mount/init (CustomizationTier1:199-320, "new" branches) ----
  useEffect(() => {
    if (!sessionOpen || !SelectedEntity?.id) return;
    const key = `${SelectedEntity.id}:${isOpenBottomSheet?.openType}:${isOpenBottomSheet?.type}`;
    if (initialisedFor.current === key) return;
    initialisedFor.current = key;

    if (isOpenBottomSheet?.openType === "edit") {
      // ---- Edit-from-bag (fork CustomizationTier1:247-320 edit branches) ----
      const editContent = isOpenBottomSheet?.editCustomizationContent ?? {};
      if (isVariantFlow) {
        // VARIANT edit: variant props from the base item, seed the row's
        // variant, fetch its addon groups — fetchAddonsForSelectedVariant
        // WIPES selections to empty (buildEmptySelectionsForModifiers), so
        // the row's customizations are restored right after (fork :275-280).
        // Confirm the size so the PDP opens on the builder, not the picker.
        setFetchModifierGroups([]);
        getVariantProperties(editContent?.baseItem);
        setSelectedVariant({ ...editContent?.selectedVariant });
        fetchAddonsForSelectedVariant({ ...editContent?.selectedVariant });
        dispatch(
          setTier1SelectedCustomization(editContent?.customizations ?? {})
        );
        setConfirmedVariant(true);
        return;
      }
      // CUSTOMIZABLE edit: groups only — redux already holds the row's
      // selections (setTier1SelectedCustomization(row.customizations) was
      // dispatched at open); do NOT reseed defaults over them.
      const editGroups =
        fetchModifierProperties(
          editContent?.baseItem?.modifiers ?? editContent?.modifiers
        ) ?? [];
      setFetchModifierGroups(editGroups);
      return;
    }

    if (isVariantFlow) {
      setFetchModifierGroups([]);
      getVariantProperties(SelectedEntity);
      return;
    }
    // customizableItem / new: seed every active group; defaults pre-selected
    // (fork seeds [] then auto-selects isDefault in the group view — same
    // outcome, done in one dispatch here).
    const groups = fetchModifierProperties(SelectedEntity.modifiers) ?? [];
    const seed: Record<string, any[]> = {};
    for (const group of groups) {
      if (group?.isActive === false) continue;
      const max = Number(group?.max ?? 0);
      const defaults = (group?.constituentItems ?? [])
        .filter((i: any) => i?.isDefault && i?.isActive !== false)
        .slice(0, max > 0 ? max : undefined)
        .map((i: any) => ({ ...i, quantity: 1 }));
      seed[group._id] = defaults;
    }
    dispatch(setTier1SelectedCustomization(seed));
    setFetchModifierGroups(groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per entity/open-type (fork parity)
  }, [sessionOpen, SelectedEntity?.id, isOpenBottomSheet?.openType, isOpenBottomSheet?.type]);

  // ---- Groups arrived (CustomizationGroupWiseContentForMIAM:358-376) ----
  useEffect(() => {
    const sorted = convertModifiersAccordingly(fetchedModifierGroups ?? []);
    setSortedModifiers(sorted);
    setSelectedGroup(sorted?.[0] ?? null);
    setCurrentIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fork parity: keyed on fetched groups only
  }, [fetchedModifierGroups]);

  // Guard: no open session (deep link/refresh) → back out, never a dead pane.
  // It also re-fires when a COMMIT closes the session (the redux update can
  // flush before the router transition closeModalStates queued), so it must
  // bounce to the SAME return path — hardcoding "/menu" here stomped the
  // direction:"cart" edit-from-bag loop back onto the menu (P7a).
  // Embedded: the host unmounts this PDP when the session closes; never route.
  useEffect(() => {
    if (embedded) return;
    if (!sessionOpen || !SelectedEntity?.id) {
      navigate(resolveCustomizationReturnPath(location.state), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionOpen]);

  const quantity = SelectedEntity?.quantity || 1;
  const basePrice = isVariantFlow
    ? Number(selectedVariant?.price ?? 0)
    : Number(SelectedEntity?.price ?? 0);
  const addonsValue = getTotalValueWithApplyAddonPrice(
    selectedCustomizations ?? {},
    SelectedEntity?.applyAddonsPrice
  );
  const total = (Number(addonsValue || 0) + basePrice) * quantity;
  const heroImage = resolveEntityImage(SelectedEntity);

  const calLabel = useMemo(() => {
    const cal = SelectedEntity?.calorieCount;
    const value = typeof cal === "object" ? cal?.value : cal;
    return value ? ` | ${value} Cal` : "";
  }, [SelectedEntity]);

  if (!sessionOpen || !SelectedEntity?.id) return null;

  const isFreebie = Boolean(SelectedEntity?.isGetItem);
  // isGetVariantDisabled = the offer's sameOrLess ceiling (only freebie
  // entities ever carry it, so menu items filter exactly as before).
  const variants: any[] = Array.isArray(SelectedEntity?.variants)
    ? SelectedEntity.variants.filter(
        (v: any) => v?.isActive !== false && !v?.isGetVariantDisabled
      )
    : [];
  const needsVariantPick = isVariantFlow && !confirmedVariant;

  const pickVariant = (variant: any) => {
    setSelectedVariant(variant);
    fetchAddonsForSelectedVariant(variant);
    setCurrentIndex(0);
    setConfirmedVariant(true);
  };

  const selectionFor = (group: any): any[] =>
    (selectedCustomizations ?? {})[group?._id] ?? [];
  const isSelected = (group: any, item: any) =>
    selectionFor(group).some((s: any) => s?.id === item?.id);
  const quantityOf = (group: any, item: any) =>
    selectionFor(group).find((s: any) => s?.id === item?.id)?.quantity ?? 0;

  // ---- Pack presentation (P6c brief): `_combo` groups with min===1 &&
  // max===1 render as slot cards + one SELECT sheet; every other group
  // (addons, BYO-shaped combos) keeps the generic renderGroup path. ----
  const isSlotGroup = (group: any) =>
    String(group?._id ?? "").includes("_combo") &&
    Number(group?.min) === 1 &&
    Number(group?.max) === 1;

  const slotOptionsFor = (group: any): any[] =>
    (renderAppropriateConstituentItems(group?.constituentItems ?? []) ?? []).filter(
      (i: any) => i?.isActive !== false
    );

  const canCustomize = (item: any) => {
    try {
      const variant = findAppropriateVariantForSelectedItem(item);
      return !!variant && Object.keys(variant).length > 0;
    } catch {
      return false; // a malformed menu map must not take the PDP down (Rule 2)
    }
  };

  const openTier2New = (group: any, item: any, variant: any) => {
    dispatch(
      setTeir2SelectedEntity({
        entity: buildTier2NewEntity({ variant, entity: item, group }),
        groupId: group._id,
        currentCustomizations: {
          selectedCustomizations: selectedCustomizations ?? {},
          group,
        },
      })
    );
    setTier2BottomSheetInRdx(true, "customizableItem", "new");
  };

  const handleSlotSave = (group: any, item: any) => {
    const variant = findAppropriateVariantForSelectedItem(item);
    const tier2Capable = !!variant && Object.keys(variant).length > 0;
    if (tier2Capable && variant?.isAllModifersOptional === false) {
      // The pick has REQUIRED nested groups — route through tier-2 NEW so
      // they can't be skipped (brief: pack sheet SAVE semantics).
      openTier2New(group, item, variant);
    } else {
      const index = (sortedModifiers ?? []).findIndex(
        (g: any) => g?._id === group?._id
      );
      const nextGroup = sortedModifiers?.[index + 1] ?? {};
      addCustomizations(group, { ...item, quantity: 1 }, null, nextGroup, false);
    }
    setOpenSlotGroupId(null);
  };

  const handleSlotCustomize = (group: any, item: any) => {
    const row = selectionFor(group).find((s: any) => s?.id === item?.id);
    if (row?.customizations && Object.keys(row.customizations).length > 0) {
      // Currently selected pick that already carries customizations → EDIT.
      dispatch(
        openTier2EditModal({
          customizations: {
            selectedEntity: { ...row },
            selectedCustomizations: row.customizations,
          },
          bottomSheet: {
            isOpen: true,
            type: "customizableItem",
            openType: "edit",
          },
          groupId: group._id,
          currentCustomizations: {
            selectedCustomizations: selectedCustomizations ?? {},
            group,
          },
          // Cast: the slice reducer types this action's payload as any/void
          // (sibling components cast the same way).
        } as any)
      );
      setOpenSlotGroupId(null);
      return;
    }
    const variant = findAppropriateVariantForSelectedItem(item);
    if (!variant || Object.keys(variant).length === 0) return; // link never renders here
    openTier2New(group, item, variant);
    setOpenSlotGroupId(null);
  };

  const openSlotGroup =
    (sortedModifiers ?? []).find((g: any) => g?._id === openSlotGroupId) ?? null;

  const renderGroup = (group: any, index: number) => {
    if (group?.isActive === false) return null;
    const items: any[] = (group?.constituentItems ?? []).filter(
      (i: any) => i?.isActive !== false
    );
    if (items.length === 0) return null;
    const nextGroup = sortedModifiers?.[index + 1] ?? {};
    const stepper = Number(group?.multiplePunchMaxItem ?? 1) > 1;
    const errored = (erroredSection as any)?.id === group?._id;
    const min = Number(group?.min ?? 0);

    return (
      <section
        key={group._id}
        id={group._id}
        data-testid={`pdp-group-${group._id}`}
        className={`mb-[40px] rounded-[8px] ${errored ? "ring-4 ring-red-500 p-[16px]" : ""}`}
      >
        <div className="mb-[16px] flex items-baseline gap-4">
          <h3 className="text-[24px] font-bold text-black">{group?.name}</h3>
          {min > 0 && (
            <span className={`text-[16px] ${errored ? "text-red-600 font-bold" : "text-tb-ink-purple/60"}`}>
              {t("pdp.required")}
            </span>
          )}
        </div>
        {stepper ? (
          <div className="flex flex-col divide-y divide-tb-grey-4 rounded-[8px] bg-tb-grey-6">
            {items.map((item: any) => {
              const qty = quantityOf(group, item);
              const imageUrl = resolveEntityImage(item);
              return (
                <div key={item.id} className="flex items-center gap-[16px] p-[16px]">
                  {imageUrl && (
                    <img alt="" src={imageUrl} className="h-[72px] w-[72px] object-contain" />
                  )}
                  <div className="flex-1">
                    <p className="text-[20px] font-medium capitalize text-black">{item.name}</p>
                    <p className="text-[16px] text-tb-ink-purple/70">
                      {Number(item.price) > 0 ? `+${currency}${Number(item.price).toFixed(2)}` : `0 Cal`}
                    </p>
                  </div>
                  <div className="flex items-center gap-[12px]">
                    <button
                      type="button"
                      aria-label={`decrease ${item.name}`}
                      onClick={() => decreaseCustomization(group, item)}
                      className="h-[44px] w-[44px] rounded-full border-2 border-tb-purple text-[24px] font-bold text-tb-purple"
                    >
                      –
                    </button>
                    <span className="w-[36px] text-center text-[22px] font-bold">{qty}</span>
                    <button
                      type="button"
                      aria-label={`increase ${item.name}`}
                      onClick={() =>
                        qty === 0
                          ? addCustomizations(group, { ...item, quantity: 1 }, null, nextGroup, false)
                          : increaseCustomization(group, item, null, nextGroup)
                      }
                      className="h-[44px] w-[44px] rounded-full bg-tb-purple text-[24px] font-bold text-tb-surface"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-[16px]">
            {items.map((item: any) => {
              const selected = isSelected(group, item);
              const imageUrl = resolveEntityImage(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`pdp-option-${item.id}`}
                  onClick={() => addCustomizations(group, item, null, nextGroup, false)}
                  className={`relative flex flex-col items-center rounded-[8px] border-2 bg-tb-grey-6 p-[16px] pb-[20px] min-h-[44px] ${
                    selected ? "border-tb-purple" : "border-transparent"
                  }`}
                >
                  {imageUrl && (
                    <img alt="" src={imageUrl} className="mb-2 h-[96px] w-full object-contain" />
                  )}
                  <p className="text-[18px] font-medium capitalize leading-[22px] text-black">
                    {item.name}
                  </p>
                  {Number(item.price) > 0 && (
                    <p className="text-[15px] text-tb-ink-purple/70">
                      +{currency}
                      {Number(item.price).toFixed(2)}
                    </p>
                  )}
                  <span
                    className={`absolute right-[10px] top-[10px] h-[26px] w-[26px] rounded-full border-2 ${
                      selected ? "border-tb-purple bg-tb-purple" : "border-tb-purple/40 bg-tb-surface"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    // h-full = ReachZone's container: 1920, or the ADA reach zone (Figma
    // 1:5413 — the whole PDP scrolls above the pinned CTA bar + footer).
    <div
      data-testid="customization-screen"
      data-embedded={embedded ? "true" : undefined}
      className="relative flex h-full w-[1080px] flex-col bg-tb-surface"
    >
      <div id="scrollCustomizableItem" className="min-h-0 flex-1 overflow-y-auto px-[48px] pb-[96px]">
        {heroImage && (
          <img alt="" src={heroImage} className="mx-auto mt-[24px] h-[420px] object-contain" />
        )}
        <div className="mt-[16px] flex items-start justify-between gap-6">
          <h1 className="tb-compressed max-w-[700px] text-[56px] leading-[52px] text-black">
            {SelectedEntity?.name}
          </h1>
          {/* One freebie per pick: no stepper (the offer sets the quantity). */}
          {!isFreebie && (
            <div className="flex items-center gap-[16px] pt-2">
              <button
                type="button"
                data-testid="pdp-qty-decrease"
                aria-label={t("pdp.decrease")}
                onClick={() => (quantity <= 1 ? closeModalStates() : decreaseQuantity1())}
                className="h-[52px] w-[52px] rounded-full border-2 border-tb-purple text-[26px] font-bold text-tb-purple"
              >
                –
              </button>
              <span data-testid="pdp-qty" className="w-[40px] text-center text-[28px] font-bold">
                {quantity}
              </span>
              <button
                type="button"
                data-testid="pdp-qty-increase"
                aria-label={t("pdp.increase")}
                onClick={() => increaseQuantity1()}
                className="h-[52px] w-[52px] rounded-full bg-tb-purple text-[26px] font-bold text-tb-surface"
              >
                +
              </button>
            </div>
          )}
        </div>
        <p className="mt-[8px] text-[20px] text-tb-ink-purple">
          {currency}
          {basePrice.toFixed(2)}
          {calLabel}
        </p>
        {SelectedEntity?.description && (
          <p className={`mt-[12px] max-w-[860px] text-[18px] leading-[24px] text-tb-ink-purple/80 ${showFullDescription ? "" : "line-clamp-2"}`}>
            {SelectedEntity.description}{" "}
            <button
              type="button"
              onClick={() => setShowFullDescription((v) => !v)}
              className="font-bold underline"
            >
              {showFullDescription ? t("pdp.showLess") : t("pdp.showMore")}
            </button>
          </p>
        )}

        {needsVariantPick ? (
          <section className="mt-[40px]" data-testid="pdp-variant-picker">
            <h3 className="tb-display mb-[24px] text-[30px] tracking-[-1px] text-tb-purple-vibrant">
              {t("size.title")}
            </h3>
            <div className="grid grid-cols-2 gap-[16px]">
              {variants.map((v: any) => {
                const imageUrl = resolveEntityImage(v);
                return (
                  <button
                    key={v.id}
                    type="button"
                    data-testid={`pdp-variant-${v.id}`}
                    onClick={() => pickVariant(v)}
                    className="flex flex-col items-start rounded-[8px] bg-tb-grey-6 p-[20px] min-h-[44px]"
                  >
                    {imageUrl && (
                      <img alt="" src={imageUrl} className="mb-2 h-[140px] w-full object-contain" />
                    )}
                    <p className="text-[20px] font-medium capitalize text-black">{v.name}</p>
                    <p className="text-[16px] text-tb-ink-purple/70">
                      {currency}
                      {Number(v.price ?? 0).toFixed(2)}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <>
            {isVariantFlow && selectedVariant?.name && (
              <button
                type="button"
                data-testid="pdp-change-size"
                onClick={() => setConfirmedVariant(false)}
                className="mt-[24px] rounded-full border-2 border-tb-purple px-6 py-3 text-[18px] font-bold text-tb-purple min-h-[44px]"
              >
                {selectedVariant.name} · {t("pdp.change")}
              </button>
            )}
            <div className="mt-[40px]">
              {(sortedModifiers ?? []).some(isSlotGroup) && (
                <div
                  data-testid="pack-slot-grid"
                  className="mb-[40px] grid grid-cols-3 gap-[16px]"
                >
                  {(sortedModifiers ?? []).map((group: any) => {
                    if (!isSlotGroup(group) || group?.isActive === false) {
                      return null;
                    }
                    const options = slotOptionsFor(group);
                    if (options.length === 0) return null;
                    return (
                      /* id={group._id} — the hook's error AutoScroll targets
                         it inside #scrollCustomizableItem (tier-1 contract) */
                      <section key={group._id} id={group._id}>
                        <PackSlotCard
                          group={group}
                          selection={selectionFor(group)}
                          previewItem={options[0]}
                          currency={currency}
                          errored={(erroredSection as any)?.id === group?._id}
                          onOpen={() => setOpenSlotGroupId(group._id)}
                        />
                      </section>
                    );
                  })}
                </div>
              )}
              {(sortedModifiers ?? []).map((group: any, i: number) =>
                isSlotGroup(group) ? null : renderGroup(group, i)
              )}
            </div>
          </>
        )}
      </div>

      {/* ADD TO BAG bar — Figma CTA_Sheet pattern. In flow (Menu's pattern)
          so the scroller ends at its top edge: pb-[96px] above is the old
          220 minus this 124px bar, so the scroll end is unchanged. */}
      <div className="flex w-full shrink-0 items-center justify-between bg-tb-purple p-[40px]">
        <button
          type="button"
          data-testid="pdp-back"
          onClick={() => closeModalStates()}
          className="flex min-h-[44px] items-center gap-3"
        >
          <img alt="" src={backspaceIcon} className="h-[28px] w-[28px] brightness-0 invert" />
          <span className="tb-display text-[22px] text-tb-surface">{t("pdp.back")}</span>
        </button>
        <button
          type="button"
          data-testid="pdp-add-to-bag"
          disabled={needsVariantPick}
          onClick={() => addCustomizationToCart(undefined)}
          className={`tb-display flex min-h-[44px] items-center gap-4 text-[24px] ${needsVariantPick ? "text-tb-surface/50" : "text-tb-surface"}`}
        >
          {/* A freebie's price is the offer's call (redeemGetItem at CONFIRM),
              so its CTA makes no price claim — not even "free": a 50% grant
              or a paid add-on still charges (fork "Add to offer" parity). */}
          {isFreebie ? (
            t("offers.picker.addFreebie")
          ) : (
            <>
              {isEditMode ? t("bag.update") : t("pdp.addToBag")} · {currency}
              {total.toFixed(2)}
            </>
          )}
        </button>
      </div>
      {!embedded && (
        <div className="relative h-[56px] w-full shrink-0">
          <FooterBar
            onCancelOrder={() => setCancelOrderOpen(true)}
            onOpenLanguage={() => setLanguageOpen(true)}
          />
        </div>
      )}

      <SlotSelectionSheet
        open={!!openSlotGroup}
        group={openSlotGroup}
        options={openSlotGroup ? slotOptionsFor(openSlotGroup) : []}
        selectedId={
          openSlotGroup ? selectionFor(openSlotGroup)[0]?.id : undefined
        }
        currency={currency}
        canCustomize={canCustomize}
        onSave={(item: any) => {
          if (openSlotGroup) handleSlotSave(openSlotGroup, item);
        }}
        onCustomize={(item: any) => {
          if (openSlotGroup) handleSlotCustomize(openSlotGroup, item);
        }}
        onClose={() => setOpenSlotGroupId(null)}
      />

      <Tier2CustomizationSheet />

      {!embedded && (
        <>
          <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
          <CancelOrderModal
            open={cancelOrderOpen}
            // ONLY navigate (hazard H1): /start's mount owns the revoke +
            // resetSession("full"). Resetting here first would close the tier-1
            // session while this route is still rendered, and the no-session
            // guard above would bounce to the return path instead of the splash.
            onConfirm={() => {
              setCancelOrderOpen(false);
              navigate("/start");
            }}
            onCancel={() => setCancelOrderOpen(false)}
          />
        </>
      )}
    </div>
  );
}
