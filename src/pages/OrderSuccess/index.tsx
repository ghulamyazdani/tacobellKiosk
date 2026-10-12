import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { currentOrder, selectOrderId } from "@cx-sdk/ordering/state/order.slice";
import { netAmount as selectNetAmount } from "@cx-sdk/ordering/state/cart.slice";
import { selectCustomerPhone } from "@cx-sdk/core/customer/customerInfo.slice";
import { emptyPayment } from "@cx-sdk/payments/state/payment.slice";
import useAppSettings from "../../hooks/utils/useAppSettings";
import usePrintUtility from "../../hooks/utils/usePrintUtility";
import { useIdleHold } from "../../hooks/utils/useIdleTimeout";
import useAdaActive from "../../hooks/utils/useAdaActive";
import usePageEnter from "../../hooks/utils/usePageEnter";
import ConfettiBurst from "../../components/common/ConfettiBurst";
import type {
  OrderSuccessLocationState,
  ReceiptPreference,
} from "../../hooks/paymentsHooks/usePayAtCounter";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import plasticOverlay from "../../assets/splash/plastic-overlay.webp";
import tbBell from "../../assets/brand/tb-bell.svg";
import panelGuest from "../../assets/order-complete/panel-guest.webp";
import panelLoyalty from "../../assets/order-complete/panel-loyalty.webp";
import unlockArrow from "../../assets/order-complete/unlock-arrow.svg";

/**
 * /orderSuccess — Order Complete, as Figma draws it: 1:5932 "No Loyalty"
 * (a guest) and 1:3437 "Has Loyalty" (a customer who identified themselves
 * this session), laid out in design pixels on the 1080x1920 KioskStage.
 *
 * REDUX ONLY — this screen makes NO network call of its own. The order it
 * shows was placed before the navigation (usePayAtCounter, or the backend
 * for Paytm); the only side effect here is the optional, gated,
 * fire-and-forget receipt print.
 *
 * ── FIGMA-EXACT (lane order-success, user 2026-10-11) ───────────────────
 * The "Gradient" (#18081D 0 → #451DCD 46 → #6426D9 63 → #D746C7 94.363 %,
 * unbound in Figma; .tb-order-gradient) under the plastic_2 sheen at 50 %
 * (the splash's crop of it: the frames' own crop puts the scratches
 * 90–150 px higher and ~3.5 % larger, and reaches past this bitmap's
 * bottom edge, so it needs its own asset — client sign-off);
 * the bell at (490, 128); the text block at 345 — a guest's 48/44 "THANK
 * YOU / FOR YOUR ORDER" over the 116/98 number, a loyalty customer's ONE
 * 116/98 "ORDER #NNNNN" block — and Figma's one "PROCEED TO FRONT COUNTER"
 * for every payment (a payment-dependent line is client sign-off P8b-11);
 * the 412×900 r56 photo panel at x 334, top 792 (guest) / 725 (loyalty),
 * each frame's own photo (the 20 % purple tint baked in); and the guest's
 * UNLOCK / FREEBIES / WITH POINTS with its arrow, drawn AFTER the panel so
 * the arrowhead paints over the photo as in the frame.
 *
 * ── OMITTED, deliberately NOT faked (BACKEND_CONTRACT_PROPOSALS §2) ─────
 * | Figma                               | here                            |
 * | QR (both frames)                    | none — the drawn one scans to a |
 * |                                     | brewery; no CX source exists    |
 * | "SCAN TO EARN 110 POINTS…" + arrow  | none — needs the QR and a       |
 * |                                     | points figure (contract A)      |
 * | "EXCLUSIVE DECADES MERCH" + arrow,  | none — a dated campaign with no |
 * | "CHECKOUT NEXT TUESDAY DROPS"       | source (contract B)             |
 * | "UNLOCK FREEBIES WITH POINTS"       | a guest on a loyalty deployment |
 * |                                     | only: without loyalty a points  |
 * |                                     | pitch is false                  |
 *
 * ── ONE EXIT (Rule 1; user decision 2026-10-12) ─────────────────────────
 * Neither frame has a control or a countdown, so neither does this screen.
 * ORDER_SUCCESS_COUNTDOWN_SECONDS after it opens (a touch does not extend
 * it) it returns to Splash (/start) — the only exit, and Rule 2's "never
 * hang". Rule 1's "a way BACK" does not apply to a placed order: the guest's
 * exit is the timer (the next guest may wait up to 20 s on a screen with no
 * control). The idle clock is held (useIdleHold) and a reload restarts the
 * timer at mount. The exit only navigates (after the last-chance print):
 * /start's mount runs the FULL reset, as for every other way to the splash.
 * Never reset-then-navigate here (hazard H1): RR7 navigates in a
 * transition, so the emptied store would commit — and paint — on THIS
 * route first (a blank number; the guest frame for an identified customer;
 * the full stage under ADA; English under Arabic). Only the payment slice
 * is emptied first — nothing on screen shows it, and the print that reads
 * its type has run — because /start's Paytm release must find no open
 * session for an order that is already paid.
 *
 * ── ADA (P9c, design language — neither frame has an ADA variant) ───────
 * The 1122 px reach zone cannot hold the 900 px panel: ADA drops the bell,
 * hides the panel and the unlock with `invisible` (never unmounted, never
 * `hidden` — either would replay their entrance on the ADA exit, D-M6) and
 * centres the text block in the zone.
 *
 * ── DIVERGENCES FROM THE FORK ───────────────────────────────────────────
 * - The fork's timer seeds 10, declares 20 and draws (30 - t) / 40: here
 *   ONE number, and no bar (Figma draws none).
 * - The fork's "Verifying payment" → "Placing order" theatre is deferred
 *   with the POS printing vertical: the order is placed before we arrive.
 * - The fork hand-rolls its clear lists here; TB's canonical
 *   useSessionReset("full") runs in /start's teardown instead (H1 above).
 */

