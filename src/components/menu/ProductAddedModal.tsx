/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart/menu entities flow through untyped from the legacy converters; typed
 * in the domain passes. Do not add NEW anys.
 */
import { useMemo } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  mutateAddToCartModal,
  selectOutOfStockItems,
  selectRecommendationDetour,
  selectUpsellStaging,
  stageUpsellItem,
  unstageConfiguredUpsellItem,
  type StagedCartRow,
} from "../../redux/features/menuSelections/menuSelections.slice";
import cartReducer, {
  addItemToCartRdx,
  selectCart,
  updateItemCartRdx,
} from "@cx-sdk/ordering/state/cart.slice";
import { buildCartItemContent, doesItemExistInCart } from "@cx-sdk/ordering/cart/cartEngine";
import { buildDirectAddPayload } from "@cx-sdk/ordering/cart/addIntent";
import { resolveItemRecommendations } from "@cx-sdk/catalog/recommendation/recommendationUtils";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { selectMenuSellableEntityMap } from "../../hooks/menuHooks/useCartUpsell";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import { useCartTotal } from "../../hooks/cartHooks/useCartBill";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import { resolveEntityImage } from "../../utils/entityImage";
import { formatPrice } from "../../utils/price";
import NoImageBell from "../common/NoImageBell";
import useLocalized from "../../hooks/utils/useLocalized";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import { formatMenuPriceLine } from "./MenuItemCard";
import closeIcon from "../../assets/icons/close.svg";
import plusIcon from "../../assets/icons/plus.svg";
import minusIcon from "../../assets/icons/qty-minus.svg?no-inline";
import trashIcon from "../../assets/icons/trash.svg?no-inline";

interface ProductAddedModalProps {
  onQuickAdd: (entity: RecommendedEntity) => void;
}

/** The live cart rows ADD TO ORDER writes onto (the cart slice is untyped). */
interface LiveCart {
  cart: { cartItems: { itemId: string; quantity: number; [field: string]: unknown }[] };
}
type CartRows = LiveCart["cart"]["cartItems"];

/**
 * What ADD TO ORDER writes for one product's one-tap units: ONE write
 * carrying them all, onto the row the menu "+" bumps (the first paid row of
 * that id), else a new row.
 */
const pickWrite = (entity: RecommendedEntity, units: number, cartItems: CartRows) => {
  const hit = doesItemExistInCart(entity.id, cartItems);
  const row = hit.itemExist ? cartItems.find((r) => r.itemId === hit.itemId) : undefined;
  return row
    ? { row: { ...row, quantity: row.quantity + units } }
    : { item: { ...buildDirectAddPayload(entity), quantity: units } };
};

/**
 * The cart ADD TO ORDER would leave: its writes (pickWrite, then the parked
 * rows as built) replayed through the cart slice's own reducer, so the
 * preview merges rows exactly as the real add will. Nothing is dispatched.
 */
const withPicks = (
  cart: any,
  recommendations: RecommendedEntity[],
  pending: Record<string, number>,
  pendingCustom: StagedCartRow[],
): any => {
  let next = cart;
  recommendations.forEach((entity) => {
    const units = pending[entity.id] ?? 0;
    if (!units) return;
    const write = pickWrite(entity, units, next?.cartItems ?? []);
    next = cartReducer(
      next,
      write.row
        ? updateItemCartRdx({ item: write.row })
        : addItemToCartRdx(buildCartItemContent(write.item, "ITEM")),
    );
  });
  pendingCustom.forEach((row) => {
    next = cartReducer(next, addItemToCartRdx(row));
  });
  return next;
};

