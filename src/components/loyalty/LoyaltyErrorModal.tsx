import { useTranslation } from "react-i18next";

export interface LoyaltyErrorModalProps {
  /** Caller-owned open state — see the "who owns the error" note below. */
  open: boolean;
  /**
   * Optional small eyebrow above the headline. Omitted by every current
   * caller (the Figma frame carries the headline only).
   */
  title?: string;
  /**
   * Headline copy: either a t() string (validate/redeem/OTP guards) or a
   * partner-supplied message from the loyalty proxy — server data, so it is
   * rendered verbatim and NOT routed through t().
   */
  message: string;
  /** TRY AGAIN — returns the caller to the step that failed. */
  onRetry: () => void;
  /** Backdrop dismiss. Falls back to onRetry when omitted (never a dead end). */
  onClose?: () => void;
}

/**
 * Loyalty error dialog — Figma rewards-scan-state (1:3786): white card,
 * pink warning triangle, display-face headline in tb-purple, full-width
 * purple TRY AGAIN bar.
 *
 * OWNERSHIP OF ERROR STATE (P7c decision, documented for the integrator):
 * this component is PRESENTATIONAL and the CALLER owns the error state
 * locally. It deliberately does NOT read the global
 * `appSettings.showErrorModal` flag — tacobell-kiosk sets that flag in
 * several places but mounts no renderer for it, so a globally-dispatched
 * loyalty error would be invisible. Local state also keeps TRY AGAIN able to
 * return to the exact step that failed (OTP step vs. reward list), which a
 * global modal cannot know.
 *
 * Generalised from the Figma's scan-specific copy: the headline is whatever
 * the caller passes. CSS-only entrance; centered, so the shared
 * `tb-modal-enter` keyframe (which ends at translate(-50%,-50%)) is correct.
 *
 * z-80: above the rewards sheet (z-50), the login modal (z-60) and the
 * success interstitial (z-70) — an error must never be occluded.
 */
export default function LoyaltyErrorModal({
  open,
  title,
  message,
  onRetry,
  onClose,
}: LoyaltyErrorModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  const dismiss = onClose ?? onRetry;

  return (
    <div
      className="absolute inset-0 z-[80]"
      data-testid="loyalty-error"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="loyalty-error-message"
    >
      <button
        type="button"
        aria-label={t("loyalty.close")}
        onClick={dismiss}
        className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70"
      />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 w-[684px] rounded-[12px] bg-tb-surface px-[44px] pb-[44px] pt-[56px] text-center">
        {/* Warning triangle — the Figma mark is not an exported asset, so it
            is drawn inline (no new dependency, no raster). Decorative: the
            headline carries the meaning. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 88"
          className="mx-auto mb-[32px] h-[120px] w-[136px]"
          fill="none"
        >
          <path
            d="M50 6 L96 82 H4 Z"
            stroke="var(--color-tb-pink-dark)"
            strokeWidth="6"
            strokeLinejoin="round"
          />
          <path
            d="M50 32 V56"
            stroke="var(--color-tb-pink-dark)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle cx="50" cy="68" r="4" fill="var(--color-tb-pink-dark)" />
        </svg>

        {title && (
          <p className="mb-[12px] text-[22px] leading-[26px] text-tb-ink-purple/70">
            {title}
          </p>
        )}
        <h2
          id="loyalty-error-message"
          className="tb-display mb-[40px] text-[34px] leading-[1.15] tracking-[-1px] text-tb-purple"
        >
          {message}
        </h2>

        <button
          type="button"
          data-testid="loyalty-error-retry"
          onClick={onRetry}
          className="tb-display min-h-[84px] w-full rounded-[8px] bg-tb-purple py-[28px] text-center text-[24px] leading-[20px] text-tb-surface"
        >
          {t("loyalty.tryAgain")}
        </button>
      </div>
    </div>
  );
}
