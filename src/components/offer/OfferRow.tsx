import { useId, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { RankedOffer } from "@cx-sdk/core/types/offer";
import {
  getOfferMechanic,
  type SavingsOffer,
} from "@cx-sdk/ordering/offer/offerSavings";
import { lockedGapPresentation } from "@cx-sdk/ordering/offer/offersSheetLogic";
import { mechanicSpecFor } from "@cx-sdk/ordering/offer/savingsLinePolicy";
import tbBell from "../../assets/brand/tb-bell.svg";
import useLineClamp from "../../hooks/utils/useLineClamp";

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
   * Buy-stage entry (offers lane, item 31). Only a LOCKED bogoBuySide or
   * minItems row renders it — as an ADD ITEMS text button in the nudge slot
   * (under the nudge on a minItems row, lane offers-parity); the sheet
   * passes it only when a buy stage can finish the offer. Every other locked
   * kind ignores it and stays informational.
   */
  onAddItems?: () => void;
  /**
   * Lane offers-parity (F3): the composed description (useOfferDescription)
   * under the second line — 2 lines + Show more / Show less (Figma 1:4034 /
   * 1:4069). The sheet never passes one to a gone row.
   */
  description?: string;
  /** An itemCriteria lock's scoped line ("Not valid on Beer"). */
  lockLine?: string;
  /**
   * D3 lock (a XENO reward in the bag, no offer applied): every row — also
   * an eligible one — renders the inert div, dimmed and aria-disabled, with
   * no radio, nudge, ADD ITEMS or Show more.
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
 *    the fork's instant tap): a full-row overlay (lane offers-parity D8);
 *    locked rows no radio; gone rows struck.
 *  - geometry (lane loyalty-visual D2, Figma 1:3842): hairline above each
 *    row inside the 24 top gap (pt-23), 152 plate, title 32/36, second line
 *    24/24; locked rows top-align with the nudge in a 206 column (D3-blocked
 *    rows show no nudge, so they centre like the rest).
 *  - lane offers-parity (Figma 1:4034 / 1:4069): the description under the
 *    second line, 2 lines + Show more / Show less — the row grows with it
 *    (194 collapsed / 346 expanded in the frame; no fixed pitch).
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
  description,
  lockLine,
}: OfferRowProps) {
  const { t } = useTranslation();
  // Ids the overlay radio and the toggle point at (aria-labelledby/-describedby/-controls).
  const uid = useId();
  const titleId = `${uid}-title`;
  const appliedId = `${uid}-applied`;
  const lineId = `${uid}-line`;
  const descId = `${uid}-desc`;

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
      // The scoped description names the items ("10% off everything except
      // Beer") — the second line and the description then agree.
      case "percentItemsScoped":
      case "percentItems":
        return description || t("offers.mechPercentItems", { value: spec.value });
      case "amountItemsScoped":
      case "amountItems":
        return (
          description ||
          t("offers.mechAmountItems", {
            amount: money(currency, spec.value),
          })
        );
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
        return lockLine || t("offers.lockedItemCriteria");
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
    !blocked &&
    !!onAddItems &&
    (presentation?.labelKind === "bogoBuySide" ||
      presentation?.labelKind === "minItems");

  // The description under the second line (lane offers-parity F3): the
  // composed text, else the mechanic line — never on a gone row, never a
  // repeat of the second line.
  const descText = gone ? "" : description || mechanicCopy();
  const showDesc = descText !== "" && descText !== secondLine;

  // Show more / Show less (CTA/Show more 1:1687): only when the COLLAPSED
  // block overflows (useLineClamp — shared with the PDP description).
  const {
    ref: descRef,
    expanded,
    setExpanded,
    clamped,
  } = useLineClamp<HTMLSpanElement>(showDesc ? descText : "");

  const addItemsButton = (
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
  );

  const nudgeLeaf = nudge ? (
    // A wrapping LEAF (P9f rule): start-aligned like Figma 1:3824 in
    // English; an Arabic nudge resolves RTL and right-aligns.
    <span
      data-testid={`offer-row-nudge-${id}`}
      dir="auto"
      className="w-[206px] shrink-0 pt-[48px] text-start text-[24px] leading-[24px] tracking-[-0.12px] text-tb-pink-dark"
    >
      {nudge}
    </span>
  ) : null;

  const inner = (
    <>
      {/* 152px plate — grey plate + tinted bell placeholder (photos deferred).
          Top-aligned when a description makes the text the taller column (1:4069). */}
      <span className="flex h-[152px] w-[152px] shrink-0 items-center justify-center self-start overflow-hidden rounded-[8px] bg-tb-grey-6">
        <span
          aria-hidden="true"
          className="h-[64px] w-[72px] bg-tb-purple opacity-25"
          style={bellMaskStyle}
        />
      </span>

      <span className="flex min-w-0 flex-1 flex-col items-start gap-[10px] text-left">
        <span className="flex flex-wrap items-center gap-[12px]">
          <span
            id={titleId}
            className={`text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black ${
              gone ? "line-through" : ""
            }`}
          >
            {offer?.name}
          </span>
          {applied && (
            <span
              id={appliedId}
              className="rounded-full bg-tb-purple px-[12px] py-[4px] text-[14px] font-bold uppercase leading-[16px] text-tb-surface"
            >
              {t("offers.applied")}
            </span>
          )}
        </span>
        {secondLine && (
          // dir="auto" on this LEAF only (never a container): a wrapped
          // Arabic line right-aligns; text-start because the parent sets
          // physical text-left.
          <span
            id={lineId}
            dir="auto"
            className="text-start text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple"
          >
            {secondLine}
          </span>
        )}
        {showDesc && (
          // Figma 1:4069 "Offer conditions": 24 below the title block (10 +
          // 14), Text/Small Rg 18/20 Grey 1, 498 wide, 8 above the toggle.
          <span className="mt-[14px] flex flex-col items-start gap-[8px]">
            {/* dir="auto" on this LEAF only: a wrapped Arabic description
                right-aligns; w-fit keeps a single line at the start edge. */}
            <span
              ref={descRef}
              id={descId}
              data-testid={`offer-row-desc-${id}`}
              dir="auto"
              className={`w-fit max-w-[498px] text-start text-[18px] leading-[20px] text-tb-grey-1 ${
                expanded ? "" : "line-clamp-2"
              }`}
            >
              {descText}
            </span>
            {clamped && !blocked && (
              // Above the eligible row's overlay radio (relative z-[1]), so a
              // toggle tap never selects; named apart from every other row's
              // "Show more" by the title (aria-describedby). A D3-blocked row
              // is dimmed and aria-disabled: no live control inside it — its
              // text stays clamped.
              <button
                type="button"
                data-testid={`offer-row-more-${id}`}
                aria-expanded={expanded}
                aria-controls={descId}
                aria-describedby={titleId}
                onClick={() => setExpanded((open) => !open)}
                className="tb-display relative z-[1] inline-flex min-h-[44px] min-w-[44px] items-center text-[16px] font-bold normal-case leading-[24px] tracking-[-0.08px] text-tb-purple underline"
              >
                {expanded ? t("pdp.showLess") : t("pdp.showMore")}
              </button>
            )}
          </span>
        )}
      </span>

      {nudgeLeaf && showAddItems ? (
        // A minItems lock a buy stage can finish: the nudge AND ADD ITEMS,
        // stacked in the 206 px column.
        <span className="flex w-[206px] shrink-0 flex-col items-start gap-[8px]">
          {nudgeLeaf}
          {addItemsButton}
        </span>
      ) : nudgeLeaf ? (
        nudgeLeaf
      ) : showAddItems ? (
        addItemsButton
      ) : (
        entry.eligible &&
        !blocked && (
          <span
            data-testid={`offer-radio-${id}`}
            aria-hidden="true"
            className={`flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border-2 ${
              selected ? "border-tb-purple" : "border-tb-grey-3"
            }`}
          >
            {selected && (
              <span className="tb-pop-in h-[20px] w-[20px] rounded-full bg-tb-purple" />
            )}
          </span>
        )
      )}
    </>
  );

  if (entry.eligible && !blocked) {
    // D8 overlay-radio pattern (BagSheet's applied row): the row is a div and
    // its LAST child a full-row radio — named by the title, described by the
    // Applied pill, the second line and the description — so nothing
    // interactive nests and the Show more toggle (relative z-[1]) sits above
    // it; a tap anywhere else on the row selects.
    const describedBy =
      [applied ? appliedId : "", secondLine ? lineId : "", showDesc ? descId : ""]
        .filter(Boolean)
        .join(" ") || undefined;
    return (
      <div
        data-testid={`offer-row-body-${id}`}
        className={`relative flex min-h-[44px] w-full items-center gap-[24px] border-t border-tb-grey-4 pt-[23px] pb-[24px] text-left ${
          disabled ? "opacity-60" : ""
        }`}
      >
        {inner}
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          aria-labelledby={titleId}
          aria-describedby={describedBy}
          data-testid={`offer-row-${id}`}
          disabled={disabled}
          onClick={onPick}
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }

  // Locked / gone / D3-blocked rows are informational, never targets — a
  // div, not a disabled button (nothing to press, nothing to announce as
  // pressable). ADD ITEMS and Show more are their own buttons inside the
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