/**
 * "YOUR PRODUCT HAS BEEN ADDED" — Figma "Product added" 1:4571, modal 1:4589:
 * a 680 card on a tb-purple/80 scrim, the H5 title, a "You Might Like" strip
 * of up to three 204×235 tiles (2-line names, "£5.59 | 360 Cal" with the
 * calories only when > 0, a 36 px quick add on a 44 px hit area), the Total
 * and ONE CTA. No suggestions → the title and the bottom block only.
 *
 * STAGED, as in posistKiosk: nothing a tile does reaches the bag until ADD
 * TO ORDER (Figma's label). The WHOLE tile (an empty overlay button, P9f
 * pattern; the "+" above it is its aria-hidden twin) goes to Menu through
 * `onQuickAdd`: a one-tap item is PICKED here; one that needs a choice
 * sends the guest to Select a Size / the PDP with recommendationDetour set,
 * which hides this modal (still open, its picks kept) and parks the add the
 * chooser ends in with them (useCartHook). A tile counts its picks (the pill
 * + a status), its "−" takes one back, and the Total is the bag's own Total
 * (after rewards, taxes and round off — user decision 2026-10-14) with the
 * picks in it: the bag's bill (useCartTotal) over the cart ADD TO ORDER would
 * leave (withPicks), printed as posistKiosk prints this modal's total
 * (formatPrice). ADD TO ORDER buys them; X and the scrim throw them away.
 * With nothing to buy the same button only closes and says so: NO THANKS
 * over a strip, GOT IT without one (posistKiosk's "No, Thanks" / "Okay").
 * The frame has no VIEW MY BAG; the menu's CTA bar keeps that edge.
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
  const store = useStore();
  const { addItemToCart, updateItemCart } = useCartHook();
  const modal = useSelector(
    (s: any) => s.menuSelections?.addToCartModal ?? { isOpen: false, item: {} }
  );
  const detour = useSelector(selectRecommendationDetour);
  const { pending, pendingCustom } = useSelector(selectUpsellStaging);
  const entityMap = useSelector(selectMenuSellableEntityMap);
  const outOfStockItems = useSelector(selectOutOfStockItems);
  const cart = useSelector(selectCart);
  const currency = useCurrencySymbol();

  const recommendations = useMemo(
    () =>
      modal?.item?.suppressRecommendations
        ? []
        : resolveItemRecommendations(entityMap, outOfStockItems, modal?.item).slice(0, 3),
    [modal, entityMap, outOfStockItems]
  );
  // Only while shown: the modal stays mounted on the menu.
  const shown = Boolean(modal?.isOpen) && !detour;
  const preview = useMemo(
    () => (shown ? withPicks(cart, recommendations, pending, pendingCustom) : null),
    [shown, cart, recommendations, pending, pendingCustom]
  );
  const total = useCartTotal(preview);

  // A suggestion's chooser is up: still open, picks kept, not shown.
  if (!shown) return null;

  const close = () => dispatch(mutateAddToCartModal(false));
  /** A tile's picks: its one-tap units plus its parked rows. */
  const picked = (id: string) =>
    (pending[id] ?? 0) +
    pendingCustom.reduce((sum, row) => sum + (row.id === id ? row.quantity : 0), 0);
  // What ADD TO ORDER would buy — exactly the set addToOrder walks: a one-tap
  // pick on a live tile, or any parked row (bought even without its tile).
  // Nothing to buy → the CTA only closes, and says so (posistKiosk's words).
  const hasPicks =
    pendingCustom.length > 0 || recommendations.some((entity) => pending[entity.id]);

  /** "−": a one-tap unit first (a tap puts it back), then the latest parked row. */
  const unpick = (id: string) => {
    if (pending[id]) {
      dispatch(stageUpsellItem({ id, delta: -1 }));
      return;
    }
    const row = [...pendingCustom].reverse().find((r) => r.id === id);
    if (row) dispatch(unstageConfiguredUpsellItem(row.itemId));
  };

  /**
   * ADD TO ORDER buys the picks. ONE write per product carrying all its
   * units — onto the row the menu "+" bumps, else a new row — so the DP
   * check (which reads the live cart) sees the true total; parked rows are
   * replayed as their chooser built them. A refused write (the DP cap; its
   * error is up) keeps the modal open with only what was refused still
   * picked. ItemAddedToCart (Menu's shape) for each product bought here; a
   * parked row reported when its chooser confirmed it.
   */
  const addToOrder = () => {
    let refused = false;
    recommendations.forEach((entity) => {
      const units = pending[entity.id] ?? 0;
      if (!units) return;
      const write = pickWrite(entity, units, (store.getState() as LiveCart).cart.cartItems);
      const landed = write.row
        ? updateItemCart(write.row)
        : addItemToCart(write.item, "ITEM", { suppressAddedModal: true });
      if (!landed) {
        refused = true;
        return;
      }
      dispatch(stageUpsellItem({ id: entity.id, delta: -units }));
      captureKioskEvent(KioskEventName.ItemAddedToCart, {
        item_id: entity.id,
        item_name: entity.name,
        item_price: entity.price,
        quantity: units,
        item_type: entity.type,
      });
    });
    pendingCustom.forEach((row) => {
      if (addItemToCart(row, row.type, { suppressAddedModal: true, stamped: true })) {
        dispatch(unstageConfiguredUpsellItem(row.itemId));
      } else refused = true;
    });
    if (!refused) close();
  };

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
                // What the guest is ADDING, never what the bag holds
                // (posistKiosk: it starts at zero even for an item in the bag).
                const qty = picked(entity.id);
                return (
                  <div
                    key={entity.id}
                    data-testid={`added-rec-${entity.id}`}
                    className="tb-press-card relative flex min-h-[235px] w-[204px] flex-col items-center justify-center gap-[20px] rounded-[8px] bg-tb-grey-6 px-[24px] pb-[24px] pt-[48px]"
                  >
                    <div className="h-[71px] w-[126px] shrink-0">
                      {imageUrl ? (
                        <img alt="" src={imageUrl} className="h-full w-full object-contain" />
                      ) : (
                        <NoImageBell />
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
                    {/* Before the overlay, so a tap on the pill still picks.
                        ForYouCard's pill (design language, no frame),
                        centred between the "−" and the "+": it pops in; the
                        re-keyed number bumps on each change. The status is
                        always mounted so changes are spoken. */}
                    <span role="status" className="absolute inset-x-0 top-[9px] flex justify-center">
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
                          <span className="sr-only">{t("added.selected", { value: qty })}</span>
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
                    {/* posistKiosk's "−" on the "+"'s circle at the mirrored
                        corner (design language, no frame): the trash glyph
                        at 1, "−" from 2 (D6). */}
                    {qty > 0 && (
                      <button
                        type="button"
                        data-testid={`added-rec-remove-${entity.id}`}
                        aria-label={t("added.removeOne", { name: name(entity) })}
                        onClick={() => unpick(entity.id)}
                        className="group absolute left-[7px] top-[5px] z-10 flex h-[44px] w-[44px] items-center justify-center"
                      >
                        <span className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-tb-surface shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)] group-active:bg-tb-lilac">
                          <img alt="" src={qty === 1 ? trashIcon : minusIcon} className="h-[16px] w-[16px]" />
                        </span>
                      </button>
                    )}
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
            {formatPrice(total)}
          </p>
          <button
            type="button"
            data-testid="added-continue"
            onClick={addToOrder}
            className="tb-display h-[60px] w-full rounded-[4px] bg-tb-purple text-[18px] leading-[16px] text-tb-surface"
          >
            {hasPicks
              ? t("added.addToOrder")
              : t(recommendations.length > 0 ? "added.noThanks" : "offers.gotIt")}
          </button>
        </div>
      </div>
    </div>
  );
}
