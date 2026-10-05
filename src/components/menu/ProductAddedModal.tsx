/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart/menu entities flow through untyped from the legacy converters; typed
 * in the domain passes. Do not add NEW anys.
 */
import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { mutateAddToCartModal } from "../../redux/features/menuSelections/menuSelections.slice";
import { selectCartAmount } from "@cx-sdk/ordering/state/cart.slice";
import { selectEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import closeIcon from "../../assets/icons/close.svg";
import plusIcon from "../../assets/icons/plus.svg";

interface ProductAddedModalProps {
  onQuickAdd: (entity: any) => void;
}

/**
 * "YOUR PRODUCT HAS BEEN ADDED" — Figma "Product added" (1:4571).
 * Opens via the fork contract: useCartHook.addItemToCart dispatches
 * mutateAddToCartModal when the added item has recommendations (or was a
 * customized/variant add). "You Might Like" strip resolves the added item's
 * recommendedItems against the converted entityMap. CSS entrance only.
 */
export default function ProductAddedModal({ onQuickAdd }: ProductAddedModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const modal = useSelector(
    (s: any) => s.menuSelections?.addToCartModal ?? { isOpen: false, item: {} }
  );
  const entityMap = useSelector(selectEntityMap) as any;
  const cartAmount = useSelector(selectCartAmount) ?? 0;
  const currencySettings = useSelector(selectCurrency) as any;
  const currency = currencySettings?.symbol ?? "";

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
    <div className="absolute inset-0 z-40" data-testid="product-added-modal">
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={close}
        className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70"
      />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 w-[820px] rounded-[16px] bg-tb-surface p-[48px]">
        <h2 className="tb-display mb-[24px] pr-[64px] text-center text-[36px] leading-[1.1] tracking-[-1px] text-tb-purple-vibrant">
          {t("added.title")}
        </h2>
        <button
          type="button"
          aria-label={t("language.close")}
          onClick={close}
          className="absolute right-[36px] top-[36px] h-[48px] w-[48px] min-h-[44px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        {recommendations.length > 0 && (
          <>
            <p className="mb-[16px] text-[20px] font-medium text-black">
              {t("added.youMightLike")}
            </p>
            <div className="mb-[24px] grid grid-cols-3 gap-[16px]">
              {recommendations.map((entity: any) => (
                <div
                  key={entity.id}
                  data-testid={`added-rec-${entity.id}`}
                  className="relative flex flex-col rounded-[8px] bg-tb-grey-6 p-[16px]"
                >
                  {entity.image_url && (
                    <img alt="" src={entity.image_url} className="mb-2 h-[96px] w-full object-contain" />
                  )}
                  <p className="text-[17px] font-medium capitalize leading-[20px] text-black">
                    {entity.name}
                  </p>
                  <p className="text-[15px] text-tb-ink-purple">
                    {currency}
                    {entity.price}
                  </p>
                  <button
                    type="button"
                    aria-label={t("menu.quickAdd")}
                    data-testid={`added-rec-add-${entity.id}`}
                    onClick={() => onQuickAdd(entity)}
                    className="absolute right-[8px] top-[8px] flex h-[44px] w-[44px] items-center justify-center rounded-full bg-tb-surface shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)]"
                  >
                    <img alt="" src={plusIcon} className="h-[14px] w-[14px]" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="mb-[16px] text-[22px] font-bold text-black" data-testid="added-total">
          {t("menu.total")} {currency}
          {Number(cartAmount).toFixed(2)}
        </p>
        <button
          type="button"
          data-testid="added-continue"
          onClick={close}
          className="tb-display w-full rounded-[8px] bg-tb-purple py-[24px] text-center text-[22px] text-tb-surface min-h-[44px]"
        >
          {t("added.addToOrder")}
        </button>
        <button
          type="button"
          data-testid="added-view-bag"
          onClick={() => {
            close();
            navigate("/cart");
          }}
          className="tb-display mt-[16px] w-full rounded-[8px] border-2 border-tb-purple py-[24px] text-center text-[22px] text-tb-purple min-h-[44px]"
        >
          {t("menu.viewMyBag")}
        </button>
      </div>
    </div>
  );
}
