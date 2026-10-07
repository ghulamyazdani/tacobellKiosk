import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  closeOfferModal,
  offerModal as selectOfferModal,
  selectCartOffer,
} from "@cx-sdk/ordering/state/cart.slice";
import { ErrorBoundary } from "../../ErrorBoundary";
import tbBell from "../../assets/brand/tb-bell.svg";

/** Shorter than the fork's 3 s modal: this card blocks nothing. */
const AUTO_CLOSE_MS = 2200;

/** cart.offerModal as the apply paths open it: openOfferModal({ id, name }). */
interface OfferModalState {
  isOpen?: boolean;
  data?: { id?: string; name?: string };
}

// Quoted: Vite inlines this small SVG as a data URI carrying ' ( ) — an
// unquoted url() is invalid CSS, the mask drops, and the bell paints as a
// solid square.
const bellMaskStyle: CSSProperties = {
  WebkitMaskImage: `url("${tbBell}")`,
  maskImage: `url("${tbBell}")`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskPosition: "center",
  maskPosition: "center",
};

const CONFETTI_COLOURS = [
  "bg-tb-yellow",
  "bg-tb-pink",
  "bg-tb-purple-vibrant",
  "bg-tb-pink-dark",
  "bg-tb-lilac",
] as const;

/**
 * 28 pieces, computed ONCE at module load (never Math.random in render —
 * react-hooks/purity): golden-angle directions spread them evenly, a +160px
 * drop biases the burst downward over the bag, and a staggered --d keeps it
 * from reading as one flat ring. Motion is the .tb-confetti-piece CSS.
 */
const CONFETTI = Array.from({ length: 28 }, (_, i) => {
  const angle = i * 2.39996;
  const reach = 200 + ((i * 47) % 160);
  return {
    colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
    style: {
      "--tx": `${Math.round(Math.cos(angle) * reach * 1.3)}px`,
      "--ty": `${Math.round(Math.sin(angle) * reach * 0.5 + 160)}px`,
      "--r": `${((i * 97) % 540) - 270}deg`,
      "--d": `${(i % 4) * 60}ms`,
    } as CSSProperties,
  };
});

/** The card itself: a child component so its render sits inside the boundary. */
function CelebrationCard({ name, amount }: { name: string; amount: string | null }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="offer-applied-celebration"
      className="tb-chip-pop relative flex w-full items-center gap-[24px] rounded-[24px] bg-tb-purple px-[32px] py-[24px] shadow-[0px_20px_40px_0px_rgba(0,0,0,0.25)]"
    >
      <span aria-hidden="true" className="absolute inset-0">
        {CONFETTI.map(({ colour, style }, index) => (
          <span key={index} className={`tb-confetti-piece ${colour}`} style={style} />
        ))}
      </span>
      {/* REWARDS INCOMING (1:4079) seal language at card scale: pink bell on
          a yellow disc. Decorative — the title carries the message. Disc and
          copy are `relative` so they paint above the (positioned) confetti. */}
      <span
        aria-hidden="true"
        className="relative flex h-[96px] w-[96px] shrink-0 items-center justify-center rounded-full bg-tb-yellow"
      >
        <span className="h-[52px] w-[58px] bg-tb-pink" style={bellMaskStyle} />
      </span>
      <div className="relative flex min-w-0 flex-1 flex-col items-start gap-[8px]">
        <p className="tb-display text-[32px] leading-[36px] tracking-[-1px] text-tb-surface">
          {t("offers.celebrate.title")}
        </p>
        {name && (
          <p className="line-clamp-2 text-[24px] font-medium leading-[28px] tracking-[-0.5px] text-tb-surface">
            {name}
          </p>
        )}
        {amount && (
          <p className="text-[24px] font-bold leading-[28px] tracking-[-0.12px] text-tb-surface">
            {t("offers.celebrate.saving", { amount })}
          </p>
        )}
      </div>
    </div>
  );
}

export interface OfferAppliedCelebrationProps {
  /**
   * The applied offer's OWN saving off the live bill (SDK getBillOfferDiscount:
   * getTotalDiscount() minus a XENO reward's share — lane loyalty-visual F1),
   * the same figure as the bag's applied-offer row; the Discounts line keeps
   * the bill total.
   */
  discount: number;
  currency: string;
  /** The bag panel's height (normal 1676 / ADA 765): the card sits over its header band. */
  sheetHeight: number;
}

/**
 * Offer-applied celebration (lane offers, item 33) — NO Figma frame: design
 * language of REWARDS INCOMING 1:4079 and the bag applied row 1:3137, flagged
 * for client sign-off. Non-blocking by design (the fork's 3 s blocking modal
 * and its confetti libraries are not ported): a 2.2 s status card over the
 * bag header band, centred at ≤600 px so it never reaches bag-close, and
 * pointer-events-none all the way down, so every tap goes through to the bag.
 *
 * Driven by cart.offerModal, which only the CUSTOMER apply paths open
 * (useOfferApply: SAVE / picker CONFIRM / buy-stage CONTINUE). An auto-apply
 * never opens it. Always mounted while the bag is open so the role=status
 * region exists before its content arrives (screen readers announce it).
 */
export default function OfferAppliedCelebration({
  discount,
  currency,
  sheetHeight,
}: OfferAppliedCelebrationProps) {
  const dispatch = useDispatch();
  const store = useStore();
  const modal = useSelector(selectOfferModal) as OfferModalState | undefined;
  const cartOffer = useSelector(selectCartOffer) as { _id?: string } | undefined;

  const isOpen = Boolean(modal?.isOpen);
  const data = modal?.data;
  // A Remove (or a cart-driven removal) inside the window must not leave
  // "Reward applied!" floating over the "Reward Removed" notice.
  const show = isOpen && (!data?.id || data.id === cartOffer?._id);

  // Rule 5: one timer, cleared on close/unmount. `data` restarts it when a
  // second apply (a swap) lands inside the window.
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => dispatch(closeOfferModal()), AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, data, dispatch]);

  // Unmount (bag closed, PAY, idle) closes a still-open card, so it can never
  // replay when the bag reopens. dispatch/store are stable, so this runs on
  // unmount only; StrictMode's extra mount-time cleanup is a no-op because the
  // card mounts with the bag, before any apply can open it.
  useEffect(
    () => () => {
      const state = store.getState() as { cart?: { offerModal?: OfferModalState } };
      if (state.cart?.offerModal?.isOpen) dispatch(closeOfferModal());
    },
    [dispatch, store],
  );

  // A centred ≤600 px box 16 px below the sheet's top edge (stage y 260 in
  // normal mode, 373 inside the ADA reach zone): over the header band, clear
  // of bag-close (x 988-1036). Zero height while closed.
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offer-celebration-region"
      className="pointer-events-none absolute inset-x-0 z-[86] mx-auto w-[600px] max-w-[calc(100%_-_48px)]"
      style={{ top: `calc(100% - ${sheetHeight}px + 16px)` }}
    >
      <ErrorBoundary fallback={null}>
        {show && (
          <CelebrationCard
            name={data?.name ?? ""}
            amount={discount > 0 ? `${currency}${discount.toFixed(2)}` : null}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}
