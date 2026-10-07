import { useTranslation } from "react-i18next";

interface IdleTimeoutModalProps {
  open: boolean;
  /** Share of the prompt window already elapsed, 0..1 — the START AGAIN fill. */
  progress: number;
  /** Seconds left when the prompt OPENED. Announced once, never ticked. */
  announcedSeconds: number;
  /** CONTINUE ORDERING and the backdrop. */
  onContinue: () => void;
  /** START AGAIN — the exit the countdown would take, taken now. */
  onStartAgain: () => void;
}

/**
 * "YOU HAVE BEEN INACTIVE" — Figma idle modal (1:4514).
 * Purely presentational: IdleGuard owns the clock, the continue and the
 * teardown; this never touches Redux or the router.
 *
 * - The frame has NO digits. Its only countdown cue is START AGAIN in the
 *   CTA "Loading" state — a lilac fill growing from the leading edge as the
 *   window runs out. Built as a positioned span on logical `start-0`, not
 *   the frame's gradient, so it mirrors under RTL and can transition.
 * - Screen readers get the countdown as one sentence in the dialog's
 *   description, with the opening value only — a per-second announcement
 *   is noise.
 * - z-[100]: above every in-stage overlay (BagSheet's children top out at
 *   z-[90] inside its own z-40 context), below NetworkStatusOverlay
 *   (z-[99999], portalled outside the stage).
 * - Centered card, so the shared tb-modal-enter keyframe is the right
 *   entrance. CSS only — no framer-motion on critical UI.
 * - MIN height: 396 px is the EN layout; longer (Arabic) copy grows the
 *   card instead of clipping.
 */
export default function IdleTimeoutModal({
  open,
  progress,
  announcedSeconds,
  onContinue,
  onStartAgain,
}: IdleTimeoutModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  const fillPercent = Math.min(100, Math.max(0, progress * 100));

  return (
    <div
      className="absolute inset-0 z-[100]"
      data-testid="idle-modal"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-modal-title"
      aria-describedby="idle-modal-body idle-modal-countdown"
    >
      {/* Backdrop tap = CONTINUE ORDERING (TB convention: the backdrop is the
          safe action; the fork's inert backdrop is not ported). */}
      <button
        type="button"
        data-testid="idle-backdrop"
        aria-label={t("idle.continue")}
        onClick={onContinue}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 flex min-h-[396px] w-[680px] flex-col items-center justify-between gap-[80px] rounded-[16px] bg-tb-surface px-[24px] pb-[24px] pt-[80px] text-center">
        <div className="flex w-[502px] flex-col gap-[24px]">
          <h2
            id="idle-modal-title"
            className="tb-display text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
          >
            {t("idle.title")}
          </h2>
          <p
            id="idle-modal-body"
            className="text-[28px] leading-[32px] text-tb-ink-purple"
          >
            {t("idle.body")}
          </p>
          <p id="idle-modal-countdown" className="sr-only">
            {t("idle.countdownA11y", { seconds: announcedSeconds })}
          </p>
        </div>
        {/* No horizontal padding on the CTAs: "CONTINUE ORDERING" measures
            ~261 px in the .tb-display stand-in (Archivo at 125 % / 900) at
            18 px — it only fits the 280 px button flex-centred and unwrapped. */}
        <div className="flex gap-[26px]">
          <button
            type="button"
            data-testid="idle-start-again"
            onClick={onStartAgain}
            className="tb-display relative h-[60px] w-[280px] overflow-hidden whitespace-nowrap rounded-[4px] border border-tb-purple text-[18px] leading-[16px] text-tb-purple"
          >
            {/* 4 Hz updates; the linear transition smooths between ticks. */}
            <span
              aria-hidden
              className="absolute inset-y-0 start-0 bg-tb-lilac transition-[width] duration-250 ease-linear"
              style={{ width: `${fillPercent}%` }}
            />
            <span className="relative">{t("idle.startAgain")}</span>
          </button>
          {/* autoFocus: an alertdialog takes focus, so a keyboard/keypad user
              extends with one key press (WCAG 2.2.1) instead of tabbing
              through the page behind. Not activity: react-idle-timer marks
              itself prompted before this mounts and ignores events then. */}
          <button
            type="button"
            data-testid="idle-continue"
            autoFocus
            onClick={onContinue}
            className="tb-display h-[60px] w-[280px] whitespace-nowrap rounded-[4px] bg-tb-purple text-[18px] leading-[16px] text-tb-surface"
          >
            {t("idle.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
