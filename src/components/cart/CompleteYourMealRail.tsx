import { useMemo } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import useCartUpsell from "../../hooks/menuHooks/useCartUpsell";
import useAddEntityToCart from "../../hooks/menuHooks/useAddEntityToCart";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import {
  CART_UPSELL_CARD_HEIGHT_PX,
  CART_UPSELL_CARD_WIDTH_PX,
  CART_UPSELL_GRID_GAP_PX,
  CART_UPSELL_IMAGE_HEIGHT_PX,
  CART_UPSELL_PAGE_PADDING_X_PX,
  CART_UPSELL_TITLE_HEIGHT_PX,
  CART_UPSELL_TITLE_LINE_HEIGHT_PX,
} from "../../hooks/menuHooks/cartUpsellUtils";
import plusIcon from "../../assets/icons/plus.svg";

interface CompleteYourMealRailProps {
  /**
   * Called BEFORE any branch that stacks another sheet or navigates away
   * (customization detour, MIAM modal, repeat sheet) so the bag sheet can
   * close cleanly first. Plain adds never fire it — they stay in the bag.
   */
  onDetour?: () => void;
}

/**
 * The engine's RecommendedEntity is deliberately narrow; the converted menu
 * entities additionally carry `image_url` and sometimes an object-shaped
 * calorie count (MenuItemCard precedent). Read those through this widening
 * rather than `any`.
 */
type ConvertedEntityExtras = {
  image_url?: string;
  calorieCount?: number | string | { value?: number | string };
  nutritionalInfo?: {
    calorieCount?: number | string | { value?: number | string };
  };
};

const imageUrlOf = (entity: RecommendedEntity): string | undefined =>
  (entity as RecommendedEntity & ConvertedEntityExtras).image_url;

const calorieValue = (
  entity: RecommendedEntity,
): number | string | undefined => {
  const extras = entity as RecommendedEntity & ConvertedEntityExtras;
  const cal = extras?.calorieCount ?? extras?.nutritionalInfo?.calorieCount;
  if (cal !== null && typeof cal === "object") return cal?.value;
  return cal;
};

/**
 * Complete-Your-Meal rail — Figma mybag 1:3171 "You Might Like" section:
 * label + horizontal row of Menu-Item cards (240×277, name + £price | cal
 * above a 172px image, ⊕ top-right). Source 2 only (isCartRecommended engine
 * via useCartUpsell — no S3 fetch, locked decision 6), minus anything already
 * in the cart (fork Cart.tsx:227-231). Renders null when the gate fails or
 * nothing survives the filter — a rail that can render empty is a broken rail.
 *
 * Card tap routes through useAddEntityToCart.addEntity: plain adds land in
 * the cart with the added-modal suppressed (the bag row appearing IS the
 * confirmation); every other intent calls onDetour first (via onBeforeLeave)
 * and carries returnTo:"cart" so a customization detour returns to /cart
 * (trap 7), never dumping the customer on /menu.
 */
export default function CompleteYourMealRail({
  onDetour,
}: CompleteYourMealRailProps) {
  const { t } = useTranslation();
  const { items, shouldShowUpsell } = useCartUpsell();
  const { addEntity } = useAddEntityToCart();
  const { doesItemExistInCart } = useCartHook();
  const cart = useSelector(selectCart) as
    | { cartItems?: { id?: string }[] }
    | null
    | undefined;
  const currencySettings = useSelector(selectCurrency) as
    | { symbol?: string; currency_symbol?: string }
    | null
    | undefined;

  const cartItems = cart?.cartItems;
  const railItems = useMemo(() => {
    const inCart = new Set((cartItems ?? []).map((row) => row?.id));
    return items.filter((entity) => !inCart.has(entity?.id));
  }, [items, cartItems]);

  if (!shouldShowUpsell || railItems.length === 0) return null;

  const currency =
    currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";

  const priceLine = (entity: RecommendedEntity): string => {
    const base = `${currency}${entity?.price ?? ""}`;
    const cal = calorieValue(entity);
    return cal ? `${base} | ${t("pack.cal", { value: cal })}` : base;
  };

  const handleTap = (entity: RecommendedEntity) => {
    addEntity(entity, {
      onBeforeLeave: () => onDetour?.(),
      returnTo: "cart",
      suppressAddedModal: true,
    });
  };

  // Render helper, NOT a component (react-hooks/static-components).
  const renderCard = (entity: RecommendedEntity) => {
    const imageUrl = imageUrlOf(entity);
    // Defensive parity with the fork's rail card: the id filter above makes
    // an in-cart hit unreachable today, but the badge contract survives a
    // future source that stops filtering.
    const inCartQty = Number(doesItemExistInCart(entity?.id)?.quantity ?? 0);

    return (
      <button
        key={entity?.id}
        type="button"
        data-testid={`bag-rail-item-${entity?.id}`}
        aria-label={entity?.name ?? ""}
        onClick={() => handleTap(entity)}
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
            {entity?.name}
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
        {inCartQty > 0 && (
          <span className="absolute left-[12px] top-[12px] flex h-[36px] min-w-[36px] items-center justify-center rounded-full bg-tb-purple px-[8px] text-[18px] font-bold text-tb-surface">
            {inCartQty}
          </span>
        )}
      </button>
    );
  };

  return (
    <section
      data-testid="bag-rail"
      className="w-full bg-tb-surface pb-[24px] pt-[48px]"
      style={{
        paddingLeft: CART_UPSELL_PAGE_PADDING_X_PX,
        paddingRight: CART_UPSELL_PAGE_PADDING_X_PX,
      }}
    >
      <p className="text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
        {t("bag.completeYourMeal")}
      </p>
      <div
        className="mt-[16px] flex w-full overflow-x-auto"
        style={{ gap: CART_UPSELL_GRID_GAP_PX, scrollbarWidth: "none" }}
      >
        {railItems.map(renderCard)}
      </div>
    </section>
  );
}
