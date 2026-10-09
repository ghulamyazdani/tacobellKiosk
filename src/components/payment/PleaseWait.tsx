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
}

/**
 * "PLEASE WAIT" (Figma 1:4456 = 1:6301, identical frames) — a full-page
 * layer (absolute inset-0, z-50: above page content, below ErrorModal z-80)
 * for the Paytm waits: the initiate on /receipt and the settle on
 * /paymentPolling. Pure presentation: no timers, no store writes; the owner
 * mounts and unmounts it. Entrance is the opacity-only tb-fade-in (pure CSS,
 * position-neutral — tb-modal-enter is only for left-1/2 top-1/2 modals).
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
}: PleaseWaitProps) {
  const { t } = useTranslation();
  const ada = useAdaActive();

  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      className="tb-fade-in absolute inset-0 z-50 overflow-clip bg-tb-purple"
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
