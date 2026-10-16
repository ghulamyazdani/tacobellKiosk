import { memo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { resolveEntityImage } from "../../utils/entityImage";
import { formatPrice } from "../../utils/price";
import useLocalized from "../../hooks/utils/useLocalized";
import NoImageBell from "../common/NoImageBell";
import VegMark from "./VegMark";
import plusIcon from "../../assets/icons/plus.svg";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Entities flow through untyped from the legacy menu converters; typed with
 * the SDK menu types in the P6 customization pass. Do not add NEW anys.
 */

interface MenuItemCardProps {
  entity: any;
  currency: string;
  onOpen: (entity: any) => void;
  onQuickAdd: (entity: any) => void;
}

/** The fields formatMenuPriceLine reads off a menu entity. */
type PriceLineEntity = {
  price?: unknown;
  calorieCount?: unknown;
  nutritionalInfo?: { calorieCount?: unknown };
} | null | undefined;

/**
 * "£5.59 | 360 Cal" — the menu card's price line, shared with the
 * product-added tiles (Figma 1:2609 / 1:4589). The price as posistKiosk
 * prints it (formatPrice: "£100", "£5.50"); the calories only when > 0
 * (every reference entity carries 0).
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with ProductAddedModal; HMR falls back to a reload for this file
export function formatMenuPriceLine(entity: unknown, currency: string, t: TFunction): string {
  const item = entity as PriceLineEntity;
  const cal = item?.calorieCount ?? item?.nutritionalInfo?.calorieCount;
  const value = typeof cal === "object" ? (cal as { value?: unknown } | null)?.value : cal;
  return `${currency}${formatPrice(item?.price)}${Number(value) > 0 ? ` | ${t("pack.cal", { value })}` : ""}`;
}

/**
 * Menu item card — Figma "Menu-Item", the 240px grid card (1:2609) for every
 * item. The arch-top hero (1:2597) that badged items used is retired (user
 * 2026-10-13: "it should be just like how it is in other item card").
 * Out-of-stock renders the UNAVAILABLE treatment and blocks interaction
 * (aria-disabled).
 *
 * The photo fills the card width at the frame's box height (172) with
 * `object-cover` (fork ItemImage parity; Figma's product scale) — the kiosk
 * images are squares, which `object-contain` shrank to a centred 65–72 %. Its
 * white background multiplies into the card grey (white × #F9F9F9 =
 * #F9F9F9: the frames' cut-out look); a transparent PNG is unaffected. Names
 * clamp at 2 lines so the photo keeps its height; the full
 * name stays the overlay button's accessible name and the PDP title (UB4).
 *
 * The price line leads with the veg / non-veg mark (audit-fixes U1; nothing
 * under `hide_veg_non_veg` or for an untagged item). The mark has no text
 * node, so the line's text is still the price.
 *
 * Overlay-button pattern: the card is a div (the quick-add button cannot
 * nest inside another button); a full-card button named by the item opens
 * it, and the quick-add sits above that overlay via z-10. The overlay stays a
 * DIRECT, empty child: tb-press-card squeezes the card while it is pressed
 * (`:has(> button:empty:active)`).
 */
function MenuItemCard({
  entity,
  currency,
  onOpen,
  onQuickAdd,
}: MenuItemCardProps) {
  const { t } = useTranslation();
  const { name } = useLocalized();
  const unavailable = entity?.outOfStock === true;
  const priceLine = formatMenuPriceLine(entity, currency, t);
  const imageUrl = resolveEntityImage(entity);

  return (
    <div
      data-testid={`item-${entity?.id}`}
      aria-disabled={unavailable ? "true" : undefined}
      className="tb-press-card relative flex h-[277px] w-full flex-col justify-between overflow-hidden rounded-[8px] bg-tb-grey-6"
    >
      <div className={`flex flex-col gap-[4px] pl-[24px] pr-[64px] pt-[24px] ${unavailable ? "opacity-40" : ""}`}>
        <p className="line-clamp-2 text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
          {name(entity)}
        </p>
        <p className="flex items-center gap-[8px] text-[18px] leading-[20px] text-tb-ink-purple">
          <VegMark entity={entity} />
          {priceLine}
        </p>
      </div>
      {imageUrl ? (
        <img
          alt=""
          src={imageUrl}
          className={`h-[172px] min-h-0 w-full object-cover mix-blend-multiply ${unavailable ? "opacity-40 grayscale" : ""}`}
        />
      ) : (
        <NoImageBell className={`h-[172px] min-h-0 w-full ${unavailable ? "opacity-40" : ""}`} />
      )}
      {!unavailable && (
        <button
          type="button"
          aria-label={name(entity)}
          onClick={() => onOpen(entity)}
          className="absolute inset-0"
        />
      )}
      {unavailable ? (
        <span className="tb-display absolute bottom-[16px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-tb-ink-purple/80 px-3 py-1.5 text-[14px] text-tb-surface">
          {t("menu.unavailable")}
        </span>
      ) : (
        <button
          type="button"
          aria-label={t("menu.quickAdd")}
          data-testid={`quick-add-${entity?.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onQuickAdd(entity);
          }}
          className="absolute right-[12px] top-[12px] z-10 flex h-[44px] w-[44px] items-center justify-center rounded-full bg-tb-surface shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)]"
        >
          <img alt="" src={plusIcon} className="h-[16px] w-[16px]" />
        </button>
      )}
    </div>
  );
}

/**
 * Memoized (perf MENU-1): Menu re-renders on every cart write, rail tap and
 * overlay toggle, the whole grid with it. The props do not move with those —
 * the entity from the memoized sellable menu, the currency string, Menu's two
 * stable handlers — so the cards skip. A language change (useTranslation,
 * useLocalized) and a stock change (a new entity object) still re-render one.
 */
export default memo(MenuItemCard);
