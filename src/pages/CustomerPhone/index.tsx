import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  kiosSettingsRdx,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { selectCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import {
  selectCustomerPhone,
  setCustomerName,
  setPhoneNumberRdx,
} from "@cx-sdk/core/customer/customerInfo.slice";
import {
  openLoyaltyItemsModal,
  selectIsReeloLoyalty,
  setLoyaltyCouponAvailable,
} from "@cx-sdk/ordering/state/loyalty.slice";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useAdaActive from "../../hooks/utils/useAdaActive";
import useLoyalty from "../../hooks/loyalty/useLoyalty";
import KioskNumpad from "../../components/keyboard/KioskNumpad";
import FooterBar from "../../components/chrome/FooterBar";
import LanguageSheet from "../../components/language/LanguageSheet";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import tbBell from "../../assets/brand/tb-bell.svg";

/** `{code, dialCode, min, max}` — core/auth `selectedCountryCode`. */
interface CountryCode {
  code?: string;
  dialCode?: string;
  min?: number;
  max?: number;
}

/** Only the two CRM flags this screen gates on. */
interface PhoneKioskSettings {
  crm_phone_mandatory?: boolean;
  crm_name_mandatory?: boolean;
}

/** `check_loyalty_balance` envelope, as read by the fork's redirection(). */
interface LoyaltyBalanceResponse {
  status_code?: number;
  response?: {
    coupons?: unknown[];
    loyalty_points?: number;
  };
}

/** Router state this screen may be entered with (P8a checkout fan-out). */
interface PhoneLocationState {
  /** The preflight route BagSheet decided on; "phone" ⇒ CHECKOUT MODE. */
  checkoutRoute?: string;
}

/** Longest phone number the numpad will accept when a country carries no max. */
const PHONE_MAX_LENGTH = 15;
/** Masked-but-last window, fork parity (CustomerPhone.tsx:88). */
const LAST_DIGIT_REVEAL_MS = 2000;

const maskExceptLast = (input: string) =>
  input.length <= 1 ? input : `${"*".repeat(input.length - 1)}${input[input.length - 1]}`;

/**
 * /phone — loyalty identity lookup, reached from /second when loyalty is on
 * (getIsLoyaltyOn: kiosk_settings.enable_loyalty AND the partner blob).
 *
 * Flow parity with posistKiosk CustomerPhone.tsx (P7c contract step 3):
 * digits via the numpad, masked-but-last for 2s, min/max from the selected
 * country (validation SKIPPED when the country carries neither), the name
 * cleared whenever the number changes, then `executeLoyalty` →
 * `check_loyalty_balance` (a pure lookup, NO OTP here). Xeno success with
 * coupons AND points opens the rewards sheet with its auto-dismiss timer.
 *
 * DIVERGENCE (brief decision 8): the fork's catch branch navigates to
 * /customerName; TB navigates to /menu — a failed lookup must never block
 * ordering, and /customerName is a checkout-time screen here.
 *
 * CHECKOUT MODE (P8a). The SAME screen is also the "phone" leg of the
 * checkout fan-out, entered from the bag (or /tent) with
 * `location.state.checkoutRoute === "phone"`. resolveCheckoutRoute only
 * returns "phone" when loyalty is OFF, so in this mode `redirection()` takes
 * its `!isLoyaltyOnSetting` early-return and NO check_loyalty_balance lookup
 * is ever fired — the screen is a pure CRM phone capture.
 *
 * The mode changes exactly two edges and nothing else, so the pre-menu
 * behaviour stays byte-identical:
 *   Continue / Skip → /customerName   (pre-menu: /menu)
 *   Back            → /cart           (pre-menu: /second)
 * Validation, masking, the CRM mandatory gates, the analytics vocabulary and
 * every rendered string are untouched by the mode.
 *
 * No Figma frame exists for this screen — TB design language (KioskStage
 * absolute px, tb-* tokens, FooterBar); flagged for client sign-off.
 *
 * ADA (P9c, design-language, flagged): the same controls at the same sizes,
 * re-stacked into the 1122px reach zone (1066 above the footer). The bell is
 * dropped (the brand zone carries the brand) and the gaps shrink to 16–20px:
 * BACK 40–104 · title 120–260 (2 lines) · subtitle 260–296 · input 316–416 ·
 * numpad 436–856 · continue 876–980 · skip 996–1048 · footer 1066. Nothing
 * scrolls — the keypad and both CTAs stay fully visible.
 * ponytail: tops are tuned to the Figma zone — skip clears the footer only
 * while ADA_BRAND_ZONE_HEIGHT ≤ 816; recalibrating past that needs these
 * re-derived (or a flex column).
 */
export default function CustomerPhone() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const ada = useAdaActive();

  // CHECKOUT MODE latch. Read once per render from router state — react-router
  // keeps `location.state` stable for the life of the entry, so this cannot
  // flip mid-screen and strand the customer on the wrong exit.
  const isCheckoutMode =
    (location.state as PhoneLocationState | null)?.checkoutRoute === "phone";

  const kioskSettings = useSelector(kiosSettingsRdx) as PhoneKioskSettings | undefined;
  const selectedCountryCode = useSelector(selectCountryCode) as CountryCode | undefined;
  const phoneRdx = (useSelector(selectCustomerPhone) as string | undefined) ?? "";
  const isReeloLoyalty = Boolean(useSelector(selectIsReeloLoyalty));

  const { getTabType, getIsLoyaltyOn } = useAppSettings();
  const { executeLoyalty, isLoyaltyEventLoading } = useLoyalty();
  const tabType = getTabType();
  const isLoyaltyOnSetting = getIsLoyaltyOn();

  const [inputValue, setInputValue] = useState<string>(phoneRdx);
  const [isPhoneVisible, setIsPhoneVisible] = useState(false);
  const [showLastDigit, setShowLastDigit] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  // One lookup per tap: executeLoyalty resolves asynchronously and navigates,
  // so a second tap must not fire a second check_loyalty_balance (Rule 2).
  const isSubmitting = useRef(false);
  const revealTimer = useRef<number | null>(null);
  // The lookup continuation dispatches + navigates after its await. Once this
  // screen is gone (Back, Skip, Cancel, idle → /start after the hold cap) it
  // must do neither: it would yank the kiosk off whatever screen it is on now
  // (Rule 1) and, after a session end, open the rewards sheet for the NEXT
  // customer.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    captureKioskEvent(KioskEventName.NumberScreenViewed, {
      loyalty_enabled: isLoyaltyOnSetting,
      tab_type: tabType,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only view event
  }, []);

  // Reveal the digit just typed for 2s, then fall back to a full mask (fork
  // parity). Driven from the key handler rather than an effect (house
  // react-hooks rules forbid set-state-in-effect); the timer is restarted on
  // every keystroke and cleared on unmount (Rule 5: no stray timers).
  const handleDigitsChange = useCallback((next: string) => {
    setInputValue(next);
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    if (next.length === 0) {
      setShowLastDigit(false);
      return;
    }
    setShowLastDigit(true);
    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = null;
      setShowLastDigit(false);
    }, LAST_DIGIT_REVEAL_MS);
  }, []);

  useEffect(
    () => () => {
      if (revealTimer.current !== null) {
        window.clearTimeout(revealTimer.current);
        revealTimer.current = null;
      }
    },
    []
  );

  const displayValue = isPhoneVisible
    ? inputValue
    : showLastDigit
      ? maskExceptLast(inputValue)
      : "*".repeat(inputValue.length);

  /** Fork parity: a changed number invalidates the CRM name. */
  const commitPhone = useCallback(() => {
    if (phoneRdx !== inputValue) {
      dispatch(setCustomerName(""));
    }
    dispatch(setPhoneNumberRdx(inputValue));
  }, [dispatch, inputValue, phoneRdx]);

  /**
   * Fork's navigationControl(). Pre-menu (loyalty on) both branches land on
   * /menu; in CHECKOUT MODE the screen is the "phone" leg of the checkout
   * fan-out and continues to the name capture instead (P8a).
   */
  const navigationControl = useCallback(() => {
    navigate(isCheckoutMode ? "/customerName" : "/menu");
  }, [isCheckoutMode, navigate]);

  /** Fork's redirection() — the Xeno branch of the partner table. */
  const redirection = useCallback(() => {
    if (!isLoyaltyOnSetting) {
      captureKioskEvent(KioskEventName.OrderCheckinNotAvailable, {
        reason: "no_loyalty_config",
      });
      navigationControl();
      return;
    }

    isSubmitting.current = true;
    captureKioskEvent(KioskEventName.AccountSendCode, {
      country_code: selectedCountryCode?.dialCode,
    });

    executeLoyalty({
      countryCode: selectedCountryCode?.dialCode,
      phoneNumber: inputValue,
    })
      .then((resp: LoyaltyBalanceResponse | undefined) => {
        if (!mountedRef.current) return;
        if (resp?.status_code === 200) {
          const res = resp?.response;
          const couponCount = res?.coupons?.length ?? 0;
          const points = res?.loyalty_points ?? 0;
          if (couponCount > 0 && points > 0) {
            captureKioskEvent(KioskEventName.AccountReorderAvailable, {
              coupon_count: couponCount,
              loyalty_points: points,
            });
            // Reelo redeems POINTS from the cart, not the Xeno coupon sheet —
            // suppress the items modal for it (Reelo itself is deferred, P7c
            // brief decision 9; the guard keeps the branch honest).
            if (!isReeloLoyalty) {
              dispatch(openLoyaltyItemsModal({ isTimerOn: true }));
              dispatch(setLoyaltyCouponAvailable(true));
            } else {
              dispatch(setLoyaltyCouponAvailable(false));
            }
          } else {
            captureKioskEvent(KioskEventName.AccountReorderUnavailable, {
              reason: "no_coupons_or_points",
            });
            dispatch(setLoyaltyCouponAvailable(false));
          }
        } else {
          captureKioskEvent(KioskEventName.OrderCheckinNotAvailable, {
            reason: "api_error",
          });
          dispatch(setLoyaltyCouponAvailable(false));
        }
        navigationControl();
      })
      .catch((error: { message?: string }) => {
        if (!mountedRef.current) return;
        captureKioskEvent(KioskEventName.AccountResendCodeError, {
          error_message: error?.message,
        });
        // DIVERGENCE (brief decision 8): fork goes to /customerName; a failed
        // lookup must never block ordering, so TB continues to the menu.
        dispatch(setLoyaltyCouponAvailable(false));
        navigationControl();
      })
      .finally(() => {
        isSubmitting.current = false;
      });
  }, [
    dispatch,
    executeLoyalty,
    inputValue,
    isLoyaltyOnSetting,
    isReeloLoyalty,
    navigationControl,
    selectedCountryCode,
  ]);

  const showError = useCallback(
    (errorMessage: string) => {
      dispatch(
        setShowErrorModalGlobal({ showErrorModal: true, errorMessage })
      );
    },
    [dispatch]
  );

  const submitNumber = useCallback(() => {
    captureKioskEvent(KioskEventName.PhoneNumberEntered, {
      phone_length: inputValue.length,
      country_code: selectedCountryCode?.dialCode,
    });
    commitPhone();
    redirection();
  }, [commitPhone, inputValue.length, redirection, selectedCountryCode]);

  const skipPhoneAndName = useCallback(() => {
    captureKioskEvent(KioskEventName.AccountSignupSkipped, {
      skip_reason: "phone_not_mandatory",
    });
    captureKioskEvent(KioskEventName.CRMPhoneNumeberSkipped, {});
    navigationControl();
  }, [navigationControl]);

  const handleContinue = useCallback(() => {
    if (isSubmitting.current || isLoyaltyEventLoading) return;

    const phoneMandatory = Boolean(kioskSettings?.crm_phone_mandatory);
    const nameMandatory = Boolean(kioskSettings?.crm_name_mandatory);
    const length = inputValue.length;
    const min = selectedCountryCode?.min;
    const max = selectedCountryCode?.max;

    // Neither field is collected and nothing was typed → straight through.
    if (!phoneMandatory && !nameMandatory && length === 0) {
      skipPhoneAndName();
      return;
    }

    // Optional phone, left blank → commit the empty value and continue.
    if (!phoneMandatory && length === 0) {
      commitPhone();
      redirection();
      return;
    }

    // Contract step 3: length validation is SKIPPED when the selected country
    // carries neither a min nor a max.
    if (!min || !max) {
      submitNumber();
      return;
    }

    if (length >= min && length <= max) {
      submitNumber();
      return;
    }

    if (phoneMandatory) {
      showError(t("phone.invalidNumber"));
    } else if (min === max) {
      showError(t("phone.exactDigits", { digits: min }));
    } else {
      showError(t("phone.digitRange", { min, max }));
    }
  }, [
    commitPhone,
    inputValue.length,
    isLoyaltyEventLoading,
    kioskSettings,
    redirection,
    selectedCountryCode,
    showError,
    skipPhoneAndName,
    submitNumber,
    t,
  ]);

  // Back never dead-ends (Rule 1): pre-menu it returns to the order-type
  // screen, in checkout mode to the bag the customer came from.
  const handleBack = useCallback(() => {
    commitPhone();
    navigate(isCheckoutMode ? "/cart" : "/second");
  }, [commitPhone, isCheckoutMode, navigate]);

  const canSkip =
    !kioskSettings?.crm_phone_mandatory && !kioskSettings?.crm_name_mandatory;
  const maxDigits = selectedCountryCode?.max ?? PHONE_MAX_LENGTH;

  return (
    <div
      data-testid="phone-screen"
      className="relative h-full w-[1080px] overflow-hidden bg-tb-purple"
    >
      <button
        type="button"
        data-testid="phone-back"
        onClick={handleBack}
        className="tb-display absolute left-[40px] top-[40px] min-h-[64px] min-w-[120px] rounded-[8px] border-2 border-tb-surface px-[32px] py-[18px] text-[20px] leading-[20px] text-tb-surface"
      >
        {t("phone.back")}
      </button>

      {!ada && (
        <img
          alt="Taco Bell"
          src={tbBell}
          className="absolute left-1/2 top-[190px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}

      <h1
        className={`tb-display absolute left-1/2 ${ada ? "top-[120px]" : "top-[330px]"} w-[880px] -translate-x-1/2 text-center text-[76px] leading-[70px] tracking-[-2.5px] text-tb-surface`}
      >
        {t("phone.title")}
      </h1>
      <p
        className={`absolute left-1/2 ${ada ? "top-[260px]" : "top-[470px]"} w-[760px] -translate-x-1/2 text-center text-[28px] leading-[36px] text-tb-cream`}
      >
        {isLoyaltyOnSetting ? t("phone.loyaltySubtitle") : t("phone.subtitle")}
      </p>

      {/* Country pill + masked entry field. The country PICKER is deferred
          (no country-code sheet exists in TB yet) — the pill reflects the
          store's selectedCountryCode and is intentionally not a control. */}
      <div
        className={`absolute left-1/2 ${ada ? "top-[316px]" : "top-[580px]"} flex w-[844px] -translate-x-1/2 items-center gap-[16px]`}
      >
        <div
          data-testid="phone-country-code"
          className="flex h-[100px] min-w-[140px] items-center justify-center rounded-[10px] border-2 border-tb-purple-vibrant bg-tb-surface px-[24px] text-[32px] font-medium text-black"
        >
          {selectedCountryCode?.dialCode ?? ""}
        </div>
        <div className="relative flex h-[100px] flex-1 items-center rounded-[10px] border-2 border-tb-purple-vibrant bg-tb-surface px-[28px]">
          <span
            data-testid="phone-number-display"
            dir="ltr"
            className="text-[32px] font-medium tracking-[6px] text-black"
          >
            {displayValue || (
              <span className="tracking-normal text-black/35">
                {t("phone.placeholder")}
              </span>
            )}
          </span>
          {inputValue.length > 0 && (
            <button
              type="button"
              data-testid="phone-visibility"
              aria-pressed={isPhoneVisible}
              onClick={() => setIsPhoneVisible((v) => !v)}
              className="absolute right-[16px] min-h-[44px] min-w-[88px] rounded-[8px] px-[12px] py-[10px] text-[20px] font-bold uppercase text-tb-purple-vibrant"
            >
              {isPhoneVisible ? t("phone.hide") : t("phone.show")}
            </button>
          )}
        </div>
      </div>

      <div
        className={`absolute left-1/2 ${ada ? "top-[436px]" : "top-[740px]"} -translate-x-1/2`}
      >
        <KioskNumpad
          value={inputValue}
          onChange={handleDigitsChange}
          maxLength={maxDigits}
        />
      </div>

      <button
        type="button"
        data-testid="phone-continue"
        onClick={handleContinue}
        disabled={isLoyaltyEventLoading}
        className={`tb-display absolute left-1/2 ${ada ? "top-[876px]" : "top-[1260px]"} min-h-[104px] w-[600px] -translate-x-1/2 rounded-[8px] bg-tb-pink py-[32px] text-center text-[28px] leading-[24px] text-tb-ink-purple disabled:opacity-60`}
      >
        {isLoyaltyEventLoading ? t("phone.checking") : t("phone.continue")}
      </button>

      {canSkip && (
        <button
          type="button"
          data-testid="phone-skip"
          onClick={skipPhoneAndName}
          className={`absolute left-1/2 ${ada ? "top-[996px]" : "top-[1400px]"} min-h-[44px] -translate-x-1/2 px-[24px] py-[12px] text-[24px] leading-[28px] text-tb-cream underline`}
        >
          {t("phone.skip")}
        </button>
      )}

      <FooterBar
        onCancelOrder={() => navigate("/start")}
        onOpenLanguage={() => setLanguageOpen(true)}
      />
      <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
    </div>
  );
}
