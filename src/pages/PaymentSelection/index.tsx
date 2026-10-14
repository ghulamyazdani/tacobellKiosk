import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  paymentSettingsRdx,
  selectDeploymentInfo,
  setShowErrorModal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { selectCart, selectCartAmount } from "@cx-sdk/ordering/state/cart.slice";
import { checkIfCODAvailable } from "@cx-sdk/payments/gateways/paymentOptions";
import { pickPaytmSelections } from "@cx-sdk/payments/gateways/paytmKiosk";
import { setKioskPaymentType } from "@cx-sdk/payments/state/payment.slice";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useAdaActive from "../../hooks/utils/useAdaActive";
import usePageEnter from "../../hooks/utils/usePageEnter";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import usePayAtCounter, {
  PAY_AT_COUNTER_PAYMENT_TYPE,
} from "../../hooks/paymentsHooks/usePayAtCounter";
import usePaytmCheckout from "../../hooks/paymentsHooks/usePaytmCheckout";
import ErrorModal from "../../components/common/ErrorModal";
import PleaseWait from "../../components/payment/PleaseWait";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import plasticOverlay from "../../assets/splash/plastic-overlay.webp";
import tbBell from "../../assets/brand/tb-bell.svg";

interface CartLike {
  cartItems?: unknown[];
}

/**
 * Cancel window between a method tap and what it starts — COD: the hop to
 * /receipt; Paytm: the initiate (fork `paymentInitiationBufferTime`, 3000 ms).
 * Nothing is sent inside it.
 */
const PAYMENT_BUFFER_MS = 3000;

/**
 * How long the screen swallows taps on arrival and after the window's CANCEL
 * or the failure modal's PAY ANOTHER WAY (ReachZone's exit-guard pattern).
 * Those close at once over the tiles, and /paymentPolling's TRY AGAIN lands
 * its guest here under the same finger, so the second tap of a double tap
 * would arm a tile — whose window now ENDS in an initiate (review 2 F1).
 */
