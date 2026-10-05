import { useMemo } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import useCartUpsell from "../../hooks/menuHooks/useCartUpsell";
import useAddEntityToCart from "../../hooks/menuHooks/useAddEntityToCart";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import ForYouCard from "./ForYouCard";
import {
  CART_UPSELL_GRID_GAP_PX,
  CART_UPSELL_PAGE_PADDING_X_PX,
} from "../../hooks/menuHooks/cartUpsellUtils";

interface CompleteYourMealRailProps {
  /**
   * Called BEFORE any branch that stacks another sheet or navigates away
   * (customization detour, MIAM modal, repeat sheet) so the bag sheet can
   * close cleanly first. Plain adds never fire it — they stay in the bag.
   */
  onDetour?: () => void;
}

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
 *
 * P7d: the tile itself now lives in `./ForYouCard`, lifted out of what used to
 * be this file's private `renderCard` helper so the pre-cart /forYou grid and
 * this rail render the SAME component — one card, one set of geometry
 * constants, one accessible-name rule. The rail keeps everything that is
 * genuinely its own: the gate, the in-cart filter, the tap routing and the
 * section chrome. `bag-rail` and `bag-rail-item-<id>` are unchanged — the
 * card takes its testid from the consumer precisely so both suites keep the
 * ids they already address.
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

  const handleTap = (entity: RecommendedEntity) => {
    addEntity(entity, {
      onBeforeLeave: () => onDetour?.(),
      returnTo: "cart",
      suppressAddedModal: true,
    });
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
        {railItems.map((entity) => (
          <ForYouCard
            key={entity?.id}
            entity={entity}
            testId={`bag-rail-item-${entity?.id}`}
            title={entity?.name ?? ""}
            // The RAW menu price, exactly as before — never the bill's taxed
            // total, which is a cart concept.
            price={entity?.price}
            currency={currency}
            /*
              Defensive parity with the fork's rail card: the in-cart filter
              above makes a hit unreachable today, but the count-pill contract
              survives a future source that stops filtering.
            */
            quantity={Number(doesItemExistInCart(entity?.id)?.quantity ?? 0)}
            /*
              Accessible verbs, reusing the keys TB already ships: `quickAdd`
              is the verb MenuItemCard puts on its one-tap "+" affordance, and
              `pack.customize` the one the slot sheet uses for a chooser. The
              card picks between them from `entity.isDirectlyAddable`.
            */
            addLabel={t("menu.quickAdd")}
            customizeLabel={t("pack.customize")}
            onAdd={handleTap}
          />
        ))}
      </div>
    </section>
  );
}
