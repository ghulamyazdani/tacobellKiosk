/* eslint-disable @typescript-eslint/no-explicit-any --
 * MIAM entities/combos flow untyped from the legacy converters + makeItAMeal
 * slice; typed in later domain passes. Do not add NEW anys.
 */
import { useMemo, useState } from "react";
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
import { checkCustomizationType } from "@cx-sdk/catalog/menu/menuUtils";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  closeBottomSheet,
  setSelectedEntity,
} from "../../redux/features/menuSelections/menuSelections.slice";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import useTagFilter from "../../hooks/menuHooks/useTagFilter";
import { resolveEntityImage } from "../../utils/entityImage";
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

/** Object-or-scalar calorie count, same widening as MenuItemCard. */
const calorieValue = (entity: any): number | string | undefined => {
  const cal = entity?.calorieCount ?? entity?.nutritionalInfo?.calorieCount;
  if (cal !== null && typeof cal === "object") return cal?.value;
  return cal;
};

/** Finite-number coercion; rejects null/objects/"" -> NaN and non-finite. */
const numeric = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/** Discount-ish fields a payload *might* carry. None exist today — see below. */
type ComboSavingsFields = {
  price?: unknown;
  savings?: unknown;
  originalPrice?: unknown;
  strikePrice?: unknown;
  strike_price?: unknown;
  mrp?: unknown;
  comparePrice?: unknown;
};

/**
 * DATA GAP — Figma 1:3070 shows a yellow "SAVE £2.99" badge on the meal card,
 * but nothing in the menu payload backs it. Verified against BOTH menus: the
 * 122-entity reference menu (StandardMenu.json) exposes only
 * price/differentialPrice/applyAddonsPrice/priceChange — no originalPrice, no
 * savings, no strike/mrp field anywhere — and `makeItMeal` carries only
 * subText/buttonText1/buttonText2. TB's e2e fixture is the same.
 *
 * So this probes the fields a future payload could plausibly ship and returns
 * a saving ONLY when one is genuinely there and positive; otherwise null and
 * the badge does not render at all. It deliberately does NOT derive a figure
 * from the host item's price — "combo price minus item price" is an upsell
 * delta, not a discount, and printing it as a saving would be a false promise
 * on an unattended kiosk. Raise the data contract before enabling the badge.
 */
const savingsFor = (combo: unknown): number | null => {
  const fields = (combo ?? {}) as ComboSavingsFields;

  // 1. An explicit saving, if the payload ever ships one.
  const explicit = numeric(fields.savings);
  if (explicit !== null && explicit > 0) return explicit;

  // 2. A was-price / strike-through, minus what we actually charge.
  const price = numeric(fields.price);
  if (price === null) return null;
  const candidates = [
    fields.originalPrice,
    fields.strikePrice,
    fields.strike_price,
    fields.mrp,
    fields.comparePrice,
  ];
  for (const candidate of candidates) {
    const before = numeric(candidate);
    if (before !== null && before > price) return before - price;
  }
  return null;
};

