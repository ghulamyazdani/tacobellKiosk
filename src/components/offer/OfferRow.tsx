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
}

const money = (currency: string, value: number): string =>
  `${currency}${Number(value).toFixed(2)}`;

/**
 * Offer photos are DEFERRED in P7b (resolveLivePhotoUrl not wired), so the
 * 84px thumb renders the brand bell, purple-tinted via CSS mask, as a
 * placeholder over the grey plate.
 */
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
    if (!locked || !presentation) return null;
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

  const inner = (
    <>
      {/* 84px thumb — grey plate + tinted bell placeholder (photos deferred). */}
      <span className="flex h-[84px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-tb-grey-6">
        <span
          aria-hidden="true"
          className="h-[40px] w-[45px] bg-tb-purple opacity-25"
          style={bellMaskStyle}
        />
      </span>

      <span className="flex min-w-0 flex-1 flex-col items-start gap-[8px] text-left">
        <span className="flex flex-wrap items-center gap-[12px]">
          <span
            className={`text-[24px] font-bold leading-[28px] tracking-[-0.5px] text-black ${
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
            className="text-start text-[20px] leading-[24px] text-tb-ink-purple/70"
          >
            {secondLine}
          </span>
        )}
      </span>

      {nudge ? (
        <span
          data-testid={`offer-row-nudge-${id}`}
          className="w-[240px] shrink-0 text-right text-[18px] font-medium leading-[22px] text-tb-pink-dark"
        >
          {nudge}
        </span>
      ) : (
        entry.eligible && (
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

  if (entry.eligible) {
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-testid={`offer-row-${id}`}
        disabled={disabled}
        onClick={onPick}
        className={`flex min-h-[44px] w-full items-center gap-[24px] border-b border-tb-grey-4 py-[24px] text-left ${
          disabled ? "opacity-60" : ""
        }`}
      >
        {inner}
      </button>
    );
  }

  // Locked / gone rows are informational, never targets — a div, not a
  // disabled button (nothing to press, nothing to announce as pressable).
  return (
    <div
      data-testid={`offer-row-${id}`}
      aria-disabled={gone ? "true" : undefined}
      className={`flex w-full items-center gap-[24px] border-b border-tb-grey-4 py-[24px] ${
        gone ? "opacity-50" : ""
      }`}
    >
      {inner}
    </div>
  );
}
