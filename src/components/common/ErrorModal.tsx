import warningIcon from "../../assets/icons/warning.svg";

interface ErrorModalAction {
  label: string;
  onClick: () => void;
  testId: string;
  /** Primary only: the destructive red fill (Remove item 1:4551, `tb-red`); default purple. */
  danger?: boolean;
}

interface ErrorModalProps {
  testId: string;
  title: string;
  /** Body under the title; omitted/empty = no body (the GlobalErrorHost's message IS its title, 1:6288). */
  message?: string;
  /** Small line under the message (the boot retry countdown). */
  note?: string;
  primary: ErrorModalAction;
  secondary?: ErrorModalAction;
  /** false = the plain Figma Modal 1:945 / 1:2855: no 179 px warning mark, a 396 px card with the CTA on its bottom band. */
  icon?: boolean;
  /** true = one full-width 632 × 60 primary (Modal 1:945 CTA); use without secondary. */
  wide?: boolean;
  /**
   * The CTA that takes focus on open. "secondary" for a confirm whose primary
   * IS the consequential choice (delete, switch, replace): focus starts on
   * the safe one (WAI-ARIA APG alertdialog), so a keypad Enter never
   * confirms. Default: the primary (retry, got it, keep paying).
   */
  initialFocus?: "primary" | "secondary";
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
  initialFocus = "primary",
}: ErrorModalProps) {
  return (
    <div
      data-testid={testId}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${testId}-title`}
      aria-describedby={message ? `${testId}-message` : undefined}
      className="absolute inset-0 z-[80]"
    >
      <div aria-hidden className="absolute inset-0 bg-tb-purple/80" />
      <div
        className={`tb-modal-enter absolute left-1/2 top-1/2 flex w-[680px] flex-col items-center gap-[80px] rounded-[16px] bg-tb-surface px-[24px] pb-[24px] pt-[80px] text-center${
          icon ? "" : " min-h-[396px] justify-between"
        }`}
      >
        <div className="flex w-[502px] flex-col items-center gap-[24px]">
          {icon && <img src={warningIcon} alt="" className="tb-wiggle size-[179px]" />}
          <h2
            id={`${testId}-title`}
            className="tb-display text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
          >
            {title}
          </h2>
          {message && (
            <p
              id={`${testId}-message`}
              className="text-[28px] leading-[32px] text-tb-ink-purple"
            >
              {message}
            </p>
          )}
          {note && (
            <p
              data-testid={`${testId}-note`}
              className="text-[22px] leading-[26px] text-tb-ink-purple/70"
            >
              {note}
            </p>
          )}
        </div>
        {/* The 280 × 60 CTAs WRAP (the OptionCard CTA's design language): a
            label carrying data — "No, keep <pipeline name>" — grows its
            button, never spills out of it. 10 px insets leave 258 px for the
            label (Archivo 125 %/900 at 18 px): every fixed label (widest
            "Yes, replace item", 237) and "No, keep Take Away" (255) still
            fit one line. */}
        <div className={wide ? "flex w-full" : "flex gap-[26px]"}>
          {/* autoFocus: an alertdialog takes focus (same as the idle modal) —
              on the CTA `initialFocus` names. */}
          {secondary && (
            <button
              type="button"
              data-testid={secondary.testId}
              autoFocus={initialFocus === "secondary"}
              onClick={secondary.onClick}
              className="tb-display flex min-h-[60px] w-[280px] items-center justify-center rounded-[4px] border border-tb-purple px-[10px] py-[8px] text-[18px] leading-[20px] text-tb-purple [overflow-wrap:anywhere]"
            >
              {secondary.label}
            </button>
          )}
          <button
            type="button"
            data-testid={primary.testId}
            autoFocus={initialFocus === "primary" || !secondary}
            onClick={primary.onClick}
            className={`tb-display flex min-h-[60px] ${wide ? "w-full" : "w-[280px]"} items-center justify-center rounded-[4px] px-[10px] py-[8px] ${primary.danger ? "bg-tb-red active:bg-tb-red-press" : "bg-tb-purple"} text-[18px] leading-[20px] text-tb-surface [overflow-wrap:anywhere]`}
          >
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  );
}
