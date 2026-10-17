import { useState } from "react";
import { useTranslation } from "react-i18next";
import useAdaActive from "../../hooks/utils/useAdaActive";
import bgTexture from "../../assets/splash/bg-texture.png";
import plasticOverlay from "../../assets/splash/plastic-overlay.webp";
import tbBell from "../../assets/brand/tb-bell.svg";
import hourglass from "../../assets/payment/hourglass.png";

interface PleaseWaitProps {
  /** Second line; defaults to "We confirm your order" (the frame's copy). */
  subtitle?: string;
  testId?: string;
  /** Never late: the owner tears down live content in the same commit. */
  atOnce?: boolean;
}

/**
 * "PLEASE WAIT" (Figma 1:4456 = 1:6301, identical frames) — a full-page
 * layer (absolute inset-0, z-50: above page content, below ErrorModal z-80)
 * for the Paytm waits: the initiate on /payment and the settle on
 * /paymentPolling. Pure presentation: no timers, no store writes; the owner
 * mounts and unmounts it. Entrance: tb-reveal-late (motion-v2 MV4) — the
 * opacity-only tb-fade-in after 300 ms, so a fast wait (a warm Paytm chunk,
 * a quick initiate) never flashes a full-screen loader; the layer blocks
 * taps from its first frame all the same — unless it replaces a dialog
 * (below) or the owner passes atOnce (/paymentPolling: its QR, CANCEL and
 * TIME LEFT unmount in the same commit, so a late layer would show a
 * half-dismantled screen): then it shows at once. Pure CSS, position-neutral
 * (tb-modal-enter is only for left-1/2 top-1/2 modals). Design language:
 * the frame shows at once (sign-off).
 *
 * Re-expressed from the frame: tb-purple + the 240 px texture tile (the same
 * bytes as the frame's fill) + the plastic sheen rotated −90° at 50 %,
 * normal blend — Figma's recipe, now that the sheen is the alpha WebP (UB3).
 * The hourglass is the static first frame of the 99-frame GIF (D8), turned
 * by tb-hourglass: the GIF's two half-turns per 3.96 s (motion lane, D8
 * revisited — sign-off); the sand does not flow.
 *
 * ADA (design language, flagged): the bell is dropped (the brand zone above
 * carries the mark) and the card is centred in the 1122 reach zone. The root
 * is overflow-clip, not hidden: the turned sheen overflows that zone, and a
 * hidden root would be a scroll container (see PaytmPayment).
 */
export default function PleaseWait({
  subtitle,
  testId = "please-wait",
  atOnce = false,
}: PleaseWaitProps) {
  const { t } = useTranslation();
  const ada = useAdaActive();
  // In place of a dialog (TRY AGAIN, YES, CHECK AGAIN) it shows at once: the
  // dialog's scrim unmounts in the same commit, and a layer still invisible
  // would leave the screen bright, and dead to taps, for 300 ms (motion-v2
  // review F1). Read once, at mount — this first render runs before that
  // commit, so the dialog is still in the document — and kept, so a
  // re-render never starts the reveal over a layer already on screen.
  const [late] = useState(() => !atOnce && !document.querySelector('[aria-modal="true"]'));

  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      className={`${late ? "tb-reveal-late " : ""}absolute inset-0 z-50 overflow-clip bg-tb-purple`}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${bgTexture})`,
          backgroundSize: "240px 240px",
          backgroundPosition: "top left",
        }}
      />
      {/* Figma's plastic_2 sheen: the stage-sized alpha bitmap (crop and
          −90° baked in, UB3) at 50 %, normal blend. */}
      <img
        aria-hidden
        alt=""
        draggable={false}
        src={plasticOverlay}
        className="absolute inset-0 h-full w-full object-cover opacity-50"
      />
      {!ada && (
        <img
          alt=""
          src={tbBell}
          className="absolute left-1/2 top-[128px] h-[89px] w-[100px] -translate-x-1/2"
        />
      )}
      <div
        className={`absolute left-1/2 ${ada ? "top-[161px]" : "top-[560px]"} flex h-[800px] w-[680px] -translate-x-1/2 flex-col items-center justify-center gap-[54px] rounded-[16px] bg-tb-purple-vibrant px-[24px] pb-[24px] pt-[80px]`}
      >
        <img alt="" src={hourglass} className="tb-hourglass size-[352px]" />
        <div className="flex flex-col items-center gap-[16px] text-center text-tb-surface">
          <h2 className="tb-display text-[64px] leading-[0.85] tracking-[-3px]">
            {t("paytm.wait.title")}
          </h2>
          <p className="tb-display w-[632px] text-[32px] leading-[32px] tracking-[-1px]">
            {subtitle ?? t("paytm.wait.confirming")}
          </p>
        </div>
      </div>
    </div>
  );
}
