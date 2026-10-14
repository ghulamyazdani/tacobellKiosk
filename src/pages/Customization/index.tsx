/* eslint-disable @typescript-eslint/no-explicit-any --
 * Entities/groups flow untyped from the legacy converters + makeItAMeal
 * slice; typed in later domain passes. Do not add NEW anys.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  closeTier2Modal,
  makeItAMealIsSessionOpen,
  makeItAMealTier1BottomSheet,
  MIAMTier2Open,
  openTier2EditModal,
  setTeir2SelectedEntity,
  tier1CustomizationSelectedEntity,
  tier1SelectedCustomization,
  setTier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { buildTier2NewEntity } from "@cx-sdk/ordering/customization/nestedCardLogic";
import {
  applySinglePunchSelection,
  getEffectiveMax,
  getEffectiveMin,
} from "@cx-sdk/ordering/customization/selectionRules";
import {
  isPackSlotGroup as isSlotGroup,
  planAddonTap,
  resolveAddonCustomize,
  type AddonCustomizeTarget,
} from "@cx-sdk/ordering/customization/addonCustomize";
import useCustomization from "../../hooks/customization/useCustomization";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import PackSlotCard from "../../components/customization/PackSlotCard";
import SlotSelectionSheet from "../../components/customization/SlotSelectionSheet";
import OptionCard, {
  Counter,
  CtaBar,
  formatOptionMeta,
  GroupHeader,
  optionCta,
  OptionRow,
  RadioMark,
} from "../../components/customization/OptionCard";
import YouMightLikeRail from "../../components/customization/YouMightLikeRail";
import VegMark from "../../components/menu/VegMark";
import { formatMenuPriceLine } from "../../components/menu/MenuItemCard";
import FooterBar from "../../components/chrome/FooterBar";
import ScrollIndicator from "../../components/chrome/ScrollIndicator";
import LanguageSheet from "../../components/language/LanguageSheet";
import CancelOrderModal from "../../components/common/CancelOrderModal";
import ErrorModal from "../../components/common/ErrorModal";
import { resolveCustomizationReturnPath } from "../../utils/customizationReturn";
import { selectRecommendationDetour } from "../../redux/features/menuSelections/menuSelections.slice";
import { resolveEntityImage } from "../../utils/entityImage";
import useAdaActive from "../../hooks/utils/useAdaActive";
import usePageEnter from "../../hooks/utils/usePageEnter";
import useLocalized from "../../hooks/utils/useLocalized";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import useLineClamp from "../../hooks/utils/useLineClamp";
import { ErrorBoundary } from "../../ErrorBoundary";
import { loadedPdpParts, loadPdpLazyParts } from "./loadPdpLazyParts";

// ---- Pack presentation (P6c brief): `_combo` groups with min===1 &&
// max===1 render as slot cards + one SELECT sheet (isSlotGroup — the SDK's
// isPackSlotGroup, which the add-on planner shares); every other group
// (addons, BYO-shaped combos) keeps the generic renderGroup path. ----

/**
 * D13 (lane addon-customize): the PDP swallows taps for this long after the
 * tier-2 page or an add-on prompt CLOSES. The page's BACK overlaps the PDP's
 * BACK by 92 px, and a prompt's YES / NO sit over the option grid, so the
 * second tap of a double tap would leave the PDP or pick the card under it.
 */
const TAP_GUARD_MS = 500;

type AddonTapInput = Parameters<typeof planAddonTap>[0];
/** An add-on prompt: decision 5's remove confirm, or the fork's replace-item. */
interface AddonPrompt {
  kind: "remove" | "replace";
  group: AddonTapInput["group"];
  item: AddonTapInput["item"];
  target: AddonCustomizeTarget | null;
  nextGroup: unknown;
  current?: AddonTapInput["item"];
}

/** Σ quantities picked in a group (the "count of max" label, 1:4911). */
const pickedCount = (selection: ReadonlyArray<{ quantity?: unknown } | null>) =>
  selection.reduce((sum, s) => sum + Number(s?.quantity ?? 0), 0);

type Size = { id?: string; isActive?: boolean; isGetVariantDisabled?: boolean };
/** The sizes a guest may pick: active, and not above an offer's sameOrLess ceiling (isGetVariantDisabled). */
const pickableSizes = (entity: { variants?: unknown } | null | undefined): Size[] => {
  const sizes = entity?.variants;
  return Array.isArray(sizes)
    ? sizes.filter((v: Size | null) => v?.isActive !== false && !v?.isGetVariantDisabled)
    : [];
};

