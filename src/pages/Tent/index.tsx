import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  generalSettingsRdx,
  setTent,
  tentRdx,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import useAdaActive from "../../hooks/utils/useAdaActive";
import useCheckoutFlow from "../../hooks/utils/useCheckoutFlow";
import usePageEnter from "../../hooks/utils/usePageEnter";
import KioskNumpad from "../../components/keyboard/KioskNumpad";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import plasticOverlay from "../../assets/splash/plastic-overlay.webp";
import tbBell from "../../assets/brand/tb-bell.svg";

/** `tent_number_range` payload: `value.value.{from,to}` (fork Tent.tsx:84-99). */
interface TentRangeValue {
  from?: number;
  to?: number;
}

/** One row of `generalSettings` — only the fields this screen reads. */
interface GeneralSettingEntity {
  setting_id?: string;
  value?: { value?: TentRangeValue };
}

interface CartLike {
  cartItems?: unknown[];
}

/** How long the inline range error stays up (fork's toast used 4000ms). */
const ERROR_VISIBLE_MS = 4000;
/** Display cells when no range is configured (the Figma frame shows four). */
const DEFAULT_DISPLAY_CELLS = 4;
/** Hard ceiling on the entry length, whatever the configured range says. */
const MAX_DISPLAY_CELLS = 6;

/**
 * /tent — "DO YOU WANT TO BE SERVED AT YOUR TABLE?" (Figma 1:4447).
 *
 * Reached from the bag when the checkout preflight resolves to "tent"
 * (dine-in / table tabs). Writes the table number to `appSettings.tent` —
 * there is NO tent slice; `setTent` / `tentRdx` live in the app-settings
 * slice and the order payload reads it as
 * `tableNumber: (tentNumber && parseInt(tentNumber)) || ""`.
 *
 * Forward fan-out (fork BrandWrapper.tsx:149-215):
 *   skipCRM ? /payment : isLoyaltyOn ? /customerName : /phone
 * `/phone` is entered in CHECKOUT MODE — it is pre-menu by default in TB, so
 * the router state carries `checkoutRoute: "phone"` to flip it.
 *
 * ⚠️ DELIBERATE DIVERGENCE — Rule 2 dead-end fix. The fork validates the
 * typed number against `tent_number_range` and, when that setting does not
 * exist, compares against `0..0`: every value fails, the customer is shown
 * "Tent value should be within 0 to 0" and there is NO way forward — a
 * misconfigured deployment strands the order. TB treats a missing row (or
 * `to === 0`) as UNCONFIGURED: the range checks are skipped entirely, the
 * customer continues with whatever they typed, and the misconfiguration is
 * reported through the analytics error path instead of being pushed onto the
 * customer. NO THANKS is always available as the second way out.
 *
 * ADA (P9c, design-language, flagged — 1:4447 has no ADA variant): same
 * controls, same sizes, in the 1122px reach zone. The bell is dropped; BACK
 * stays at 40; title 120–288 (3 lines) · display 346–436 · numpad 460–880;
 * CONFIRM and NO THANKS keep their 126/18px distance to the bottom edge
 * (904–996, 1012–1104). There is no room for the range error under the
 * keypad, so in ADA it sits directly above the display (262–330) and the
 * title it would overlap hides for the error's 4 s (the error is the
 * `role="alert"` announcement, so nothing is lost to a screen reader).
 * ponytail: the keypad top is tuned to the Figma zone — CONFIRM clears it
 * only while ADA_BRAND_ZONE_HEIGHT ≤ 822; past that, re-derive the tops.
 */
