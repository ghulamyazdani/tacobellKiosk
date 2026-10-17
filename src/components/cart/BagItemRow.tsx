/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart rows flow through untyped from the legacy cart slice/converters;
 * typed in the P7+ domain passes. Do not add NEW anys.
 */
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import {
  selectMinMaxErroredBaseItems,
  selectUpdatedBaseItems,
} from "@cx-sdk/catalog/state/Menu.slice";
import { computeShowAddonPrices } from "@cx-sdk/ordering/customization/nestedCardLogic";
import { flaggedPicks } from "@cx-sdk/catalog/oos/optionStock";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import { resolveEntityImage } from "../../utils/entityImage";
import useLocalized from "../../hooks/utils/useLocalized";
import VegMark from "../menu/VegMark";
import NoImageBell from "../common/NoImageBell";
import plusIcon from "../../assets/icons/plus.svg";
import type { LeastValueGrant } from "./leastValueGrants";

/** The bag's offer chip: freebie, reward and least-value rows wear the same pill. */
const CHIP =
  "rounded-full bg-tb-purple px-[12px] py-[4px] text-[14px] font-bold uppercase leading-[16px] text-tb-surface";

/** The stock / schedule flags PAY writes onto a cart row. */
interface StockFlags {
  outOfStock?: unknown;
  isAvailable?: unknown;
  selectedVariant?: { outOfStock?: unknown } | null;
}

/**
 * A row the kitchen cannot serve right now: out of stock (the base item or
 * its size — PAY's stock re-check, A1) or outside its schedule. BagSheet's
 * write-back reads the same rule for a stale flag.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with BagSheet's PAY write-back; HMR falls back to a reload for this file
export const isRowUnavailable = (row: unknown): boolean => {
  const flags = (row ?? {}) as StockFlags;
  return Boolean(
    flags.outOfStock ||
      flags.selectedVariant?.outOfStock ||
      flags.isAvailable === false,
  );
};

/** Menu.slice's PAY lists (never persisted; the next PAY rewrites them). */
const asIdList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * "A, B and C" in the guest's language (Intl.ListFormat), each name once; an
 * unknown locale tag falls back to commas. Shared with BagSheet's PAY notice.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with BagSheet's PAY notice; HMR falls back to a reload for this file
export const joinNames = (names: readonly string[], language: string): string => {
  const unique = [...new Set(names.filter(Boolean))];
  try {
    return new Intl.ListFormat(language, { type: "conjunction" }).format(unique);
  } catch {
    return unique.join(", ");
  }
};

/**
 * What rows flag out of stock, by name: the item, the item (its size), or
 * each pick PAY kept, flagged (walk-oos). BagSheet's PAY notice — and PAY's
 * verdict when its check cannot run: those flags still stand (review F1).
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with BagSheet's PAY; HMR falls back to a reload for this file
export const soldOutNames = (rows: readonly unknown[], name: (entity: unknown) => string): string[] =>
  rows.flatMap((entry) => {
    const row = (entry ?? {}) as StockFlags & { customizations?: unknown };
    if (row.outOfStock) return [name(row)];
    if (row.selectedVariant?.outOfStock) return [`${name(row)} (${name(row.selectedVariant)})`];
    return flaggedPicks(row.customizations).map((pick) => name(pick));
  });

interface BagItemRowProps {
  row: any;
  /** Motion §3.3: a row ADDED while the bag is open rises in (BagSheet decides). */
  rise?: boolean;
  currency: string;
  /** Edit-from-bag: BagSheet owns the full contract-B1 dispatch recipe. */
  onEdit: (row: any) => void;
  /**
   * Decrease at qty 1 would delete the row — intercept with the REMOVE ITEM
   * confirm (TB divergence from the fork, per Figma 1:4533).
   */
  onRequestRemove: (row: any) => void;
  /**
   * P7c — a XENO loyalty reward row is removable ONLY while it is
   * out-of-stock / unavailable (contract branch table). BagSheet owns the
   * reversal recipe (remove + refund "Points Value" + revoke); optional so
   * the row stays renderable on its own.
   */
  onRemoveLoyalty?: (row: any) => void;
  /**
   * Lane bag-ribbon: the applied least-value offer's grant on this paid row
   * (BagSheet reads it off the bill) — the chip and the struck line price.
   */
  leastValue?: LeastValueGrant;
}

