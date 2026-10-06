import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  kiosSettingsRdx,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  selectCustomerName,
  selectCustomerPhone,
  setCustomerName,
} from "@cx-sdk/core/customer/customerInfo.slice";
import { useGetCustomerNameByNumberMutation } from "@cx-sdk/core/customer/services/customerInfo";
import { selectCart, selectCartAmount } from "@cx-sdk/ordering/state/cart.slice";
import { selectRedeemedLoyalty } from "@cx-sdk/ordering/state/loyalty.slice";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useAdaActive from "../../hooks/utils/useAdaActive";
import useLoyalty from "../../hooks/loyalty/useLoyalty";
import usePayAtCounter from "../../hooks/paymentsHooks/usePayAtCounter";
import useSessionReset from "../../hooks/utils/useSessionReset";
import KioskKeyboard from "../../components/keyboard/KioskKeyboard";
import FooterBar from "../../components/chrome/FooterBar";
import LanguageSheet from "../../components/language/LanguageSheet";
import CancelOrderModal from "../../components/common/CancelOrderModal";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import inputClear from "../../assets/icons/input-clear.svg";

/** One CRM record from `POST /api/cx/kiosk/getCustomerNameByNumber`. */
interface CrmRecord {
  firstname?: string;
  lastname?: string;
  updated?: string;
}

/** Only the flag this screen gates on. */
interface NameKioskSettings {
  crm_name_mandatory?: boolean;
}

interface CartLike {
  cartItems?: unknown[];
}

/** Longest first name the keyboard will accept. */
const NAME_MAX_LENGTH = 32;
/** Hard ceiling on the CRM prefill lookup — Rule 2 (no unbounded request). */
const CRM_LOOKUP_TIMEOUT_MS = 10000;

/**
 * /customerName — the checkout-time identity screen (contract step 10).
 *
 * With loyalty on the preflight already resolves to "customerName" (the
 * phone was collected before the menu), so this screen only needs the
 * name: prefilled from the CRM (`getCustomerNameByNumber`, newest `updated`
 * record's `firstname`) ONLY when the redux name is empty, gated on
 * `crm_name_mandatory`, then committed with `setCustomerName(trim)`.
 *
 * P8a — the fan-out this screen now owns (the /checkout stub is gone):
 *   directOrder === false → /payment
 *   directOrder === true  → NO /payment at all: push the order here and land
 *                           on /orderSuccess (usePayAtCounter.placeOrder).
 *
 * `directOrder` is `shouldPlaceLoyaltyOrderDirectly(...)`, i.e. the zero-bill
 * loyalty case where a redeemed reward covers the whole order. P7c shipped it
 * as `state.directOrder` on the way to the stub; with the stub deleted the
 * decision is CONSUMED here, computed from the same three redux inputs it was
 * always computed from.
 *
 * DELIBERATE: an inbound `location.state.directOrder` is NOT honoured. This
 * screen is reachable from the bag, /tent and /phone, and a caller-supplied
 * `true` on a non-zero bill would place a real, unpaid order with
 * `payment.paymentType` still "" — the decision stays local, where the bill
 * that justifies it is.
 *
 * QUIRK (preserved, not fixed): on the direct path `payment.paymentType` is
 * deliberately left as-is (""), so buildPushOrderPayload emits
 * `payments.type: "ONLINE"` rather than "COD" — matching the fork. It is NOT
 * the pay-at-counter string, and it must not be "quietly corrected" here: the
 * three-way switch in useOrderHook.pushOrder treats "" like the default
 * branch (pushOnlineOrder), which is the correct endpoint for this path.
 * Flagged for the data owner.
 *
 * No Figma frame exists for this screen — TB design language (KioskStage
 * absolute px, tb-* tokens, FooterBar); flagged for client sign-off.
 *
 * ADA (P9c, design-language, flagged): same controls, same sizes, re-stacked
 * into the 1122px reach zone (1066 above the footer): BACK 40–104 · title
 * 120–260 (2 lines) · subtitle 270–306 · input 330–430 · continue 454–558 ·
 * keyboard 598–1027 · footer 1066. Nothing scrolls. The full-cover overlays
 * (CRM loading, order-error) are `inset-0`, so they follow the page height.
 * ponytail: tops are tuned to the Figma zone — the keyboard clears the footer
 * only while ADA_BRAND_ZONE_HEIGHT ≤ 837; past that, re-derive them.
 */
