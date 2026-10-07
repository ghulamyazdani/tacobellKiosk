/* eslint-disable @typescript-eslint/no-explicit-any --
 * Entities/groups flow untyped from the legacy converters + makeItAMeal
 * slice; typed in later domain passes. Do not add NEW anys.
 */
import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  addTier2CustomizationsToTier1,
  closeTier2Modal,
  closeTier2ModalBottomSheet,
  confirmTier1CustomizationRemoval,
  decreaseTier2selectedEntityQuantity,
  increaseTier2selectedEntityQuantity,
  makeItAMealTier1Customization,
  makeItAMealTier2BottomSheet,
  MIAMTier2Open,
  removeTier2SelectedCustomization,
  selectConfirmTier1CustomizationRemoval,
  selectCurrentTier1Customizations,
  selectTier2CustomizationModalForConfirmation,
  setAutoSelectTier1AutoSelectGroup,
  setNestedCustomizationDirect,
  setTier1SelectedCustomization,
  setTier2CustomizationModalForConfirmation,
  setTier2SelectedCustomization,
  tier2CustomizationSelectedEntity,
  tier2MIAMGroupID,
  tier2SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  selectCurrency,
  selectHidePlusIconFromItem,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  appendTier2SelectionToTier1,
  buildContradictoryItemsMap,
  buildEmptySelectionsForActiveGroups,
  decideTier2QuantityDecrease,
  evaluateTier2QuantityIncrease,
  findTier2MinMaxViolation,
  removeTier1Selection,
  replaceTier2SelectionInTier1,
  shouldAutoSelectTier1Group,
  shouldPromptTier2CloseConfirmation,
} from "@cx-sdk/ordering/customization/tier2Logic";
import {
  getEffectiveMax,
  getEffectiveMin,
} from "@cx-sdk/ordering/customization/selectionRules";
import { closeBottomSheet } from "../../redux/features/menuSelections/menuSelections.slice";
import useCustomization from "../../hooks/customization/useCustomization";
import useGlobalTriggerServices from "../../hooks/globals/useGlobalTriggerServices";
import { resolveEntityImage } from "../../utils/entityImage";
import useLocalized from "../../hooks/utils/useLocalized";
import closeIcon from "../../assets/icons/close.svg";

// Unique id for a repeat-capable tier-1 row (fork's generateUniqueId).
// Module-level: only ever called from user-event commits, never in render.
const generateUniqueId = (id: any) => `${Date.now()}_${id}`;

/**
 * Tier-2 (nested) customization sheet — the "Customize" surface reached from
 * a pack slot's SELECT sheet (new) or from an already-customized slot pick
 * (edit). Full-height white sheet over a purple-tinted backdrop, in the pack
 * design language (Figma 1:4761/1:4692 family; the nested frames 1:4895 were
 * not pullable — same language, flagged for sign-off).
 *
 * Binds the ported useCustomization EXACTLY like the fork's
 * CustomizationTier2: args {cartRef, isOpenBottomSheet (tier-2 bottomSheet),
 * SelectedEntity (tier-2 entity), selectedCustomizations (tier-2 map),
 * setSelectedCustomizations (the slice ACTION CREATOR),
 * addTier2CustomizationToMIAMCart (defined HERE — the hook calls it on
 * quick-customization auto-commit paths)}.
 *
 * Commit recipe (fork parity): min/max violation → errored ring + AutoScroll
 * inside #scrollCustomizableItem2; new → appendTier2SelectionToTier1 with a
 * `${Date.now()}_${id}` uniqueId over a deep clone of the tier-1 selections
 * SNAPSHOT frozen when the sheet opened; edit → replaceTier2SelectionInTier1
 * by SelectedEntity.itemId; then addTier2CustomizationsToTier1 +
 * closeTier2Modal + shouldAutoSelectTier1Group check.
 *
 * Renders null while the tier-2 modal is closed.
 */
