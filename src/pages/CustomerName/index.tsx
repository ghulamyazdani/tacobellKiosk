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
import useLoyalty from "../../hooks/loyalty/useLoyalty";
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
 * DIVERGENCE (brief decision 7): the fork's Continue either calls
 * pushOrderDirect (when `shouldPlaceLoyaltyOrderDirectly` is true) or routes
 * to /payment. P7c pushes NO order — both paths route to the /checkout stub
 * and hand P8 the decision as `state.directOrder`.
 *
 * No Figma frame exists for this screen — TB design language (KioskStage
 * absolute px, tb-* tokens, FooterBar); flagged for client sign-off.
 */
export default function CustomerName() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

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
    // No global fetch timeout exists on the kiosk base query — bound this
    // call explicitly (Rule 2: every API call has a timeout).
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
   * Fork's navigationControl(), minus the order push: P8 owns payment, so
   * both branches land on the /checkout stub and the direct-order decision
   * travels as router state (brief decision 7).
   */
  const navigationControl = useCallback(() => {
    const directOrder = getIsLoyaltyOn()
      ? shouldPlaceLoyaltyOrderDirectly({
          cartItems: cart?.cartItems,
          redeemedLoyalty,
          netAmount: netAmountRdx,
        })
      : false;

    navigate("/checkout", {
      state: { checkoutRoute: "customerName", directOrder },
    });
  }, [
    cart,
    getIsLoyaltyOn,
    navigate,
    netAmountRdx,
    redeemedLoyalty,
    shouldPlaceLoyaltyOrderDirectly,
  ]);

  const handleContinue = useCallback(() => {
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
  }, [dispatch, inputValue, kioskSettings, navigationControl, t]);

  const handleBack = useCallback(() => {
    dispatch(setCustomerName(inputValue.trim()));
    navigate("/cart");
  }, [dispatch, inputValue, navigate]);

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
      className="relative h-[1920px] w-[1080px] overflow-hidden bg-tb-purple"
    >
      <button
        type="button"
        data-testid="customer-name-back"
        onClick={handleBack}
        className="tb-display absolute left-[40px] top-[40px] min-h-[64px] min-w-[120px] rounded-[8px] border-2 border-tb-surface px-[32px] py-[18px] text-[20px] leading-[20px] text-tb-surface"
      >
        {t("customerName.back")}
      </button>

      <h1 className="tb-display absolute left-1/2 top-[220px] w-[880px] -translate-x-1/2 text-center text-[76px] leading-[70px] tracking-[-2.5px] text-tb-surface">
        {t("customerName.title")}
      </h1>
      <p className="absolute left-1/2 top-[370px] w-[760px] -translate-x-1/2 text-center text-[28px] leading-[36px] text-tb-cream">
        {t("customerName.subtitle")}
      </p>

      <div className="absolute left-1/2 top-[480px] flex h-[100px] w-[844px] -translate-x-1/2 items-center rounded-[10px] border-2 border-tb-purple-vibrant bg-tb-surface px-[28px]">
        <span
          data-testid="customer-name-input"
          className="text-[32px] font-medium text-black"
        >
          {inputValue || (
            <span className="text-black/35">{t("customerName.placeholder")}</span>
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
        disabled={loadingCRM}
        className="tb-display absolute left-1/2 top-[640px] min-h-[104px] w-[600px] -translate-x-1/2 rounded-[8px] bg-tb-pink py-[32px] text-center text-[28px] leading-[24px] text-tb-ink-purple disabled:opacity-60"
      >
        {t("customerName.continue")}
      </button>

      <div className="absolute left-1/2 top-[820px] w-[1000px] -translate-x-1/2">
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

      <FooterBar
        onCancelOrder={() => setCancelOrderOpen(true)}
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