/**
 * PDP / customization — Figma "PDP - Single Product" (1:2614 / 1:5823) +
 * "PDP - Builder" (1:2856 family) + "Order a Pack" (1:4895), bound to the
 * ported useCustomization the way posistKiosk's CustomizationTier1 binds it
 * (the hook's only real driver):
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
 * Item 42 shell: the grey Hero band (1:598), contents at x 24 (w 1032), the
 * Counter (1:615), the What's Included / option grids on Menu-Item_Medium
 * cards, Cards/Item/Old stepper rows, and the 148 px CTA bar (1:589).
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
 * language sheet, CANCEL ORDER or suggestion rail — the bag owns those
 * (hazard H1). A freebie hides the qty stepper (one per pick) and its CTA
 * carries no price claim.
 */
export default function Customization({
  embedded = false,
}: { embedded?: boolean } = {}) {
  // Above the no-session return (hook order). Embedded, the result is
  // ignored: OfferTierHost's own static data-enter drives the pane.
  const enter = usePageEnter();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const cartRef = useRef(null);
  const pdpScrollRef = useRef<HTMLDivElement>(null);
  const ada = useAdaActive();
  const { name, description } = useLocalized();

  const sessionOpen = useSelector(makeItAMealIsSessionOpen);
  const isOpenBottomSheet = useSelector(makeItAMealTier1BottomSheet);
  const SelectedEntity = useSelector(tier1CustomizationSelectedEntity);
  const selectedCustomizations = useSelector(tier1SelectedCustomization);
  const tier2Open = Boolean(useSelector(MIAMTier2Open));
  // Opened from a product-added suggestion: one hop, so no rail of its own.
  const suggestionDetour = Boolean(useSelector(selectRecommendationDetour));
  const currency = useCurrencySymbol();

  // ---- The lazy parts (the completion warning, the tier-2 page, the
  // split-edit planner): warmed at MOUNT, never at a tap (G2c) — without
  // them the PDP still completes (the ring alone; a closing scrim for
  // tier-2; a split edit refuses). See loadPdpLazyParts. ----
  const [lazyParts, setLazyParts] = useState(() => loadedPdpParts());
  useEffect(() => {
    if (lazyParts) return;
    let live = true;
    const load = async () => {
      const parts = await loadPdpLazyParts();
      if (live && parts) setLazyParts(parts);
    };
    void load();
    return () => { live = false; };
  }, [lazyParts]);

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
    isAllowMultiplePunch,
    notifyGroupMax,
    hasNoMax,
  } = useCustomization({
    cartRef,
    isOpenBottomSheet,
    SelectedEntity,
    selectedCustomizations,
    setSelectedCustomizations: setTier1SelectedCustomization,
    planSplitEditCommit: lazyParts?.planSplitEditCommit,
  });

  const {
    findAppropriateVariantForSelectedItem,
    renderAppropriateConstituentItems,
    setTier2BottomSheetInRdx,
  } = useMakeItAMeal();

  // Which pack slot group's SELECT sheet is open (null = closed) — the one
  // SlotSelectionSheet instance is driven by this id.
  const [openSlotGroupId, setOpenSlotGroupId] = useState<string | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  // Item 23: each failed ADD TO BAG (re)mounts the completion warning (0 = closed).
  const [incompleteTap, setIncompleteTap] = useState(0);
  const initialisedFor = useRef<string | null>(null);

  // ---- Lane addon-customize: the add-on prompts (D9) and the tap guard
  // (D13), armed on a CLOSE edge of either layer — the page or a prompt —
  // never on an open edge (adjust state while rendering, DetourTapGuard's
  // pattern). ----
  const [addonPrompt, setAddonPrompt] = useState<AddonPrompt | null>(null);
  const promptOpen = addonPrompt !== null;
  const [prevLayers, setPrevLayers] = useState({ tier2Open, promptOpen });
  const [tapGuard, setTapGuard] = useState(false);
  if (prevLayers.tier2Open !== tier2Open || prevLayers.promptOpen !== promptOpen) {
    setPrevLayers({ tier2Open, promptOpen });
    if ((prevLayers.tier2Open && !tier2Open) || (prevLayers.promptOpen && !promptOpen)) {
      setTapGuard(true);
    }
  }
  // Rule 5: the guard's timer never outlives it (or the PDP).
  useEffect(() => {
    if (!tapGuard) return;
    const id = window.setTimeout(() => setTapGuard(false), TAP_GUARD_MS);
    return () => window.clearTimeout(id);
  }, [tapGuard]);

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
      // S1: the Select-a-Size fast lane already chose this size — open the
      // builder on it (the edit branch's trio). Unknown, inactive or
      // offer-capped id → the size picker, as before. A lone pickable size
      // (a buy-stage size tile's entity, a one-size item) is the choice
      // already: it opens chosen too (walk 2026-10-14).
      const sizes = pickableSizes(SelectedEntity);
      const preselectedId = isOpenBottomSheet?.preselectedVariantId;
      const preselected =
        (preselectedId ? sizes.find((v) => v?.id === preselectedId) : undefined) ??
        (sizes.length === 1 ? sizes[0] : undefined);
      if (preselected) {
        setSelectedVariant(preselected);
        fetchAddonsForSelectedVariant(preselected);
        setConfirmedVariant(true);
      }
      return;
    }

    /*
      D5: a one-option slot (the fork literal `constituentItems.length === 1`)
      is an INCLUDED item — Figma draws it picked and radio-less (1:2930). The
      entry comes from the SAME SDK rule a sheet pick runs (handleSlotSave →
      addCustomizations → handleSinglePunch → applySinglePunchSelection), so
      the committed row and the bill are byte-identical to a pick. It stays
      empty (a CHOICE slot) when the option needs tier-2 — required nested
      groups, handleSlotSave's rule.
      DELIBERATE FORK DIVERGENCE: the fork's classic path seeds these
      (utilities/ItemCustomizationCard.tsx:83-95); its MIAM tier-1 path, the
      one TB mirrors, has it commented out (ItemCustomizationContainerMIAM.tsx
      :427-445).
      ponytail: not in the variant flow (its groups arrive later, from
      fetchAddonsForSelectedVariant — seed there if a sized pack ever needs it)
      and not in edit (the row's own picks are restored).
    */
    const seedOneOptionSlot = (group: {
      _id: string;
      constituentItems?: unknown[];
    }): unknown[] => {
      if (!isSlotGroup(group) || group?.constituentItems?.length !== 1) return [];
      const option = (renderAppropriateConstituentItems(group.constituentItems) ?? []).find(
        (i: { isActive?: boolean } | null) => i?.isActive !== false
      );
      if (!option || option.outOfStock === true) return [];
      try {
        if (findAppropriateVariantForSelectedItem(option)?.isAllModifersOptional === false) {
          return [];
        }
      } catch {
        return []; // a malformed menu map: the sheet path decides (Rule 2)
      }
      return (
        applySinglePunchSelection({
          customizations: { [group._id]: [] },
          modifier: group,
          item: { ...option, quantity: 1 },
          allowMultiplePunch: isAllowMultiplePunch(),
          selectionConfirmed: false,
        }).customizations[group._id] ?? []
      );
    };

    // customizableItem / new: seed every active group; defaults pre-selected
    // (fork seeds [] then auto-selects isDefault in the group view — same
    // outcome, done in one dispatch here), then the one-option slots (D5).
    const groups = fetchModifierProperties(SelectedEntity.modifiers) ?? [];
    const seed: Record<string, any[]> = {};
    for (const group of groups) {
      if (group?.isActive === false) continue;
      const max = Number(group?.max ?? 0);
      const defaults = (group?.constituentItems ?? [])
        .filter((i: any) => i?.isDefault && i?.isActive !== false)
        .slice(0, max > 0 ? max : undefined)
        .map((i: any) => ({ ...i, quantity: 1 }));
      // Up to the raw max (a raw 1 / 1 slot is a one-pick card, whatever its
      // multi-punch max) and the EFFECTIVE max the commit counts. A group with
      // no positive effective max takes no pick, so it opens empty (user
      // decision 2026-10-14, posistKiosk parity).
      const effectiveMax = Number(getEffectiveMax(group, isAllowMultiplePunch()));
      if (!(effectiveMax > 0)) seed[group._id] = [];
      else seed[group._id] = defaults.length > 0 ? defaults.slice(0, effectiveMax) : seedOneOptionSlot(group);
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
  const pdpDescription = description(SelectedEntity);
  // Show more only when the 2-line clamp actually cuts the description
  // (OfferRow's measured clamp): a one-line one had a dead toggle.
  const {
    ref: descriptionRef,
    expanded: showFullDescription,
    setExpanded: setShowFullDescription,
    clamped: descriptionClamped,
  } = useLineClamp<HTMLParagraphElement>(pdpDescription);

  const calLabel = useMemo(() => {
    const cal = SelectedEntity?.calorieCount;
    const value = typeof cal === "object" ? cal?.value : cal;
    return value ? ` | ${t("pack.cal", { value })}` : "";
  }, [SelectedEntity, t]);

  if (!sessionOpen || !SelectedEntity?.id) return null;

  const isFreebie = Boolean(SelectedEntity?.isGetItem);
  // isGetVariantDisabled = the offer's sameOrLess ceiling (only freebie
  // entities ever carry it, so menu items filter exactly as before).
  const variants = pickableSizes(SelectedEntity);
  // The grid shows until a size is confirmed — and again after "Change",
  // over the CURRENT size (marked; its add-ons, price and CTA kept). No size
  // at all is the hook's own commit rule (an empty selectedVariant).
  const sizeGridOpen = isVariantFlow && !confirmedVariant;
  const sizePending = isVariantFlow && Object.keys(selectedVariant ?? {}).length === 0;

  const pickVariant = (variant: any) => {
    // The current size again: close the grid, keep its add-ons
    // (fetchAddonsForSelectedVariant would reset them).
    if (variant?.id != null && variant.id === selectedVariant?.id) {
      setConfirmedVariant(true);
      return;
    }
    setSelectedVariant(variant);
    fetchAddonsForSelectedVariant(variant);
    setCurrentIndex(0);
    setConfirmedVariant(true);
  };

  // ---- Completion warning (item 23, Figma 1:2855): a failed ADD TO BAG
  // names every incomplete group. The ring + AutoScroll already ran inside
  // the commit; a success navigated / closed, so it never opens then.
  // UB2: before a size is picked the button is live too — the warning names
  // the size and nothing is committed (the size grid is the only section).
  // The grid open over a chosen size commits that size. The grid closes
  // SYNCHRONOUSLY first (flushSync): the commit's AutoScroll measures the
  // ringed group's offsetTop, and a queued close left the groups out of the
  // DOM (scrollTo top NaN → the pane jumped to the top, off the ring). ----
  const handleAddToBag = () => {
    if (sizePending) {
      setIncompleteTap((tap) => tap + 1);
      return;
    }
    if (sizeGridOpen) flushSync(() => setConfirmedVariant(true));
    if (addCustomizationToCart(undefined) === false) setIncompleteTap((tap) => tap + 1);
  };

  const selectionFor = (group: any): any[] =>
    (selectedCustomizations ?? {})[group?._id] ?? [];
  const isSelected = (group: any, item: any) =>
    selectionFor(group).some((s: any) => s?.id === item?.id);
  const quantityOf = (group: any, item: any) =>
    selectionFor(group).find((s: any) => s?.id === item?.id)?.quantity ?? 0;

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

  /**
   * The customize page NEW for a fresh pick — refused (the hook's message,
   * nothing written) in a group with no max: the one add the hook's guard
   * never sees. `tier1` (a card's plan) lands first, as before.
   */
  const openTier2New = (group: any, item: any, variant: any, tier1?: Record<string, unknown[]>) => {
    if (hasNoMax(group)) {
      notifyGroupMax(group);
      return;
    }
    if (tier1) dispatch(setTier1SelectedCustomization(tier1));
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

  /*
    Lane addon-customize — a tap on a grid option card: CUSTOMIZE
    ("customize") or CHOOSE / REMOVE / the card body ("select"). The SDK's
    planAddonTap decides (the fork card's planCustomizationSelect mapped onto
    the two buttons); this applies it. Plain cards come through here too:
    their plan is today's tap, except a swap away from a customized pick,
    which asks first. A throw does nothing (Rule 2).
  */
  const onCardTap = (
    action: "customize" | "select",
    group: AddonTapInput["group"],
    item: AddonTapInput["item"],
    target: AddonCustomizeTarget | null,
    nextGroup: unknown,
    replaceConfirmed = false
  ) => {
    try {
      // No ring reset here: a tap that lands clears it in the hook
      // (handleSinglePunch); a refusal, a prompt or the page keeps it.
      const plan = planAddonTap({
        action,
        customizations: selectedCustomizations,
        group,
        item,
        target,
        allowMultiplePunch: isAllowMultiplePunch(),
        fetchModifierProperties,
        generateUniqueId: (id) => `${Date.now()}_${String(id)}`,
        replaceConfirmed,
      });
      if (plan.kind === "list") addCustomizations(group, plan.item, null, nextGroup, false);
      else if (plan.kind === "refuse") notifyGroupMax(group);
      else if (plan.kind === "confirm-remove") setAddonPrompt({ kind: "remove", group, item, target, nextGroup });
      else if (plan.kind === "confirm-replace")
        setAddonPrompt({ kind: "replace", group, item, target, nextGroup, current: plan.current });
      else if (plan.kind === "open-new") openTier2New(group, item, target?.variant, plan.tier1);
      else if (plan.kind === "open-edit") {
        dispatch(setTier1SelectedCustomization(plan.tier1));
        dispatch(
          openTier2EditModal({
            customizations: { selectedEntity: plan.entity, selectedCustomizations: plan.selections },
            bottomSheet: { isOpen: true, type: "customizableItem", openType: "edit" },
            groupId: group._id,
            currentCustomizations: { selectedCustomizations: plan.tier1, group },
            // Cast: handleSlotCustomize's — the reducer types this payload as any/void.
          } as any)
        );
      }
    } catch {
      // Rule 2: a malformed menu map never takes the PDP down; the tap does nothing.
    }
  };

  /** A prompt's YES: REMOVE drops every row of the id; a replace re-plans the same tap, confirmed. */
  const confirmAddonPrompt = () => {
    const prompt = addonPrompt;
    setAddonPrompt(null);
    if (!prompt) return;
    if (prompt.kind === "replace") {
      onCardTap("select", prompt.group, prompt.item, prompt.target, prompt.nextGroup, true);
      return;
    }
    try {
      addCustomizations(prompt.group, prompt.item, null, prompt.nextGroup, false);
    } catch {
      // Rule 2: the pick stays.
    }
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
  const slotGroups = (sortedModifiers ?? []).filter(
    (g: { isActive?: boolean } | null) => isSlotGroup(g) && g?.isActive !== false
  );

  // Option cards (radio) for one-per-tap groups, Cards/Item/Old stepper rows
  // for multi-punch ones. EVERY card carries the CTA, add-on and BYO alike
  // (D9 amended 2026-10-09: Figma draws one on every card — 1:2614 / 1:2728
  // Upgrades, 1:5332 — and add-on cards without it drew the user report "why
  // choose is not coming"). It is the label of the card's own tap (one
  // button, one select), so it says what the SDK does with that tap: CHOOSE,
  // REMOVE, or none on a swap group's pick (optionCta) — whose box stays
  // (reserveCta), so picking never moves the card's name or the row.
  // Lane addon-customize (user decisions 2026-10-09): a card whose item has
  // options of its own (resolveAddonCustomize — any card group, `_combo` and
  // `_addons` alike) is Figma 1:5332's two-button card: CUSTOMIZE on a pick
  // only (1:5333) above that CTA as a real button (1:5334 unpicked), its body
  // CHOOSE unpicked and CUSTOMIZE on a pick; every card of its group is 476
  // px (decision 4). Every card's tap runs the fork's flow (onCardTap).
  const renderGroup = (group: any, index: number) => {
    if (group?.isActive === false) return null;
    const items: any[] = (group?.constituentItems ?? []).filter(
      (i: any) => i?.isActive !== false
    );
    if (items.length === 0) return null;
    const nextGroup = sortedModifiers?.[index + 1] ?? {};
    // UB2: the EFFECTIVE bounds (multi-punch ones when the menu turns it on)
    // decide the presentation, as the fork's group header does: an
    // effective 1/1 group is always radio cards (a second tap swaps), never
    // steppers, and "Required" says what the commit enforces. Identical with
    // multi-punch off except a 1/1 group whose item cap is > 1.
    const amp = isAllowMultiplePunch();
    const minPicks = Number(getEffectiveMin(group, amp));
    const maxPicks = Number(getEffectiveMax(group, amp));
    const oneOfOne = minPicks === 1 && maxPicks === 1;
    const stepper = Number(group?.multiplePunchMaxItem ?? 1) > 1 && !oneOfOne;
    const errored = (erroredSection as any)?.id === group?._id;
    // From the menu, never the selection: a tap never moves anything.
    const targets = stepper
      ? []
      : items.map((item: any) =>
          resolveAddonCustomize({
            group,
            item,
            allowMultiplePunch: amp,
            resolveVariant: findAppropriateVariantForSelectedItem,
          })
        );
    const tall = targets.some(Boolean);

    return (
      <section
        key={group._id}
        id={group._id}
        data-testid={`pdp-group-${group._id}`}
        className={`flex flex-col gap-[16px] rounded-[8px] ${errored ? "tb-shake ring-4 ring-red-500 p-[16px]" : ""}`}
      >
        {/* The max the "You can choose up to" guard refuses at, so the two
            agree; at 1 wherever a second unit or pick is refused (user report
            2026-10-14). No positive max: "0 of 0" — the group takes no pick
            (user decision 2026-10-14, posistKiosk parity). */}
        <GroupHeader
          name={name(group)}
          count={pickedCount(selectionFor(group))}
          max={maxPicks}
          noMax={!(maxPicks > 0)}
          atOne={stepper || (!oneOfOne && items.length > 1)}
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
                  testId={`pdp-option-${item.id}`}
                  image={resolveEntityImage(item)}
                  name={name(item)}
                  meta={formatOptionMeta(item, currency, t)}
                  qty={qty}
                  onDecrease={() => decreaseCustomization(group, item)}
                  onIncrease={() =>
                    qty === 0
                      ? addCustomizations(group, { ...item, quantity: 1 }, null, nextGroup, false)
                      : increaseCustomization(group, item, null, nextGroup)
                  }
                  decreaseLabel={`${t("pdp.decrease")} ${name(item)}`}
                  increaseLabel={`${t("pdp.increase")} ${name(item)}`}
                />
              );
            })}
          </div>
        ) : (
          // minmax: an errored section's 16 px padding must not push the
          // third 328 px card out of the ring.
          <div className="grid grid-cols-[repeat(3,minmax(0,328px))] gap-[16px]">
            {items.map((item: any, i: number) => {
              const selected = isSelected(group, item);
              const target = targets[i];
              const select = () => onCardTap("select", group, item, target, nextGroup);
              const cta = optionCta(group, amp, selected, t, `pdp-option-cta-${item.id}`);
              return (
                <OptionCard
                  key={item.id}
                  testId={`pdp-option-${item.id}`}
                  image={resolveEntityImage(item)}
                  name={name(item)}
                  meta={formatOptionMeta(item, currency, t)}
                  radio={selected ? "on" : "off"}
                  onSelect={select}
                  selectLabel={name(item)}
                  tall={tall}
                  {...(target
                    ? {
                        selectTestId: `pdp-option-select-${item.id}`,
                        cta: cta && { ...cta, onClick: select, ariaLabel: `${cta.label} ${name(item)}` },
                        customize: {
                          label: t("pack.customize"),
                          ariaLabel: `${t("pack.customize")} ${name(item)}`,
                          testId: `pdp-option-customize-${item.id}`,
                          description: t("pdp.selected"),
                          onClick: selected
                            ? () => onCardTap("customize", group, item, target, nextGroup)
                            : undefined,
                        },
                      }
                    : { cta, reserveCta: true })}
                />
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const tier2Scrim = (
    <button
      type="button"
      data-testid="tier2-loading"
      aria-label={t("language.close")}
      onClick={() => dispatch(closeTier2Modal())}
      className="absolute inset-0 z-[60] h-full w-full bg-tb-purple/80"
    />
  );

  return (
    // h-full = ReachZone's container: 1920, or the ADA reach zone (Figma
    // 1:5413 — the whole PDP scrolls above the pinned CTA bar + footer).
    <div
      data-testid="customization-screen"
      data-embedded={embedded ? "true" : undefined}
      data-enter={embedded ? undefined : enter}
      className="relative flex h-full w-[1080px] flex-col bg-tb-surface"
    >
      {/* Contents at x 24 / w 1032 (every PDP frame). pb-[72px] = the old
          220 minus the 148 px CTA bar below, so the scroll end is unchanged.
          The pane is the page's one arriving block (motion §2.7); the
          scrollbar, the CTA bar, the footer and the sheets stay. */}
      <div ref={pdpScrollRef} id="scrollCustomizableItem" className="tb-enter [--i:0] min-h-0 flex-1 overflow-y-auto px-[24px] pb-[72px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Hero (1:598): the band always renders; imageless items show it bare. */}
        <div className="-mx-[24px] flex h-[450px] w-[1080px] items-center justify-center bg-tb-grey-6">
          {heroImage && (
            <img alt="" src={heroImage} className="h-[354px] w-[680px] object-contain" />
          )}
        </div>
        <div className="mt-[24px] flex items-start justify-between gap-[24px]">
          <h1 className="tb-display max-w-[592px] text-[48px] leading-[44px] tracking-[-1px] text-tb-ink-purple">
            {name(SelectedEntity)}
          </h1>
          {/* One freebie per pick: no stepper (the offer sets the quantity). */}
          {!isFreebie && (
            <Counter
              testId="pdp-qty"
              value={quantity}
              onDecrease={() => (quantity <= 1 ? closeModalStates() : decreaseQuantity1())}
              onIncrease={() => increaseQuantity1()}
              decreaseLabel={t("pdp.decrease")}
              increaseLabel={t("pdp.increase")}
            />
          )}
        </div>
        {/* U1: the diet mark leads the price line (design language). The
            text stays in ONE span: bare runs in a flex <p> each take the gap.
            ponytail: the mark reads the item's own tags — every reference
            size carries its parent's diet tag (66 / 66); pass the picked
            size if a menu ever differs. Before a size is chosen the line
            reads as the item's menu card does — never a fake £0.00. */}
        <p className="mt-[16px] flex items-center gap-[12px] text-[28px] leading-[32px] text-tb-ink-purple">
          <VegMark entity={SelectedEntity} size={24} />
          <span data-testid="pdp-price">
            {sizePending
              ? formatMenuPriceLine(SelectedEntity, currency, t)
              : `${currency}${basePrice.toFixed(2)}${calLabel}`}
          </span>
        </p>
        {pdpDescription && (
          <>
            {/* w-fit (P9f S2): a single Arabic line keeps the layout's left
                edge; only a wrapped one fills 682 px and right-aligns. */}
            <p ref={descriptionRef} dir="auto" className={`mt-[55px] w-fit max-w-[682px] text-start text-[24px] leading-[24px] tracking-[-0.12px] text-black ${showFullDescription ? "" : "line-clamp-2"}`}>
              {pdpDescription}
            </p>
            {/* CTA/Show more (1:1687), only when the clamp cuts the text.
                Outside the clamp: inside it, a long description hid the
                toggle in the clipped overflow. 44 px tall. */}
            {descriptionClamped && (
              <button
                type="button"
                data-testid="pdp-show-more"
                aria-expanded={showFullDescription}
                onClick={() => setShowFullDescription((v) => !v)}
                className="tb-display inline-flex min-h-[44px] items-center text-[16px] font-bold normal-case leading-[24px] tracking-[-0.08px] text-tb-purple underline"
              >
                {showFullDescription ? t("pdp.showLess") : t("pdp.showMore")}
              </button>
            )}
          </>
        )}

        {sizeGridOpen ? (
          <section className="mt-[40px]" data-testid="pdp-variant-picker">
            <h3 className="tb-display mb-[24px] text-[30px] tracking-[-1px] text-tb-purple-vibrant">
              {t("size.title")}
            </h3>
            {/* After "Change" the current size is marked (Select a Size's
                36 px radio — design language: no frame draws this grid). */}
            <div className="grid grid-cols-2 gap-[16px]">
              {variants.map((v: any) => {
                const imageUrl = resolveEntityImage(v);
                const current = v?.id != null && v.id === selectedVariant?.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    data-testid={`pdp-variant-${v.id}`}
                    aria-pressed={current}
                    onClick={() => pickVariant(v)}
                    className="relative flex flex-col items-start rounded-[8px] bg-tb-grey-6 p-[20px] min-h-[44px]"
                  >
                    <RadioMark on={current} corner="right-[12px] top-[12px]" />
                    {imageUrl && (
                      <img alt="" src={imageUrl} className="mb-2 h-[140px] w-full object-contain" />
                    )}
                    {/* pr: an imageless tile's name stays clear of the radio. */}
                    <p className="pr-[36px] text-[20px] font-medium capitalize text-black">{name(v)}</p>
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
            {/* Block-level (flex w-fit) so the chip takes its own line: as an
                inline button it sat right after Show more (user 2026-10-13). */}
            {isVariantFlow && selectedVariant?.name && (
              <button
                type="button"
                data-testid="pdp-change-size"
                onClick={() => setConfirmedVariant(false)}
                className="mt-[24px] flex min-h-[44px] w-fit items-center rounded-full border-2 border-tb-purple px-6 py-3 text-[18px] font-bold text-tb-purple"
              >
                {name(selectedVariant)} · {t("pdp.change")}
              </button>
            )}
            <div className="mt-[55px] flex flex-col gap-[64px]">
              {slotGroups.length > 0 && (
                <div className="flex flex-col gap-[16px]">
                  {/* "Included" (1:4903; 1:2929 says "What's Included"). */}
                  <GroupHeader name={t("pack.included")} />
                  <div
                    data-testid="pack-slot-grid"
                    className="grid grid-cols-[repeat(3,328px)] gap-[16px]"
                  >
                    {slotGroups.map((group: any) => {
                      const options = slotOptionsFor(group);
                      if (options.length === 0) return null;
                      const pick = selectionFor(group)[0];
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
                            fixed={options.length === 1}
                            onCustomize={
                              pick && canCustomize(pick)
                                ? () => handleSlotCustomize(group, pick)
                                : undefined
                            }
                            onOpen={() => setOpenSlotGroupId(group._id)}
                          />
                        </section>
                      );
                    })}
                  </div>
                </div>
              )}
              {(sortedModifiers ?? []).map((group: any, i: number) =>
                isSlotGroup(group) ? null : renderGroup(group, i)
              )}
            </div>
            {/* "You Might Like" (1:2657 / 1:5867) — after the groups; hidden
                when there is nothing to suggest, in the bag, under the size
                picker and on a product-added suggestion's detour (the modal
                behind is hidden, not closed: a rail tap would park there
                unseen, or bump an in-bag row past its ADD TO ORDER). */}
            {!embedded && !suggestionDetour && (
              <ErrorBoundary fallback={null}>
                <YouMightLikeRail entityId={SelectedEntity?.id} />
              </ErrorBoundary>
            )}
          </>
        )}
      </div>
      {/* Figma 1:5263 bar (PDP 1:2920 / ADA 1:5442), positioned off this root. */}
      <ErrorBoundary fallback={null}>
        <ScrollIndicator
          target={pdpScrollRef}
          top={ada ? 488 : 703}
          height={ada ? 394 : 790}
          testId="pdp-scrollbar"
        />
      </ErrorBoundary>

      {/* CTA/Bottom screen (1:589) — in flow (Menu's pattern) so the
          scroller ends at its top edge. D7-A: the live price stays in the
          label (the guest's only pre-commit total). A freebie's price is the
          offer's call (redeemGetItem at CONFIRM), so its CTA makes no price
          claim — not even "free": a 50% grant or a paid add-on still charges
          (fork "Add to offer" parity). Before a size is chosen there is no
          price to claim: the label alone, as Figma's 1:2614 / 1:2728 /
          1:5540 draw it. */}
      <CtaBar
        backTestId="pdp-back"
        backLabel={t("pdp.back")}
        onBack={() => closeModalStates()}
        actionTestId="pdp-add-to-bag"
        onAction={handleAddToBag}
        action={
          isFreebie ? (
            t("offers.picker.addFreebie")
          ) : sizePending ? (
            t("pdp.addToBag")
          ) : (
            <>
              {isEditMode ? t("bag.update") : t("pdp.addToBag")} · {currency}
              {total.toFixed(2)}
            </>
          )
        }
      />
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

      {/* Tier-2 CUSTOMIZE page (lazy, z-60): mounted only while open, so each
          open snapshots the tier-1 session afresh. Until its code is here —
          or if it failed — a named scrim that closes tier-2 (the tier-1
          picks stay). */}
      {tier2Open &&
        (lazyParts ? (
          <ErrorBoundary fallback={tier2Scrim}>
            <lazyParts.Tier2CustomizationSheet />
          </ErrorBoundary>
        ) : (
          tier2Scrim
        ))}

      {/* D13: over the page (z-60) and the PDP; the add-on prompts sit above at z-80. */}
      {tapGuard && (
        <div aria-hidden="true" data-testid="pdp-tier2-tap-guard" className="absolute inset-0 z-[61]" />
      )}

      {/* Lane addon-customize: REMOVE on a customized add-on (decision 5)
          and a swap away from a customized pick (the fork's replace-item) ask
          first — RemoveItemModal's ErrorModal shell (inert scrim, focus on
          NO, KEEP IT: the safe choice). The fork's words: Are you sure? /
          Remove this item; Replace {name} in your meal? / Yes, replace item. */}
      {addonPrompt && (
        <ErrorModal
          testId={addonPrompt.kind === "remove" ? "pdp-addon-remove" : "pdp-addon-replace"}
          icon={false}
          initialFocus="secondary"
          title={
            addonPrompt.kind === "remove"
              ? t("pdp.discardTitle")
              : t("pdp.replaceTitle", { name: name(addonPrompt.current) })
          }
          message={t("pdp.discardBody")}
          secondary={{
            label: t("pdp.keepItem"),
            testId: `pdp-addon-${addonPrompt.kind}-cancel`,
            onClick: () => setAddonPrompt(null),
          }}
          primary={{
            label: addonPrompt.kind === "remove" ? t("pdp.removeThisItem") : t("pdp.replaceConfirm"),
            testId: `pdp-addon-${addonPrompt.kind}-confirm`,
            onClick: confirmAddonPrompt,
            danger: addonPrompt.kind === "remove",
          }}
        />
      )}

      {/* Completion warning — Figma Modal 1:945 (no icon, one full-width
          GOT IT); z-80 over the PDP, embedded hosts included. Closing it is
          the only action: the guest finishes the ringed groups. Without its
          code nothing shows over the ringed PDP (the picks stay). */}
      {incompleteTap > 0 && lazyParts && (
        <ErrorBoundary fallback={null}>
          <lazyParts.PdpIncompleteWarning
            key={incompleteTap}
            entity={SelectedEntity}
            selectedVariant={selectedVariant}
            customizations={selectedCustomizations}
            fetchModifierProperties={fetchModifierProperties}
            isBox={isSlotGroup}
            sizeMissing={sizePending}
            onClose={() => setIncompleteTap(0)}
          />
        </ErrorBoundary>
      )}

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
