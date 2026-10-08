import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { useTenantItemSuggestions } from "../../hooks/recommendation/useTenantRecommendations";
import useAddEntityToCart from "../../hooks/menuHooks/useAddEntityToCart";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useLocalized from "../../hooks/utils/useLocalized";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import { CART_UPSELL_GRID_GAP_PX } from "../../hooks/menuHooks/cartUpsellUtils";
import ForYouCard from "../cart/ForYouCard";

/**
 * PDP "You Might Like" rail — Figma ProductSuggestion 1:1825 (1:2657 /
 * 1:5867): label (Md 20/24, −0.5) + a row of 240×277 Menu-Item cards (the
 * bag rail's card in its photo-on-top layout, 1:1829), 64 below the groups
 * (the Ingredients gap). Prices in the PDP's money format (£8.00).
 *
 * Source: the tenant co-purchase map for THIS item (useTenantItemSuggestions
 * — the bag rail's source, per item, D7 flag included); so in production it
 * shows only where VITE_TENANT_RECOMMENDATIONS_URL is set. Only one-tap adds
 * (`getAddIntent === "add"`) are offered: any other intent opens another
 * tier-1 session over the guest's open customisation (Rule 1/3). A tap adds
 * one unit with the added modal suppressed — the card's count pill is the
 * confirmation. Null when nothing survives. Names resolve at render.
 */
export default function YouMightLikeRail({
  entityId,
}: {
  entityId?: string;
}): JSX.Element | null {
  const { t } = useTranslation();
  const { name } = useLocalized();
  const suggestions = useTenantItemSuggestions(entityId);
  const { getAddIntent, addEntity } = useAddEntityToCart();
  const { doesItemExistInCart } = useCartHook();
  const currency = useCurrencySymbol();

  const items = suggestions.filter((entity) => getAddIntent(entity) === "add");
  if (items.length === 0) return null;

  // Every card here adds, so it is named with the add verb on both paths:
  // ForYouCard picks its label from isDirectlyAddable (isOneTapAddable), which
  // says "customize" for an upsell item the classifier still adds directly.
  const addLabel = t("menu.quickAdd");
  const handleAdd = (entity: RecommendedEntity) => {
    addEntity(entity, { suppressAddedModal: true });
  };

  return (
    <section data-testid="pdp-rail" className="mt-[64px] w-full">
      <p className="text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
        {t("added.youMightLike")}
      </p>
      <div
        className="mt-[16px] flex w-full overflow-x-auto"
        style={{ gap: CART_UPSELL_GRID_GAP_PX, scrollbarWidth: "none" }}
      >
        {items.map((entity) => (
          <ForYouCard
            key={entity.id}
            entity={entity}
            testId={`pdp-rail-item-${entity.id}`}
            title={name(entity)}
            price={Number.isFinite(Number(entity.price ?? NaN)) ? Number(entity.price).toFixed(2) : undefined}
            currency={currency}
            quantity={Number(doesItemExistInCart(entity.id)?.quantity ?? 0)}
            addLabel={addLabel}
            customizeLabel={addLabel}
            onAdd={handleAdd}
            imageTop
          />
        ))}
      </div>
    </section>
  );
}
