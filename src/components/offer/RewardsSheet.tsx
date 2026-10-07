import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCartOffer } from "@cx-sdk/ordering/state/cart.slice";
import { selectFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  selectEntityMap,
  selectSubCategoryMap,
  selectVariantObject,
} from "@cx-sdk/catalog/state/Menu.slice";
import {
  hasOffer,
  lockedGapPresentation,
  sectionRankedOffers,
} from "@cx-sdk/ordering/offer/offersSheetLogic";
import {
  resolveBuyStageView,
  type BuyStageOffer,
  type BuyStageView,
} from "@cx-sdk/ordering/offer/buyStageUtils";
import { canOfferBuyStage } from "@cx-sdk/ordering/offer/offerCommitRules";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import type { RankedOffer } from "@cx-sdk/core/types/offer";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import useOfferSavings from "../../hooks/offerHooks/useOfferSavings";
import useOfferApply from "../../hooks/offerHooks/useOfferApply";
import useCartUpsell from "../../hooks/menuHooks/useCartUpsell";
import useAddEntityToCart from "../../hooks/menuHooks/useAddEntityToCart";
import useLocalized from "../../hooks/utils/useLocalized";
import { resolveEntityImage } from "../../utils/entityImage";
import {
  CART_UPSELL_CARD_HEIGHT_PX,
  CART_UPSELL_CARD_WIDTH_PX,
  CART_UPSELL_GRID_GAP_PX,
  CART_UPSELL_IMAGE_HEIGHT_PX,
  CART_UPSELL_PAGE_PADDING_X_PX,
  CART_UPSELL_TITLE_HEIGHT_PX,
  CART_UPSELL_TITLE_LINE_HEIGHT_PX,
} from "../../hooks/menuHooks/cartUpsellUtils";
import OfferRow from "./OfferRow";
import tbBell from "../../assets/brand/tb-bell.svg";
import closeIcon from "../../assets/icons/close.svg";
import plusIcon from "../../assets/icons/plus.svg";

export interface RewardsSheetProps {
  open: boolean;
  /** X / backdrop / after-commit close. X = no change (locked decision 2). */
  onClose: () => void;
  /**
   * Fired (before onClose) when the committed pick requires a freebie choice
   * — the page owns the FreebiePickerSheet's open state and receives the
   * offer to hand it.
   */
  onNeedsPicker?: (offer: SavingsOffer) => void;
  /**
   * ADD ITEMS on a locked bogoBuySide row (offers lane, item 31): fired
   * (before onClose) with the offer and its resolved buy stage — the page
   * owns the BuyStageSheet. Rows only offer it when canOfferBuyStage holds;
   * every other locked row stays inert (no /menu fallback).
   */
  onAddItems?: (offer: SavingsOffer, view: BuyStageView) => void;
}

/** resolveBuyStageView's menu inputs, as the untyped Menu slice holds them. */
type EntityMapIn = Parameters<typeof resolveBuyStageView>[1];
type SubCategoryMapIn = Parameters<typeof resolveBuyStageView>[2];
type VariantObjectIn = Parameters<typeof resolveBuyStageView>[3];

/**
 * Converted menu entities widen the engine's RecommendedEntity with
 * `image_url` and a sometimes-object calorie count (CompleteYourMealRail /
 * MenuItemCard precedent) — read through this widening rather than `any`.
 */
type ConvertedEntityExtras = {
  image_url?: string;
  calorieCount?: number | string | { value?: number | string };
  nutritionalInfo?: {
    calorieCount?: number | string | { value?: number | string };
  };
};

const calorieValue = (
  entity: RecommendedEntity,
): number | string | undefined => {
  const extras = entity as RecommendedEntity & ConvertedEntityExtras;
  const cal = extras?.calorieCount ?? extras?.nutritionalInfo?.calorieCount;
  if (cal !== null && typeof cal === "object") return cal?.value;
  return cal;
};

