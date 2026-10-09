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
import useAdaActive from "../../hooks/utils/useAdaActive";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import ScrollIndicator from "../chrome/ScrollIndicator";
import { ErrorBoundary } from "../../ErrorBoundary";
import OptionCard, {
  Counter,
  CtaBar,
  formatOptionMeta,
  GroupHeader,
  OptionRow,
} from "./OptionCard";

// Unique id for a repeat-capable tier-1 row (fork's generateUniqueId).
// Module-level: only ever called from user-event commits, never in render.
const generateUniqueId = (id: any) => `${Date.now()}_${id}`;

/**
 * Tier-2 (nested) customization — the full-screen CUSTOMIZE page (item 42,
 * D4: Figma 1:2984 / 1:5051 family) reached from a pack slot's SELECT sheet
 * or CUSTOMIZE (new), or from an already-customized slot pick (edit): the
 * Hero/Customize band, the PDP's group sections, BACK + UPDATE. Lazy: it
 * rides in bagLazyParts (+ the SDK tier2Logic only it imports) and the PDP
 * mounts it only while MIAMTier2Open — each open is a fresh mount.
 * BLOCKED, never faked: NONE / REGULAR / EXTRA levels, REMOVED / ADD,
 * RECOMMENDED, UNAVAILABLE and an upgrade card's CUSTOMIZE (no data; no
 * tier-3).
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
  const currency = useCurrencySymbol();
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const ada = useAdaActive();

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
  const heroImage = resolveEntityImage(SelectedEntity);

  const entityCal = (() => {
    const cal = SelectedEntity?.calorieCount;
    const value = typeof cal === "object" ? cal?.value : cal;
    return value ? ` | ${t("pack.cal", { value })}` : "";
  })();

  const selectionFor = (group: any): any[] =>
    (selectedCustomizations ?? {})[group?._id] ?? [];
  const isSelected = (group: any, item: any) =>
    selectionFor(group).some((s: any) => s?.id === item?.id);
  const quantityOf = (group: any, item: any) =>
    selectionFor(group).find((s: any) => s?.id === item?.id)?.quantity ?? 0;

  // The PDP's building blocks with this session's handlers: radio cards
  // (no CTAs, no badges) for one-per-tap groups, stepper rows for
  // multi-punch ones. Section id={group._id} — the hook's error AutoScroll
  // targets it inside #scrollCustomizableItem2.
  const renderGroup = (group: any, index: number) => {
    if (group?.isActive === false) return null;
    const items: any[] = (group?.constituentItems ?? []).filter(
      (i: any) => i?.isActive !== false,
    );
    if (items.length === 0) return null;
    const nextGroup = sortedModifiers?.[index + 1] ?? {};
    // UB2: the EFFECTIVE bounds decide the presentation (the PDP's rule): an
    // effective 1/1 group is radio cards, never steppers; "Required" follows
    // the effective min.
    const amp = isAllowMultiplePunch();
    const minPicks = Number(getEffectiveMin(group, amp));
    const maxPicks = Number(getEffectiveMax(group, amp));
    const oneOfOne = minPicks === 1 && maxPicks === 1;
    const stepper = Number(group?.multiplePunchMaxItem ?? 1) > 1 && !oneOfOne;
    const errored = (erroredSection as any)?.id === group?._id;

    return (
      <section
        key={group._id}
        id={group._id}
        data-testid={`tier2-group-${group._id}`}
        className={`flex flex-col gap-[16px] rounded-[8px] ${errored ? "tb-shake ring-4 ring-red-500 p-[16px]" : ""}`}
      >
        <GroupHeader
          name={name(group)}
          count={selectionFor(group).reduce(
            (sum: number, s: { quantity?: unknown } | null) =>
              sum + Number(s?.quantity ?? 0),
            0,
          )}
          max={maxPicks}
          required={minPicks > 0}
          errored={errored}
        />
        {stepper ? (
          <div className="flex flex-col gap-[24px]">
            {items.map((item: any) => {
              const qty = quantityOf(group, item);
              return (
                <OptionRow
                  key={item.id}
                  testId={`tier2-option-${item.id}`}
                  image={resolveEntityImage(item)}
                  name={name(item)}
                  meta={formatOptionMeta(item, currency, t)}
                  qty={qty}
                  onDecrease={() => decreaseCustomization(group, item)}
                  onIncrease={() =>
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
                  decreaseLabel={`${t("pdp.decrease")} ${name(item)}`}
                  increaseLabel={`${t("pdp.increase")} ${name(item)}`}
                />
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(3,minmax(0,328px))] gap-[16px]">
            {items.map((item: any) => (
              <OptionCard
                key={item.id}
                testId={`tier2-option-${item.id}`}
                image={resolveEntityImage(item)}
                name={name(item)}
                meta={formatOptionMeta(item, currency, t)}
                radio={isSelected(group, item) ? "on" : "off"}
                onSelect={() =>
                  addCustomizations(group, item, null, nextGroup, false)
                }
              />
            ))}
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
    // The full-screen CUSTOMIZE page (D4; 1:2984 / 1:5051 family) over the
    // whole PDP root, its footer strip included (as 1:5051). Opacity-only
    // entrance: a transform here would fight nothing today, but the page
    // needs none (one transform owner per element).
    <div
      data-testid="tier2-sheet"
      className="absolute inset-0 z-[60] flex flex-col bg-tb-surface"
      style={{ animation: "tbTier2PageEnter 0.2s ease-out both" }}
    >
      <style>{`@keyframes tbTier2PageEnter{from{opacity:0}to{opacity:1}}@keyframes tbTier2DialogEnter{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* The hook's error AutoScroll targets this id. */}
      <div
        ref={pageScrollRef}
        id="scrollCustomizableItem2"
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {/* Hero/Customize (1:4924): CUSTOMIZE at y 48, the 328×202 image
            centred at y 207, name + price | cal centred at y 380. */}
        <div className="flex min-h-[450px] flex-col items-center bg-tb-grey-6 px-[24px] pb-[24px] pt-[32px]">
          <p className="tb-display text-[32px] leading-[32px] tracking-[-1px] text-tb-purple">
            {t("pack.customize")}
          </p>
          <span className="mt-[42px] flex h-[202px] w-[328px] items-center justify-center">
            {heroImage && (
              <img alt="" src={heroImage} className="h-full w-full object-contain" />
            )}
          </span>
          <div className="mt-[42px] flex w-[768px] flex-col items-center gap-[8px] text-center">
            <h2 className="text-[28px] font-medium leading-[32px] tracking-[-0.5px] text-black">
              {name(SelectedEntity)}
            </h2>
            <p
              data-testid="tier2-price-line"
              className="text-[20px] leading-[20px] text-tb-ink-purple"
            >
              {currency}
              {total.toFixed(2)}
              {entityCal}
            </p>
          </div>
        </div>

        {/* The pick's own quantity — no frame draws it on this page: the
            PDP's Counter, right-aligned above the first section. */}
        <div className="flex justify-end px-[24px] pt-[24px]">
          <Counter
            testId="tier2-qty"
            value={quantity}
            onDecrease={decreaseEntityQuantity}
            onIncrease={hidePlusButton ? undefined : increaseEntityQuantity}
            decreaseLabel={t("pdp.decrease")}
            increaseLabel={t("pdp.increase")}
          />
        </div>

        <div className="flex flex-col gap-[64px] p-[24px]">
          {(sortedModifiers ?? []).map((group: any, i: number) =>
            renderGroup(group, i),
          )}
        </div>
      </div>
      <ErrorBoundary fallback={null}>
        <ScrollIndicator
          target={pageScrollRef}
          top={ada ? 488 : 703}
          height={ada ? 394 : 790}
          testId="tier2-scrollbar"
        />
      </ErrorBoundary>

      {/* CTA/Bottom screen (1:589, 1:2984 "UPDATE"): BACK = today's close
          (the discard prompt rule), UPDATE = the commit. */}
      <CtaBar
        backTestId="tier2-sheet-close"
        backLabel={t("pdp.back")}
        onBack={closeSheet}
        actionTestId="tier2-sheet-save"
        action={t("bag.update")}
        onAction={() => addTier2CustomizationToMIAMCart()}
      />

      {discardPromptOpen &&
        renderConfirm("tier2-discard", keepEditing, discardAndClose)}
      {removalOpen &&
        renderConfirm("tier2-remove", cancelRemoval, confirmRemoval)}
    </div>
  );
}
