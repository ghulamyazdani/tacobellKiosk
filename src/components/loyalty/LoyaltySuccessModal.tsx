import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  closeLoyaltyModal,
  selectOpenLoyaltyModal,
} from "@cx-sdk/ordering/state/loyalty.slice";
import tbBell from "../../assets/brand/tb-bell.svg";

/** Fork parity: the redemption celebration is a brief interstitial, not a dialog. */
const AUTO_CLOSE_MS = 3000;

/**
 * "REWARDS INCOMING" — Figma loyalty-success (1:4079).
 *
 * Driven entirely by Redux: the redemption chain dispatches
 * `openLoyaltyModal({ isOpen: true, item })` (the slice stamps
 * `type: "redeem"`) and this interstitial shows for ~3s, then dispatches
 * `closeLoyaltyModal()`. Tapping it dismisses early — a kiosk must never
 * trap the customer behind a timer (Rule 1/2).
 *
 * FLAGGED — the Figma seal is not an exported asset: the yellow disc with the
 * circular "TACO BELL REWARDS" lockup and the pink flame in its middle are
 * composed here from tb-* tokens, the display face, inline SVG and the one
 * exported brand mark (tb-bell.svg, tinted pink via CSS mask — the same
 * placeholder technique OfferRow already uses). Swap in the real seal art
 * when design exports it.
 *
 * CSS-only entrance (JS/rAF animation freezes in occluded windows). Centered,
 * so the shared `tb-modal-enter` keyframe is the correct one. z-70: above the
 * rewards sheet (z-50) and login modal (z-60), below the error dialog (z-80).
 */
export default function LoyaltySuccessModal() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const modal = useSelector(selectOpenLoyaltyModal) as
    | { isOpen?: boolean }
    | undefined;

  const isOpen = Boolean(modal?.isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(
      () => dispatch(closeLoyaltyModal()),
      AUTO_CLOSE_MS,
    );
    // Rule 5 — the timeout is always torn down (unmount, early dismiss, or a
    // second redemption re-opening the interstitial).
    return () => window.clearTimeout(timer);
  }, [isOpen, dispatch]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-[70]"
      data-testid="loyalty-success"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        aria-label={t("loyalty.close")}
        onClick={() => dispatch(closeLoyaltyModal())}
        className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70"
      />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 flex h-[802px] w-[684px] flex-col items-center justify-center gap-[80px] bg-tb-purple px-[48px]">
        {/* Composed seal — decorative; the headline below carries the message. */}
        <span aria-hidden="true" className="relative block h-[356px] w-[356px]">
          <svg viewBox="0 0 356 356" className="h-full w-full">
            <defs>
              <path
                id="tbLoyaltySealArc"
                d="M 178,178 m -140,0 a 140,140 0 1,1 280,0 a 140,140 0 1,1 -280,0"
                fill="none"
              />
            </defs>
            <circle cx="178" cy="178" r="178" fill="var(--color-tb-yellow)" />
            <text
              fill="var(--color-tb-purple)"
              fontSize="26"
              fontWeight="900"
              letterSpacing="4"
              style={{ textTransform: "uppercase" }}
            >
              {/* Two copies at opposite offsets fill the ring, matching the
                  Figma lockup's repeated wordmark. */}
              <textPath href="#tbLoyaltySealArc" startOffset="2%">
                {t("loyalty.sealText")}
              </textPath>
              <textPath href="#tbLoyaltySealArc" startOffset="52%">
                {t("loyalty.sealText")}
              </textPath>
            </text>
          </svg>
          <span
            className="absolute left-1/2 top-1/2 h-[170px] w-[190px] -translate-x-1/2 -translate-y-1/2 bg-tb-pink"
            style={{
              WebkitMaskImage: `url(${tbBell})`,
              maskImage: `url(${tbBell})`,
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskSize: "contain",
              maskSize: "contain",
              WebkitMaskPosition: "center",
              maskPosition: "center",
            }}
          />
        </span>

        <p className="tb-display text-center text-[48px] leading-[1.05] tracking-[-1px] text-tb-surface">
          {t("loyalty.successTitle")}
        </p>
      </div>
    </div>
  );
}