export default function Tent() {
  const enter = usePageEnter();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const ada = useAdaActive();

  const generalSettings = useSelector(generalSettingsRdx) as
    | GeneralSettingEntity[]
    | undefined;
  const tentValueRdx = (useSelector(tentRdx) as string | null | undefined) ?? "";
  const cart = useSelector(selectCart) as CartLike | undefined;

  const { goNext, goBack } = useCheckoutFlow();

  // The store's tent is the starting value (fork seeds it from tentRdx in an
  // effect; a lazy initializer does the same without a set-state-in-effect).
  const [inputValue, setInputValue] = useState<string>(() =>
    typeof tentValueRdx === "string" ? tentValueRdx : ""
  );
  const [rangeError, setRangeError] = useState("");
  // Keys the error banner: every refused key remounts it, so it re-shakes
  // (motion §3.8) and re-announces — setRangeError(sameText) would not.
  const [refusals, setRefusals] = useState(0);
  const errorTimer = useRef<number | null>(null);
  const reportedUnconfigured = useRef(false);

  const cartCount = cart?.cartItems?.length ?? 0;

  /**
   * Configured range, derived (not mirrored into state — the house
   * react-hooks rules forbid set-state-in-effect). `configured` is false both
   * when the row is absent and when it reads 0..0, which is the fork's
   * dead-end case.
   */
  const tentRange = useMemo(() => {
    const rows = Array.isArray(generalSettings) ? generalSettings : [];
    const row = rows.find((entity) => entity?.setting_id === "tent_number_range");
    const from = Number(row?.value?.value?.from ?? 0);
    const to = Number(row?.value?.value?.to ?? 0);
    const usable = Number.isFinite(from) && Number.isFinite(to) && to > 0;
    return {
      from: usable ? from : 0,
      to: usable ? to : 0,
      configured: usable,
    };
  }, [generalSettings]);

  const displayCells = tentRange.configured
    ? Math.min(
        MAX_DISPLAY_CELLS,
        Math.max(DEFAULT_DISPLAY_CELLS, String(tentRange.to).length)
      )
    : DEFAULT_DISPLAY_CELLS;

  // Never strand a customer on a screen with nothing to pay for (Rule 2).
  useEffect(() => {
    if (cartCount === 0) {
      navigate("/menu", { replace: true });
    }
  }, [cartCount, navigate]);

  // Report the misconfiguration once instead of trapping the customer with
  // it. `captureKioskEvent` is the structured, never-throwing error path —
  // console is forbidden (Rule 4 / guardrails).
  useEffect(() => {
    if (tentRange.configured || reportedUnconfigured.current) return;
    reportedUnconfigured.current = true;
    captureKioskEvent(KioskEventName.ErrorOccurred, {
      screen: "tent",
      reason: "tent_number_range_unconfigured",
    });
  }, [tentRange.configured]);

  // Rule 5 — the error timer never outlives the screen.
  useEffect(
    () => () => {
      if (errorTimer.current !== null) {
        window.clearTimeout(errorTimer.current);
        errorTimer.current = null;
      }
    },
    []
  );

  /**
   * Inline banner by design, not `setShowErrorModalGlobal` (GlobalErrorHost):
   * the range hint sits next to the field it is about.
   */
  const showRangeError = useCallback(() => {
    setRangeError(
      t("tent.rangeError", { from: tentRange.from, to: tentRange.to })
    );
    setRefusals((count) => count + 1);
    if (errorTimer.current !== null) {
      window.clearTimeout(errorTimer.current);
    }
    errorTimer.current = window.setTimeout(() => {
      errorTimer.current = null;
      setRangeError("");
    }, ERROR_VISIBLE_MS);
  }, [t, tentRange.from, tentRange.to]);

  /**
   * Per-keypress ceiling check (fork NumberKeyboard `tentCheck`): a digit
   * that would push the value past the configured maximum is refused rather
   * than accepted-and-rejected later. Deletions always pass. The typed value
   * stays local until BACK or an accepted CONFIRM commits it (NO THANKS
   * commits an empty tent; the fork writes it per key): a store write
   * re-serialises the whole persisted root.
   */
  const handleChange = useCallback(
    (next: string) => {
      if (
        tentRange.configured &&
        next.length > inputValue.length &&
        Number(next) > tentRange.to
      ) {
        showRangeError();
        return;
      }
      setRangeError("");
      setInputValue(next);
    },
    [inputValue.length, showRangeError, tentRange.configured, tentRange.to]
  );

  /**
   * Fork BrandWrapper's tent branch, minus the dead end: skipCRM ? /payment :
   * loyalty ? /customerName : /phone (checkout mode) — the next applicable
   * step, from the one place BACK reads too (useCheckoutFlow).
   */
  const continueForward = useCallback(() => goNext("/tent"), [goNext]);

  const handleConfirm = useCallback(() => {
    const trimmed = inputValue.trim();

    // DIVERGENCE (see header): an unconfigured range must not block anyone.
    if (!tentRange.configured) {
      dispatch(setTent(trimmed));
      continueForward();
      return;
    }

    const value = trimmed.length === 0 ? Number.NaN : Number(trimmed);
    if (
      !Number.isFinite(value) ||
      value < tentRange.from ||
      value > tentRange.to
    ) {
      showRangeError();
      return;
    }

    dispatch(setTent(trimmed));
    continueForward();
  }, [
    continueForward,
    dispatch,
    inputValue,
    showRangeError,
    tentRange.configured,
    tentRange.from,
    tentRange.to,
  ]);

  /** NO THANKS — no table service; tent stays empty → `tableNumber: ""`. */
  const handleSkip = useCallback(() => {
    setInputValue("");
    dispatch(setTent(""));
    continueForward();
  }, [continueForward, dispatch]);

  const handleBack = useCallback(() => {
    dispatch(setTent(inputValue.trim()));
    goBack("/tent");
  }, [dispatch, goBack, inputValue]);

  return (
    // Motion §2.7: the title, the display and the keypad arrive (.tb-enter);
    // texture, BACK, bell, CONFIRM / NO THANKS and the error stay.
    <div
      data-testid="tent-screen"
      data-enter={enter}
      className="relative h-full w-[1080px] overflow-hidden bg-tb-purple"
    >
      {/* The Figma "BG TEXTURE" ground, exactly as on /second and the splash
          (user 2026-10-13): bg-texture.png at its 240px tile plus the plastic_2
          sheen at 50 %, both stage-sized and bottom-anchored so in ADA they
          continue the brand zone's across the seam. */}
      <div
        aria-hidden
        className="absolute bottom-0 left-0 h-[1920px] w-[1080px]"
        style={{
          backgroundImage: `url(${bgTexture})`,
          backgroundSize: "240px 240px",
          backgroundPosition: "top left",
        }}
      />
      <img
        aria-hidden
        alt=""
        src={plasticOverlay}
        className="pointer-events-none absolute bottom-0 left-0 h-[1920px] w-[1080px] opacity-50"
      />

      <button
        type="button"
        data-testid="tent-back"
        onClick={handleBack}
        className="tb-display absolute left-[40px] top-[40px] min-h-[64px] min-w-[120px] rounded-[8px] border-2 border-tb-surface px-[32px] py-[18px] text-[20px] leading-[20px] text-tb-surface"
      >
        {t("tent.back")}
      </button>

      {!ada && (
        <img
          alt="Taco Bell"
          src={tbBell}
          className="absolute left-1/2 top-[135px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}

      <h1
        className={`tb-enter [--i:0] tb-display absolute left-1/2 ${ada ? "top-[120px]" : "top-[566px]"} w-[880px] -translate-x-1/2 text-center text-[58px] leading-[56px] tracking-[-1.5px] text-tb-surface${ada && rangeError ? " invisible" : ""}`}
      >
        {t("tent.title")}
      </h1>

      {/* Value display — one cell per possible digit, dot placeholders. */}
      <div
        data-testid="tent-display"
        role="textbox"
        aria-readonly="true"
        aria-label={t("tent.displayLabel")}
        dir="ltr"
        className={`tb-enter [--i:1] absolute left-1/2 ${ada ? "top-[346px]" : "top-[819px]"} flex h-[90px] w-[400px] -translate-x-1/2 items-center justify-center gap-[28px] rounded-[10px] bg-tb-surface`}
      >
        {Array.from({ length: displayCells }, (_, index) => (
          <span
            key={index}
            className="flex h-[48px] w-[48px] items-center justify-center"
          >
            {/* A digit pops into its cell (motion §3.3): the class arrives
                with the digit, which starts it. */}
            {inputValue[index] ? (
              <span className="tb-pop-in text-[40px] font-bold leading-none text-tb-purple">
                {inputValue[index]}
              </span>
            ) : (
              <span
                aria-hidden
                className="block h-[16px] w-[16px] rounded-full bg-tb-grey-4"
              />
            )}
          </span>
        ))}
      </div>

      <div
        className={`tb-enter [--i:2] absolute left-1/2 ${ada ? "top-[460px]" : "top-[940px]"} -translate-x-1/2`}
      >
        <KioskNumpad
          value={inputValue}
          onChange={handleChange}
          maxLength={displayCells}
        />
      </div>

      {/* ADA: bottom-anchored 16px above the display, so a 2-line
          translation grows upward into the (hidden) title slot, never down
          over the display. The edge is y 330 measured from the TOP (the
          display and keypad are top-anchored), so it holds at any
          ADA_BRAND_ZONE_HEIGHT — a plain bottom offset drifts onto the
          display/keypad when the zone grows. */}
      {rangeError && (
        <p
          key={refusals}
          data-testid="tent-error"
          role="alert"
          className={`tb-shake absolute left-1/2 ${ada ? "bottom-[calc(100%_-_330px)]" : "top-[1410px]"} w-[880px] -translate-x-1/2 rounded-[8px] bg-tb-red px-[24px] py-[18px] text-center text-[26px] leading-[32px] font-bold text-tb-surface`}
        >
          {rangeError}
        </p>
      )}

      <button
        type="button"
        data-testid="tent-confirm"
        onClick={handleConfirm}
        className={`tb-display absolute left-[24px] ${ada ? "bottom-[132px]" : "top-[1704px]"} h-[84px] w-[1032px] rounded-[8px] bg-tb-surface text-center text-[24px] leading-[20px] text-tb-purple shadow-[0_20px_40px_rgba(0,0,0,0.15)]`}
      >
        {t("tent.confirm")}
      </button>

      <button
        type="button"
        data-testid="tent-skip"
        onClick={handleSkip}
        className={`tb-display absolute left-[24px] ${ada ? "bottom-[24px]" : "top-[1812px]"} h-[84px] w-[1032px] rounded-[8px] border border-tb-surface text-center text-[24px] leading-[20px] text-tb-surface`}
      >
        {t("tent.skip")}
      </button>
    </div>
  );
}
