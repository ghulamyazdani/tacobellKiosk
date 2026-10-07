import { useTranslation } from "react-i18next";
import tickerBag from "../../assets/icons/ticker-bag.svg";

/**
 * Daypart marquee — Figma "Daypart" bar (dark pink, 96px). `message` is the
 * operator's kiosk_settings.pipeline_text_<slot> when set (D5, SecondLayout);
 * otherwise the design's static daypart copy.
 */
export default function DaypartTicker({ message }: { message?: string }) {
  const { t } = useTranslation();
  const text = message ?? t("ticker.lunch");
  const cells = Array.from({ length: 6 });
  // index.css moves one copy in 18 s, tuned for the 16-char design line. A
  // longer operator message (D5) scales the duration, so it keeps that speed.
  // The zero-width bidi isolates (U+2066–2069) an RTL session wraps around
  // the text are not visible characters, so they do not count.
  const visibleLength = message?.replace(/[\u2066-\u2069]/g, "").length ?? 0;
  const style = message
    ? { animationDuration: `${18 * Math.max(1, visibleLength / 16)}s` }
    : undefined;

  return (
    <div className="relative h-[96px] w-full overflow-hidden bg-tb-pink-dark">
      <div
        className="tb-marquee-track absolute top-[28px] flex w-max gap-[24px]"
        style={style}
      >
        {[0, 1].map((copy) => (
          <div
            key={copy}
            aria-hidden={copy === 1}
            className="flex w-max gap-[24px]"
          >
            {cells.map((_, i) => (
              <div key={i} className="flex h-[40px] items-center gap-[24px]">
                <img alt="" src={tickerBag} className="h-[40px] w-[40px]" />
                <span className="tb-display whitespace-nowrap text-[32px] leading-[32px] tracking-[-1px] text-tb-surface">
                  {text}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