/**
 * MIAM upsell prompt — "Would you like to make it a meal?".
 *
 * Presentation follows Figma frame 1:3070 (mislabelled "Upsell" in
 * docs/FIGMA_UI_GUIDE.md, which assumed a pre-cart /forYou screen): a 680px
 * card over the purple backdrop — grey meal panel on top (optional SAVE
 * badge, 285px image, name + price|cal), white panel below with the heading
 * and the two CTAs. The frame shows exactly ONE meal; CX can return several,
 * so multiple combos stack in a scrollable column, each tappable, first
 * preselected, and the primary CTA accepts the selected one.
 *
 * Opens via the SDK addIntent executor: `addEntity` on an `"upsell"` intent
 * dispatches `openMakeItAMealModal({isOpen, selectedItem, availableCombos})`,
 * which also force-stamps `isForceOpenMakeItAMealModal` — so EVERY close path
 * here clears that latch too (fork's MakeItAMealModal.closeMakeItAMeal dance).
 *
 * Lifecycle mirrored from the fork's MakeItAMealModal / MainSelectionMIAM /
 * OptionsUpSell / UpsellMeals stack:
 * - combo tap or primary CTA (accept): customizable → openDoubleTierModal (its
 *   openComboConstutientCustomizations closes the prompt's isOpen and keeps
 *   the MIAM session live for /customization); variant → manual tier-1 seed
 *   (planDoubleTierModal returns null for variant shapes); plain → straight
 *   add + full close.
 * - decline: original item added by shape; plain adds also blacklist the id
 *   so the next tap classifies as "add", not "upsell".
 * - X: fork close dance + removeMakeItAMealItem. The frame has no X, but it is
 *   a DISTINCT behaviour from "not today" (it never blacklists, so the item
 *   re-prompts) and tests/e2e/pack.spec.ts asserts it — kept deliberately,
 *   unobtrusive over the card's top-right.
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

  // Multi-combo selection. Derived-with-fallback rather than an effect, so
  // "first preselected" holds even when the combo list changes underneath.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selected =
    combos.find((c: any) => String(c?.id) === pickedId) ?? combos[0];
  const isMulti = combos.length > 1;

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

  /** Multi-combo: a tap selects; the primary CTA accepts. Single: tap accepts. */
  const handleComboTap = (combo: any) => {
    if (isMulti) {
      setPickedId(String(combo?.id));
      return;
    }
    handleAccept(combo);
  };

  /** "Not today" = add the ORIGINAL item, by shape. */
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

  return (
    <div className="absolute inset-0 z-40" data-testid="miam-prompt">
      {/* Backdrop — non-interactive on purpose (fork parity: its onClick is
          commented out; the only exits are a combo, decline, or the X). */}
      <div className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70" />

      {/* Card cap = containing block (the z-45 AppRoutes wrapper → the reach
          container) minus 2×24 px: inert on the 1920 stage (the tallest card,
          1100 scroller + ~300 CTA panel, is < 1872), 1074 in the 1122 ADA
          reach zone (= ADA_MODAL_MAX_HEIGHT), where a multi-combo card would
          otherwise lose its X and both CTAs to the clip. The meal scroller
          absorbs the cut; the CTA panel never shrinks. */}
      <div className="tb-modal-enter absolute left-1/2 top-1/2 flex max-h-[calc(100%_-_48px)] w-[680px] flex-col overflow-hidden rounded-[16px] bg-tb-surface">
        {/* Meal panel(s). One combo renders the frame verbatim; several stack
            in this scroller with the identical card treatment. */}
        <div className="flex max-h-[1100px] min-h-0 flex-col gap-[8px] overflow-y-auto">
          {combos.map((combo: any) => {
            const imageUrl = resolveEntityImage(combo);
            const saving = savingsFor(combo);
            const cal = calorieValue(combo);
            const price = `${currency}${Number(combo?.price ?? 0).toFixed(2)}`;
            const priceLine = cal
              ? `${price} | ${t("pack.cal", { value: cal })}`
              : price;
            const isPicked = String(combo?.id) === String(selected?.id);
            return (
              <button
                key={combo?.id}
                type="button"
                data-testid={`miam-combo-${combo?.id}`}
                aria-pressed={isMulti ? isPicked : undefined}
                onClick={() => handleComboTap(combo)}
                className={`flex w-full flex-col gap-[22px] bg-tb-grey-6 p-[24px] text-left ${
                  isMulti && isPicked
                    ? "shadow-[inset_0_0_0_3px_var(--color-tb-purple)]"
                    : ""
                }`}
              >
                {saving !== null && (
                  <span className="tb-compressed self-start bg-tb-yellow px-[8px] py-[9px] text-[24px] leading-[18px] text-black">
                    {t("miam.save", {
                      amount: `${currency}${saving.toFixed(2)}`,
                    })}
                  </span>
                )}
                {imageUrl && (
                  <img
                    alt=""
                    src={imageUrl}
                    className="h-[285px] w-full object-contain"
                  />
                )}
                <span className="flex flex-col gap-[4px]">
                  <span className="text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
                    {combo?.name}
                  </span>
                  <span className="text-[18px] leading-[20px] text-tb-ink-purple">
                    {priceLine}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-[48px] bg-tb-surface p-[24px]">
          <h2 className="tb-display text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple">
            {primaryText || t("miam.title")}
          </h2>
          <div className="flex w-full flex-col gap-[16px]">
            {selected && (
              <button
                type="button"
                data-testid="miam-accept"
                onClick={() => handleAccept(selected)}
                className="tb-display h-[60px] w-full rounded-[4px] border border-tb-purple bg-tb-purple text-[18px] leading-[16px] text-tb-surface"
              >
                {item?.makeItMeal?.buttonText1 || t("miam.accept")}
              </button>
            )}
            <button
              type="button"
              data-testid="miam-decline"
              onClick={handleDecline}
              className="tb-display h-[60px] w-full rounded-[4px] border border-tb-purple bg-tb-surface text-[18px] leading-[16px] text-tb-purple"
            >
              {item?.makeItMeal?.buttonText2 || t("miam.decline")}
            </button>
          </div>
        </div>

        {/* Deliberate addition — the frame has no X, but this is a distinct
            behaviour from "not today" (no blacklist, so the item re-prompts)
            and tests/e2e/pack.spec.ts asserts it. */}
        <button
          type="button"
          aria-label={t("language.close")}
          data-testid="miam-close"
          onClick={handleClose}
          className="absolute right-[16px] top-[16px] h-[48px] w-[48px] min-h-[44px] min-w-[44px] opacity-70"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>
      </div>
    </div>
  );
}
