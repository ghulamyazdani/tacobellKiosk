/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart/menu entities flow through untyped from the legacy converters; typed
 * in the domain passes. Do not add NEW anys.
 */
import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  mutateAddToCartModal,
  selectOutOfStockItems,
} from "../../redux/features/menuSelections/menuSelections.slice";
import { selectCart, selectSubTotal } from "@cx-sdk/ordering/state/cart.slice";
import { doesItemExistInCart } from "@cx-sdk/ordering/cart/cartEngine";
import { resolveItemRecommendations } from "@cx-sdk/catalog/recommendation/recommendationUtils";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { selectMenuSellableEntityMap } from "../../hooks/menuHooks/useCartUpsell";
import { resolveEntityImage } from "../../utils/entityImage";
import useLocalized from "../../hooks/utils/useLocalized";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import { formatMenuPriceLine } from "./MenuItemCard";
import closeIcon from "../../assets/icons/close.svg";
import plusIcon from "../../assets/icons/plus.svg";

interface ProductAddedModalProps {
  onQuickAdd: (entity: RecommendedEntity) => void;
}

/**
 * "YOUR PRODUCT HAS BEEN ADDED" — Figma "Product added" 1:4571, modal 1:4589:
 * a 680 card on a tb-purple/80 scrim, the H5 title, a "You Might Like" strip
 * of up to three 204×235 tiles (2-line names, "£5.59 | 360 Cal" with the
 * calories only when > 0, a 36 px quick add on a 44 px hit area), the Total
 * and ONE CTA. No suggestions → the title and the bottom block only.
 *
 * The WHOLE tile adds (an empty overlay button, P9f pattern; the "+" above
 * it is its aria-hidden twin) through `onQuickAdd`, at once, and the tile
 * counts that item in the order (the pill + a status for screen readers).
 * A suggestion that needs a choice leaves through Menu's handler, which
 * closes this modal FIRST. So ADD TO ORDER (Figma's label), X and the scrim
 * only confirm and close: every add already happened on the tiles (lane
 * added-modal, sign-off Q1). The frame has no VIEW MY BAG; the menu's CTA
 * bar keeps that edge and its upsell gate.
 *
 * Opens via the fork contract: useCartHook.addItemToCart dispatches
 * mutateAddToCartModal when the added item has recommendations (or was a
 * customized/variant add). The strip comes from the SDK resolver
 * (resolveItemRecommendations, the one the open check mirrors) over the
 * menu-sellable map and the LIVE out-of-stock map. CSS entrance only: the
 * Figma Smart Animate spring (index.css tb-modal-spring).
 */
export default function ProductAddedModal({ onQuickAdd }: ProductAddedModalProps) {
  const { t } = useTranslation();
  const { name } = useLocalized();
  const dispatch = useDispatch();
  const modal = useSelector(
    (s: any) => s.menuSelections?.addToCartModal ?? { isOpen: false, item: {} }
  );
  const entityMap = useSelector(selectMenuSellableEntityMap);
  const outOfStockItems = useSelector(selectOutOfStockItems);
  const cartItems = (useSelector(selectCart) as { cartItems?: unknown[] } | undefined)?.cartItems;
  // The menu CTA bar's live subTotal (same "Total" label). netAmount is only
  // mirrored while the bag is open, so it read £0.00 / a stale bill here.
  const cartAmount = useSelector(selectSubTotal) ?? 0;
  const currency = useCurrencySymbol();

  const recommendations = useMemo(
    () =>
      modal?.item?.suppressRecommendations
        ? []
        : resolveItemRecommendations(entityMap, outOfStockItems, modal?.item).slice(0, 3),
    [modal, entityMap, outOfStockItems]
  );

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
              {recommendations.map((entity) => {
                const imageUrl = resolveEntityImage(entity);
                // Paid rows of this id (free / loyalty excluded; size rows
                // carry the parent id) — the PDP and bag rails' count.
                const qty = Number(doesItemExistInCart(entity.id, cartItems)?.quantity ?? 0);
                return (
                  <div
                    key={entity.id}
                    data-testid={`added-rec-${entity.id}`}
                    className="tb-press-card relative flex min-h-[235px] w-[204px] flex-col items-center justify-center gap-[20px] rounded-[8px] bg-tb-grey-6 px-[24px] pb-[24px] pt-[48px]"
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
                    {/* Before the overlay, so a tap on the pill still adds.
                        ForYouCard's pill (design language, no frame): it
                        pops in; the re-keyed number bumps on each change.
                        The status is always mounted so changes are spoken. */}
                    <span role="status" className="absolute left-[12px] top-[12px]">
                      {qty > 0 && (
                        <>
                          <span
                            aria-hidden="true"
                            data-testid={`added-count-${entity.id}`}
                            className="tb-pop-in flex h-[36px] min-w-[36px] items-center justify-center rounded-full bg-tb-purple px-[8px] text-[18px] font-bold text-tb-surface"
                          >
                            <span key={qty} className="tb-bump">
                              {qty}
                            </span>
                          </span>
                          <span className="sr-only">{t("added.inOrder", { value: qty })}</span>
                        </>
                      )}
                    </span>
                    {/* ForYouCard's naming: a tile that needs a choice LEAVES
                        the modal, and "Customize" is the only warning a
                        screen reader gives of that (review UIA-2). */}
                    <button
                      type="button"
                      aria-label={`${t(entity.isDirectlyAddable ? "menu.quickAdd" : "pack.customize")} ${name(entity)}`}
                      onClick={() => onQuickAdd(entity)}
                      className="absolute inset-0"
                    />
                    {/* The overlay's visual twin: one accessible control per
                        tile. A tap must never focus it — a focused aria-hidden
                        button is un-hidden as a nameless one (review UIA-1). */}
                    <button
                      type="button"
                      aria-hidden="true"
                      tabIndex={-1}
                      data-testid={`added-rec-add-${entity.id}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onQuickAdd(entity)}
                      className="group absolute right-[7px] top-[5px] z-10 flex h-[44px] w-[44px] items-center justify-center"
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
