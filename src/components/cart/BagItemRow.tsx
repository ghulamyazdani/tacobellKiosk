/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart rows flow through untyped from the legacy cart slice/converters;
 * typed in the P7+ domain passes. Do not add NEW anys.
 */
import { useTranslation } from "react-i18next";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import { resolveEntityImage } from "../../utils/entityImage";
import plusIcon from "../../assets/icons/plus.svg";

interface BagItemRowProps {
  row: any;
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
  currency,
  onEdit,
  onRequestRemove,
  onRemoveLoyalty,
}: BagItemRowProps) {
  const { t } = useTranslation();
  const { IncreaseItemQuantityById, decreaseItemQuantityById, getAllCustomizationList } =
    useCartHook();

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

  // Branch table: the reward is removable ONLY once the kitchen can no longer
  // serve it. Everything else is reversed by the bag's auto-reversal effect.
  const canRemoveLoyalty =
    isLoyaltyRow && Boolean(row?.outOfStock || row?.isAvailable === false);

  const canIncrease = !(row?.outOfStock || row?.isAvailable === false);
  const canEdit =
    isPaidRow &&
    !row?.outOfStock &&
    row?.isAvailable !== false &&
    row?.type !== "ITEM";

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

  // "{qty} x Name +£0.60" — price suffix only when > 0, qty prefix only
  // when !== 1 (contract A2). Render helper, NOT a component.
  const renderLine = (line: any, nested = false) => {
    const price = Number(line?.price ?? 0);
    const prefix =
      line?.quantity !== 1 ? `${t("bag.lineQty", { qty: line?.quantity })} ` : "";
    const suffix = price > 0 ? ` +${currency}${price.toFixed(2)}` : "";
    return (
      <p
        key={`${nested ? "sub-" : ""}${line?.id ?? line?.name}`}
        className={nested ? "pl-[24px]" : ""}
      >
        {prefix}
        {line?.name}
        {suffix}
      </p>
    );
  };

  return (
    <div
      data-testid={
        isLoyaltyRow ? `bag-loyalty-row-${row?.itemId}` : `bag-row-${row?.itemId}`
      }
      className="flex w-full items-start gap-[24px] border-t border-tb-grey-4 py-[24px]"
    >
      {imageUrl ? (
        <img
          alt=""
          src={imageUrl}
          className="h-[152px] w-[152px] shrink-0 rounded-[8px] bg-tb-grey-6 object-contain"
        />
      ) : (
        <span className="h-[152px] w-[152px] shrink-0 rounded-[8px] bg-tb-grey-6" />
      )}

      <div className="flex min-w-0 flex-1 flex-col items-start gap-[10px]">
        <div className="flex flex-wrap items-center gap-[12px]">
          <p className="text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black">
            {row?.name}
          </p>
          {isGetItemRow && (
            <span
              data-testid={`bag-free-chip-${row?.itemId}`}
              className="rounded-full bg-tb-purple px-[12px] py-[4px] text-[14px] font-bold uppercase leading-[16px] text-tb-surface"
            >
              {freebieChipLabel()}
            </span>
          )}
          {isLoyaltyRow && (
            <span
              data-testid={`bag-loyalty-chip-${row?.itemId}`}
              className="rounded-full bg-tb-purple px-[12px] py-[4px] text-[14px] font-bold uppercase leading-[16px] text-tb-surface"
            >
              {loyaltyChipLabel()}
            </span>
          )}
        </div>
        {(row?.type === "VARIANT" || lines.length > 0) && (
          <div className="flex flex-col gap-[4px] text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple">
            {row?.type === "VARIANT" && row?.selectedVariant?.name && (
              <p>{row.selectedVariant.name}</p>
            )}
            {lines.map((line: any) => [
              renderLine(line),
              ...(Array.isArray(line?.customizations)
                ? line.customizations.map((sub: any) => renderLine(sub, true))
                : []),
            ])}
          </div>
        )}
        {canEdit && (
          <button
            type="button"
            data-testid={`bag-edit-${row?.itemId}`}
            onClick={() => onEdit(row)}
            className="-ml-[8px] inline-flex min-h-[44px] min-w-[44px] items-center px-[8px] text-[16px] font-bold tracking-[-0.08px] text-tb-purple underline"
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
        {/* Discounted-price column, shared by freebie and reward rows: the
            struck undiscounted line above the live one. A reward carries no
            `discounted_total_price`, so `discountedLine` falls back to the
            already-discounted `total_price` — exactly the fork's pair
            (undiscounted_total_price struck, total_price live). */}
        {isGetItemRow || isLoyaltyRow ? (
          <div className="flex flex-col items-end gap-[8px]">
            {undiscountedLine > discountedLine && (
              <p className="text-[24px] leading-[28px] text-tb-ink-purple/60 line-through">
                {currency}
                {undiscountedLine.toFixed(2)}
              </p>
            )}
            <p className="text-[32px] font-medium leading-[36px] tracking-[-1px] text-black">
              {currency}
              {discountedLine.toFixed(2)}
            </p>
          </div>
        ) : (
          <p className="text-[32px] font-medium leading-[36px] tracking-[-1px] text-black">
            {currency}
            {lineTotal.toFixed(2)}
          </p>
        )}
        {isPaidRow && (
          <div className="flex h-[68px] w-[188px] items-center justify-between rounded-full border-[1.72px] border-[#b9b9b9] bg-tb-surface px-[10px]">
            <button
              type="button"
              data-testid={`bag-dec-${row?.itemId}`}
              aria-label={t("bag.decrease")}
              onClick={handleDecrease}
              className="flex h-[44px] w-[44px] items-center justify-center text-tb-purple"
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
            <p className="text-[20px] font-black leading-[16px] text-black">{quantity}</p>
            <button
              type="button"
              data-testid={`bag-inc-${row?.itemId}`}
              aria-label={t("bag.increase")}
              aria-disabled={!canIncrease}
              onClick={handleIncrease}
              className={`flex h-[44px] w-[44px] items-center justify-center ${
                canIncrease ? "" : "opacity-40"
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
