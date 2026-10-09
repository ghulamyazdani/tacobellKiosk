/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart/menu entities flow through untyped from the legacy converters; typed
 * in the domain passes. Do not add NEW anys.
 */
import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { mutateAddToCartModal } from "../../redux/features/menuSelections/menuSelections.slice";
import { selectSubTotal } from "@cx-sdk/ordering/state/cart.slice";
import { selectMenuSellableEntityMap } from "../../hooks/menuHooks/useCartUpsell";
import { resolveEntityImage } from "../../utils/entityImage";
import useLocalized from "../../hooks/utils/useLocalized";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import { formatMenuPriceLine } from "./MenuItemCard";
import closeIcon from "../../assets/icons/close.svg";
import plusIcon from "../../assets/icons/plus.svg";

interface ProductAddedModalProps {
  onQuickAdd: (entity: any) => void;
}

/**
 * "YOUR PRODUCT HAS BEEN ADDED" — Figma "Product added" 1:4571, modal 1:4589:
 * a 680 card on a tb-purple/80 scrim, the H5 title, a "You Might Like" strip
 * of up to three 204×235 tiles (2-line names, "£5.59 | 360 Cal" with the
 * calories only when > 0, a 36 px quick add on a 44 px hit area), the Total
 * and ONE CTA — ADD TO ORDER closes it and the guest keeps ordering (the
 * frame has no VIEW MY BAG; the menu's CTA bar keeps that edge and its
 * upsell gate). No suggestions → the title and the bottom block only.
 *
 * Opens via the fork contract: useCartHook.addItemToCart dispatches
 * mutateAddToCartModal when the added item has recommendations (or was a
 * customized/variant add). The strip resolves the added item's
 * recommendedItems against the converted entityMap. CSS entrance only: the
 * Figma Smart Animate spring (index.css tb-modal-spring).
 */
export default function ProductAddedModal({ onQuickAdd }: ProductAddedModalProps) {
  const { t } = useTranslation();
  const { name } = useLocalized();
  const dispatch = useDispatch();
  const modal = useSelector(
    (s: any) => s.menuSelections?.addToCartModal ?? { isOpen: false, item: {} }
  );
  const entityMap = useSelector(selectMenuSellableEntityMap) as any;
  // The menu CTA bar's live subTotal (same "Total" label). netAmount is only
  // mirrored while the bag is open, so it read £0.00 / a stale bill here.
  const cartAmount = useSelector(selectSubTotal) ?? 0;
  const currency = useCurrencySymbol();

  const recommendations: any[] = useMemo(() => {
    if (modal?.item?.suppressRecommendations) return [];
    const ids: any[] = modal?.item?.recommendedItems ?? [];
    return ids
      .map((id: any) => entityMap?.[typeof id === "object" ? id?.id : id])
      .filter((e: any) => e && !e.outOfStock)
      .slice(0, 3);
  }, [modal, entityMap]);

  if (!modal?.isOpen) return null;

  const close = () => dispatch(mutateAddToCartModal(false));

  return (
    <div
      className="absolute inset-0 z-40"
      data-testid="product-added-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="added-title"
    >
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={close}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* Figma 1:5502 → 1:5521: the card springs open (tb-modal-spring);
          its fill carries the centring, so no translate utility here. The
          scrim above appears at once (Figma). */}
      <div className="tb-modal-spring absolute left-1/2 top-1/2 flex w-[680px] flex-col items-center gap-[75px] rounded-[16px] bg-tb-surface px-[24px] pb-[24px] pt-[80px]">
        <h2
          id="added-title"
          className="tb-display w-[502px] text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
        >
          {t("added.title")}
        </h2>
        <button
          type="button"
          aria-label={t("language.close")}
          onClick={close}
          className="absolute right-[25px] top-[25px] h-[48px] w-[48px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        {recommendations.length > 0 && (
          <div className="flex w-full flex-col gap-[16px]">
            <p className="text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
              {t("added.youMightLike")}
            </p>
            {/* min-h, not h: an Arabic calorie label wraps the meta line —
                the tile grows (the row stretches all three) instead of
                spilling. Exactly 235 / 72 whenever the meta fits one line. */}
            <div className="flex gap-[10px]">
              {recommendations.map((entity: any) => {
                const imageUrl = resolveEntityImage(entity);
                return (
                  <div
                    key={entity.id}
                    data-testid={`added-rec-${entity.id}`}
                    className="relative flex min-h-[235px] w-[204px] flex-col items-center justify-center gap-[20px] rounded-[8px] bg-tb-grey-6 px-[24px] pb-[24px] pt-[48px]"
                  >
                    <div className="h-[71px] w-[126px] shrink-0">
                      {imageUrl && (
                        <img alt="" src={imageUrl} className="h-full w-full object-contain" />
                      )}
                    </div>
                    <div className="flex min-h-[72px] w-full flex-col gap-[4px]">
                      <p className="line-clamp-2 text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
                        {name(entity)}
                      </p>
                      <p className="text-[18px] leading-[20px] text-tb-ink-purple">
                        {formatMenuPriceLine(entity, currency, t)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={t("menu.quickAdd")}
                      data-testid={`added-rec-add-${entity.id}`}
                      onClick={() => onQuickAdd(entity)}
                      className="group absolute right-[7px] top-[5px] flex h-[44px] w-[44px] items-center justify-center"
                    >
                      {/* Figma Quick Add pressed fill (white → lilac) on the circle. */}
                      <span className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-tb-surface shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)] group-active:bg-tb-lilac">
                        <img alt="" src={plusIcon} className="h-[16px] w-[16px]" />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex w-full flex-col gap-[24px]">
          <p
            data-testid="added-total"
            className="text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple"
          >
            {t("menu.total")} {currency}
            {Number(cartAmount).toFixed(2)}
          </p>
          <button
            type="button"
            data-testid="added-continue"
            onClick={close}
            className="tb-display h-[60px] w-full rounded-[4px] bg-tb-purple text-[18px] leading-[16px] text-tb-surface"
          >
            {t("added.addToOrder")}
          </button>
        </div>
      </div>
    </div>
  );
}
