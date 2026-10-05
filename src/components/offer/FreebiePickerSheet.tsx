/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offers and their converter-resolved getItems entries flow through untyped
 * from the SDK slices/converters; typed in a later domain pass. Do not add
 * NEW anys.
 */
import { useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import useOfferApply from "../../hooks/offerHooks/useOfferApply";
import { resolveEntityImage } from "../../utils/entityImage";
import closeIcon from "../../assets/icons/close.svg";

interface FreebiePickerSheetProps {
  open: boolean;
  /** The converter-resolved offer (from filteredOffers) whose freebies to pick. */
  offer: any;
  onClose: () => void;
}

/** Stable id for a getItems entry's resolved entity (slim-menu `id` first). */
const entityIdOf = (entry: any): string =>
  String(entry?.entities?.id ?? entry?.baseItemId ?? entry?._id ?? "");

/** Radio (or-mode) / check (and-mode) indicator, 44px+ inside the row tap target. */
function SelectionGlyph({ selected, mode }: { selected: boolean; mode: "or" | "and" }) {
  if (mode === "and") {
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
  const currencySettings = useSelector(selectCurrency) as any;
  const currency =
    currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";

  // Only entries the converter resolved to a live entity are offerable
  // (contract trap 1: unresolvable baseItemIds silently vanish).
  const entries: any[] = (offer?.getItems?.items ?? []).filter(
    (entry: any) => entry?.entities && Object.keys(entry.entities).length > 0,
  );
  // Converter stamps type: "ITEM" for plain entities; VARIANT/CUSTOMIZABLE
  // carry a choice of their own — the tier session is DEFERRED in P7b, so
  // those rows render disabled with the "coming soon" note.
  const isPlain = (entry: any) => entry?.entities?.type === "ITEM";
  const plainEntries = entries.filter(isPlain);

  // "or" relation → the customer picks ONE; pure-"and" list → every plain
  // entry is part of the grant (all-selected, nothing to toggle).
  const orMode =
    offer?.isAndOffer === false ||
    entries.some((entry: any) => entry?.relation === "or");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

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

  const canConfirm =
    !committing && (orMode ? selectedId !== null : plainEntries.length > 0);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    const picks = orMode
      ? plainEntries.filter((entry: any) => entityIdOf(entry) === selectedId)
      : plainEntries;
    if (picks.length === 0) return;
    setCommitting(true);
    try {
      // Contract picker recipe: emptyGetItems → applyOfferByItem per pick →
      // applyOffer — all inside the hook (which also rolls back on failure).
      await commitPickedFreebies({ offer, picks });
      onClose();
    } finally {
      setCommitting(false);
    }
  };

  // Render helper, NOT a component (house pattern).
  const renderRow = (entry: any) => {
    const id = entityIdOf(entry);
    const plain = isPlain(entry);
    const selected = orMode ? selectedId === id : plain;
    const entity = entry?.entities ?? {};
    // The resolved entity is the menu entity, so its kiosk aggregator image
    // is the one to show.
    const imageUrl = resolveEntityImage(entity);
    const undiscounted = Number(
      entity?.undiscounted_total_price ?? entity?.price ?? 0,
    );
    const discounted = Number(
      entity?.discounted_total_price ?? entity?.price ?? 0,
    );
    const qtyPrefix =
      Number(entry?.quantity ?? 1) > 1
        ? `${t("bag.lineQty", { qty: entry?.quantity })} `
        : "";

    return (
      <button
        key={id}
        type="button"
        data-testid={`freebie-option-${id}`}
        disabled={!plain}
        aria-disabled={!plain}
        aria-pressed={plain ? selected : undefined}
        onClick={() => {
          if (plain && orMode) setSelectedId(id);
        }}
        className={`flex w-full items-center gap-[24px] border-b border-tb-grey-4 px-[48px] py-[24px] text-left min-h-[132px] ${
          plain ? "" : "opacity-50"
        }`}
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
          <span className="text-[20px] leading-[24px] text-tb-ink-purple/70">
            {plain ? discountLine(entry) : t("offers.customizableSoon")}
          </span>
        </span>
        {plain && (
          <span className="flex shrink-0 items-center gap-[16px]">
            {undiscounted > discounted && (
              <span className="text-[20px] leading-[24px] text-tb-ink-purple/60 line-through">
                {currency}
                {undiscounted.toFixed(2)}
              </span>
            )}
            <span className="text-[24px] font-medium leading-[28px] text-black">
              {currency}
              {discounted.toFixed(2)}
            </span>
            <SelectionGlyph selected={selected} mode={orMode ? "or" : "and"} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="absolute inset-0 z-[80]" data-testid="freebie-picker">
      {/* Position-neutral bottom-sheet entrance — tb-modal-enter is reserved
          for centered modals (house rule). */}
      <style>{`@keyframes tbFreebieSheetEnter{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={onClose}
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
          {orMode ? t("offers.freebieSubtitleOr") : t("offers.freebieSubtitleAnd")}
        </p>
        <button
          type="button"
          data-testid="freebie-close"
          aria-label={t("language.close")}
          onClick={onClose}
          className="absolute right-[32px] top-[36px] h-[48px] min-h-[44px] w-[48px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[8px]">
          {entries.map(renderRow)}
        </div>

        <div className="px-[24px] pb-[32px] pt-[16px]">
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
 * `getItems.items` entries. Plain entities are selectable (radio for an "or"
 * choice, all-selected for an "and" grant); entities that still carry a
 * variant/modifier choice render disabled with the "coming soon" note (the
 * customizable-freebie tier session is DEFERRED in P7b). CONFIRM commits via
 * useOfferApply.commitPickedFreebies, then closes.
 */
export default function FreebiePickerSheet({
  open,
  offer,
  onClose,
}: FreebiePickerSheetProps) {
  if (!open || !offer || Object.keys(offer).length === 0) return null;
  return <PickerBody key={String(offer?._id ?? "")} offer={offer} onClose={onClose} />;
}