/**
 * One My Bag row — Figma "Bag Bottom Sheet" cards (1:3193/1:3194): 152px
 * thumb, 32px medium name, 24px customization lines ("Add Onions +£0.60",
 * "No Lettuce"), purple underlined Edit, right column line total over the
 * outlined − n + stepper pill.
 *
 * Mutations go through useCartHook (Dexie mirror + cart_modified analytics
 * live inside the hook — contract A2; never duplicated here). Fork parity:
 * steppers dispatch with ("ITEM", "itemId") — resolveCartIdKey keeps the
 * caller's idKey for ITEM, so every row type addresses by itemId.
 *
 * P7c adds the XENO loyalty reward treatment (locked decision 6): a reward is
 * an ORDINARY cart row, not a bag "Rewards" entry — Free / "{v}% off" chip,
 * struck undiscounted line over the live total, no stepper, no Edit, and a
 * Remove link only while the reward is out-of-stock / unavailable. The root
 * testid switches to `bag-loyalty-row-<itemId>` for those rows so the loyalty
 * spec can address them without disturbing the `bag-row-` row counters the
 * existing bag/offers specs use.
 */
export default function BagItemRow({
  row,
  rise = false,
  currency,
  onEdit,
  onRequestRemove,
  onRemoveLoyalty,
  leastValue,
}: BagItemRowProps) {
  const { t, i18n } = useTranslation();
  const { name } = useLocalized();
  const { IncreaseItemQuantityById, decreaseItemQuantityById, getAllCustomizationList } =
    useCartHook();
  const updatedBaseItems = asIdList(useSelector(selectUpdatedBaseItems));
  const minMaxErroredBaseItems = asIdList(useSelector(selectMinMaxErroredBaseItems));

  const lines: any[] = getAllCustomizationList(row?.customizations) ?? [];
  // A cart row is the menu entity spread into the row, so `aggregator_image`
  // rides along and the kiosk image resolves straight off the row.
  const imageUrl = resolveEntityImage(row);
  const quantity = Number(row?.quantity ?? 0);
  const lineTotal = Number(row?.total_price ?? 0) * quantity;

  // Contract A2/B1 guards. `isPaidRow` is what suppresses BOTH the stepper
  // and the Edit link for a loyalty reward — a reward is quantity-locked to 1
  // and its configuration is what the partner priced, so neither affordance
  // may appear (P7c contract step 7; no extra guard needed below).
  const isPaidRow = !row?.isLoyaltyItem && !row?.isGetItem;

  // P7b freebie rows (committed get-items — redeemGetItem stamps
  // isGetItem:true, discountType/discountValue, discounted_/undiscounted_
  // total_price; total_price itself stays UNDISCOUNTED): no stepper (isPaidRow
  // already false), a Free/X%-off chip, and the discounted price with the
  // undiscounted one struck through when greater (contract).
  const isGetItemRow = Boolean(row?.isGetItem);
  // No stepper on a reward row, so its units lead the name — the picker's
  // "2 x" (walk 2026-10-14: two units read as one beside their line price).
  const rewardUnits =
    isGetItemRow && quantity > 1 ? `${t("bag.lineQty", { qty: quantity })} ` : "";
  const undiscountedLine =
    Number(row?.undiscounted_total_price ?? row?.total_price ?? 0) * quantity;
  const discountedLine =
    Number(row?.discounted_total_price ?? row?.total_price ?? 0) * quantity;

  const freebieChipLabel = (): string => {
    if (row?.discountType === "percent") {
      return Number(row?.discountValue) >= 100
        ? t("offers.free")
        : t("offers.percentOff", { value: row?.discountValue });
    }
    return t("offers.amountOff", {
      amount: `${currency}${Number(row?.discountValue ?? 0).toFixed(2)}`,
    });
  };

  // P7c XENO reward row (contract step 7 / fork CartItem.tsx:317, :524-560,
  // :641-659). The row arrives from redeemItem(): `isLoyaltyItem` + the
  // coupon's snake_case `discount_type` / `discount_value` (NOT the get-item
  // camelCase pair), `undiscounted_total_price` preserved and `total_price`
  // already discounted. Quantity is always 1.
  const isLoyaltyRow = Boolean(row?.isLoyaltyItem);

  // Free at a full percentage discount, "{v}% off" below it. redeemItem only
  // discounts `discount_type === "percentage"`, so any other coupon type
  // leaves the price untouched and keeps the fork ribbon's blanket "Free".
  const loyaltyChipLabel = (): string =>
    row?.discount_type === "percentage" && Number(row?.discount_value) < 100
      ? t("loyalty.percentOff", { value: row?.discount_value })
      : t("loyalty.free");

  // posistKiosk's least-value ribbon wording (CartItem.tsx:319-337, and
  // QuickAccessItem): the whole row "Free", some units "{n} Free"; below
  // 100 % "{v}% off", some units "{v}% off ×{n}". ONE chip per row — the
  // quantity never splits.
  const leastChipLabel = ({ units, percent }: LeastValueGrant): string => {
    const wholeRow = units >= quantity;
    if (percent === 100) return wholeRow ? t("offers.free") : t("offers.unitsFree", { units });
    return wholeRow
      ? t("offers.percentOff", { value: percent })
      : t("offers.percentOffUnits", { value: percent, units });
  };
  // The struck pair: a freebie / reward row's own undiscounted → discounted
  // line; a paid row's line → that line less what the least-value offer
  // saves on it (the bill's figure — its add-ons stay charged), never below
  // £0 (posistKiosk's floor: an offer over 100 % saves more than the line).
  const leastSaving = leastValue?.saving ?? 0;
  const struckLine = isPaidRow ? lineTotal : undiscountedLine;
  const liveLine = isPaidRow ? Math.max(0, lineTotal - leastSaving) : discountedLine;

  // A1 looks (design language, sign-off): unavailable = loyalty-visual's
  // 1:3858 ineligible look (art 50 % + "Unavailable"); a row PAY found with
  // a lost or invalid pick gets one red line and keeps Edit to fix it. Their
  // testids never start "bag-row-": the specs count rows by that prefix.
  const unavailable = isRowUnavailable(row);
  // walk-oos: the picks PAY found out of stock stay in the row, flagged
  // (persisted with it, so a reload keeps them), and the red line names them.
  const soldOutPicks = flaggedPicks(row?.customizations);
  const soldOutIds = new Set(soldOutPicks.map((pick) => pick.id));
  const flaggedByPay =
    updatedBaseItems.includes(row?.itemId) ||
    minMaxErroredBaseItems.includes(row?.itemId) ||
    soldOutPicks.length > 0;
  const needsChanges = !unavailable && flaggedByPay;

  // Branch table: the reward is removable ONLY once the kitchen can no longer
  // serve it — out of stock / unavailable, or PAY found a lost pick (the
  // fork's updatedBaseItems leg, CartItem.tsx:640-644) or a broken group. A
  // reward has no Edit, so Remove is its only way out of a blocked PAY
  // (Rule 1). Everything else is reversed by the bag's auto-reversal effect.
  const canRemoveLoyalty = isLoyaltyRow && (unavailable || flaggedByPay);

  // The affordances follow the look: an Unavailable row (a sold-out size
  // included) takes no "+" and offers no Edit — only − / remove.
  const canIncrease = !unavailable;
  const canEdit = isPaidRow && !unavailable && row?.type !== "ITEM";

  const handleIncrease = () => {
    if (!canIncrease) return;
    IncreaseItemQuantityById(row?.itemId, "ITEM", "itemId", row);
  };

  const handleDecrease = () => {
    if (quantity <= 1) {
      onRequestRemove(row);
      return;
    }
    decreaseItemQuantityById(row?.itemId, "ITEM", "itemId");
  };

  // An add-on's OWN picks (the nested lines) are charged only under the
  // row's truthy applyAddonsPrice (pricing / orderBuilder), so their "+£"
  // shows only then — the fork's display rule, computeShowAddonPrices (lane
  // addon-customize). The add-on's own line is always charged.
  const nestedPriced = Boolean(computeShowAddonPrices(true, row));

  // "{qty} x Name +£0.60" — price suffix only when > 0, qty prefix only
  // when !== 1 (contract A2). Render helper, NOT a component.
  const renderLine = (line: any, nested = false) => {
    const price = Number(line?.price ?? 0);
    const prefix =
      line?.quantity !== 1 ? `${t("bag.lineQty", { qty: line?.quantity })} ` : "";
    const suffix =
      price > 0 && (!nested || nestedPriced) ? ` +${currency}${price.toFixed(2)}` : "";
    // walk-oos: a pick PAY found out of stock reads red (the line above names it).
    const soldOut = soldOutIds.has(line?.id);
    return (
      <p
        key={`${nested ? "sub-" : ""}${line?.id ?? line?.name}`}
        data-testid={soldOut ? `bag-pick-oos-${row?.itemId}-${line?.id}` : undefined}
        className={[nested && "pl-[24px]", soldOut && "text-tb-red"].filter(Boolean).join(" ")}
      >
        {prefix}
        {name(line)}
        {suffix}
      </p>
    );
  };

  return (
    <div
      data-testid={
        isLoyaltyRow ? `bag-loyalty-row-${row?.itemId}` : `bag-row-${row?.itemId}`
      }
      className={`flex w-full items-start gap-[24px] border-t border-tb-grey-4 py-[24px] ${rise ? "tb-rise" : ""}`}
    >
      {imageUrl ? (
        <img
          alt=""
          src={imageUrl}
          className={`h-[152px] w-[152px] shrink-0 rounded-[8px] bg-tb-grey-6 object-contain${
            unavailable ? " opacity-50" : ""
          }`}
        />
      ) : (
        <NoImageBell
          className={`h-[152px] w-[152px] shrink-0 rounded-[8px] bg-tb-grey-6${
            unavailable ? " opacity-50" : ""
          }`}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col items-start gap-[10px]">
        <div className="flex flex-wrap items-center gap-[12px]">
          {/* The mark and the name share a NON-wrapping line: in the
              flex-wrap row a name wider than the column dropped below the
              mark and left it alone on its own line. mt 6 = (36 − 24) / 2
              centres it on the name's first line. */}
          <div className="flex min-w-0 items-start gap-[12px]">
            <VegMark entity={row} size={24} className="mt-[6px]" />
            <p className="min-w-0 text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black">
              {rewardUnits}
              {name(row)}
            </p>
          </div>
          {isGetItemRow && (
            <span data-testid={`bag-free-chip-${row?.itemId}`} className={CHIP}>
              {freebieChipLabel()}
            </span>
          )}
          {isLoyaltyRow && (
            <span data-testid={`bag-loyalty-chip-${row?.itemId}`} className={CHIP}>
              {loyaltyChipLabel()}
            </span>
          )}
          {leastValue && (
            <span data-testid={`bag-least-chip-${row?.itemId}`} className={CHIP}>
              {leastChipLabel(leastValue)}
            </span>
          )}
        </div>
        {unavailable && (
          <p
            data-testid={`bag-unavailable-${row?.itemId}`}
            className="text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple"
          >
            {t("menu.unavailable")}
          </p>
        )}
        {needsChanges && (
          <p
            data-testid={`bag-changed-${row?.itemId}`}
            className="text-[24px] leading-[24px] tracking-[-0.12px] text-tb-red"
          >
            {soldOutPicks.length > 0
              ? t("bag.outOfStock", {
                  names: joinNames(soldOutPicks.map((pick) => name(pick)), i18n.language),
                })
              : t("bag.choicesUnavailable")}
          </p>
        )}
        {(row?.type === "VARIANT" || lines.length > 0) && (
          <div className="flex flex-col gap-[4px] text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple">
            {row?.type === "VARIANT" && row?.selectedVariant?.name && (
              <p>{name(row.selectedVariant)}</p>
            )}
            {lines.map((line: any) => [
              renderLine(line),
              ...(Array.isArray(line?.customizations)
                ? line.customizations.map((sub: any) => renderLine(sub, true))
                : []),
            ])}
          </div>
        )}
        {/* CTA/Show more (verified 1:3193): Exp Bd 16/24, −0.08, #501098,
            underline — font-bold wins over .tb-display's 900 (@layer). */}
        {canEdit && (
          <button
            type="button"
            data-testid={`bag-edit-${row?.itemId}`}
            onClick={() => onEdit(row)}
            className="tb-display -ml-[8px] inline-flex min-h-[44px] min-w-[44px] items-center px-[8px] text-[16px] font-bold normal-case leading-[24px] tracking-[-0.08px] text-tb-purple underline"
          >
            {t("bag.edit")}
          </button>
        )}
        {canRemoveLoyalty && (
          <button
            type="button"
            data-testid={`bag-loyalty-remove-${row?.itemId}`}
            onClick={() => onRemoveLoyalty?.(row)}
            className="-ml-[8px] inline-flex min-h-[44px] min-w-[44px] items-center px-[8px] text-[16px] font-bold tracking-[-0.08px] text-tb-red underline"
          >
            {t("loyalty.remove")}
          </button>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center gap-[24px]">
        {/* The price column: the struck line above the live one whenever
            the row is discounted (freebie, reward and least-value rows). A
            reward carries no `discounted_total_price`, so `discountedLine`
            falls back to the already-discounted `total_price` — exactly the
            fork's pair (undiscounted_total_price struck, total_price live). */}
        <div className="flex flex-col items-end gap-[8px]">
          {struckLine > liveLine && (
            <p
              data-testid={`bag-was-${row?.itemId}`}
              className="text-[24px] leading-[28px] text-tb-ink-purple/60 line-through"
            >
              {currency}
              {struckLine.toFixed(2)}
            </p>
          )}
          <p
            data-testid={`bag-price-${row?.itemId}`}
            className="text-[32px] font-medium leading-[36px] tracking-[-1px] text-black"
          >
            {currency}
            {liveLine.toFixed(2)}
          </p>
        </div>
        {isPaidRow && (
          <div className="flex h-[68px] w-[188px] items-center justify-between rounded-full border-[1.72px] border-tb-grey-3 bg-tb-surface px-[10px]">
            <button
              type="button"
              data-testid={`bag-dec-${row?.itemId}`}
              aria-label={t("bag.decrease")}
              onClick={handleDecrease}
              // rounded-full bg-tb-surface: white on the white pill at rest; a lilac disc at touch-down (UX-12).
              className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-tb-surface text-tb-purple"
            >
              {/* Minus glyph (Figma icon 3601ce08) inlined — no committed minus.svg yet. */}
              <svg viewBox="0 0 24 24" className="h-[24px] w-[24px]" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M2.5 12C2.5 11.1716 3.17157 10.5 4 10.5L20 10.5C20.8284 10.5 21.5 11.1716 21.5 12C21.5 12.8284 20.8284 13.5 20 13.5L4 13.5C3.17157 13.5 2.5 12.8284 2.5 12Z"
                  fill="currentColor"
                />
              </svg>
            </button>
            <p key={quantity} className="tb-bump text-[20px] font-black leading-[16px] text-black">{quantity}</p>
            <button
              type="button"
              data-testid={`bag-inc-${row?.itemId}`}
              aria-label={t("bag.increase")}
              aria-disabled={!canIncrease}
              onClick={handleIncrease}
              className={`flex h-[44px] w-[44px] items-center justify-center rounded-full ${
                canIncrease ? "bg-tb-surface" : "opacity-40"
              }`}
            >
              <img alt="" src={plusIcon} className="h-[24px] w-[24px]" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
