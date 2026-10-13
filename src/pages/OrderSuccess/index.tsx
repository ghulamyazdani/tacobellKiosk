import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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

/**
 * /orderSuccess — Order Complete, as Figma draws it: 1:5932 "No Loyalty"
 * (a guest) and 1:3437 "Has Loyalty" (a customer who identified themselves
 * this session), laid out in design pixels on the 1080x1920 KioskStage —
 * without the frames' photo panel (user 2026-10-14: "remove the static
 * image in the middle").
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
 * the bell at (490, 128); the text block — a guest's 48/44 "THANK YOU /
 * FOR YOUR ORDER" over the 116/98 number, a loyalty customer's ONE 116/98
 * "ORDER #NNNNN" block — and Figma's one "PROCEED TO FRONT COUNTER" for
 * every payment (a payment-dependent line is client sign-off P8b-11).
 * With the panel gone the text block is centred on the page (the stage, or
 * ADA's reach zone) instead of Figma's top 345.
 *
 * ── OMITTED, deliberately NOT faked (BACKEND_CONTRACT_PROPOSALS §2) ─────
 * | Figma                               | here                            |
 * | the 412×900 photo panel and the     | none — removed (user            |
 * | "UNLOCK FREEBIES WITH POINTS" arrow |  2026-10-14); the arrow pointed |
 * |                                     |  into the photo                 |
 * | QR (both frames)                    | none — the drawn one scans to a |
 * |                                     | brewery; no CX source exists    |
 * | "SCAN TO EARN 110 POINTS…" + arrow  | none — needs the QR and a       |
 * |                                     | points figure (contract A)      |
 * | "EXCLUSIVE DECADES MERCH" + arrow,  | none — a dated campaign with no |
 * | "CHECKOUT NEXT TUESDAY DROPS"       | source (contract B)             |
 *
 * ── ONE EXIT, COUNTED DOWN (Rule 1; user decisions 2026-10-12/13/14) ────
 * Neither frame has a control or a countdown; this screen has both, in the
 * design language (client sign-off): START NEW ORDER, whose label counts
 * ORDER_SUCCESS_COUNTDOWN_SECONDS down from arrival (a touch does not
 * extend it) while a fill slides across it, and which a tap takes at once.
 * At 0 it returns to Splash (/start) — Rule 2's "never hang". Rule 1's "a
 * way BACK" does not apply to a placed order. The idle clock is held
 * (useIdleHold) and a reload restarts the countdown at mount. The exit only
 * navigates (after the last-chance print): /start's mount runs the FULL
 * reset, as for every other way to the splash. Never reset-then-navigate
 * here (hazard H1): RR7 navigates in a transition, so the emptied store
 * would commit — and paint — on THIS route first (a blank number; the guest
 * frame for an identified customer; the full stage under ADA; English under
 * Arabic). Only the payment slice is emptied first — nothing on screen
 * shows it, and the print that reads its type has run — because /start's
 * Paytm release must find no open session for an order that is already
 * paid.
 *
 * ── ADA (P9c, design language — neither frame has an ADA variant) ───────
 * The bell is dropped; the text block is centred in the reach zone (the
 * same rule as the stage's) and START NEW ORDER sits at the zone's foot.
 *
 * ── DIVERGENCES FROM THE FORK ───────────────────────────────────────────
 * - The fork's timer seeds 10, declares 20 and draws (30 - t) / 40: here
 *   ONE clock (a deadline fixed at mount) drives the digits and the exit,
 *   and the fill runs the same 20 s in CSS.
 * - The fork's "Verifying payment" → "Placing order" theatre is deferred
 *   with the POS printing vertical: the order is placed before we arrive.
 * - The fork hand-rolls its clear lists here; TB's canonical
 *   useSessionReset("full") runs in /start's teardown instead (H1 above).
 */

/** The auto exit, in seconds from arrival — its single source of truth. */
export const ORDER_SUCCESS_COUNTDOWN_SECONDS = 20;

/** The START NEW ORDER fill's run, fed from the constant (index.css .tb-countdown-fill). */
const COUNTDOWN_FILL = {
  "--tb-countdown": `${ORDER_SUCCESS_COUNTDOWN_SECONDS}s`,
} as CSSProperties;

