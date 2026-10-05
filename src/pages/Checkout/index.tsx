/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart/currency read through the untyped legacy slices; typed in the P7+
 * domain passes. Do not add NEW anys.
 */
import { useEffect } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { selectCart, selectCartAmount } from "@cx-sdk/ordering/state/cart.slice";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";

/**
 * /checkout stub (locked decision 5): every preflight route
 * (tent | payment | customerName | phone) lands here until P8 builds the
 * real screens. Shows the decided route + the paid total (netAmount — set
 * by the bag's setAmount dispatch right before navigating) and a
 * back-to-bag CTA. Guard: an empty cart bounces to /menu (replace).
 */
export default function Checkout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const cart = useSelector(selectCart) as any;
  const netAmount = Number(useSelector(selectCartAmount) ?? 0);
  const currencySettings = useSelector(selectCurrency) as any;
  const currency = currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";

  const checkoutRoute = (location.state as any)?.checkoutRoute as
    | string
    | undefined;
  const routeLabels: Record<string, string> = {
    tent: t("checkout.routes.tent"),
    payment: t("checkout.routes.payment"),
    customerName: t("checkout.routes.customerName"),
    phone: t("checkout.routes.phone"),
  };

  const cartCount = cart?.cartItems?.length ?? 0;
  useEffect(() => {
    if (cartCount === 0) {
      navigate("/menu", { replace: true });
    }
  }, [cartCount, navigate]);

  return (
    <div
      data-testid="checkout-stub"
      className="flex h-[1920px] w-[1080px] flex-col items-center justify-center gap-[48px] bg-tb-purple px-[80px] text-center"
    >
      <h1 className="tb-display text-[72px] leading-[0.9] tracking-[-3px] text-tb-surface">
        {t("checkout.title")}
      </h1>
      <p className="max-w-[720px] text-[30px] leading-[40px] text-tb-surface/80">
        {t("checkout.placeholder")}
      </p>
      {checkoutRoute && (
        <p
          data-testid="checkout-route"
          className="text-[26px] leading-[32px] text-tb-surface/80"
        >
          {t("checkout.routeLabel")}: {routeLabels[checkoutRoute] ?? checkoutRoute}
        </p>
      )}
      <p data-testid="checkout-total" className="tb-display text-[40px] leading-[44px] text-tb-yellow">
        {t("checkout.totalLabel")} {currency}
        {netAmount.toFixed(2)}
      </p>
      <button
        type="button"
        data-testid="checkout-back"
        onClick={() => navigate("/cart")}
        className="tb-display min-h-[84px] rounded-[8px] border-2 border-tb-surface px-[64px] py-[28px] text-[24px] leading-[20px] text-tb-surface"
      >
        {t("checkout.backToBag")}
      </button>
    </div>
  );
}
