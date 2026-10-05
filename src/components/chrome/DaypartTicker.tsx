import { useTranslation } from "react-i18next";
import tickerBag from "../../assets/icons/ticker-bag.svg";

/**
 * Daypart marquee — Figma "Daypart" bar (dark pink, 96px). Text is currently
 * the design's static daypart copy; a server-driven daypart message can feed
 * `message` later without layout change.
 */
export default function DaypartTicker({ message }: { message?: string }) {
  const { t } = useTranslation();
  const text = message ?? t("ticker.lunch");
  const cells = Array.from({ length: 6 });

  return (
    <div className="relative h-[96px] w-full overflow-hidden bg-tb-pink-dark">
      <div className="tb-marquee-track absolute top-[28px] flex w-max gap-[24px]">
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
