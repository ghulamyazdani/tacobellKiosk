/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offers and their converter-resolved getItems entries flow through untyped
 * from the SDK slices/converters; typed in a later domain pass. Do not add
 * NEW anys.
 */
import { useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { selectGetItems } from "@cx-sdk/ordering/state/cart.slice";
import { isGroupWiseItemOffer } from "@cx-sdk/ordering/offer/groupWiseOfferUtils";
import {
  canAddGroupWiseUnit,
  canCompleteGroupWisePicks,
  getGroupWisePickState,
  isFixedGetEntry,
  type GroupWisePick,
} from "@cx-sdk/ordering/offer/offerCommitRules";
import useOfferApply from "../../hooks/offerHooks/useOfferApply";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import { resolveEntityImage } from "../../utils/entityImage";
import closeIcon from "../../assets/icons/close.svg";

interface FreebiePickerSheetProps {
  open: boolean;
  /** The converter-resolved offer (from filteredOffers) whose freebies to pick. */
  offer: any;
  onClose: () => void;
}

/** The converter-resolved getItems entry fields the customise path reads. */
type GetEntry = {
  _id?: string;
  baseItemId?: string;
  quantity?: number | string;
  entities?: Record<string, unknown>;
};

/** A customised freebie the embedded PDP holds in cart.getItems. */
type StagedRow = {
  id?: string;
  itemId?: string;
  selectedVariant?: { id?: string };
};

/** Stable id for a getItems entry's resolved entity (slim-menu `id` first). */
const entityIdOf = (entry: any): string =>
  String(entry?.entities?.id ?? entry?.baseItemId ?? entry?._id ?? "");

/**
 * Row identity (React key + pick): the getItems entry's own `_id`. Variant-id
 * entries of one base share `entities.id`, so the entity id would select —
 * and grant — every size at once. The test id keeps the entity id.
 */
const rowKeyOf = (entry: GetEntry): string => String(entry?._id ?? entityIdOf(entry));

/**
 * Fork matchesGetItemEntry: a staged freebie belongs to a getItems entry when
 * the entry's baseItemId is the row's base id (VARIANT rows keep the base id
 * and carry the picked variant) or, as a fallback, the row's variant id.
 */
const matchesGetItemEntry = (entry: GetEntry, staged: StagedRow): boolean =>
  Boolean(
    entry?.baseItemId &&
      (entry.baseItemId === staged?.id ||
        entry.baseItemId === staged?.selectedVariant?.id),
  );

/**
 * Radio (or-mode) / check (and-mode) indicator, 44px+ inside the row tap
 * target. An and-mode row not yet customized shows the empty ring.
 */
function SelectionGlyph({ selected, mode }: { selected: boolean; mode: "or" | "and" }) {
  if (mode === "and" && selected) {
    return (
      <span
        aria-hidden="true"
        className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-tb-purple"
      >
        <svg viewBox="0 0 13.34 13.34" className="h-[18px] w-[18px]">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M11.6717 2.8984C12.0233 3.23355 12.0367 3.79034 11.7016 4.14202L5.47493 10.676L1.63034 6.62296C1.296 6.2705 1.31069 5.71375 1.66315 5.37941C2.01561 5.04508 2.57237 5.05977 2.9067 5.41223L5.47787 8.12279L10.428 2.92835C10.7632 2.57666 11.32 2.56325 11.6717 2.8984Z"
            fill="white"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border-2 ${
        selected ? "border-tb-purple" : "border-tb-grey-4"
      }`}
    >
      {selected && <span className="h-[20px] w-[20px] rounded-full bg-tb-purple" />}
    </span>
  );
}

/**
 * Body mounted only while open (house pattern — RepeatItemSheet), so the
 * radio state re-seeds whenever the picker (re)opens for an offer.
 */
function PickerBody({ offer, onClose }: { offer: any; onClose: () => void }) {
  const { t } = useTranslation();
  const { commitPickedFreebies } = useOfferApply();
  const { emptyGetItems, redeemGetItem, removeGetItemsById } = useCartHook();
  const { openGetItemTierModal } = useMakeItAMeal();
  const stagedRows: StagedRow[] = useSelector(selectGetItems) ?? [];
  const currencySettings = useSelector(selectCurrency) as any;
  const currency =
    currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";

  // Only entries the converter resolved to a live entity are offerable
  // (contract trap 1: unresolvable baseItemIds silently vanish).
  const entries: any[] = (offer?.getItems?.items ?? []).filter(
    (entry: any) => entry?.entities && Object.keys(entry.entities).length > 0,
  );
  // Plain = a fixed grant committed as-is (SDK isFixedGetEntry): an ITEM
  // entity, or a variant-id entity (converter isVariantSelected — the offer
  // grants THAT size; the fork locks it). Through the PDP,
  // buildVariantCommitPayload's trailing `...selectedEntity` spread put the
  // offer's size back over the customer's pick and dropped their add-ons
  // while total_price still charged them. Other VARIANT/CUSTOMIZABLE
  // entities carry a choice of their own, made in the embedded PDP
  // (OfferTierHost), which stages the row into cart.getItems.
  const isPlain = (entry: GetEntry) => isFixedGetEntry(entry);
  // G3: a group-wise "pick N" offer — the guest picks EXACTLY getQuantity
  // units across its entries, whatever their relation (SDK rules).
  const groupWise = isGroupWiseItemOffer(offer);
  const customEntries: GetEntry[] = entries.filter((entry) => !isPlain(entry));
  // The entry a staged row belongs to. Group mode: the FIRST customizable
  // entry it matches (fork apply parity), so one customization backs one
  // pick even when two entries share a base item.
  const ownsRow = (entry: GetEntry, row: StagedRow): boolean =>
    groupWise
      ? customEntries.find((candidate) => matchesGetItemEntry(candidate, row)) === entry
      : matchesGetItemEntry(entry, row);
  // Newest wins: a re-customization appends a row (non-ITEM rows are keyed
  // by a fresh itemId), so BACK out of the PDP keeps the held one. Older
  // rows are ignored here and swept by CONFIRM (commitPickedFreebies) or X.
  const stagedRowFor = (entry: GetEntry): StagedRow | undefined =>
    [...stagedRows].reverse().find((row) => ownsRow(entry, row));

  // "or" relation → the customer picks ONE; pure-"and" list → every entry is
  // part of the grant (plain ones all-selected, customizable ones once staged).
  const orMode =
    offer?.isAndOffer === false ||
    entries.some((entry: any) => entry?.relation === "or");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  // Group mode: units picked per plain entry (row key → count); a
  // customizable entry counts once its row is staged.
  const [counts, setCounts] = useState<Record<string, number>>({});

  const unitsOf = (entry: GetEntry): number =>
    isPlain(entry) ? (counts[rowKeyOf(entry)] ?? 0) : stagedRowFor(entry) ? 1 : 0;
  const groupPicks: GroupWisePick<GetEntry>[] = groupWise
    ? entries.flatMap((entry: GetEntry) => {
        const quantity = unitsOf(entry);
        if (quantity === 0) return [];
        return [
          isPlain(entry)
            ? { entry, quantity }
            : { entry, quantity, entities: stagedRowFor(entry) },
        ];
      })
    : [];
  const group = groupWise ? getGroupWisePickState(offer, groupPicks) : null;
  // A group its entries can never fill ("get 2" over ONE customizable entry,
  // or an unconfigured getQuantity) says "can't be applied" and locks.
  const groupFillable = groupWise && canCompleteGroupWisePicks(offer, groupPicks, entries);

  // Or-mode pick: the newest staged row's entry wins, else the plain radio pick.
  const newest = stagedRows[stagedRows.length - 1];
  const stagedEntry = newest
    ? customEntries.find((entry) => matchesGetItemEntry(entry, newest))
    : undefined;
  const orPickId = stagedEntry ? rowKeyOf(stagedEntry) : selectedId;

  const discountLine = (entry: any): string => {
    if (entry?.discountType === "percent") {
      return Number(entry?.value) === 100
        ? t("offers.free")
        : t("offers.percentOff", { value: entry?.value });
    }
    return t("offers.amountOff", {
      amount: `${currency}${Number(entry?.value ?? 0).toFixed(2)}`,
    });
  };

  // Group mode: exactly getQuantity units (the SDK commit exists only then).
  // And-mode: plain entries are auto-included; every customizable one must
  // be staged first.
  const canConfirm =
    !committing &&
    (group
      ? group.commitItems !== null
      : orMode
        ? orPickId !== null
        : entries.length > 0 && customEntries.every((entry) => stagedRowFor(entry)));

  /** applyOfferByItem-shaped pick: plain → the entry; customizable → the staged row. */
  const pickFor = (entry: GetEntry): GetEntry | null => {
    if (isPlain(entry)) return entry;
    const row = stagedRowFor(entry);
    // ponytail: qty>1 shares this one customization; per-unit customization
    // is the fork's RepeatGetItem — add it if asked.
    return row
      ? { ...entry, entities: row, quantity: Number(entry?.quantity) || 1 }
      : null;
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    // Group mode commits exactly the picks, stamped by the SDK rules.
    const picks = group
      ? (group.commitItems ?? [])
      : (orMode ? entries.filter((entry) => rowKeyOf(entry) === orPickId) : entries)
          .map(pickFor)
          .filter(Boolean);
    if (picks.length === 0) return;
    setCommitting(true);
    try {
      // Contract picker recipe: emptyGetItems → applyOfferByItem per pick →
      // applyOffer — all inside the hook (which also rolls back on failure).
      await commitPickedFreebies({ offer, picks });
      onClose();
    } catch {
      // The hook rolls back and never rejects; if it ever does, the picker
      // stays open and usable (Rule 2).
    } finally {
      setCommitting(false);
    }
  };

  /**
   * Group-mode row tap: a plain row adds one unit; a customizable row opens
   * the embedded PDP — re-customizing a held pick replaces it, anything else
   * needs room under getQuantity (more is impossible).
   */
  const handleGroupTap = (entry: GetEntry) => {
    const held = !isPlain(entry) && unitsOf(entry) > 0;
    if (!held && !canAddGroupWiseUnit(offer, groupPicks, entry)) return;
    if (!isPlain(entry)) {
      openGetItemTierModal(entry.entities);
      return;
    }
    const key = rowKeyOf(entry);
    setCounts((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  };

  /** Group-mode "−": one unit off a plain pick; a customized pick is dropped. */
  const handleRemoveUnit = (entry: GetEntry) => {
    if (isPlain(entry)) {
      const key = rowKeyOf(entry);
      setCounts((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) - 1) }));
      return;
    }
    stagedRows
      .filter((row) => ownsRow(entry, row))
      .forEach((row) => removeGetItemsById(row.itemId, "itemId"));
  };

  /**
   * Row tap. Plain: or-mode radio pick (clears any staged customization).
   * Customizable: open the embedded PDP in place (fork OfferItem :389-410).
   * Nothing held is dropped here — a new customization supersedes it only
   * once it lands (newest wins), so BACK out of the PDP keeps the old pick.
   */
  const handleRowTap = (entry: GetEntry) => {
    if (groupWise) {
      handleGroupTap(entry);
      return;
    }
    if (isPlain(entry)) {
      if (orMode) {
        emptyGetItems();
        setSelectedId(rowKeyOf(entry));
      }
      return;
    }
    openGetItemTierModal(entry.entities);
  };

  // Staged rows never outlive the picker.
  const handleClose = () => {
    emptyGetItems();
    onClose();
  };

  // Render helper, NOT a component (house pattern).
  const renderRow = (entry: any) => {
    const key = rowKeyOf(entry);
    const plain = isPlain(entry);
    // Group mode: the units picked; an unpicked row is out of play once
    // getQuantity units are picked (more is impossible).
    const units = groupWise ? unitsOf(entry) : 0;
    const locked =
      groupWise &&
      units === 0 &&
      (!groupFillable || !canAddGroupWiseUnit(offer, groupPicks, entry));
    const stagedRow = plain ? undefined : stagedRowFor(entry);
    // Or-mode: only the picked entry reads as customized (a superseded
    // row lingers in cart.getItems until CONFIRM / X sweep it).
    const staged = !!stagedRow && (groupWise || !orMode || orPickId === key);
    const selected = groupWise
      ? units > 0
      : orMode
        ? orPickId === key
        : plain || staged;
    const entity = entry?.entities ?? {};
    // The resolved entity is the menu entity, so its kiosk aggregator image
    // is the one to show.
    const imageUrl = resolveEntityImage(entity);
    // A staged row is priced exactly as CONFIRM will price it (redeemGetItem,
    // add-ons included), so a "Free" item with a paid add-on shows its charge.
    const priced = staged
      ? redeemGetItem(stagedRow, entry?.discountType, 1, entry?.value, false)
      : entity;
    const showPrice = plain || staged;
    const undiscounted = Number(
      priced?.undiscounted_total_price ?? priced?.price ?? 0,
    );
    const discounted = Number(
      priced?.discounted_total_price ?? priced?.price ?? 0,
    );
    // Group mode names the units picked; otherwise the grant's own quantity.
    const lineQty = groupWise ? units : Number(entry?.quantity ?? 1);
    const qtyPrefix = lineQty > 1 ? `${t("bag.lineQty", { qty: lineQty })} ` : "";

    const row = (
      <button
        key={groupWise ? undefined : key}
        type="button"
        data-testid={`freebie-option-${entityIdOf(entry)}`}
        disabled={locked}
        aria-pressed={locked ? undefined : selected}
        onClick={() => handleRowTap(entry)}
        className={`flex items-center gap-[24px] py-[24px] text-left min-h-[132px] ${
          groupWise
            ? "min-w-0 flex-1 pl-[48px]"
            : "w-full border-b border-tb-grey-4 px-[48px]"
        } ${locked ? "opacity-50" : ""}`}
      >
        {imageUrl ? (
          <img
            alt=""
            src={imageUrl}
            className="h-[84px] w-[84px] shrink-0 rounded-[8px] bg-tb-grey-6 object-contain"
          />
        ) : (
          <span className="h-[84px] w-[84px] shrink-0 rounded-[8px] bg-tb-grey-6" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-[6px]">
          <span className="text-[24px] font-bold capitalize leading-[28px] text-black">
            {qtyPrefix}
            {entity?.name}
          </span>
          {/* A fixed-size grant names its size (BagItemRow's variant line). */}
          {entity?.isVariantSelected === true && entity?.selectedVariant?.name && (
            <span className="text-[20px] leading-[24px] text-tb-ink-purple">
              {entity.selectedVariant.name}
            </span>
          )}
          <span className="text-[20px] leading-[24px] text-tb-ink-purple/70">
            {discountLine(entry)}
          </span>
          {!plain && !locked && (
            <span className="text-[20px] font-bold leading-[24px] text-tb-purple underline">
              {staged ? t("offers.picker.customized") : t("offers.picker.customize")}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-[16px]">
          {/* An uncustomized row has no price pair — the converter stamps
              none and the figure depends on the customization. */}
          {showPrice && undiscounted > discounted && (
            <span className="text-[20px] leading-[24px] text-tb-ink-purple/60 line-through">
              {currency}
              {undiscounted.toFixed(2)}
            </span>
          )}
          {showPrice && (
            <span className="text-[24px] font-medium leading-[28px] text-black">
              {currency}
              {discounted.toFixed(2)}
            </span>
          )}
          <SelectionGlyph
            selected={selected}
            mode={orMode && !groupWise ? "or" : "and"}
          />
        </span>
      </button>
    );
    if (!groupWise) return row;
    // Group mode: the row adds a unit; "−" (outside the row button — no
    // nested buttons) takes one back.
    return (
      <div
        key={key}
        className="flex items-center gap-[16px] border-b border-tb-grey-4 pr-[48px]"
      >
        {row}
        {units > 0 && (
          <button
            type="button"
            data-testid={`freebie-dec-${entityIdOf(entry)}`}
            aria-label={t("offers.buyStage.decrease", { name: entity?.name ?? "" })}
            onClick={() => handleRemoveUnit(entry)}
            className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full border-[1.72px] border-[#b9b9b9] text-tb-purple"
          >
            {/* Minus glyph (Figma icon 3601ce08) — BagItemRow's inline copy. */}
            <svg viewBox="0 0 24 24" className="h-[24px] w-[24px]" aria-hidden="true">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M2.5 12C2.5 11.1716 3.17157 10.5 4 10.5L20 10.5C20.8284 10.5 21.5 11.1716 21.5 12C21.5 12.8284 20.8284 13.5 20 13.5L4 13.5C3.17157 13.5 2.5 12.8284 2.5 12Z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
      </div>
    );
  };

  // Group mode names what is missing (TB mounts no global error modal).
  const groupHint = !group
    ? null
    : !groupFillable
      ? t("offers.notApplicable")
      : group.remaining === 1
        ? t("offers.picker.groupHintOne")
        : group.remaining > 1
          ? t("offers.picker.groupHintOther", { count: group.remaining })
          : null;

  return (
    <div className="absolute inset-0 z-[80]" data-testid="freebie-picker">
      {/* Position-neutral bottom-sheet entrance — tb-modal-enter is reserved
          for centered modals (house rule). */}
      <style>{`@keyframes tbFreebieSheetEnter{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={handleClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* Cap = containing block (the bag's inset-0 root → Menu's h-full root
          → the reach container) minus a 96 px scrim band: 1200 on the 1920
          stage, 1026 in the 1122 ADA reach zone. Title/X and CONFIRM keep
          their content height; only the options shrink and scroll. */}
      <div
        style={{ animation: "tbFreebieSheetEnter 0.2s ease-out both" }}
        className="absolute bottom-0 left-0 flex max-h-[min(1200px,calc(100%_-_96px))] w-[1080px] flex-col rounded-t-[24px] bg-tb-surface pt-[44px]"
      >
        <h2 className="tb-display mb-[8px] px-[96px] text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple">
          {t("offers.freebieTitle")}
        </h2>
        <p className="mb-[24px] px-[96px] text-center text-[22px] leading-[26px] text-tb-ink-purple/80">
          {group && group.need > 1
            ? t("offers.picker.groupSubtitle", { count: group.need })
            : orMode || group
              ? t("offers.freebieSubtitleOr")
              : t("offers.freebieSubtitleAnd")}
        </p>
        <button
          type="button"
          data-testid="freebie-close"
          aria-label={t("language.close")}
          onClick={handleClose}
          className="absolute right-[32px] top-[36px] h-[48px] min-h-[44px] w-[48px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[8px]">
          {entries.map(renderRow)}
        </div>

        <div className="px-[24px] pb-[32px] pt-[16px]">
          {group && (
            <p
              data-testid="freebie-group-hint"
              aria-live="polite"
              className="min-h-[26px] pb-[16px] text-center text-[22px] font-bold leading-[26px] text-tb-pink-dark"
            >
              {groupHint}
            </p>
          )}
          <button
            type="button"
            data-testid="freebie-confirm"
            aria-disabled={!canConfirm}
            onClick={handleConfirm}
            className={`tb-display min-h-[84px] w-full rounded-[8px] bg-tb-purple py-[32px] text-center text-[24px] leading-[20px] text-tb-surface ${
              canConfirm ? "" : "opacity-40"
            }`}
          >
            {t("offers.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * FREEBIE PICKER — design-language bottom sheet (no dedicated Figma frame —
 * flagged for client sign-off): lists the offer's converter-resolved
 * `getItems.items` entries. Plain entities (incl. a fixed-size variant-id
 * grant) are selectable (radio for an "or" choice, all-selected for an "and"
 * grant). Entities that still carry a variant/modifier choice open the
 * embedded PDP in place (OfferTierHost — the URL stays /cart), which stages
 * the customized row into cart.getItems; the row then reads as picked, with
 * the price CONFIRM will charge. A group-wise "pick N" offer (G3) is one
 * group: a plain row adds a unit per tap, a customizable row is picked once
 * (its own customization), "−" takes one back, unpicked rows lock at N, and
 * CONFIRM unlocks at exactly N units with a hint until then (a group its
 * entries can never fill reads "can't be applied", rows locked) — the SDK
 * group-wise rules build the commit. CONFIRM commits via
 * useOfferApply.commitPickedFreebies, then closes; X / backdrop drop any
 * staged rows.
 */
export default function FreebiePickerSheet({
  open,
  offer,
  onClose,
}: FreebiePickerSheetProps) {
  if (!open || !offer || Object.keys(offer).length === 0) return null;
  return <PickerBody key={String(offer?._id ?? "")} offer={offer} onClose={onClose} />;
}
