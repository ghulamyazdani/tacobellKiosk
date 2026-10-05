import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { currentOrder, selectOrderId } from "@cx-sdk/ordering/state/order.slice";
import { netAmount as selectNetAmount } from "@cx-sdk/ordering/state/cart.slice";
import { selectCustomerPhone } from "@cx-sdk/core/customer/customerInfo.slice";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useSessionReset, {
  type SessionResetScope,
} from "../../hooks/utils/useSessionReset";
import usePrintUtility from "../../hooks/utils/usePrintUtility";
import { useIdleHold } from "../../hooks/utils/useIdleTimeout";
import useAdaActive from "../../hooks/utils/useAdaActive";
import type {
  OrderSuccessLocationState,
  ReceiptPreference,
} from "../../hooks/paymentsHooks/usePayAtCounter";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import bgTexture from "../../assets/splash/bg-texture.png";
import tbBell from "../../assets/brand/tb-bell.svg";

/**
 * /orderSuccess — Order Complete. Figma 1:5932 (guest) and 1:3437
 * (logged-in), laid out in design pixels on the 1080x1920 KioskStage.
 *
 * REDUX ONLY — this screen makes NO network call of its own. The order it
 * shows was placed by usePayAtCounter before the navigation; the only side
 * effect here is the optional, gated, fire-and-forget receipt print.
 *
 * ── DECISIONS / DIVERGENCES FROM THE FORK ───────────────────────────────
 * 1. COUNTDOWN. The fork declares 20s in `stepDurations`, seeds the timer
 *    with 10, and computes the bar as `((30 - timer) / 40) * 100` — three
 *    different numbers, so the bar sweeps 50% -> 75% and never reaches
 *    either end. Here there is ONE number
 *    ({@link ORDER_SUCCESS_COUNTDOWN_SECONDS} = 20) and the bar is derived
 *    from it honestly: elapsed / total, 0% -> 100%.
 * 2. THREE-STEP THEATRE DEFERRED. The fork opens on "Verifying payment" ->
 *    "Placing order" -> success, but only when `enable_printing_via_pos` is
 *    on; with it off it opens straight on success. P8a has no payment to
 *    verify and the order is already placed before we arrive, so only the
 *    success step exists. The two POS steps are deferred with the POS
 *    printing vertical.
 * 3. SESSION RESET. The fork hand-rolls two different ad-hoc clear lists
 *    (one per exit) and misses several customer-scoped slices. This uses
 *    TB's canonical useSessionReset, whose two scopes are a superset:
 *    "full" for Start Over (-> /start) and "nextCustomer" for Place New
 *    Order (-> /second, keeping the menu loaded). The reset runs AFTER the
 *    print, because it clears the order the ticket is built from.
 *
 * ── MISSING DATA CONTRACTS (flagged, deliberately NOT faked) ────────────
 * - The QR codes in both frames have no CX data source: nothing in the
 *   kiosk state, the order payload or the loyalty slice produces a URL for
 *   them. The panel is rendered with the frames' geometry and message, but
 *   with NO QR image — a placeholder QR that scans to nothing is worse than
 *   none. Same class of gap as the MIAM SAVE badge.
 * - The guest frame's "SCAN TO EARN 110 POINTS" number is likewise
 *   sourceless (it is neither the customer's balance nor a published earn
 *   rate), so the copy here drops both the number and the "scan" verb until
 *   the contract exists. Restore the frame's exact wording with the QR.
 * - The lifestyle/merch photography inside the panel is Figma comp imagery
 *   with no media endpoint behind it; the panel uses the brand mark instead.
 *
 * ── ADA (P9c, design-language, flagged — neither frame has an ADA variant)
 * The 1122px reach zone cannot hold the 700px promo panel, so ADA drops it
 * together with the bell: the panel has no QR and no data behind it (see
 * above), and the brand zone carries the mark. The countdown and the two
 * buttons keep their bottom distances (389 / 190px), i.e. the SAME physical
 * position as in the full view (countdown 672–733, buttons 812–932); the
 * heading block sits on a 120px gap above the countdown (bottom edge 552).
 * The countdown itself is unchanged in ADA (P9c scope: only the loyalty
 * rewards auto-dismiss is lifted) — flagged with the WCAG 2.2.1 question.
 */

/** Single source of truth for the auto-reset countdown AND the bar. */
export const ORDER_SUCCESS_COUNTDOWN_SECONDS = 20;

/** Only the fields this screen reads off `order.currentOrder`. */
interface CurrentOrderSnapshot {
  orderId?: string;
}

