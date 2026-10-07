import warningIcon from "../../assets/icons/warning.svg";

interface ErrorModalAction {
  label: string;
  onClick: () => void;
  testId: string;
}

interface ErrorModalProps {
  testId: string;
  title: string;
  message: string;
  /** Small line under the message (the boot retry countdown). */
  note?: string;
  primary: ErrorModalAction;
  secondary?: ErrorModalAction;
  /** false = the plain Figma Modal 1:945 / 1:2855: no 179 px warning mark, a 396 px card with the CTA on its bottom band. */
  icon?: boolean;
  /** true = one full-width 632 × 60 primary (Modal 1:945 CTA); use without secondary. */
  wide?: boolean;
}

/**
 * The ONE error dialog for the P9b recovery surfaces (boot, menu load, app
 * crash) — Figma "Icon Modal" 1:988 from Payment Failure 1:3427 (purple 80%
 * skrim, 680 card, Icon L 1:990, H5 title + body) with the 1:4514 CTA pair the
 * idle modal already uses. Copy is design-language: no frame carries text for
 * these states (flagged for client sign-off).
 *
 * PURE — no hooks, store, router or i18n — so the app ErrorBoundary can render
 * it after everything above it has died; callers pass translated strings.
 * The skrim is inert: an error needs an explicit choice.
 * z-80: above page overlays (≤55) and the bag (40); the idle prompt (100) and
 * the offline overlay (99999, portalled) stay above it. Centred card, so the
 * shared tb-modal-enter keyframe is the right entrance (CSS only).
 */
export default function ErrorModal({
  testId,
  title,
  message,
  note,
  primary,
  secondary,
  icon = true,
  wide = false,
}: ErrorModalProps) {
  return (
    <div
      data-testid={testId}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${testId}-title`}
      aria-describedby={`${testId}-message`}
      className="absolute inset-0 z-[80]"
    >
      <div aria-hidden className="absolute inset-0 bg-tb-purple/80" />
      <div
        className={`tb-modal-enter absolute left-1/2 top-1/2 flex w-[680px] flex-col items-center gap-[80px] rounded-[16px] bg-tb-surface px-[24px] pb-[24px] pt-[80px] text-center${
          icon ? "" : " min-h-[396px] justify-between"
        }`}
      >
        <div className="flex w-[502px] flex-col items-center gap-[24px]">
          {icon && <img src={warningIcon} alt="" className="size-[179px]" />}
          <h2
            id={`${testId}-title`}
            className="tb-display text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
          >
            {title}
          </h2>
          <p
            id={`${testId}-message`}
            className="text-[28px] leading-[32px] text-tb-ink-purple"
          >
            {message}
          </p>
          {note && (
            <p
              data-testid={`${testId}-note`}
              className="text-[22px] leading-[26px] text-tb-ink-purple/70"
            >
              {note}
            </p>
          )}
        </div>
        <div className={wide ? "flex w-full" : "flex gap-[26px]"}>
          {secondary && (
            <button
              type="button"
              data-testid={secondary.testId}
              onClick={secondary.onClick}
              className="tb-display h-[60px] w-[280px] whitespace-nowrap rounded-[4px] border border-tb-purple text-[18px] leading-[16px] text-tb-purple"
            >
              {secondary.label}
            </button>
          )}
          {/* autoFocus: an alertdialog takes focus (same as the idle modal). */}
          <button
            type="button"
            data-testid={primary.testId}
            autoFocus
            onClick={primary.onClick}
            className={`tb-display h-[60px] ${wide ? "w-full" : "w-[280px]"} whitespace-nowrap rounded-[4px] bg-tb-purple text-[18px] leading-[16px] text-tb-surface`}
          >
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  );
}
