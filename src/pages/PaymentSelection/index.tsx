import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  paymentSettingsRdx,
  selectCurrency,
  selectDeploymentInfo,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { selectCart, selectCartAmount } from "@cx-sdk/ordering/state/cart.slice";
import { checkIfCODAvailable } from "@cx-sdk/payments/gateways/paymentOptions";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useAdaActive from "../../hooks/utils/useAdaActive";
import usePayAtCounter from "../../hooks/paymentsHooks/usePayAtCounter";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import tbBell from "../../assets/brand/tb-bell.svg";

interface CartLike {
  cartItems?: unknown[];
}

/** `currencySettings` may also be the number 1 — see setInitialAppSetting. */
interface CurrencySettings {
  symbol?: string;
  currency_symbol?: string;
}

/**
 * Cancel window between the PAY AT COUNTER tap and the receipt step — the
 * fork's `paymentInitiationBufferTime` (3000ms). Nothing is pushed inside it.
 */
const PAYMENT_BUFFER_MS = 3000;

/**
 * Shared chrome for both render branches (selection + unavailable). In ADA
 * the bell is dropped — the brand zone above the reach zone carries it.
 */
function PaymentChrome({ ada }: { ada: boolean }) {
  return (
    <>
      {/* Full-bleed purple texture — the SAME asset as the splash screen
          (bg-texture.png is byte-identical to the Figma fill), tiled at 540px
          so the horizontal repeat lands exactly on the 1080px frame edges. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${bgTexture})`,
          backgroundSize: "540px 540px",
          backgroundPosition: "top left",
        }}
      />
      {!ada && (
        <img
          alt="Taco Bell"
          src={tbBell}
          className="absolute left-1/2 top-[135px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}
    </>
  );
}

/**
 * /payment — "HOW WOULD YOU LIKE TO PAY?" (Figma 1:3364).
 *
 * P8a is PAY-AT-COUNTER ONLY. The frame's second tile (PAY WITH CARD BELOW)
 * is rendered INERT with the established coming-soon treatment: no gateway
 * option list is mapped, no gateway module is imported and no gateway handler
 * is reachable from this file — that is by construction, not by a flag.
 *
 * COD gating uses `checkIfCODAvailable` from
 * `@cx-sdk/payments/gateways/paymentOptions`.
 *
 * ⚠️ KNOWN DIVERGENCE between the two implementations of that check — the SDK
 * export is used here because it is the maintained surface, but it is NOT the
 * one that ships in the fork:
 *   • fork page-local (PaymentSelection.tsx:66-92): matches
 *     `entity.name === "disable_cod_kiosk"`, then the tab by
 *     `tabs[].tabType` (with a take_out/takeout alias) and requires
 *     `tabSetting.selected === true` to disable COD.
 *   • SDK (paymentOptions.ts:117-137, used here): matches
 *     `entity.label === "Disable COD for Kiosk"`, then the tab by
 *     `tabs[].tabLabel`, and disables COD on a tab match alone.
 * A deployment blob therefore has to carry BOTH key spellings for the two to
 * agree — the e2e fixture does. Reconciling them is a payments-package change
 * and is deliberately out of scope for a screen.
 *
 * ⚠️ DELIBERATE DIVERGENCE (Rule 2): both implementations return `false` when
 * the deployment-settings blob is missing, so a boot where that fetch has not
 * landed yet would silently HIDE the only payment method and dead-end the
 * order. Here an un-fetched/absent blob (or an empty tabType) is treated as
 * "not decidable" and COD stays available; only a blob that actually says so
 * turns it off.
 *
 * ADA (P9c, design-language, flagged — 1:3364 has no ADA variant): both
 * roots render into the 1122px reach zone with the bell dropped. Selection:
 * title 120–232 · total 302–414 · tiles 482–894 · BACK TO MENU keeps its
 * 18px bottom distance (1012–1104). Unavailable: title 120–232 · body
 * 344–384 · the same BACK. The buffer dialog is centred on the page, so it
 * follows the page height.
 */
export default function PaymentSelection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ada = useAdaActive();

  const netAmountRdx = Number(useSelector(selectCartAmount) ?? 0);
  const deploymentSettings = useSelector(selectDeploymentInfo) as
    | Record<string, unknown>
    | undefined;
  const paymentOptions = useSelector(paymentSettingsRdx) as unknown[] | undefined;
  const currencySettings = useSelector(selectCurrency) as
    | CurrencySettings
    | number
    | undefined;
  const cart = useSelector(selectCart) as CartLike | undefined;

  const { getTabType, getIsPayAtCounter, shouldSkipCRM } = useAppSettings();
  // The push itself lives in the hook (guarded, retry ladder, idempotency
  // latch). This screen only ARMS it: beginCheckout pins
  // payment.paymentType = "PAY_AT_RESTAURANT" before anything is pushed.
  const { beginCheckout, cancelCheckout } = usePayAtCounter();

  const [bufferOpen, setBufferOpen] = useState(false);
  const bufferTimer = useRef<number | null>(null);
  const viewedFired = useRef(false);

  const tabType = getTabType();
  const cartCount = cart?.cartItems?.length ?? 0;

  const currency = useMemo(() => {
    if (!currencySettings || typeof currencySettings === "number") return "";
    return currencySettings.symbol ?? currencySettings.currency_symbol ?? "";
  }, [currencySettings]);

  /** See the header note on the missing-blob divergence. */
  const codAvailable = useMemo(() => {
    const decidable =
      Boolean(tabType) &&
      deploymentSettings != null &&
      Object.keys(deploymentSettings).length > 0;
    if (!decidable) return true;
    return Boolean(checkIfCODAvailable(tabType, deploymentSettings));
  }, [deploymentSettings, tabType]);

  const gatewayCount = Array.isArray(paymentOptions) ? paymentOptions.length : 0;

  /**
   * Fork's unavailable branch is `zero gateways AND no COD`. In P8a no
   * gateway tile is rendered at all, so a configured gateway is not a
   * reachable payment method and the condition reduces to `!codAvailable` —
   * showing a screen whose only tile is inert would be the dead end the fork's
   * unavailable screen exists to prevent. P8b restores the gateway tiles and
   * with them the AND.
   */
  const showUnavailable = !codAvailable;

  const payAtCounterLabel = getIsPayAtCounter()
    ? t("payment.payAtCounter")
    : t("payment.payAtRestaurant");

  useEffect(() => {
    if (viewedFired.current) return;
    viewedFired.current = true;
    captureKioskEvent(KioskEventName.PaymentViewed, {
      method_count: gatewayCount,
      cod_available: codAvailable,
      net_amount: netAmountRdx,
    });
  }, [codAvailable, gatewayCount, netAmountRdx]);

  // Nothing to pay for → back to the menu rather than an empty total (Rule 2).
  useEffect(() => {
    if (cartCount === 0) {
      navigate("/menu", { replace: true });
    }
  }, [cartCount, navigate]);

  // Rule 5 — the buffer timer never outlives the screen.
  useEffect(
    () => () => {
      if (bufferTimer.current !== null) {
        window.clearTimeout(bufferTimer.current);
        bufferTimer.current = null;
      }
    },
    []
  );

  const handleBack = useCallback(() => {
    captureKioskEvent(KioskEventName.PaymentDismissed, {});
    navigate(shouldSkipCRM() ? "/cart" : "/customerName");
  }, [navigate, shouldSkipCRM]);

  /**
   * PAY AT COUNTER. Arms the push (payment type pinned to
   * "PAY_AT_RESTAURANT"), then opens the cancel window. The window ends by
   * navigating to the receipt step — the push happens THERE, so Cancel here
   * is always strictly before anything is placed.
   *
   * The buffer lives in component state (the fork drove the equivalent effect
   * off `redirectionRef.current` in a dependency array — a ref mutation does
   * not re-render, so that effect fired on unrelated renders).
   */
  const handlePayAtCounter = useCallback(() => {
    if (bufferOpen) return;
    captureKioskEvent(KioskEventName.PaymentMethodSelected, {
      payment_type: "PAY_AT_RESTAURANT",
      net_amount: netAmountRdx,
    });
    beginCheckout();
    setBufferOpen(true);
    bufferTimer.current = window.setTimeout(() => {
      bufferTimer.current = null;
      navigate("/receipt");
    }, PAYMENT_BUFFER_MS);
  }, [beginCheckout, bufferOpen, navigate, netAmountRdx]);

  const handleCancelBuffer = useCallback(() => {
    if (bufferTimer.current !== null) {
      window.clearTimeout(bufferTimer.current);
      bufferTimer.current = null;
    }
    setBufferOpen(false);
    cancelCheckout();
    captureKioskEvent(KioskEventName.PaymentIniatiationCancelled, {
      payment_type: "PAY_AT_RESTAURANT",
      net_amount: netAmountRdx,
    });
  }, [cancelCheckout, netAmountRdx]);

  if (showUnavailable) {
    return (
      <div
        data-testid="payment-unavailable"
        className="relative h-full w-[1080px] overflow-hidden bg-tb-purple"
      >
        <PaymentChrome ada={ada} />
        <h1
          className={`tb-display absolute left-1/2 ${ada ? "top-[120px]" : "top-[566px]"} w-[880px] -translate-x-1/2 text-center text-[58px] leading-[56px] tracking-[-1.5px] text-tb-surface`}
        >
          {t("payment.unavailable")}
        </h1>
        <p
          className={`absolute left-1/2 ${ada ? "top-[344px]" : "top-[790px]"} w-[800px] -translate-x-1/2 text-center text-[30px] leading-[40px] text-tb-cream`}
        >
          {t("payment.unavailableBody")}
        </p>
        <button
          type="button"
          data-testid="payment-back"
          onClick={handleBack}
          className={`tb-display absolute left-[24px] ${ada ? "bottom-[18px]" : "top-[1810px]"} h-[92px] w-[1032px] rounded-[8px] border-2 border-tb-surface text-center text-[28px] leading-[28px] tracking-[1px] text-tb-surface`}
        >
          {t("payment.backToMenu")}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="payment-screen"
      className="relative h-full w-[1080px] overflow-hidden bg-tb-purple"
    >
      <PaymentChrome ada={ada} />

      <h1
        className={`tb-display absolute left-1/2 ${ada ? "top-[120px]" : "top-[566px]"} w-[880px] -translate-x-1/2 text-center text-[58px] leading-[56px] tracking-[-1.5px] text-tb-surface`}
      >
        {t("payment.title")}
      </h1>

      {/* TOTAL bar — the SAME net amount the bag checked out with
          (cart.netAmount, written by BagSheet's setAmount(getCheckoutNetAmount)). */}
      <div
        data-testid="payment-total"
        className={`absolute left-1/2 ${ada ? "top-[302px]" : "top-[750px]"} flex h-[112px] w-[848px] -translate-x-1/2 items-center justify-between rounded-[8px] bg-tb-purple-vibrant px-[36px]`}
      >
        <span className="tb-display text-[34px] leading-[34px] tracking-[-0.5px] text-tb-surface">
          {t("payment.total")}
        </span>
        <span className="tb-display text-[34px] leading-[34px] tracking-[-0.5px] text-tb-surface">
          {currency}
          {netAmountRdx.toFixed(2)}
        </span>
      </div>

      <div
        className={`absolute left-1/2 ${ada ? "top-[482px]" : "top-[930px]"} flex -translate-x-1/2 gap-[24px]`}
      >
        {/* PAY WITH CARD BELOW — INERT in P8a. Disabled at the DOM level and
            wired to nothing: there is no onClick, no gateway import and no
            code path from this screen to a terminal or a gateway session.
            Flagged for P8b. */}
        <div
          data-testid="payment-card"
          aria-disabled="true"
          className="flex h-[412px] w-[412px] flex-col items-center justify-center gap-[16px] rounded-[10px] bg-tb-surface px-[32px] opacity-50"
        >
          <span className="tb-display text-center text-[36px] leading-[40px] tracking-[-1px] text-tb-purple">
            {t("payment.payWithCard")}
          </span>
          <span className="text-center text-[22px] leading-[26px] font-bold uppercase tracking-[1px] text-tb-purple/70">
            {t("payment.comingSoon")}
          </span>
        </div>

        <button
          type="button"
          data-testid="payment-counter"
          onClick={handlePayAtCounter}
          className="flex h-[412px] w-[412px] items-center justify-center rounded-[10px] bg-tb-surface px-[32px]"
        >
          <span className="tb-display text-center text-[36px] leading-[40px] tracking-[-1px] text-tb-purple">
            {payAtCounterLabel}
          </span>
        </button>
      </div>

      <button
        type="button"
        data-testid="payment-back"
        onClick={handleBack}
        className={`tb-display absolute left-[24px] ${ada ? "bottom-[18px]" : "top-[1810px]"} h-[92px] w-[1032px] rounded-[8px] border-2 border-tb-surface text-center text-[28px] leading-[28px] tracking-[1px] text-tb-surface`}
      >
        {t("payment.backToMenu")}
      </button>

      {bufferOpen && (
        <div
          data-testid="payment-buffer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-buffer-title"
          className="absolute inset-0 z-50"
        >
          <div aria-hidden className="absolute inset-0 bg-tb-ink-purple/70" />
          <div className="tb-modal-enter absolute left-1/2 top-1/2 w-[676px] rounded-[12px] bg-tb-surface px-[44px] pb-[44px] pt-[56px] text-center">
            <h2
              id="payment-buffer-title"
              className="tb-display mb-[40px] text-[40px] leading-[1.1] tracking-[-1px] text-tb-purple"
            >
              {t("payment.placingOrder")}
            </h2>
            <button
              type="button"
              data-testid="payment-buffer-cancel"
              onClick={handleCancelBuffer}
              className="min-h-[56px] min-w-[280px] rounded-[6px] border-2 border-tb-purple bg-tb-surface px-[24px] py-[14px] text-[20px] font-bold uppercase tracking-[1px] text-tb-purple"
            >
              {t("payment.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