/** Header bell, tinted tb-purple via CSS mask (the SVG's fills are white). */
const bellMaskStyle: CSSProperties = {
  WebkitMaskImage: `url(${tbBell})`,
  maskImage: `url(${tbBell})`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskPosition: "center",
  maskPosition: "center",
};

const noop = () => undefined;

interface SheetBodyProps {
  onClose: () => void;
  onNeedsPicker?: (offer: SavingsOffer) => void;
  onAddItems?: (offer: SavingsOffer, view: BuyStageView) => void;
}

/**
 * Sheet body — mounted only while open (default export below, RepeatItemSheet
 * house pattern), so the radio state re-seeds from the applied offer on every
 * (re)open without a setState-in-effect.
 */
function SheetBody({ onClose, onNeedsPicker, onAddItems }: SheetBodyProps) {
  const { t } = useTranslation();

  const filteredOffers = useSelector(selectFilteredOffers) as
    | SavingsOffer[]
    | null
    | undefined;
  const appliedOffer = useSelector(selectCartOffer) as SavingsOffer | undefined;
  const currencySettings = useSelector(selectCurrency) as
    | { symbol?: string; currency_symbol?: string }
    | null
    | undefined;
  const entityMap = useSelector(selectEntityMap) as EntityMapIn;
  const subCategoryMap = useSelector(selectSubCategoryMap) as SubCategoryMapIn;
  const variantObject = useSelector(selectVariantObject) as VariantObjectIn;

  const { rank } = useOfferSavings();
  // Verified against the landed apply core: selectOfferAndCommit(offer) →
  // Promise<OfferCommitResult> ({ applied, needsPicker?, offer?, blocked? }) —
  // the swapCartOffer atomic / directly-applicable / picker-verdict recipes
  // and the sameOrLess ceiling live inside it.
  const { selectOfferAndCommit } = useOfferApply();
  const { items: upsellPool } = useCartUpsell();
  const { addEntity, getAddIntent } = useAddEntityToCart();
  // Menu names at render; offer names stay English (no per-language data).
  const { name } = useLocalized();

  const currency =
    currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";
  const money = (value: number): string =>
    `${currency}${Number(value).toFixed(2)}`;

  // rank() is memoised on the cart signature inside useOfferSavings; the memo
  // here keeps re-renders from re-walking the (cached) probe path per row.
  const ranked = useMemo(
    () => rank(filteredOffers ?? []),
    [rank, filteredOffers],
  );

  const appliedId = hasOffer(appliedOffer) ? appliedOffer._id : undefined;

  const sections = useMemo(
    () => sectionRankedOffers(ranked, appliedId),
    [ranked, appliedId],
  );

  // Flat Figma-order list (locked decision 3): eligible rows first, hero
  // treatment DEFERRED — the top-ranked eligible offer simply leads the list.
  const eligibleRows: RankedOffer<SavingsOffer>[] = sections.hero
    ? [sections.hero, ...sections.readyRows]
    : sections.readyRows;

  // Radio state — applied offer preselected; seeded per open (see SheetBody
  // mounting note). SAVE compares against the live appliedId at commit time.
  const [pickedId, setPickedId] = useState<string | undefined>(() => appliedId);
  const [committing, setCommitting] = useState(false);
  // SAVE refused (the sameOrLess ceiling, or an item offer with nothing to
  // grant) — inline, because TB mounts no global error modal; cleared by the
  // next pick.
  const [notApplicable, setNotApplicable] = useState(false);

  // The commit is awaited: an idle reset or bag close can unmount the sheet
  // mid-flight, and nothing may hand a picker offer to the page after that.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const savable = eligibleRows.length > 0;

  /**
   * SAVE SELECTION (locked decision 2): unchanged selection → just close;
   * a new pick commits through the apply core (atomic swap recipes live
   * there), and a `needsPicker` signal hands the offer to the page's
   * FreebiePickerSheet via onNeedsPicker before closing — the ceiling-
   * filtered offer when the apply core returns one. A `blocked` verdict
   * keeps the sheet open with the inline not-applicable line.
   */
  const handleSave = async () => {
    if (!savable || committing) return;
    if (!pickedId || pickedId === appliedId) {
      onClose();
      return;
    }
    const entry = eligibleRows.find((row) => row.offer?._id === pickedId);
    if (!entry) {
      onClose();
      return;
    }
    setCommitting(true);
    try {
      const result = await selectOfferAndCommit(entry.offer);
      if (!mountedRef.current) return;
      if (result?.blocked) {
        setNotApplicable(true);
        return;
      }
      if (result?.needsPicker) onNeedsPicker?.(result.offer ?? entry.offer);
      onClose();
    } catch {
      // The apply core failed — never a frozen or crashed sheet (Rule 2):
      // stay open with the selection intact so the customer can retry or X out.
    } finally {
      if (mountedRef.current) setCommitting(false);
    }
  };

  // Buy stages for the locked bogoBuySide rows — only where TB can finish
  // the offer (canOfferBuyStage: no group mode, no get-categories). A row
  // whose view fails to resolve (or throws on a malformed payload) simply
  // stays inert, as before.
  const buyStageViews = useMemo(() => {
    const views = new Map<string, BuyStageView>();
    sections.lockedRows.forEach((row) => {
      if (lockedGapPresentation(row.offer, row.gap).labelKind !== "bogoBuySide") {
        return;
      }
      try {
        const view = resolveBuyStageView(
          row.offer as BuyStageOffer,
          entityMap,
          subCategoryMap,
          variantObject,
        );
        if (view && canOfferBuyStage(row.offer, view)) {
          views.set(String(row.offer?._id ?? ""), view);
        }
      } catch {
        // Inert row — never a crashed sheet (Rule 2).
      }
    });
    return views;
  }, [sections.lockedRows, entityMap, subCategoryMap, variantObject]);

  const handleAddItems = (offer: SavingsOffer, view: BuyStageView) => {
    if (committing) return;
    onAddItems?.(offer, view);
    onClose();
  };

  // Suggested rail (locked decision 4): only when the TOP locked offer has a
  // minBill gap; pool = cart-upsell items priced at/above the gap short, else
  // any pool items; max 4. Restricted to plain-add intents so a rail tap can
  // NEVER navigate or stack a sheet from under the open rewards sheet
  // ("closes nothing" — Rule 1 flow integrity).
  const topLocked = sections.lockedRows[0] ?? null;
  const railShort = useMemo(() => {
    if (!topLocked) return null;
    const presentation = lockedGapPresentation(topLocked.offer, topLocked.gap);
    return presentation.labelKind === "minBill" && presentation.short > 0
      ? presentation.short
      : null;
  }, [topLocked]);

  const railItems = useMemo(() => {
    if (railShort === null) return [];
    const plainAdds = upsellPool.filter(
      (entity) => getAddIntent(entity) === "add",
    );
    const covering = plainAdds.filter(
      (entity) => Number(entity?.price ?? 0) >= railShort,
    );
    return (covering.length > 0 ? covering : plainAdds).slice(0, 4);
  }, [railShort, upsellPool, getAddIntent]);

  const handleRailTap = (entity: RecommendedEntity) => {
    // Re-check at tap time: an intent that drifted since render must no-op
    // rather than detour the customer with two sheets open.
    if (getAddIntent(entity) !== "add") return;
    addEntity(entity, { suppressAddedModal: true });
  };

  const priceLine = (entity: RecommendedEntity): string => {
    const base = `${currency}${entity?.price ?? ""}`;
    const cal = calorieValue(entity);
    return cal ? `${base} | ${t("pack.cal", { value: cal })}` : base;
  };

  // Render helper, NOT a component (react-hooks/static-components) — the
  // menu-card skin from the bag's rail, with the offer-rail testids.
  const renderRailCard = (entity: RecommendedEntity) => {
    const imageUrl = resolveEntityImage(entity);
    return (
      <button
        key={entity?.id}
        type="button"
        data-testid={`offer-suggested-item-${entity?.id}`}
        aria-label={name(entity)}
        onClick={() => handleRailTap(entity)}
        className="relative flex shrink-0 flex-col items-stretch justify-between overflow-hidden rounded-[8px] bg-tb-grey-6 text-left"
        style={{
          width: CART_UPSELL_CARD_WIDTH_PX,
          height: CART_UPSELL_CARD_HEIGHT_PX,
        }}
      >
        <span className="flex flex-col gap-[4px] pl-[24px] pr-[64px] pt-[24px]">
          <span
            className="block overflow-hidden text-[20px] font-medium capitalize tracking-[-0.5px] text-black"
            style={{
              lineHeight: `${CART_UPSELL_TITLE_LINE_HEIGHT_PX}px`,
              maxHeight: CART_UPSELL_TITLE_HEIGHT_PX,
            }}
          >
            {name(entity)}
          </span>
          <span className="block text-[18px] leading-[20px] text-tb-ink-purple">
            {priceLine(entity)}
          </span>
        </span>
        {imageUrl ? (
          <img
            alt=""
            src={imageUrl}
            className="w-full object-contain"
            style={{ height: CART_UPSELL_IMAGE_HEIGHT_PX }}
          />
        ) : (
          <span
            className="block w-full"
            style={{ height: CART_UPSELL_IMAGE_HEIGHT_PX }}
          />
        )}
        <span
          aria-hidden="true"
          className="absolute right-[12px] top-[12px] flex h-[44px] w-[44px] items-center justify-center rounded-full bg-tb-surface shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)]"
        >
          <img alt="" src={plusIcon} className="h-[16px] w-[16px]" />
        </span>
      </button>
    );
  };

  const renderRow = (row: RankedOffer<SavingsOffer>, interactive: boolean) => {
    const id = String(row.offer?._id ?? "");
    const view = onAddItems ? buyStageViews.get(id) : undefined;
    return (
      <OfferRow
        key={id}
        entry={row}
        selected={interactive && pickedId === id}
        applied={appliedId === id}
        currency={currency}
        // Locked/gone rows render a div that ignores this latch; only their
        // ADD ITEMS button reads it.
        disabled={committing}
        onPick={
          interactive
            ? () => {
                setPickedId(id);
                setNotApplicable(false);
              }
            : noop
        }
        onAddItems={view ? () => handleAddItems(row.offer, view) : undefined}
      />
    );
  };

  return (
    <div className="absolute inset-0 z-50" data-testid="rewards-sheet">
      {/* Own position-neutral entrance keyframe — tb-modal-enter is reserved
          for centered modals (it carries a -50% translate). */}
      <style>{`@keyframes tbRewardsSheetEnter{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <button
        type="button"
        aria-label={t("offers.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* Height is capped by the containing block (the bag's inset-0 root
          → Menu's h-full root → the reach container) minus a 96 px scrim
          band — Tier2's top-[96px]. Never binds on the 1920 stage (1824 >
          1470); in the 1122 ADA reach zone the sheet is 1026, so the X and
          SAVE stay on screen and only the list scrolls. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rewards-sheet-title"
        style={{ animation: "tbRewardsSheetEnter 0.2s ease-out both" }}
        className="absolute bottom-0 left-0 flex h-[min(1470px,calc(100%_-_96px))] w-[1080px] flex-col overflow-hidden rounded-t-[60px] bg-tb-surface"
      >
        <div className="relative shrink-0 pb-[32px] pt-[54px]">
          <div className="flex items-center justify-center gap-[16px]">
            <span
              aria-hidden="true"
              className="h-[36px] w-[40px] bg-tb-purple"
              style={bellMaskStyle}
            />
            <p
              id="rewards-sheet-title"
              className="tb-display text-center text-[40px] leading-[40px] tracking-[-1px] text-tb-purple"
            >
              {t("offers.title")}
            </p>
          </div>
          <p className="mt-[16px] text-center text-[22px] leading-[26px] text-tb-ink-purple/80">
            {t("offers.subtitle")}
          </p>
          <button
            type="button"
            data-testid="rewards-close"
            aria-label={t("offers.close")}
            onClick={onClose}
            className="absolute right-[44px] top-[44px] h-[48px] min-h-[44px] w-[48px] min-w-[44px]"
          >
            <img alt="" src={closeIcon} className="h-full w-full" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {ranked.length === 0 ? (
            <div className="flex flex-col items-center gap-[12px] px-[48px] py-[120px] text-center">
              <p className="text-[28px] font-bold text-black">
                {t("offers.noneAvailableTitle")}
              </p>
              <p className="text-[22px] leading-[28px] text-tb-ink-purple/70">
                {t("offers.noneAvailableBody")}
              </p>
            </div>
          ) : (
            <div
              role="radiogroup"
              aria-label={t("offers.subtitle")}
              className="border-t border-tb-grey-4 px-[24px]"
            >
              {/* Figma section order (locked decision 3): eligible (top-ranked
                  first), then locked, then gone — one flat list. */}
              {eligibleRows.map((row) => renderRow(row, true))}
              {sections.lockedRows.map((row) => renderRow(row, false))}
              {sections.goneRows.map((row) => renderRow(row, false))}
            </div>
          )}

          {railShort !== null && railItems.length > 0 && (
            <section
              data-testid="offer-suggested-rail"
              className="w-full pb-[24px] pt-[48px]"
              style={{
                paddingLeft: CART_UPSELL_PAGE_PADDING_X_PX,
                paddingRight: CART_UPSELL_PAGE_PADDING_X_PX,
              }}
            >
              <p className="text-[20px] font-medium leading-[24px] tracking-[-0.5px] text-black">
                {t("offers.suggestedItems", { amount: money(railShort) })}
              </p>
              <div
                className="mt-[16px] flex w-full overflow-x-auto"
                style={{ gap: CART_UPSELL_GRID_GAP_PX, scrollbarWidth: "none" }}
              >
                {railItems.map(renderRailCard)}
              </div>
            </section>
          )}
        </div>

        <div className="shrink-0 p-[24px] drop-shadow-[0px_0px_64px_rgba(0,0,0,0.08)]">
          {/* Always mounted: a live region must exist before its text does. */}
          <p
            data-testid="rewards-not-applicable"
            role="status"
            className={`text-center text-[20px] font-medium leading-[24px] text-tb-pink-dark ${
              notApplicable ? "mb-[16px]" : ""
            }`}
          >
            {notApplicable ? t("offers.notApplicable") : null}
          </p>
          <button
            type="button"
            data-testid="rewards-save"
            aria-busy={committing}
            disabled={!savable || committing}
            onClick={handleSave}
            className={`tb-display min-h-[84px] w-full rounded-[8px] bg-tb-purple py-[32px] text-center text-[24px] leading-[20px] text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)] ${
              !savable || committing ? "opacity-40" : ""
            }`}
          >
            {t("offers.saveSelection")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * REWARDS sheet — Figma rewards-default 1:3824 / rewards-ineligible 1:3858 /
 * rewards-active 1:3924: white rounded-top sheet over the purple-tinted menu,
 * bell + REWARDS header + X, "Select 1 reward" subtitle, flat offer rows
 * (radio selection, applied preselected), pink minBill/minItems nudges,
 * "Suggested £X+ Items" rail, full-width purple SAVE SELECTION bar.
 *
 * Conditionally mounted so each open re-seeds selection from the applied
 * offer. Reads Redux + useOfferSavings directly; commits through the P7b
 * apply core (useOfferApply). Locked bogoBuySide rows that a buy stage can
 * finish carry ADD ITEMS, handed to the page via onAddItems.
 */
export default function RewardsSheet({
  open,
  onClose,
  onNeedsPicker,
  onAddItems,
}: RewardsSheetProps) {
  if (!open) return null;
  return (
    <SheetBody
      onClose={onClose}
      onNeedsPicker={onNeedsPicker}
      onAddItems={onAddItems}
    />
  );
}
