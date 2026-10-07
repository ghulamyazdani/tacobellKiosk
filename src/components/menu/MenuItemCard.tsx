import { useTranslation } from "react-i18next";
import { resolveEntityImage } from "../../utils/entityImage";
import plusIcon from "../../assets/icons/plus.svg";

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Entities flow through untyped from the legacy menu converters; typed with
 * the SDK menu types in the P6 customization pass. Do not add NEW anys.
 */

interface MenuItemCardProps {
  entity: any;
  currency: string;
  large?: boolean;
  onOpen: (entity: any) => void;
  onQuickAdd: (entity: any) => void;
}

const isNew = (entity: any): boolean =>
  Array.isArray(entity?.badges) &&
  entity.badges.some((b: any) => /new/i.test(b?.name ?? b ?? ""));

/**
 * Menu item card — Figma "Menu-Item". `large` renders the arch-top hero
 * (504px, promo/NEW items); default is the 240px grid card. Out-of-stock
 * renders the UNAVAILABLE treatment and blocks interaction (aria-disabled).
 *
 * Overlay-button pattern: the card is a div (the quick-add button cannot
 * nest inside another button); a full-card button named by the item opens
 * it, and the quick-add sits above that overlay via z-10.
 */
export default function MenuItemCard({
  entity,
  currency,
  large = false,
  onOpen,
  onQuickAdd,
}: MenuItemCardProps) {
  const { t } = useTranslation();
  const unavailable = entity?.outOfStock === true;
  const cal = entity?.calorieCount ?? entity?.nutritionalInfo?.calorieCount;
  const value = typeof cal === "object" ? cal?.value : cal;
  const priceLine = `${currency}${entity?.price ?? ""}${
    value ? ` | ${t("pack.cal", { value })}` : ""
  }`;
  const imageUrl = resolveEntityImage(entity);

  if (large) {
    return (
      <div
        data-testid={`item-${entity?.id}`}
        aria-disabled={unavailable ? "true" : undefined}
        className="relative col-span-2 flex h-[578px] w-full flex-col items-center justify-between overflow-hidden rounded-b-[8px] rounded-t-[500px] bg-tb-grey-6 pt-[48px]"
      >
        <div className={`flex flex-col items-center gap-[16px] ${unavailable ? "opacity-40" : ""}`}>
          {isNew(entity) && (
            <span className="tb-compressed bg-tb-yellow px-[8px] py-[9px] text-[24px] leading-[18px] text-black">
              {t("menu.new")}
            </span>
          )}
          <p className="w-[352px] text-center text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black">
            {entity?.name}
          </p>
          <p className="text-[18px] leading-[20px] text-tb-ink-purple">{priceLine}</p>
        </div>
        {imageUrl && (
          <img
            alt=""
            src={imageUrl}
            className={`h-[326px] min-h-0 w-full object-contain ${unavailable ? "opacity-40 grayscale" : ""}`}
          />
        )}
        {!unavailable && (
          <button
            type="button"
            aria-label={entity?.name}
            onClick={() => onOpen(entity)}
            className="absolute inset-0"
          />
        )}
        {unavailable ? (
          <span className="tb-display absolute bottom-[24px] left-1/2 -translate-x-1/2 rounded-[4px] bg-tb-ink-purple/80 px-4 py-2 text-[18px] text-tb-surface">
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
            className="absolute bottom-[12px] right-[12px] z-10 flex h-[44px] w-[44px] items-center justify-center rounded-full bg-tb-surface shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)]"
          >
            <img alt="" src={plusIcon} className="h-[16px] w-[16px]" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid={`item-${entity?.id}`}
      aria-disabled={unavailable ? "true" : undefined}
      className="relative flex h-[277px] w-full flex-col justify-between overflow-hidden rounded-[8px] bg-tb-grey-6"
    >
      <div className={`flex flex-col gap-[4px] pl-[24px] pr-[64px] pt-[24px] ${unavailable ? "opacity-40" : ""}`}>
        <p className="text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
          {entity?.name}
        </p>
        <p className="text-[18px] leading-[20px] text-tb-ink-purple">{priceLine}</p>
      </div>
      {imageUrl && (
        <img
          alt=""
          src={imageUrl}
          className={`h-[172px] min-h-0 w-full object-contain ${unavailable ? "opacity-40 grayscale" : ""}`}
        />
      )}
      {!unavailable && (
        <button
          type="button"
          aria-label={entity?.name}
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
