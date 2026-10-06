import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  paymentSettingsRdx,
  selectCurrency,
  selectDeploymentInfo,
  setShowErrorModal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { selectCart, selectCartAmount } from "@cx-sdk/ordering/state/cart.slice";
import { checkIfCODAvailable } from "@cx-sdk/payments/gateways/paymentOptions";
import { pickPaytmSelections } from "@cx-sdk/payments/gateways/paytmKiosk";
import { setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useAdaActive from "../../hooks/utils/useAdaActive";
import usePayAtCounter, {
  PAY_AT_COUNTER_PAYMENT_TYPE,
} from "../../hooks/paymentsHooks/usePayAtCounter";
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
 * Cancel window between a method tap and the receipt step — the fork's
 * `paymentInitiationBufferTime` (3000ms). Nothing is sent inside it.
 */
const PAYMENT_BUFFER_MS = 3000;

/** One method tile in the row (D9). */
interface MethodTile {
  testId: string;
  /** The payment type the tap arms. */
  type: string;
  label: string;
}

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
 * P8b (user decision 2026-10-05: Paytm Dynamic QR + Paytm EDC only; every
 * other gateway stays unported). One row of method tiles, in this order:
 *   `payment-card`    PaytmEdc        "PAY WITH CARD BELOW" (the frame's tile)
 *   `payment-qr`      PaytmDynamicQr  design language (no frame), LIVE (D1)
 *   `payment-counter` PAY AT COUNTER  only when COD is available
 * The Paytm tiles come from the SDK's `pickPaytmSelections`, which offers an
 * option only when its credentials are usable (a tile that can only fail is
 * never shown), and they hide when there is nothing to charge. A tap only
 * ARMS `payment.paymentType` and opens the same 3 s cancel window as COD —
 * NOTHING is sent from this screen. The Paytm initiate runs on /receipt
 * (usePaytmCheckout), so Cancel is always strictly before money moves.
 * Credentials are never dispatched from here (D11).
 *
 * Rule 1: /payment → /receipt for Paytm reuses the existing COD edge; no
 * transition is added or removed on this screen.
 *
 * Layout (D9, design language, flagged): one tile keeps the Figma 412×412;
 * n ≥ 2 tiles are (848 − 24(n−1))/n wide. Labels are 36 px; at n = 3 they
 * drop to 24 px with 16 px side padding — measured: "RESTAURANT" in Archivo
 * Expanded Black is 270 px at 30 px, wider than the 267 px tile.
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
  const dispatch = useDispatch();
  const ada = useAdaActive();

  const netAmountRdx = Number(useSelector(selectCartAmount) ?? 0);
  const deploymentSettings = useSelector(selectDeploymentInfo) as
    | Record<string, unknown>
    | undefined;
  const paymentOptions: unknown = useSelector(paymentSettingsRdx);
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

  // The payment type the open cancel window armed; null = window closed.
  const [armedType, setArmedType] = useState<string | null>(null);
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

  /** Usable Paytm options; none when there is nothing to charge. */
  const selections = useMemo(
    () => (netAmountRdx > 0 ? pickPaytmSelections(paymentOptions) : []),
    [netAmountRdx, paymentOptions]
  );

  /** Fork parity: the unavailable branch is `zero gateways AND no COD`. */
  const showUnavailable = selections.length === 0 && !codAvailable;

  const payAtCounterLabel = getIsPayAtCounter()
    ? t("payment.payAtCounter")
    : t("payment.payAtRestaurant");

  const edc = selections.find((option) => option.kind === "paytmEdc");
  const dqr = selections.find((option) => option.kind === "paytmDqr");
  const tiles: MethodTile[] = [
    ...(edc
      ? [{ testId: "payment-card", type: edc.paymentType, label: t("payment.payWithCard") }]
      : []),
    ...(dqr
      ? [{ testId: "payment-qr", type: dqr.paymentType, label: t("paytm.methodQr") }]
      : []),
    ...(codAvailable
      ? [{ testId: "payment-counter", type: PAY_AT_COUNTER_PAYMENT_TYPE, label: payAtCounterLabel }]
      : []),
  ];
  const tileWidth =
    tiles.length === 1 ? 412 : (848 - 24 * (tiles.length - 1)) / tiles.length;
  const narrow = tiles.length === 3;

  useEffect(() => {
    if (viewedFired.current) return;
    viewedFired.current = true;
    captureKioskEvent(KioskEventName.PaymentViewed, {
      method_count: selections.length,
      cod_available: codAvailable,
      net_amount: netAmountRdx,
    });
  }, [codAvailable, selections.length, netAmountRdx]);

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
   * A method tile. ARMS the payment type (COD via beginCheckout, unchanged;
   * Paytm by setKioskPaymentType), then opens the cancel window. The window
   * ends by navigating to the receipt step — the push / initiate happens
   * THERE, so Cancel here is always strictly before anything is sent.
   *
   * The buffer lives in component state (the fork drove the equivalent effect
   * off `redirectionRef.current` in a dependency array — a ref mutation does
   * not re-render, so that effect fired on unrelated renders). The timer ref
   * also latches a same-render double tap.
   */
  const handleMethod = useCallback(
    (type: string) => {
      if (armedType !== null || bufferTimer.current !== null) return;
      captureKioskEvent(KioskEventName.PaymentMethodSelected, {
        payment_type: type,
        net_amount: netAmountRdx,
      });
      if (type === PAY_AT_COUNTER_PAYMENT_TYPE) {
        beginCheckout();
      } else {
        dispatch(setShowErrorModal({ showErrorModal: false, errorMessage: "" }));
        dispatch(setKioskPaymentType({ type }));
      }
      setArmedType(type);
      bufferTimer.current = window.setTimeout(() => {
        bufferTimer.current = null;
        navigate("/receipt");
      }, PAYMENT_BUFFER_MS);
    },
    [armedType, beginCheckout, dispatch, navigate, netAmountRdx]
  );

  const handleCancelBuffer = useCallback(() => {
    if (bufferTimer.current !== null) {
      window.clearTimeout(bufferTimer.current);
      bufferTimer.current = null;
    }
    setArmedType(null);
    if (armedType !== PAY_AT_COUNTER_PAYMENT_TYPE) {
      // Paytm: nothing was sent. Disarm, so no stale gateway type survives
      // into a later payload (planner refinement).
      captureKioskEvent(KioskEventName.PaymentIniatiationCancelled, {
        payment_type: armedType,
        net_amount: netAmountRdx,
      });
      dispatch(setKioskPaymentType({ type: "" }));
      return;
    }
    cancelCheckout();
    captureKioskEvent(KioskEventName.PaymentIniatiationCancelled, {
      payment_type: "PAY_AT_RESTAURANT",
      net_amount: netAmountRdx,
    });
  }, [armedType, cancelCheckout, dispatch, netAmountRdx]);

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
        {tiles.map((tile) => (
          <button
            key={tile.testId}
            type="button"
            data-testid={tile.testId}
            onClick={() => handleMethod(tile.type)}
            style={{ width: tileWidth }}
            className={`flex h-[412px] items-center justify-center rounded-[10px] bg-tb-surface ${narrow ? "px-[16px]" : "px-[32px]"}`}
          >
            <span
              className={`tb-display text-center ${narrow ? "text-[24px] leading-[28px]" : "text-[36px] leading-[40px]"} tracking-[-1px] text-tb-purple`}
            >
              {tile.label}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="payment-back"
        onClick={handleBack}
        className={`tb-display absolute left-[24px] ${ada ? "bottom-[18px]" : "top-[1810px]"} h-[92px] w-[1032px] rounded-[8px] border-2 border-tb-surface text-center text-[28px] leading-[28px] tracking-[1px] text-tb-surface`}
      >
        {t("payment.backToMenu")}
      </button>

      {armedType !== null && (
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
              {armedType === PAY_AT_COUNTER_PAYMENT_TYPE
                ? t("payment.placingOrder")
                : t("paytm.redirecting")}
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