export default function Tier2CustomizationSheet() {
  const { t } = useTranslation();
  const { name } = useLocalized();
  const dispatch = useDispatch();
  const cartRef = useRef(null);
  const { triggerNotification } = useGlobalTriggerServices();

  const tier2Open = useSelector(MIAMTier2Open);
  const isOpenBottomSheet = useSelector(makeItAMealTier2BottomSheet);
  const SelectedEntity = useSelector(tier2CustomizationSelectedEntity);
  const selectedCustomizations = useSelector(tier2SelectedCustomization);
  const groupIdTier2 = useSelector(tier2MIAMGroupID);
  const parentMeta = useSelector(selectCurrentTier1Customizations);
  const tier1SessionLive = useSelector(makeItAMealTier1Customization);
  const hidePlusButton = useSelector(selectHidePlusIconFromItem);
  const discardPromptOpen = useSelector(
    selectTier2CustomizationModalForConfirmation,
  );
  const removalRequested = useSelector(selectConfirmTier1CustomizationRemoval);
  const currencySettings = useSelector(selectCurrency) as any;
  const currency = currencySettings?.symbol ?? "";

  const isEditOpen = isOpenBottomSheet?.openType === "edit";
  // Item 24: "−" at qty 1 of an EDIT (hide-plus on) asks before removing the
  // tier-1 pick; never over the discard prompt.
  const removalOpen =
    Boolean(removalRequested) && tier2Open && isEditOpen && !discardPromptOpen;

  /*
    Tier-1 session snapshot frozen when the sheet OPENS (fork parity: the
    fork's mount-frozen ref of the tier1CustomizationModal subtree). The
    commit's baseCustomizations deep-clones THIS snapshot, not the live map,
    so mid-session tier-1 mutations can't corrupt the commit base.
  */
  const tier1SessionSnapshot = useRef<any>(null);
  useEffect(() => {
    if (tier2Open) {
      if (tier1SessionSnapshot.current === null) {
        tier1SessionSnapshot.current = tier1SessionLive;
      }
    } else {
      tier1SessionSnapshot.current = null;
    }
  }, [tier2Open, tier1SessionLive]);

  /*
    Auto-select-next-tier1-group check after a commit (fork's
    conditionsCheckForParentForAutoSelection). Guarded exactly like the fork:
    only when the parent snapshot is non-empty. Engine call is fenced — a
    malformed parent snapshot must not take the sheet down.
    Declared before the commit fn purely for reading order; both close over
    hook outputs below and only run on user events, after initialization.
  */
  const runParentAutoSelectCheck = () => {
    try {
      if (!parentMeta || Object.keys(parentMeta).length === 0) return;
      const amp = isAllowMultiplePunch();
      const parentGroup = parentMeta?.group;
      if (
        shouldAutoSelectTier1Group({
          groupId: parentGroup?._id,
          min: getEffectiveMin(parentGroup, amp),
          max: getEffectiveMax(parentGroup, amp),
          selectedCustomizations: parentMeta?.selectedCustomizations,
          addedQuantity: SelectedEntity?.quantity,
          isEditOpen,
          editEntityId: SelectedEntity?.id,
        })
      ) {
        dispatch(setAutoSelectTier1AutoSelectGroup(true as any));
      }
    } catch {
      // Auto-select is a convenience; never let it crash the kiosk (Rule 2).
    }
  };

  /*
    THE tier-2 commit (fork's addTier2CustomizationToMIAMCart +
    updateTier2CustomizationToMIAMCart merged behind the openType switch).
    Passed INTO useCustomization: the hook calls it with the fresh
    customizations map on quick-customization auto-commit paths; the SAVE
    button calls it with no argument.
  */
  const addTier2CustomizationToMIAMCart = (customizations?: any) => {
    try {
      const effectiveSelections =
        customizations ?? selectedCustomizations ?? {};

      // 1. min/max violation → errored ring + autoscroll, abort.
      const violation = findTier2MinMaxViolation(
        effectiveSelections,
        fetchModifierProperties,
        isAllowMultiplePunch(),
      );
      if (violation) {
        setErroredSection({ id: violation.modifierID, name: violation.name });
        AutoScroll(
          document.getElementById("scrollCustomizableItem2"),
          document.getElementById(violation.modifierID)?.offsetTop,
          100,
        );
        triggerNotification(t("pdp.customizationErrors"));
        return;
      }

      // 3. deep clone of the tier-1 selections snapshot taken at open.
      const session = tier1SessionSnapshot.current ?? tier1SessionLive;
      const baseCustomizations = JSON.parse(
        JSON.stringify(session?.customizations?.selectedCustomizations ?? {}),
      );

      if (isEditOpen) {
        const nextTier1 = replaceTier2SelectionInTier1({
          baseCustomizations,
          groupId: groupIdTier2,
          itemId: SelectedEntity?.itemId,
          selectedEntity: SelectedEntity,
          selectedCustomizations: effectiveSelections,
        });
        dispatch(addTier2CustomizationsToTier1(nextTier1));
        runParentAutoSelectCheck();
        dispatch(closeTier2Modal());
        return;
      }

      // 2. unique id for the new tier-1 row.
      const uniqueId = generateUniqueId(SelectedEntity?.id);
      const amp = isAllowMultiplePunch();
      const { customizations: nextTier1, applied } =
        appendTier2SelectionToTier1({
          baseCustomizations,
          groupId: groupIdTier2,
          tier1Min: getEffectiveMin(parentMeta?.group, amp),
          tier1Max: getEffectiveMax(parentMeta?.group, amp),
          selectedEntity: SelectedEntity,
          selectedCustomizations: effectiveSelections,
          uniqueId,
        });

      if (applied) {
        dispatch(addTier2CustomizationsToTier1(nextTier1));
        dispatch(closeTier2Modal());
        runParentAutoSelectCheck();
      }
    } catch {
      // Never crash the kiosk on a commit; surface the generic error instead.
      triggerNotification(t("pdp.customizationErrors"));
    }
  };

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
    setErroredSection,
    addCustomizations,
    increaseCustomization,
    decreaseCustomization,
    getTotalValueWithApplyAddonPrice,
    isAllowMultiplePunch,
    setConfirmedVariant,
    setQuantity,
    setLoaderVariantEdit,
    setGrayOutAllCustomizations,
    setContradictoryItems,
    AutoScroll,
  } = useCustomization({
    cartRef,
    isOpenBottomSheet,
    SelectedEntity,
    selectedCustomizations,
    setSelectedCustomizations: setTier2SelectedCustomization,
    addTier2CustomizationToMIAMCart,
  });

  const initialisedFor = useRef<string | null>(null);
  const hasInitializedContradictoryItems = useRef(false);

  // ---- Mount/seed (fork CustomizationTier2:322-437, customizableItem) ----
  useEffect(() => {
    if (!tier2Open || !isOpenBottomSheet?.isOpen || !SelectedEntity?.id) {
      initialisedFor.current = null;
      return;
    }
    const key = `${SelectedEntity.id}:${isOpenBottomSheet?.openType}:${isOpenBottomSheet?.type}`;
    if (initialisedFor.current === key) return;
    initialisedFor.current = key;

    if (
      isOpenBottomSheet?.type === "customizableItem" &&
      isOpenBottomSheet?.openType === "new"
    ) {
      setGrayOutAllCustomizations({ isEnabled: false, modifierID: [] });
      const modifierProperties = fetchModifierProperties(
        SelectedEntity?.modifiers ?? [],
      );
      dispatch(
        setTier2SelectedCustomization(
          buildEmptySelectionsForActiveGroups(modifierProperties),
        ),
      );
      setFetchModifierGroups(modifierProperties);
    } else if (
      isOpenBottomSheet?.type === "customizableItem" &&
      isOpenBottomSheet?.openType === "edit"
    ) {
      // Selections already live in redux (openTier2EditModal wrote them, or
      // the edit payload's customizations) — only the groups are fetched.
      const modifierGroups = fetchModifierProperties(
        SelectedEntity?.modifiers ?? [],
      );
      setFetchModifierGroups(modifierGroups);

      // Fork parity: a cart-edit of a MIAM item restores its nested map.
      if (
        isOpenBottomSheet?.editCustomizationContent?.isMakeItAMealItem &&
        !SelectedEntity?.hasVariant &&
        SelectedEntity?.modifiers?.length > 0
      ) {
        dispatch(
          setNestedCustomizationDirect(
            isOpenBottomSheet?.editCustomizationContent?.nestedCustomizations,
          ),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fork parity: one-shot per entity/open-type, keyed by the ref above
  }, [tier2Open, isOpenBottomSheet, SelectedEntity?.id]);

  // ---- Edit-session local state (fork CustomizationTier2:289-295) ----
  useEffect(() => {
    if (isOpenBottomSheet?.openType === "edit") {
      setConfirmedVariant(true);
      setQuantity(
        isOpenBottomSheet?.editCustomizationContent?.quantity ??
          SelectedEntity?.quantity ??
          1,
      );
      setLoaderVariantEdit(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fork parity: keyed on the bottom-sheet state only
  }, [isOpenBottomSheet]);

  // ---- Contradictory-item seed for edit sessions (fork :439-454) ----
  useEffect(() => {
    if (
      selectedCustomizations &&
      isOpenBottomSheet?.openType === "edit" &&
      !hasInitializedContradictoryItems.current
    ) {
      hasInitializedContradictoryItems.current = true;
      setContradictoryItems(buildContradictoryItemsMap(selectedCustomizations));
    }
    if (!isOpenBottomSheet?.isOpen) {
      hasInitializedContradictoryItems.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fork parity: keyed on selections + sheet state only
  }, [selectedCustomizations, isOpenBottomSheet]);

  // ---- Groups arrived → sorted render list (tier-1 page idiom) ----
  useEffect(() => {
    const sorted = convertModifiersAccordingly(fetchedModifierGroups ?? []);
    setSortedModifiers(sorted);
    setSelectedGroup(sorted?.[0] ?? null);
    setCurrentIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fork parity: keyed on fetched groups only
  }, [fetchedModifierGroups]);

  // ---- Close / discard-confirm (fork closeTier2 + ConfirmCustomization) ----
  const closeSheet = () => {
    dispatch(confirmTier1CustomizationRemoval(false));
    if (
      shouldPromptTier2CloseConfirmation({
        selectedCustomizations: selectedCustomizations ?? {},
        openType: isOpenBottomSheet?.openType,
      })
    ) {
      dispatch(setTier2CustomizationModalForConfirmation(true));
    } else {
      dispatch(closeBottomSheet());
      dispatch(closeTier2ModalBottomSheet());
    }
  };

  const discardAndClose = () => {
    dispatch(closeBottomSheet());
    dispatch(closeTier2ModalBottomSheet());
    dispatch(setTier2CustomizationModalForConfirmation(false));
    dispatch(removeTier2SelectedCustomization());
    dispatch(confirmTier1CustomizationRemoval(false));
  };

  /*
    Item 24 YES (fork ConfirmFirstTierDeleteCustomization): drop this pick from
    the LIVE tier-1 map, clear the flag, close without the discard prompt.
    DELIBERATE FORK DIVERGENCE: the group comes from this tier-2 session
    (tier2MIAMGroupID) and the pick is matched by itemId — the fork's
    `group.id` (groups carry `_id`) wrote an "undefined" key that made PDP
    pricing throw.
  */
  const confirmRemoval = () => {
    dispatch(
      setTier1SelectedCustomization(
        removeTier1Selection({
          selectedCustomizations:
            tier1SessionLive?.customizations?.selectedCustomizations,
          groupId: groupIdTier2,
          entity: SelectedEntity,
        }),
      ),
    );
    dispatch(confirmTier1CustomizationRemoval(false));
    dispatch(closeTier2Modal());
  };

  const cancelRemoval = () => {
    dispatch(confirmTier1CustomizationRemoval(false));
  };

  const keepEditing = () => {
    dispatch(setTier2CustomizationModalForConfirmation(false));
  };

  // ---- Entity quantity stepper (engine verdicts + tier-2 actions) ----
  const increaseEntityQuantity = () => {
    try {
      const verdict = evaluateTier2QuantityIncrease({
        tier2Open,
        tier1Session: tier1SessionSnapshot.current ?? tier1SessionLive,
        groupId: groupIdTier2,
        selectedEntity: SelectedEntity,
        allowMultiplePunch: isAllowMultiplePunch(),
        isEditOpen,
      });
      if (!verdict.allowed) {
        triggerNotification(
          verdict.reason === "item-limit"
            ? t("pdp.itemLimitExceeded")
            : t("pdp.groupLimitExceeded"),
        );
        return;
      }
      dispatch(increaseTier2selectedEntityQuantity());
    } catch {
      // A malformed session must not crash the stepper (Rule 2).
    }
  };

  const decreaseEntityQuantity = () => {
    const decision = decideTier2QuantityDecrease({
      quantity: SelectedEntity?.quantity,
      isEditOpen,
      hidePlusButton,
    });
    if (decision === "confirm-removal") {
      dispatch(confirmTier1CustomizationRemoval(true as any));
      return;
    }
    if (decision === "close") {
      closeSheet();
      return;
    }
    dispatch(decreaseTier2selectedEntityQuantity());
  };

  if (!tier2Open) return null;

  // ---- Price line: (addons-with-applyAddonsPrice + entity price) × qty ----
  const quantity = SelectedEntity?.quantity || 1;
  const basePrice = Number(SelectedEntity?.price ?? 0);
  const addonsValue = getTotalValueWithApplyAddonPrice(
    selectedCustomizations ?? {},
    SelectedEntity?.applyAddonsPrice,
  );
  const total = (Number(addonsValue || 0) + basePrice) * quantity;

  const entityCal = (() => {
    const cal = SelectedEntity?.calorieCount;
    const value = typeof cal === "object" ? cal?.value : cal;
    return value ? ` | ${t("pack.cal", { value })}` : "";
  })();

  const itemMeta = (item: any) => {
    const cal = item?.calorieCount;
    const calValue = typeof cal === "object" ? cal?.value : cal;
    const parts: string[] = [];
    if (Number(item?.price) > 0) {
      parts.push(`+${currency}${Number(item.price).toFixed(2)}`);
    }
    if (calValue) parts.push(t("pack.cal", { value: calValue }));
    return parts.join(" | ");
  };

  const selectionFor = (group: any): any[] =>
    (selectedCustomizations ?? {})[group?._id] ?? [];
  const isSelected = (group: any, item: any) =>
    selectionFor(group).some((s: any) => s?.id === item?.id);
  const quantityOf = (group: any, item: any) =>
    selectionFor(group).find((s: any) => s?.id === item?.id)?.quantity ?? 0;

  // Same visual idiom as the tier-1 PDP renderGroup: 3-col single-select
  // cards, stepper rows for multiPunch groups. Section id={group._id} — the
  // hook's error AutoScroll targets it inside #scrollCustomizableItem2.
  const renderGroup = (group: any, index: number) => {
    if (group?.isActive === false) return null;
    const items: any[] = (group?.constituentItems ?? []).filter(
      (i: any) => i?.isActive !== false,
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
        data-testid={`tier2-group-${group._id}`}
        className={`mb-[40px] rounded-[8px] ${errored ? "ring-4 ring-red-500 p-[16px]" : ""}`}
      >
        <div className="mb-[16px] flex items-baseline gap-4">
          <h3 className="text-[24px] font-bold text-black">{name(group)}</h3>
          {min > 0 && (
            <span
              className={`text-[16px] ${errored ? "text-red-600 font-bold" : "text-tb-ink-purple/60"}`}
            >
              {t("pdp.required")}
            </span>
          )}
        </div>
        {stepper ? (
          <div className="flex flex-col divide-y divide-tb-grey-4 rounded-[8px] bg-tb-grey-6">
            {items.map((item: any) => {
              const qty = quantityOf(group, item);
              const meta = itemMeta(item);
              const imageUrl = resolveEntityImage(item);
              return (
                <div
                  key={item.id}
                  data-testid={`tier2-option-${item.id}`}
                  className="flex items-center gap-[16px] p-[16px]"
                >
                  {imageUrl && (
                    <img
                      alt=""
                      src={imageUrl}
                      className="h-[72px] w-[72px] object-contain"
                    />
                  )}
                  <div className="flex-1">
                    <p className="text-[20px] font-medium capitalize text-black">
                      {name(item)}
                    </p>
                    {meta && (
                      <p className="text-[16px] text-tb-ink-purple/70">{meta}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-[12px]">
                    <button
                      type="button"
                      aria-label={`${t("pdp.decrease")} ${name(item)}`}
                      onClick={() => decreaseCustomization(group, item)}
                      className="h-[44px] w-[44px] rounded-full border-2 border-tb-purple text-[24px] font-bold text-tb-purple"
                    >
                      –
                    </button>
                    <span className="w-[36px] text-center text-[22px] font-bold">
                      {qty}
                    </span>
                    <button
                      type="button"
                      aria-label={`${t("pdp.increase")} ${name(item)}`}
                      onClick={() =>
                        qty === 0
                          ? addCustomizations(
                              group,
                              { ...item, quantity: 1 },
                              null,
                              nextGroup,
                              false,
                            )
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
              const meta = itemMeta(item);
              const imageUrl = resolveEntityImage(item);
              return (
                // No photo: the name sits on the radio's row, so px-[44px]
                // keeps it centred and 8 px clear of the 26 px radio (right-10).
                <button
                  key={item.id}
                  type="button"
                  data-testid={`tier2-option-${item.id}`}
                  onClick={() =>
                    addCustomizations(group, item, null, nextGroup, false)
                  }
                  className={`relative flex min-h-[44px] flex-col items-center rounded-[8px] border-2 bg-tb-grey-6 p-[16px] pb-[20px] ${
                    imageUrl ? "" : "px-[44px]"
                  } ${selected ? "border-tb-purple" : "border-transparent"}`}
                >
                  {imageUrl && (
                    <img
                      alt=""
                      src={imageUrl}
                      className="mb-2 h-[96px] w-full object-contain"
                    />
                  )}
                  <p className="text-[18px] font-medium capitalize leading-[22px] text-black">
                    {name(item)}
                  </p>
                  {meta && (
                    <p className="text-[15px] text-tb-ink-purple/70">{meta}</p>
                  )}
                  <span
                    className={`absolute right-[10px] top-[10px] h-[26px] w-[26px] rounded-full border-2 ${
                      selected
                        ? "border-tb-purple bg-tb-purple"
                        : "border-tb-purple/40 bg-tb-surface"
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

  // Inline confirm (design-language modal, z-[70]) — render helper, used for
  // the discard prompt and the item-24 removal confirm (same copy: the fork's
  // own removal dialog says the equivalent). An alertdialog that takes focus
  // (ErrorModal precedent; IdleGuard ignores focus events).
  const renderConfirm = (
    testIdPrefix: string,
    onKeep: () => void,
    onConfirm: () => void,
  ) => (
    <div
      data-testid={`${testIdPrefix}-overlay`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${testIdPrefix}-title`}
      aria-describedby={`${testIdPrefix}-message`}
      className="absolute inset-0 z-[70] flex items-center justify-center"
    >
      <div className="absolute inset-0 bg-tb-ink-purple/60" />
      <div
        className="relative w-[640px] rounded-[16px] bg-tb-surface p-[40px] text-center"
        style={{ animation: "tbTier2DialogEnter 0.2s ease-out both" }}
      >
        <h3
          id={`${testIdPrefix}-title`}
          className="tb-display text-[30px] uppercase tracking-[-1px] text-tb-purple"
        >
          {t("pdp.discardTitle")}
        </h3>
        <p
          id={`${testIdPrefix}-message`}
          className="mt-[16px] text-[22px] text-tb-ink-purple/80"
        >
          {t("pdp.discardBody")}
        </p>
        <div className="mt-[32px] flex items-center justify-center gap-[24px]">
          <button
            type="button"
            data-testid={`${testIdPrefix}-cancel`}
            onClick={onKeep}
            className="h-[64px] min-w-[220px] rounded-[8px] border-2 border-tb-purple px-[24px] text-[20px] font-bold text-tb-purple"
          >
            {t("pdp.discardKeep")}
          </button>
          <button
            type="button"
            data-testid={`${testIdPrefix}-confirm`}
            autoFocus
            onClick={onConfirm}
            className="h-[64px] min-w-[220px] rounded-[8px] bg-tb-purple px-[24px] text-[20px] font-bold text-tb-surface"
          >
            {t("pdp.discardConfirm")}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div data-testid="tier2-sheet" className="absolute inset-0 z-[60]">
      {/* Purple-tinted backdrop (SELECT-sheet design language). Not a close
          target — dismissal is explicit via the X, kiosk-safe. */}
      <div className="absolute inset-0 bg-tb-purple-vibrant/70" />

      {/* Bottom-anchored entrance, scoped like SlotSelectionSheet's:
          index.css's tb-modal-enter ends at translate(-50%,-50%) (centered
          modals), which would shift this full-width sheet half off-screen. */}
      <style>{`@keyframes tbTier2SheetEnter{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:translateY(0)}}@keyframes tbTier2DialogEnter{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div
        className="absolute inset-x-0 bottom-0 top-[96px] flex flex-col overflow-hidden rounded-t-[24px] bg-tb-surface"
        style={{ animation: "tbTier2SheetEnter 0.2s ease-out both" }}
      >
        {/* Header: centered display title, X top-right, qty + price line */}
        <div className="relative shrink-0 px-[48px] pb-[20px] pt-[40px]">
          <h2 className="tb-display px-[64px] text-center text-[34px] uppercase leading-[1.05] tracking-[-1px] text-tb-purple">
            {name(SelectedEntity)}
          </h2>
          <button
            type="button"
            data-testid="tier2-sheet-close"
            aria-label={t("language.close")}
            onClick={closeSheet}
            className="absolute right-[32px] top-[32px] h-[44px] w-[44px]"
          >
            <img alt="" src={closeIcon} className="h-full w-full" />
          </button>

          <div className="mt-[20px] flex items-center justify-center gap-[32px]">
            <div className="flex items-center gap-[12px]">
              <button
                type="button"
                data-testid="tier2-qty-decrease"
                aria-label={t("pdp.decrease")}
                onClick={decreaseEntityQuantity}
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-tb-grey-6 text-[26px] font-bold text-tb-ink-purple"
              >
                –
              </button>
              <span
                data-testid="tier2-qty"
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-tb-purple text-[24px] font-bold text-tb-surface"
              >
                {quantity}
              </span>
              {!hidePlusButton && (
                <button
                  type="button"
                  data-testid="tier2-qty-increase"
                  aria-label={t("pdp.increase")}
                  onClick={increaseEntityQuantity}
                  className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-tb-grey-6 text-[26px] font-bold text-tb-ink-purple"
                >
                  +
                </button>
              )}
            </div>
            <p
              data-testid="tier2-price-line"
              className="text-[22px] font-medium text-tb-ink-purple"
            >
              {currency}
              {total.toFixed(2)}
              {entityCal}
            </p>
          </div>
        </div>

        {/* Group sections — the hook's error AutoScroll targets this id */}
        <div
          id="scrollCustomizableItem2"
          className="min-h-0 flex-1 overflow-y-auto px-[48px] pb-[40px] pt-[8px]"
        >
          {(sortedModifiers ?? []).map((group: any, i: number) =>
            renderGroup(group, i),
          )}
        </div>

        {/* SAVE bar (SELECT-sheet CTA pattern) */}
        <div className="shrink-0 px-[24px] pb-[24px] pt-[16px]">
          <button
            type="button"
            data-testid="tier2-sheet-save"
            onClick={() => addTier2CustomizationToMIAMCart()}
            className="tb-display h-[88px] w-full rounded-[8px] bg-tb-purple text-[26px] uppercase tracking-[0.5px] text-tb-surface"
          >
            {t("pack.save")}
          </button>
        </div>
      </div>

      {discardPromptOpen &&
        renderConfirm("tier2-discard", keepEditing, discardAndClose)}
      {removalOpen &&
        renderConfirm("tier2-remove", cancelRemoval, confirmRemoval)}
    </div>
  );
}