export default function OrderSuccess() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const ada = useAdaActive();

  const orderIdRdx = (useSelector(selectOrderId) as string | undefined) ?? "";
  const currentOrderRdx = useSelector(currentOrder) as
    | CurrentOrderSnapshot
    | undefined;
  const netAmountRdx = Number(useSelector(selectNetAmount) ?? 0);
  const phoneRdx = (useSelector(selectCustomerPhone) as string | undefined) ?? "";

  const { getIsLoyaltyOn } = useAppSettings();
  const { resetSession } = useSessionReset();
  const { printOrderTicket } = usePrintUtility();

  // This screen owns its exit (the countdown below). A push that outlived
  // IDLE_HOLD_MAX_MS left an idle period running from the cap, and a route
  // change is not activity — unheld, that period could prompt over this
  // confirmation or end the session before leave() sends its analytics.
  // Taking a hold also closes a prompt that is already open.
  useIdleHold(true);

  // The receipt choice travels as router state (there is no receipt slice —
  // see usePayAtCounter). A reload loses it, which is also the reason a
  // reload cannot reprint.
  const receipt: ReceiptPreference =
    (location.state as OrderSuccessLocationState | null)?.receipt ?? "none";

  // The two frames are the same screen with a different salutation: a
  // recognised loyalty customer gets "ORDER #NNNNN", a guest gets the
  // thank-you. Loyalty being ON is not enough — the customer must actually
  // have identified themselves this session.
  const isLoggedIn = getIsLoyaltyOn() && phoneRdx.length > 0;

  // Last 5 characters of order.orderId — the number called out at the
  // counter, and the same slice the printed ticket puts in big type.
  const orderNumber = orderIdRdx.slice(-5);

  const [remaining, setRemaining] = useState(ORDER_SUCCESS_COUNTDOWN_SECONDS);
  const elapsed = ORDER_SUCCESS_COUNTDOWN_SECONDS - remaining;
  const progress = Math.min(
    100,
    Math.max(0, (elapsed / ORDER_SUCCESS_COUNTDOWN_SECONDS) * 100),
  );

  // One exit only — a countdown that lands on the same tick as a tap must
  // not reset the session twice or navigate twice.
  const exitedRef = useRef(false);
  const printedRef = useRef(false);
  const viewedRef = useRef(false);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    captureKioskEvent(KioskEventName.OrderSuccessViewed, {
      order_id: orderIdRdx,
      net_amount: netAmountRdx,
      receipt_preference: receipt,
    });
  }, [netAmountRdx, orderIdRdx, receipt]);

  /**
   * Print once, as soon as the pushed order is on screen. Gated inside
   * usePrintUtility (choice + print_bill + POS ownership + per-order latch);
   * failures there are swallowed, so nothing here can block the screen.
   * `currentOrder` starts as `{}` (truthy), so the readiness test is that it
   * carries THIS order, not that it exists.
   */
  const printReceiptOnce = useCallback(() => {
    if (printedRef.current) return;
    if (!orderIdRdx) return;
    if (currentOrderRdx?.orderId !== orderIdRdx) return;
    printedRef.current = true;
    printOrderTicket(receipt, {
      order: currentOrderRdx,
      orderId: orderIdRdx,
      totalAmount: netAmountRdx,
    });
  }, [currentOrderRdx, netAmountRdx, orderIdRdx, printOrderTicket, receipt]);

  useEffect(() => {
    printReceiptOnce();
  }, [printReceiptOnce]);

  const leave = useCallback(
    (scope: SessionResetScope, to: string) => {
      if (exitedRef.current) return;
      exitedRef.current = true;
      // Belt and braces: the mount effect has normally printed already, and
      // the per-order latch makes this a no-op — but the reset below wipes
      // the order, so the last chance to print is here.
      printReceiptOnce();
      captureKioskEvent(KioskEventName.OrderCompleted, { order_id: orderIdRdx });
      captureKioskEvent(KioskEventName.SessionEnd, {
        order_id: orderIdRdx,
        net_amount: netAmountRdx,
      });
      captureKioskEvent(KioskEventName.AccountSignoutSuccess, {
        reason: "order_complete",
      });
      resetSession(scope);
      navigate(to);
    },
    [navigate, netAmountRdx, orderIdRdx, printReceiptOnce, resetSession],
  );

  const handleStartOver = useCallback(() => {
    captureKioskEvent(KioskEventName.startOverFromOrderSuccessClicked, {
      order_id: orderIdRdx,
    });
    leave("full", "/start");
  }, [leave, orderIdRdx]);

  const handleNewOrder = useCallback(() => {
    // "nextCustomer" keeps the menu/settings loaded so /second is instant,
    // while every customer-scoped datum (cart, identity, loyalty, offers)
    // still clears.
    leave("nextCustomer", "/second");
  }, [leave]);

  // 1Hz tick. Cleared on unmount (Rule 5 — no timer outlives its screen).
  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Unattended kiosk: nobody tapped, so take the full reset back to Splash.
  useEffect(() => {
    if (remaining > 0) return;
    if (exitedRef.current) return;
    captureKioskEvent(
      KioskEventName.startOverFromOrderSuccessTimeoutTriggered,
      { order_id: orderIdRdx },
    );
    leave("full", "/start");
  }, [leave, orderIdRdx, remaining]);

  return (
    <div
      data-testid="order-success"
      className="relative h-full w-[1080px] overflow-hidden"
      style={{
        backgroundImage:
          "linear-gradient(180deg, #1B0726 0%, #501098 28%, #9A23F8 62%, #F07ADE 100%)",
      }}
    >
      {/* Same purple texture tile as Splash (1:2185) — one shared asset. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-25 mix-blend-soft-light"
        style={{
          backgroundImage: `url(${bgTexture})`,
          backgroundSize: "240px 240px",
          backgroundPosition: "top left",
        }}
      />

      {!ada && (
        <img
          alt="Taco Bell"
          src={tbBell}
          className="absolute left-1/2 top-[101px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}

      <div
        className={`absolute left-1/2 ${ada ? "bottom-[570px]" : "top-[300px]"} w-[920px] -translate-x-1/2 text-center`}
      >
        <h1 className="tb-display text-[76px] leading-[0.92] tracking-[-2.5px] text-tb-surface">
          {isLoggedIn ? t("success.orderHeading") : t("success.thankYou")}
        </h1>
        <p
          data-testid="order-number"
          className="tb-display mt-[16px] text-[112px] leading-[0.92] tracking-[-4px] text-tb-surface"
        >
          {orderNumber ? `#${orderNumber}` : ""}
        </p>
        <p className="tb-display mt-[24px] text-[28px] leading-[1.2] tracking-[0.5px] text-tb-surface">
          {t("success.proceedToCounter")}
        </p>
      </div>

      {/* Promo panel — frame geometry, NO QR (see the header note). Omitted
          in ADA (header note). */}
      {!ada && (
        <div className="absolute left-1/2 top-[700px] flex h-[700px] w-[406px] -translate-x-1/2 flex-col items-center justify-center gap-[28px] overflow-hidden rounded-[24px] bg-tb-ink-purple/35 px-[36px] text-center">
          <img
            aria-hidden
            alt=""
            src={tbBell}
            className="h-[107px] w-[120px] opacity-90"
          />
          <p className="tb-display text-[34px] leading-[1.05] tracking-[-1px] text-tb-yellow">
            {isLoggedIn
              ? t("success.promoHeadline")
              : t("success.rewardsHeadline")}
          </p>
          <p className="text-[24px] font-bold uppercase leading-[1.25] text-tb-cream">
            {isLoggedIn ? t("success.promoSub") : t("success.rewardsSub")}
          </p>
        </div>
      )}

      {/* Honest countdown: bar position == elapsed/total, both from the
          same constant. */}
      <div
        className={`absolute left-1/2 ${ada ? "bottom-[389px]" : "top-[1470px]"} w-[720px] -translate-x-1/2`}
      >
        <div
          role="progressbar"
          aria-label={t("success.autoResetLabel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="h-[12px] w-full overflow-hidden rounded-[6px] bg-tb-surface/25"
        >
          <div
            className="h-full rounded-[6px] bg-tb-yellow"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-[20px] text-center text-[24px] leading-[1.2] text-tb-cream">
          {t("success.autoReset", { seconds: remaining })}
        </p>
      </div>

      <div
        className={`absolute left-1/2 ${ada ? "bottom-[190px]" : "top-[1610px]"} flex w-[920px] -translate-x-1/2 items-stretch justify-center gap-[40px]`}
      >
        <button
          type="button"
          data-testid="order-success-startover"
          onClick={handleStartOver}
          className="tb-display min-h-[120px] w-[440px] rounded-[8px] border-2 border-tb-surface px-[32px] py-[36px] text-[26px] leading-[24px] text-tb-surface"
        >
          {t("success.startOver")}
        </button>
        <button
          type="button"
          data-testid="order-success-neworder"
          onClick={handleNewOrder}
          className="tb-display min-h-[120px] w-[440px] rounded-[8px] bg-tb-pink px-[32px] py-[36px] text-[26px] leading-[24px] text-tb-ink-purple"
        >
          {t("success.newOrder")}
        </button>
      </div>
    </div>
  );
}
