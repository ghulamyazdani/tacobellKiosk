import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { RankedOffer } from "@cx-sdk/core/types/offer";
import {
  getOfferMechanic,
  type SavingsOffer,
} from "@cx-sdk/ordering/offer/offerSavings";
import { lockedGapPresentation } from "@cx-sdk/ordering/offer/offersSheetLogic";
import { mechanicSpecFor } from "@cx-sdk/ordering/offer/savingsLinePolicy";
import tbBell from "../../assets/brand/tb-bell.svg";

export interface OfferRowProps {
  /** One ranked entry from useOfferSavings().rank() — offer + saving + gap. */
  entry: RankedOffer<SavingsOffer>;
  /** Radio state — the sheet owns the picked id (applied offer preselected). */
  selected: boolean;
  /** Whether this offer is the one currently applied to the cart. */
  applied: boolean;
  /** Currency symbol, prefixed verbatim (BagSheet convention). */
  currency: string;
  onPick: () => void;
  /** Interaction latch (e.g. while a commit is in flight). */
  disabled: boolean;
  /**
   * Buy-stage entry (offers lane, item 31). Only a LOCKED bogoBuySide row
   * renders it — as an ADD ITEMS text button in the nudge slot; the sheet
   * passes it only when a buy stage can finish the offer. Every other locked
   * kind ignores it and stays informational.
   */
  onAddItems?: () => void;
  /**
   * D3 lock (a XENO reward in the bag, no offer applied): every row — also
   * an eligible one — renders the inert div, dimmed and aria-disabled, with
   * no radio, nudge or ADD ITEMS.
   */
  blocked?: boolean;
}

const money = (currency: string, value: number): string =>
  `${currency}${Number(value).toFixed(2)}`;

/**
 * Offer photos are DEFERRED in P7b (resolveLivePhotoUrl not wired), so the
 * 152px plate renders the brand bell, purple-tinted via CSS mask, as a
 * placeholder over the grey plate (the bag applied-row precedent). The url()
 * is quoted (as in OfferAppliedCelebration): the inlined SVG data URI carries
 * ' ( ), so an unquoted url() is invalid and the bell paints as a solid
 * square.
 */
const bellMaskStyle: CSSProperties = {
  WebkitMaskImage: `url("${tbBell}")`,
  maskImage: `url("${tbBell}")`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskPosition: "center",
  maskPosition: "center",
};

/**
 * One REWARDS-sheet row — Figma rewards 1:3824/1:3858 adapted per the P7b
 * LOCKED decisions:
 *  - second line = mechanic/save copy (CX offers carry no expiry field):
 *    eligible → "Save £X" (realised saving) or the mechanicSpec-derived line;
 *    locked minBill/minItems keep the mechanic line here because their gap
 *    copy rides the pink right-nudge; other lock reasons put their copy here.
 *  - pink right-nudge (tb-pink-dark) ONLY for minBill/minItems gaps, amount
 *    from lockedGapPresentation().short.
 *  - eligible rows carry a radio (decision 2 — radio + SAVE SELECTION, not
 *    the fork's instant tap); locked rows no radio; gone rows struck.
 *  - geometry (lane loyalty-visual D2, Figma 1:3842): hairline above each
 *    row inside the 24 top gap (pt-23 → 200 pitch), 152 plate, title 32/36,
 *    second line 24/24; locked rows top-align with the nudge in a 206
 *    column (D3-blocked rows show no nudge, so they centre like the rest).
 *
 * Presentational only: no Redux, no apply logic — the sheet owns selection
 * state and the commit.
 */