/** The auto exit, in seconds from arrival — its single source of truth. */
export const ORDER_SUCCESS_COUNTDOWN_SECONDS = 20;

/** Only the fields this screen reads off `order.currentOrder`. */
interface CurrentOrderSnapshot {
  orderId?: string;
}

/** 1:5932 "with points" / "unlock" (Bd 28.601/1.1, white). */
const UNLOCK_BODY =
  "rotate-15 whitespace-nowrap text-[28.601px] font-bold uppercase leading-[1.1] text-tb-surface";
/**
 * 1:5932 nodes 1:6281-1:6283, reading order: each box is the rotated
 * line's frame, centred on its Figma x (-translate-x-1/2).
 */
const UNLOCK_LINES = [
  ["success.unlockTop", "left-[875.22px] top-[1367.53px] h-[61.261px] w-[124.9px]", UNLOCK_BODY],
  [
    "success.unlockFreebies",
    "left-[866.49px] top-[1384.21px] h-[86.847px] w-[193.62px]",
    "tb-display font-bold rotate-15 whitespace-nowrap text-[28.601px] leading-[38.134px] text-tb-yellow",
  ],
  ["success.unlockBottom", "left-[859.72px] top-[1418.77px] h-[79.119px] w-[191.549px]", UNLOCK_BODY],
] as const;