const TAP_GUARD_MS = 500;

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
      {!ada && (
        <img
          alt="Taco Bell"
          src={tbBell}
          className="absolute left-1/2 top-[128px] h-[89px] w-[100px] -translate-x-1/2"
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
 * never shown), and they hide when there is nothing to charge. A Paytm tap
 * ARMS the type and opens the same 3 s cancel window as COD — nothing is sent
 * inside it. The window's end IS the initiate (usePaytmCheckout; fork parity:
 * posistKiosk PaymentSelection.tsx:239-257 initiates in its buffer timer), so
 * Cancel is still strictly before money moves, and the receipt question
 * comes after the payment (user 2026-10-13). Its wait (PleaseWait 1:4456) and
 * failure modal (1:6288 layout: TRY AGAIN · PAY ANOTHER WAY, which closes it
 * in place · BACK TO BAG) sit over this screen. A tap guard keeps the second
 * tap of a double tap off the tiles (TAP_GUARD_MS). Credentials are never
 * dispatched from here (D11).
 *
 * Rule 1: /payment → /paymentPolling (the initiate — NEW edge, was guard-only)
 * and the initiate failure modal's BACK TO BAG /payment → /cart (moved from
 * /receipt). COD keeps /payment → /receipt. BACK TO MENU /payment → /menu
 * (2026-10-14; was /cart, or /customerName with CRM).
 *
 * Layout (D9, design language, flagged): the frame's CTA Cards are 416×416
 * in an 856 px row (1:3375 / 1:3376); one tile keeps 416×416, n ≥ 2 tiles
 * are (856 − 24(n−1))/n wide (n = 2 → the frame's 416). Labels and the TOTAL
 * bar are the frame's CTA/Compressed Large (Cm Bd 48/44 → .tb-compressed) at
 * every n; at n = 3 only the side padding narrows to 16 px — measured in
 * Archivo 62 %/700: "RESTAURANT" is 222.4 px, inside the 237.33 px label box.
 * The headline is Title/H2 (Exp Bl 64/54.4, −3) in the frame's 856 px block
 * at 572; an Arabic title wraps to ≤ 3 lines (163 px), clear of the bar at 744.
 *
 * COD gating uses `checkIfCODAvailable` from
 * `@cx-sdk/payments/gateways/paymentOptions`. SDK rule = fork live rule
 * (audit-fixes A2): name or label, tabType + the take-out alias, tab
 * `selected === true`.
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
 * title 120–229 (3 lines: 283) · total 302–426 · tiles 482–898 · BACK TO MENU
 * keeps its 18px bottom distance (1012–1104). Unavailable: title 120–229 · body
 * 344–424 · the same BACK. The buffer dialog is centred on the page, so it
 * follows the page height.
 */
export default function PaymentSelection() {
  // Above the unavailable branch's early return (hook order); that branch
  // renders no data-enter, so it stays static.
  const enter = usePageEnter();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const ada = useAdaActive();

  const netAmountRdx = Number(useSelector(selectCartAmount) ?? 0);
  const deploymentSettings = useSelector(selectDeploymentInfo) as
    | Record<string, unknown>
    | undefined;
  const paymentOptions: unknown = useSelector(paymentSettingsRdx);
  const currency = useCurrencySymbol();
  const cart = useSelector(selectCart) as CartLike | undefined;

  const { getTabType, getIsPayAtCounter } = useAppSettings();
  // The push itself lives in the hook (guarded, retry ladder, idempotency
  // latch). This screen only ARMS it: beginCheckout pins
  // payment.paymentType = "PAY_AT_RESTAURANT" before anything is pushed.
  const { beginCheckout, cancelCheckout } = usePayAtCounter();
  const {
    status: paytmStatus,
    failure: paytmFailure,
    start: startPaytm,
    retry: retryPaytm,
    dismiss: dismissPaytm,
  } = usePaytmCheckout();

  // The payment type the open cancel window armed; null = window closed.
  const [armedType, setArmedType] = useState<string | null>(null);
  const bufferTimer = useRef<number | null>(null);
  const viewedFired = useRef(false);
  // Armed at mount; CANCEL and PAY ANOTHER WAY re-arm it (TAP_GUARD_MS).
  const [tapGuard, setTapGuard] = useState(true);
  // Rule 5: the guard's timer never outlives it (or the screen).
  useEffect(() => {
    if (!tapGuard) return;
    const id = window.setTimeout(() => setTapGuard(false), TAP_GUARD_MS);
    return () => window.clearTimeout(id);
  }, [tapGuard]);

  const tabType = getTabType();
  const cartCount = cart?.cartItems?.length ?? 0;

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

  const atCounter = getIsPayAtCounter();
  const payAtCounterLabel = atCounter
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
    tiles.length === 1 ? 416 : (856 - 24 * (tiles.length - 1)) / tiles.length;
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

  // Never off the screen under a window or an initiate. The window and
  // PleaseWait cover BACK for a finger; this covers keyboard / AT — and the
  // frame between the window's timer and its commit, whose closure still reads
  // paytmStatus "idle" but armedType set (review R1). Not refused on "failed":
  // the unavailable branch has no modal and must keep its way back (Rule 2).
  // It goes where its label (Figma 1:3367 "Back to menu") says: the menu, the
  // bag kept (walk 2026-10-14 — it opened the bag, or /customerName with CRM;
  // posistKiosk's generic "Back" steps back a screen). The bag stays one tap
  // away (VIEW MY BAG); the failure modal's BACK TO BAG is the /cart edge.
  const handleBack = useCallback(() => {
    if (armedType !== null || paytmStatus === "initiating") return;
    captureKioskEvent(KioskEventName.PaymentDismissed, {});
    navigate("/menu");
  }, [armedType, navigate, paytmStatus]);

  /**
   * A method tile. ARMS the payment type (COD via beginCheckout, unchanged;
   * Paytm by setKioskPaymentType), then opens the cancel window. The window
   * ends by navigating to /receipt (COD, which pushes there) or by starting
   * the Paytm initiate here, so Cancel is always strictly before anything is
   * sent.
   *
   * The buffer lives in component state (the fork drove the equivalent effect
   * off `redirectionRef.current` in a dependency array — a ref mutation does
   * not re-render, so that effect fired on unrelated renders). The timer ref
   * also latches a same-render double tap.
   */
  const handleMethod = useCallback(
    (type: string) => {
      if (armedType !== null || bufferTimer.current !== null || paytmStatus !== "idle") return;
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
        if (type === PAY_AT_COUNTER_PAYMENT_TYPE) {
          navigate("/receipt");
          return;
        }
        // Paytm: the window is over. The initiate replaces it in ONE commit,
        // so PleaseWait shows at once (it replaces a dialog — PleaseWait.tsx).
        setArmedType(null);
        startPaytm();
      }, PAYMENT_BUFFER_MS);
    },
    [armedType, beginCheckout, dispatch, navigate, netAmountRdx, paytmStatus, startPaytm]
  );

  const handleCancelBuffer = useCallback(() => {
    // The window is over once its timer fired (the timer nulls the ref first):
    // a CANCEL still painted for that frame runs THIS render's closure and
    // would disarm the type under an initiate that has already left — the
    // session vanishes from readOpenPaytmSession while the terminal stays
    // armed (review R1).
    if (bufferTimer.current === null) return;
    window.clearTimeout(bufferTimer.current);
    bufferTimer.current = null;
    setArmedType(null);
    setTapGuard(true);
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

  /** Initiate failure exits: nothing is in flight once the modal is up. */
  const handlePaytmOtherWay = useCallback(() => {
    dismissPaytm();
    setTapGuard(true);
    // Already on /payment: disarm like CANCEL, so no stale gateway type
    // survives into a later payload.
    dispatch(setKioskPaymentType({ type: "" }));
  }, [dismissPaytm, dispatch]);

  const handlePaytmBackToBag = useCallback(() => {
    dismissPaytm();
    navigate("/cart");
  }, [dismissPaytm, navigate]);

  if (showUnavailable) {
    return (
      <div
        data-testid="payment-unavailable"
        className="relative h-full w-[1080px] overflow-hidden bg-tb-purple"
      >
        <PaymentChrome ada={ada} />
        <h1
          className={`tb-display absolute left-1/2 ${ada ? "top-[120px]" : "top-[572px]"} w-[856px] -translate-x-1/2 text-center text-[64px] leading-[54.4px] tracking-[-3px] text-tb-surface`}
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
          className={`tb-display absolute left-[24px] ${ada ? "bottom-[24px]" : "top-[1812px]"} h-[84px] w-[1032px] rounded-[8px] border border-tb-surface text-center text-[24px] leading-[20px] text-tb-surface`}
        >
          {t("payment.backToMenu")}
        </button>
      </div>
    );
  }

  return (
    // Motion §2.7: the title, TOTAL and the tile row arrive (.tb-enter);
    // the chrome, BACK TO MENU and the buffer dialog stay.
    <div
      data-testid="payment-screen"
      data-enter={enter}
      className="relative h-full w-[1080px] overflow-hidden bg-tb-purple"
    >
      <PaymentChrome ada={ada} />

      <h1
        className={`tb-enter [--i:0] tb-display absolute left-1/2 ${ada ? "top-[120px]" : "top-[572px]"} w-[856px] -translate-x-1/2 text-center text-[64px] leading-[54.4px] tracking-[-3px] text-tb-surface`}
      >
        {t("payment.title")}
      </h1>

      {/* TOTAL bar — the SAME net amount the bag checked out with
          (cart.netAmount, written by BagSheet's setAmount(getCheckoutNetAmount)). */}
      <div
        data-testid="payment-total"
        className={`tb-enter [--i:1] absolute left-1/2 ${ada ? "top-[302px]" : "top-[744px]"} flex w-[856px] -translate-x-1/2 items-center justify-between rounded-[8px] bg-tb-purple-vibrant p-[40px]`}
      >
        <span className="tb-compressed text-[48px] leading-[44px] text-tb-surface">
          {t("payment.total")}
        </span>
        <span className="tb-compressed text-[48px] leading-[44px] text-tb-surface">
          {currency}
          {netAmountRdx.toFixed(2)}
        </span>
      </div>

      <div
        className={`tb-enter [--i:2] absolute left-1/2 ${ada ? "top-[482px]" : "top-[932px]"} flex -translate-x-1/2 gap-[24px]`}
      >
        {tiles.map((tile) => (
          <button
            key={tile.testId}
            type="button"
            data-testid={tile.testId}
            onClick={() => handleMethod(tile.type)}
            style={{ width: tileWidth }}
            className={`flex h-[416px] items-center justify-center rounded-[10px] bg-tb-surface ${narrow ? "px-[16px]" : "px-[32px]"}`}
          >
            {/* Figma's Cm Bd 48/44 is a caps line height: Arabic (system
                fallback, ink ~44 above and ~14 below the baseline) wraps to
                2–3 lines that touched at 44 (walk 2026-10-14), so an Arabic
                label leads 64 (4/3). A single line sits centred either way. */}
            <span className="tb-compressed text-center text-[48px] leading-[44px] text-tb-purple [&:lang(ar)]:leading-[64px]">
              {tile.label}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="payment-back"
        onClick={handleBack}
        className={`tb-display absolute left-[24px] ${ada ? "bottom-[24px]" : "top-[1812px]"} h-[84px] w-[1032px] rounded-[8px] border border-tb-surface text-center text-[24px] leading-[20px] text-tb-surface`}
      >
        {t("payment.backToMenu")}
      </button>

      {/* Transparent but hit-testable, over the tiles and BACK; under the
          window and PleaseWait (z-50) and the failure modal (z-80). */}
      {tapGuard && (
        <div aria-hidden="true" data-testid="payment-tap-guard" className="absolute inset-0 z-40" />
      )}

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
              className="tb-display mb-[32px] text-[40px] leading-[1.1] tracking-[-1px] text-tb-purple"
            >
              {/* Pay at counter: a confirmation of the tile the guest tapped,
                  never "placing" — nothing is placed until /receipt's answer
                  (2026-10-13), whose push alone says PLACING YOUR ORDER
                  (walk 2026-10-14). Design language, sign-off. */}
              {armedType === PAY_AT_COUNTER_PAYMENT_TYPE
                ? t(atCounter ? "payment.payAtCounterChosen" : "payment.payAtRestaurantChosen")
                : t("paytm.redirecting")}
            </h2>
            {/* The house indeterminate sweep (motion-v2 MV3): a sibling of
                CANCEL, never in or around a button. */}
            <div aria-hidden className="mx-auto mb-[40px] h-[8px] w-[420px] overflow-hidden rounded-full bg-tb-lilac">
              <div className="tb-indeterminate h-full w-1/3 rounded-full bg-tb-purple" />
            </div>
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

      {paytmStatus === "initiating" && (
        <PleaseWait testId="paytm-preparing" subtitle={t("paytm.wait.preparing")} />
      )}

      {paytmStatus === "failed" && paytmFailure && (
        <ErrorModal
          testId="paytm-initiate-failed"
          title={t("paytm.failed.title")}
          message={t(
            paytmFailure.reason === "busy" ? "paytm.failed.busy" : "paytm.failed.start"
          )}
          primary={
            paytmFailure.retryable
              ? {
                  label: t("paytm.failed.tryAgain"),
                  onClick: retryPaytm,
                  testId: "paytm-initiate-retry",
                }
              : {
                  label: t("paytm.failed.payAnotherWay"),
                  onClick: handlePaytmOtherWay,
                  testId: "paytm-initiate-other",
                }
          }
          secondary={{
            label: t("orderError.backToBag"),
            onClick: handlePaytmBackToBag,
            testId: "paytm-initiate-bag",
          }}
        />
      )}
    </div>
  );
}