export default function CustomerName() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const ada = useAdaActive();

  const kioskSettings = useSelector(kiosSettingsRdx) as NameKioskSettings | undefined;
  const customerNameRdx = (useSelector(selectCustomerName) as string | undefined) ?? "";
  const phoneNumber = (useSelector(selectCustomerPhone) as string | undefined) ?? "";
  const cart = useSelector(selectCart) as CartLike | undefined;
  const netAmountRdx = Number(useSelector(selectCartAmount) ?? 0);
  const redeemedLoyalty = useSelector(selectRedeemedLoyalty);

  const { getIsLoyaltyOn } = useAppSettings();
  const { shouldPlaceLoyaltyOrderDirectly, checkAndRevokeLoyaltyReward } =
    useLoyalty();
  const { resetSession } = useSessionReset();
  // The guarded push shared with /payment: id → pending → pushOrder →
  // /orderSuccess, with the settlement retry ladder and the `placedRef`
  // one-order-per-customer latch. Its whole network surface is
  // POST /api/onlineOrders/partner/kiosk/placeOrder — no gateway, no terminal.
  const {
    start: startOrderPush,
    isBuffering,
    isPushing,
    hasFailed,
    failedOnTimeout,
    retry: retryOrderPush,
    dismissError,
  } = usePayAtCounter();
  const [getCustomerNameByNumber] = useGetCustomerNameByNumberMutation();

  // The store's name is the starting value; the CRM lookup only runs when it
  // is empty (contract step 10), so no effect has to seed the field.
  const [inputValue, setInputValue] = useState(customerNameRdx);
  const [loadingCRM, setLoadingCRM] = useState(
    () => phoneNumber.length > 0 && customerNameRdx.length === 0
  );
  const [languageOpen, setLanguageOpen] = useState(false);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  // In-flight CRM lookup, so the timeout and unmount can both abort it.
  const crmRequest = useRef<{ abort: () => void } | null>(null);

  /**
   * The order is committed. The single-shot latch is NOT duplicated here: the
   * hook owns it (`placedRef` is set the instant a push resolves and is never
   * cleared, and `start()` refuses unless status is "idle"), which is a
   * stronger guarantee than a screen-local ref — it survives this component's
   * own re-renders and covers `retry()` too.
   */
  const placingOrder = isBuffering || isPushing;

  /**
   * CRM prefill (mount-only). Best-effort by design: any failure (offline,
   * 4xx, abort, timeout) leaves the field as-is for the customer to type —
   * it must never block the screen (Rule 2). Every state write happens in a
   * promise callback, never synchronously in the effect body (house
   * react-hooks rules forbid set-state-in-effect).
   */
  useEffect(() => {
    if (phoneNumber.length === 0 || customerNameRdx.length > 0) return;

    const request = getCustomerNameByNumber({ phone_number: phoneNumber });
    crmRequest.current = request;
    // Bounded here as well as by the transport's host-configured budget
    // (apiSlice), so the prefill stays ≤ 10 s whatever that config says.
    const timeout = window.setTimeout(
      () => request.abort(),
      CRM_LOOKUP_TIMEOUT_MS
    );

    request
      .unwrap()
      .then((body: CrmRecord[] | { data?: CrmRecord[] } | undefined) => {
        // The wire body is an array of CRM records; it may arrive nested
        // one level under `data`.
        let records: CrmRecord[] = [];
        if (Array.isArray(body)) {
          records = body;
        } else if (body && Array.isArray(body.data)) {
          records = body.data;
        }
        // `updated` is an ISO date string — take the most recent record.
        const latest = [...records].sort(
          (a, b) =>
            new Date(b?.updated ?? 0).getTime() -
            new Date(a?.updated ?? 0).getTime()
        )[0];
        const crmName =
          typeof latest?.firstname === "string" ? latest.firstname.trim() : "";
        if (crmName.length > 0) setInputValue(crmName);
      })
      .catch(() => {
        // Prefill is optional — leave the field for the customer to type.
      })
      .finally(() => {
        window.clearTimeout(timeout);
        crmRequest.current = null;
        setLoadingCRM(false);
      });

    return () => {
      // Never leave a request (or its setState) outliving the screen (Rule 5).
      window.clearTimeout(timeout);
      crmRequest.current?.abort();
      crmRequest.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only prefill
  }, []);

  /**
   * Fork's navigationControl(), with the real P8a destinations wired in.
   *
   * `mode: "directOrder"` is what tells usePayAtCounter to SKIP the
   * `setKioskPaymentType` dispatch, which is the preserved quirk described in
   * the file header. It also defaults the buffer to 0ms (the fork pushes this
   * path immediately) and the receipt to "none" — there is no /receipt step on
   * a zero-bill loyalty order.
   *
   * Failure is not a dead end (Rule 2): the hook runs the settlement ladder
   * internally and, only once it is exhausted (or an attempt timed out —
   * U2, never auto-retried), flips `hasFailed`. This screen then renders the
   * terminal `order-error` panel with Retry and Back to bag.
   */
  const navigationControl = useCallback(() => {
    const directOrder = getIsLoyaltyOn()
      ? shouldPlaceLoyaltyOrderDirectly({
          cartItems: cart?.cartItems,
          redeemedLoyalty,
          netAmount: netAmountRdx,
        })
      : false;

    if (!directOrder) {
      navigate("/payment");
      return;
    }

    // start() is itself idempotent (placed/in-flight latch + status guard) and
    // navigates to /orderSuccess on success.
    startOrderPush({ mode: "directOrder" });
  }, [
    cart,
    getIsLoyaltyOn,
    navigate,
    netAmountRdx,
    redeemedLoyalty,
    shouldPlaceLoyaltyOrderDirectly,
    startOrderPush,
  ]);

  const handleContinue = useCallback(() => {
    // Second line of defence behind the disabled button: a push in flight (or
    // a terminal failure awaiting its own CTAs) owns the screen.
    if (placingOrder || hasFailed) return;
    const trimmed = inputValue.trim();
    if (kioskSettings?.crm_name_mandatory && trimmed.length === 0) {
      dispatch(
        setShowErrorModalGlobal({
          showErrorModal: true,
          errorMessage: t("customerName.required"),
        })
      );
      return;
    }
    if (trimmed.length > 0) {
      dispatch(setCustomerName(trimmed));
    } else {
      captureKioskEvent(KioskEventName.CRMCustomerNameSkipped, {
        skip_reason: "name_not_mandatory",
      });
    }
    navigationControl();
  }, [
    dispatch,
    hasFailed,
    inputValue,
    kioskSettings,
    navigationControl,
    placingOrder,
    t,
  ]);

  /**
   * Terminal-failure exit. `dismissError()` returns the hook to "idle" so the
   * screen is fully live again. The order id is NOT kept: leaving unmounts
   * this screen's hook instance, so a later push mints a new id — only the
   * panel's Retry reuses it.
   */
  const handleOrderErrorBack = useCallback(() => {
    dismissError();
    navigate("/cart");
  }, [dismissError, navigate]);

  const handleBack = useCallback(() => {
    // Back is refused only while an order is actually being pushed — leaving
    // then would strand a placed order behind the customer.
    if (placingOrder) return;
    dispatch(setCustomerName(inputValue.trim()));
    navigate("/cart");
  }, [dispatch, inputValue, navigate, placingOrder]);

  const handleCancelConfirm = useCallback(() => {
    setCancelOrderOpen(false);
    // Contract trap 1: the revoke reads the render-time claimed-coupon
    // closure, so it MUST be fired before resetSession clears it. Failure
    // is swallowed — a dead partner must never block the reset (Rule 2).
    checkAndRevokeLoyaltyReward().catch(() => {});
    resetSession("full");
    navigate("/start");
  }, [checkAndRevokeLoyaltyReward, navigate, resetSession]);

  return (
    <div
      data-testid="customer-name-screen"
      className="relative h-full w-[1080px] overflow-hidden bg-tb-purple"
    >
      <button
        type="button"
        data-testid="customer-name-back"
        onClick={handleBack}
        className="tb-display absolute left-[40px] top-[40px] min-h-[64px] min-w-[120px] rounded-[8px] border-2 border-tb-surface px-[32px] py-[18px] text-[20px] leading-[20px] text-tb-surface"
      >
        {t("customerName.back")}
      </button>

      <h1
        className={`tb-display absolute left-1/2 ${ada ? "top-[120px]" : "top-[220px]"} w-[880px] -translate-x-1/2 text-center text-[76px] leading-[70px] tracking-[-2.5px] text-tb-surface`}
      >
        {t("customerName.title")}
      </h1>
      <p
        className={`absolute left-1/2 ${ada ? "top-[270px]" : "top-[370px]"} w-[760px] -translate-x-1/2 text-center text-[28px] leading-[36px] text-tb-cream`}
      >
        {t("customerName.subtitle")}
      </p>

      <div
        className={`absolute left-1/2 ${ada ? "top-[330px]" : "top-[480px]"} flex h-[100px] w-[844px] -translate-x-1/2 items-center rounded-[10px] border-2 border-tb-purple-vibrant bg-tb-surface px-[28px]`}
      >
        <span
          data-testid="customer-name-input"
          className="text-[32px] font-medium text-black"
        >
          {inputValue || (
            <span className="text-black/55">{t("customerName.placeholder")}</span>
          )}
        </span>
        {inputValue.length > 0 && (
          <button
            type="button"
            data-testid="customer-name-clear"
            aria-label={t("customerName.clear")}
            onClick={() => setInputValue("")}
            className="absolute right-[24px] h-[44px] w-[44px] p-[10px]"
          >
            <img alt="" src={inputClear} className="h-full w-full" />
          </button>
        )}
      </div>

      <button
        type="button"
        data-testid="customer-name-continue"
        onClick={handleContinue}
        disabled={loadingCRM || placingOrder}
        className={`tb-display absolute left-1/2 ${ada ? "top-[454px]" : "top-[640px]"} min-h-[104px] w-[600px] -translate-x-1/2 rounded-[8px] bg-tb-pink py-[32px] text-center text-[28px] leading-[24px] text-tb-ink-purple disabled:opacity-60`}
      >
        {placingOrder ? t("payment.placingOrder") : t("customerName.continue")}
      </button>

      <div
        className={`absolute left-1/2 ${ada ? "top-[598px]" : "top-[820px]"} w-[1000px] -translate-x-1/2`}
      >
        <KioskKeyboard
          value={inputValue}
          onChange={setInputValue}
          maxLength={NAME_MAX_LENGTH}
        />
      </div>

      {loadingCRM && (
        <div
          data-testid="customer-name-loading"
          className="absolute inset-0 z-50 flex items-center justify-center bg-tb-ink-purple/40"
        >
          <p className="tb-display text-[32px] leading-[36px] text-tb-surface">
            {t("customerName.loading")}
          </p>
        </div>
      )}

      {/* TERMINAL PUSH FAILURE (Rule 2). The fork's equivalent path only
          console.errors and leaves the customer staring at a spinner; here the
          exhausted retry ladder surfaces as an explicit screen with two live
          exits. z-[60] clears the in-session overlay wrappers (z-45 / z-55)
          mounted by AppRoutes, so nothing can paint over it. After a TIMEOUT
          the order may exist, so the copy switches to the uncertain variant
          (design-language, flagged for client sign-off). */}
      {hasFailed && (
        <div
          data-testid="order-error"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="order-error-title"
          aria-describedby="order-error-message"
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-[40px] bg-tb-ink-purple/95 px-[90px] text-center"
        >
          <h2
            id="order-error-title"
            className="tb-display text-[64px] leading-[60px] tracking-[-2px] text-tb-surface"
          >
            {t(failedOnTimeout ? "orderError.uncertainTitle" : "orderError.title")}
          </h2>
          <p
            id="order-error-message"
            className="max-w-[820px] text-[30px] leading-[40px] text-tb-cream"
          >
            {t(
              failedOnTimeout
                ? "orderError.uncertainMessage"
                : "orderError.message"
            )}
          </p>
          <button
            type="button"
            data-testid="order-error-retry"
            onClick={retryOrderPush}
            className="tb-display min-h-[104px] w-[600px] rounded-[8px] bg-tb-pink py-[32px] text-[28px] leading-[24px] text-tb-ink-purple"
          >
            {t("orderError.retry")}
          </button>
          <button
            type="button"
            data-testid="order-error-back"
            onClick={handleOrderErrorBack}
            className="tb-display min-h-[88px] w-[600px] rounded-[8px] border-2 border-tb-surface py-[26px] text-[24px] leading-[24px] text-tb-surface"
          >
            {t("orderError.backToBag")}
          </button>
        </div>
      )}

      {/* Cancel Order is suppressed while a push is in flight: confirming it
          runs resetSession("full"), which would clear the cart and the order
          id out from under an order the backend may already have accepted.
          The ladder resolves (success navigates away, failure re-enables
          everything); idle is held while it runs (usePayAtCounter →
          useIdleHold). Every attempt is transport-bounded, so the hold ends
          in ≤ 46 s, and its cap (IDLE_HOLD_MAX_MS) is a backstop — a pause,
          never a trap. */}
      <FooterBar
        onCancelOrder={() => {
          if (placingOrder) return;
          setCancelOrderOpen(true);
        }}
        onOpenLanguage={() => setLanguageOpen(true)}
      />
      <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
      <CancelOrderModal
        open={cancelOrderOpen}
        onConfirm={handleCancelConfirm}
        onCancel={() => setCancelOrderOpen(false)}
      />
    </div>
  );
}