export default function OfferRow({
  entry,
  selected,
  applied,
  currency,
  onPick,
  disabled,
  onAddItems,
  blocked = false,
}: OfferRowProps) {
  const { t } = useTranslation();

  const offer = entry.offer;
  const id = String(offer?._id ?? "");
  const gone = entry.gap?.reason === "unavailable";
  const locked = !entry.eligible && !gone;
  const presentation = locked ? lockedGapPresentation(offer, entry.gap) : null;

  // What the offer does, in one line — scope passed null on purpose: the
  // scoped ("only"/"except") name-list variants are deferred with the rest of
  // the hero treatment, and mechanicSpecFor falls back to the base lines.
  const mechanicCopy = (): string => {
    const spec = mechanicSpecFor(offer, getOfferMechanic(offer), null);
    if (!spec) return "";
    switch (spec.code) {
      case "percentCompleteCapped":
        return t("offers.mechPercentCompleteCapped", {
          value: spec.value,
          max: money(currency, spec.cap),
        });
      case "percentComplete":
        return t("offers.mechPercentComplete", { value: spec.value });
      case "amountComplete":
        return t("offers.mechAmountComplete", {
          amount: money(currency, spec.value),
        });
      case "percentItemsScoped":
      case "percentItems":
        return t("offers.mechPercentItems", { value: spec.value });
      case "amountItemsScoped":
      case "amountItems":
        return t("offers.mechAmountItems", {
          amount: money(currency, spec.value),
        });
      case "leastValueOne":
        return t("offers.mechLeastValueOne", { buy: spec.buy });
      case "leastValueOther":
        return t("offers.mechLeastValueOther", {
          buy: spec.buy,
          get: spec.get,
        });
      case "groupWise":
        return t("offers.mechGroupWise", { count: spec.count });
      case "freeItem":
        return t("offers.mechFreeItem");
      case "bogo":
      default:
        return t("offers.mechBogo");
    }
  };

  const secondLine = ((): string => {
    if (gone) return t("offers.unavailable");
    if (locked && presentation) {
      if (presentation.labelKind === "bogoBuySide") {
        return t("offers.lockedBogoBuySide");
      }
      if (presentation.labelKind === "itemCriteria") {
        return t("offers.lockedItemCriteria");
      }
      if (presentation.labelKind === "generic") {
        return t("offers.lockedGeneric");
      }
      // minBill / minItems: the gap copy rides the pink nudge — this slot
      // keeps the mechanic line (the mock's expiry slot, adapted).
      return mechanicCopy();
    }
    const savingAmount = Number(entry.saving?.amount ?? 0);
    if (savingAmount > 0) {
      const amount = money(currency, savingAmount);
      return entry.saving?.certainty === "upTo"
        ? t("offers.saveUpTo", { amount })
        : t("offers.save", { amount });
    }
    return mechanicCopy();
  })();

  const nudge = ((): string | null => {
    if (blocked || !locked || !presentation) return null;
    if (presentation.labelKind === "minBill" && presentation.short > 0) {
      return t("offers.addNudge", {
        amount: money(currency, presentation.short),
      });
    }
    if (presentation.labelKind === "minItems" && presentation.short > 0) {
      return t("offers.addNudgeItems", { count: presentation.short });
    }
    return null;
  })();

  const showAddItems =
    !blocked && !!onAddItems && presentation?.labelKind === "bogoBuySide";

  const inner = (
    <>
      {/* 152px plate — grey plate + tinted bell placeholder (photos deferred). */}
      <span className="flex h-[152px] w-[152px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-tb-grey-6">
        <span
          aria-hidden="true"
          className="h-[64px] w-[72px] bg-tb-purple opacity-25"
          style={bellMaskStyle}
        />
      </span>

      <span className="flex min-w-0 flex-1 flex-col items-start gap-[10px] text-left">
        <span className="flex flex-wrap items-center gap-[12px]">
          <span
            className={`text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black ${
              gone ? "line-through" : ""
            }`}
          >
            {offer?.name}
          </span>
          {applied && (
            <span className="rounded-full bg-tb-purple px-[12px] py-[4px] text-[14px] font-bold uppercase leading-[16px] text-tb-surface">
              {t("offers.applied")}
            </span>
          )}
        </span>
        {secondLine && (
          // dir="auto" on this LEAF only (never a container): a wrapped
          // Arabic line right-aligns; text-start because the parent sets
          // physical text-left.
          <span
            dir="auto"
            className="text-start text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple"
          >
            {secondLine}
          </span>
        )}
      </span>

      {nudge ? (
        // A wrapping LEAF (P9f rule): start-aligned like Figma 1:3824 in
        // English; an Arabic nudge resolves RTL and right-aligns.
        <span
          data-testid={`offer-row-nudge-${id}`}
          dir="auto"
          className="w-[206px] shrink-0 pt-[48px] text-start text-[24px] leading-[24px] tracking-[-0.12px] text-tb-pink-dark"
        >
          {nudge}
        </span>
      ) : showAddItems ? (
        // A sibling of the row's text inside a div — never a nested button.
        <button
          type="button"
          data-testid={`offer-row-add-items-${id}`}
          disabled={disabled}
          onClick={onAddItems}
          className={`inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center px-[8px] text-[18px] font-bold tracking-[-0.08px] text-tb-purple underline ${
            disabled ? "opacity-40" : ""
          }`}
        >
          {t("offers.buyStage.addItems")}
        </button>
      ) : (
        entry.eligible &&
        !blocked && (
          <span
            data-testid={`offer-radio-${id}`}
            aria-hidden="true"
            className={`flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border-2 ${
              selected ? "border-tb-purple" : "border-[#b9b9b9]"
            }`}
          >
            {selected && (
              <span className="h-[20px] w-[20px] rounded-full bg-tb-purple" />
            )}
          </span>
        )
      )}
    </>
  );

  if (entry.eligible && !blocked) {
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-testid={`offer-row-${id}`}
        disabled={disabled}
        onClick={onPick}
        className={`flex min-h-[44px] w-full items-center gap-[24px] border-t border-tb-grey-4 pt-[23px] pb-[24px] text-left ${
          disabled ? "opacity-60" : ""
        }`}
      >
        {inner}
      </button>
    );
  }

  // Locked / gone / D3-blocked rows are informational, never targets — a
  // div, not a disabled button (nothing to press, nothing to announce as
  // pressable). A bogoBuySide row's ADD ITEMS is its own button inside the
  // div. Gone and blocked rows are inactive (aria-disabled, dimmed — exempt
  // from WCAG 1.4.3).
  const inactive = gone || blocked;
  return (
    <div
      data-testid={`offer-row-${id}`}
      aria-disabled={inactive ? "true" : undefined}
      className={`flex w-full ${locked && !blocked ? "items-start" : "items-center"} gap-[24px] border-t border-tb-grey-4 pt-[23px] pb-[24px] ${
        inactive ? "opacity-50" : ""
      }`}
    >
      {inner}
    </div>
  );
}