export default function OrderSuccess() {
  const enter = usePageEnter();
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

  const dispatch = useDispatch();
  const { getIsLoyaltyOn } = useAppSettings();
  const { printOrderTicket } = usePrintUtility();

  // This screen owns its exit (the 20 s timer below). A push that outlived
  // IDLE_HOLD_MAX_MS left an idle period running from the cap, and a route
  // change is not activity — unheld, that period could prompt over this
  // confirmation or end the session before the exit sends its analytics.
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
  // The guest frame's points pitch is true only where loyalty exists (D8).
  const showUnlock = !isLoggedIn && getIsLoyaltyOn();

  // Last 5 characters of order.orderId — the number called out at the
  // counter, and the same slice the printed ticket puts in big type.
  const orderNumber = orderIdRdx.slice(-5);

  // One exit only: the route changes in a transition, so this screen renders
  // again before it unmounts (the emptied payment type reaches it through
  // usePrintUtility), and that render must not exit twice.
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

  // ONE timer that flips state, armed at mount and cleared on unmount
  // (Rule 5): a re-created callback never restarts it.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(
      () => setTimedOut(true),
      ORDER_SUCCESS_COUNTDOWN_SECONDS * 1000,
    );
    return () => window.clearTimeout(id);
  }, []);

  // The exit: back to Splash, whose mount runs the full reset (header, H1).
  // The next guest's splash tap starts their analytics session (audit-fixes
  // B3).
  useEffect(() => {
    if (!timedOut || exitedRef.current) return;
    exitedRef.current = true;
    captureKioskEvent(
      KioskEventName.startOverFromOrderSuccessTimeoutTriggered,
      { order_id: orderIdRdx },
    );
    // Belt and braces: the mount effect has normally printed already, and
    // the per-order latch makes this a no-op — but /start's reset wipes the
    // order, so the last chance to print is here.
    printReceiptOnce();
    captureKioskEvent(KioskEventName.OrderCompleted, { order_id: orderIdRdx });
    captureKioskEvent(KioskEventName.SessionEnd, {
      order_id: orderIdRdx,
      net_amount: netAmountRdx,
    });
    captureKioskEvent(KioskEventName.AccountSignoutSuccess, {
      reason: "order_complete",
    });
    // A paid Paytm session is settled: /start's release must not read it.
    dispatch(emptyPayment());
    navigate("/start");
  }, [dispatch, navigate, netAmountRdx, orderIdRdx, printReceiptOnce, timedOut]);

  return (
    // Motion §2.7 / MV2: the text block and the panel arrive (.tb-enter),
    // the number pops (one burst), then the unlock arrow (300 ms) and its
    // lines (380 ms) pop; the layers and the bell stay.
    <div
      data-testid="order-success"
      data-enter={enter}
      className="relative h-full w-[1080px] overflow-hidden"
    >
      {/* Stage-registered (bottom-anchored, 1920 tall): in ADA (page = the
          reach zone) both continue the stage's instead of restarting at the
          zone's edge. Normal mode: the same box as inset-0. */}
      <div
        aria-hidden
        data-testid="order-success-bg"
        className="tb-order-gradient absolute bottom-0 left-0 h-[1920px] w-[1080px]"
      />
      <img
        aria-hidden
        alt=""
        draggable={false}
        src={plasticOverlay}
        className="absolute bottom-0 left-0 h-[1920px] w-[1080px] opacity-50"
      />

      {!ada && (
        <img
          alt="Taco Bell"
          src={tbBell}
          className="absolute left-1/2 top-[128px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}

      {/* Text block of 1:5932 / 1:3778, top 345 (920 wide so a wide number
          never clips). Guest: Title/H3 (48/44, −1) on the frame's two
          lines, 24 above the Title/H1 number. Loyalty: "ORDER" and the
          number are ONE H1 block (both 116/98, −3.27). */}
      <div
        className={`tb-enter [--i:0] absolute left-1/2 ${ada ? "top-1/2 -translate-y-1/2" : "top-[345px]"} w-[920px] -translate-x-1/2 text-center`}
      >
        <h1
          className={`tb-display text-tb-surface ${
            isLoggedIn
              ? "text-[116px] leading-[98px] tracking-[-3.27px]"
              : "whitespace-pre-line text-[48px] leading-[44px] tracking-[-1px]"
          }`}
        >
          {isLoggedIn ? t("success.orderHeading") : t("success.thankYou")}
        </h1>
        {/* The number pops (motion §3.5); `relative` centres the one
            confetti burst on it. The burst renders only on an in-session
            arrival (enter set), so a reload (POP) never replays it; its
            pieces are empty spans, so the text stays "#NNNNN". */}
        <p
          data-testid="order-number"
          className={`tb-pop-in relative tb-display ${isLoggedIn ? "mt-0" : "mt-[24px]"} text-[116px] leading-[98px] tracking-[-3.27px] text-tb-surface`}
        >
          {orderNumber ? `#${orderNumber}` : ""}
          {enter && <ConfettiBurst />}
        </p>
        {/* Title/H4 of 1:5932 / 1:3780: Cm Bd 34/38 — one line for every
            payment (Figma's double space is a typo). */}
        <p
          data-testid="order-success-proceed"
          className="tb-compressed mt-[24px] text-[34px] leading-[38px] text-tb-surface"
        >
          {t("success.proceedToCounter")}
        </p>
      </div>

      {/* The frame's photo, NO QR (header). In ADA `invisible`, never
          unmounted or `hidden`: either would replay its entrance on the ADA
          exit (the mode switch never animates — motion D-M6). */}
      <div
        data-testid="order-success-panel"
        className={`tb-enter [--i:1] absolute left-[334px] ${isLoggedIn ? "top-[725px]" : "top-[792px]"} h-[900px] w-[412px] overflow-hidden rounded-[56px] ${ada ? "invisible" : ""}`}
      >
        <img
          alt=""
          draggable={false}
          src={isLoggedIn ? panelLoyalty : panelGuest}
          className="h-full w-full object-cover"
        />
      </div>

      {/* 1:6280 + 1:6284, AFTER the panel: both are absolute with z-index
          auto, so tree order paints the arrowhead over the photo (x 715–745
          inside the panel's right edge at 746). Positioned against the
          root; real text, so not aria-hidden. */}
      {showUnlock && (
        <div
          data-testid="order-success-unlock"
          className={ada ? "invisible" : undefined}
        >
          <img
            alt=""
            draggable={false}
            src={unlockArrow}
            className="tb-pop-in [animation-delay:calc(var(--tb-dur-page)+var(--tb-stagger))] absolute left-[707.75px] top-[1272.6px] h-[63.434px] w-[144.259px] -scale-x-100 rotate-[39.4deg]"
          />
          {UNLOCK_LINES.map(([key, box, line]) => (
            <div
              key={key}
              className={`tb-pop-in [animation-delay:calc(var(--tb-dur-page)+3*var(--tb-stagger))] absolute flex items-center justify-center -translate-x-1/2 ${box}`}
            >
              <span className={line}>{t(key)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