/** Only the fields this screen reads off `order.currentOrder`. */
interface CurrentOrderSnapshot {
  orderId?: string;
}

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

  // This screen owns its exit (the countdown below). A push that outlived
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

  // How the screen ends — the countdown reaching 0 or START NEW ORDER (user
  // 2026-10-13): whichever comes first wins.
  const [exitBy, setExitBy] = useState<"timeout" | "tap" | null>(null);

  // The countdown (user 2026-10-14) has ONE clock: a deadline fixed at
  // mount, read by a 1 s interval, so the digits and the exit can never
  // disagree — and a late (throttled) tick catches up instead of drifting.
  // The interval stops once the exit is decided and on unmount (Rule 5).
  const [secondsLeft, setSecondsLeft] = useState(ORDER_SUCCESS_COUNTDOWN_SECONDS);
  const deadlineRef = useRef(0);
  useEffect(() => {
    if (exitBy) return;
    deadlineRef.current ||= Date.now() + ORDER_SUCCESS_COUNTDOWN_SECONDS * 1000;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setExitBy((by) => by ?? "timeout");
    }, 1000);
    return () => window.clearInterval(id);
  }, [exitBy]);

  // The exit: back to Splash, whose mount runs the full reset (header, H1).
  // The next guest's splash tap starts their analytics session (audit-fixes
  // B3).
  useEffect(() => {
    if (!exitBy || exitedRef.current) return;
    exitedRef.current = true;
    captureKioskEvent(
      exitBy === "tap"
        ? KioskEventName.startOverFromOrderSuccessClicked
        : KioskEventName.startOverFromOrderSuccessTimeoutTriggered,
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
  }, [dispatch, navigate, netAmountRdx, orderIdRdx, printReceiptOnce, exitBy]);

  return (
    // Motion §2.7 / MV2: the text block arrives (.tb-enter), the number pops
    // (one burst) and the countdown fill slides for the whole countdown; the
    // layers, the bell and the button stay.
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

      {/* Text block of 1:5932 / 1:3778 (920 wide so a wide number never
          clips), centred on the page — the stage, or ADA's reach zone — now
          that the photo panel under it is gone (user 2026-10-14). Guest:
          Title/H3 (48/44, −1) on the frame's two lines, 24 above the
          Title/H1 number. Loyalty: "ORDER" and the number are ONE H1 block
          (both 116/98, −3.27). */}
      <div className="tb-enter [--i:0] absolute left-1/2 top-1/2 w-[920px] -translate-x-1/2 -translate-y-1/2 text-center">
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
        {/* The countdown for a screen reader, ONCE: the arrival value, never
            ticked (the idle prompt's countdownA11y) — no per-second live
            region. */}
        <p data-testid="order-success-countdown-a11y" role="status" className="sr-only">
          {t("success.countdownA11y", { seconds: ORDER_SUCCESS_COUNTDOWN_SECONDS })}
        </p>
      </div>

      {/* START NEW ORDER (user 2026-10-13) and its countdown (user
          2026-10-14) — design language, Figma draws neither: the
          CTA_Sheet_Fixed outline at 1812 (ADA: the zone's foot). The label
          carries the seconds left; behind it a 20 % white fill slides in
          from the inline-start edge over the same countdown (.tb-countdown-
          fill: CSS only and nothing waits on it — the interval above owns
          the exit; hidden under reduced motion, where the digits carry it).
          The accessible name never ticks: aria-label, the digits
          aria-hidden. */}
      <button
        type="button"
        data-testid="order-success-new-order"
        aria-label={t("success.startNewOrder")}
        onClick={() => setExitBy((by) => by ?? "tap")}
        className={`tb-display absolute left-[24px] ${ada ? "bottom-[24px]" : "top-[1812px]"} h-[84px] w-[1032px] overflow-hidden rounded-[8px] border border-tb-surface text-center text-[24px] leading-[20px] text-tb-surface`}
      >
        <span
          aria-hidden="true"
          data-testid="order-success-countdown-fill"
          className="tb-countdown-fill absolute inset-0 bg-tb-surface/20"
          style={COUNTDOWN_FILL}
        />
        {/* dir="auto" on this LEAF only: in Arabic the label and its
            seconds read right to left, as one line. */}
        <span dir="auto" className="relative">
          {t("success.startNewOrder")}
          <span aria-hidden="true" data-testid="order-success-countdown">
            {" · "}
            {t("success.countdown", { seconds: secondsLeft })}
          </span>
        </span>
      </button>
    </div>
  );
}
