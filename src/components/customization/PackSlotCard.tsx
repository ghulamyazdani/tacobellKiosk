/* eslint-disable @typescript-eslint/no-explicit-any --
 * Modifier groups / constituent items flow through untyped from the legacy
 * converters; typed in later domain passes. Do not add NEW anys.
 */
import { useTranslation } from "react-i18next";
import { resolveEntityImage } from "../../utils/entityImage";
import useLocalized from "../../hooks/utils/useLocalized";

interface PackSlotCardProps {
  group: any; // modifier group (name, _id, min, max)
  selection: any[]; // selectedCustomizations[group._id] ?? []
  previewItem?: any; // first constituent (placeholder image when empty)
  currency: string;
  errored?: boolean; // min/max errored ring
  onOpen: () => void; // open the slot sheet
}

const calValue = (item: any) => {
  const cal = item?.calorieCount ?? item?.nutritionalInfo?.calorieCount;
  return typeof cal === "object" ? cal?.value : cal;
};

/**
 * Pack slot card — Figma "Order a pack" PDP (1:4641/1:4590): white card in
 * the 3-col pack grid. Selected slot = pick's image + ✓ badge + SWAP;
 * empty slot = preview constituent dimmed + empty ring + "SELECT {group}".
 * Pure presentational: the whole card is one ≥44px button → onOpen; the
 * errored ring mirrors the PDP group treatment. No business logic; the only
 * store read is the display language (useLocalized names).
 */
export default function PackSlotCard({
  group,
  selection,
  previewItem,
  currency,
  errored = false,
  onOpen,
}: PackSlotCardProps) {
  const { t } = useTranslation();
  const { name } = useLocalized();

  const pick = selection?.[0] ?? null;
  const shown = pick ?? previewItem ?? null;
  const shownImage = resolveEntityImage(shown);
  const price = Number(shown?.price ?? 0);
  const cal = calValue(shown);
  const infoLine =
    price > 0
      ? `+${currency}${price.toFixed(2)}`
      : cal
        ? t("pack.cal", { value: cal })
        : "";
  const ctaLabel = pick
    ? t("pack.swap")
    : t("pack.selectGroup", { name: name(group) });

  return (
    <div
      data-testid={`pack-slot-${group?._id}`}
      className={`relative h-full rounded-[8px] bg-tb-surface ${
        errored ? "ring-4 ring-red-500" : "border border-tb-grey-4"
      }`}
    >
      {/* h-full (card + button): fill the stretched grid cell so mt-auto
          pins every CTA to the row's bottom when a 2-line name + info line
          makes one card taller. */}
      <button
        type="button"
        data-testid={`pack-slot-open-${group?._id}`}
        aria-label={ctaLabel}
        onClick={onOpen}
        className="flex h-full min-h-[44px] w-full flex-col items-stretch p-[16px] text-left"
      >
        {/* top-right selection ring — ✓ filled when the slot has a pick */}
        <span
          className={`absolute right-[14px] top-[14px] z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 ${
            pick
              ? "border-tb-purple bg-tb-purple text-tb-surface"
              : "border-tb-purple/40 bg-tb-surface"
          }`}
        >
          {pick && (
            <svg viewBox="0 0 24 24" className="h-[16px] w-[16px]" aria-hidden="true">
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>

        {shownImage ? (
          <img
            alt=""
            src={shownImage}
            className={`mx-auto mb-[14px] mt-[20px] h-[150px] w-full object-contain ${
              pick ? "" : "opacity-40"
            }`}
          />
        ) : (
          <span className="tb-compressed mb-[14px] mt-[20px] flex h-[150px] w-full items-center justify-center rounded-[8px] bg-tb-grey-6 px-[8px] text-center text-[24px] leading-[24px] text-tb-ink-purple/60">
            {name(group)}
          </span>
        )}

        <span className="mb-[16px] min-h-[48px]">
          <span
            className={`block text-[18px] font-medium capitalize leading-[22px] text-black ${
              pick ? "" : "text-black/70"
            }`}
          >
            {name(shown) || name(group)}
          </span>
          {infoLine && (
            <span className="mt-[2px] block text-[15px] leading-[20px] text-tb-ink-purple/70">
              {infoLine}
            </span>
          )}
        </span>

        {/* outlined CTA — visual only; the whole card is the real button */}
        <span className="tb-display mt-auto flex min-h-[48px] items-center justify-center rounded-[8px] border border-tb-purple px-[8px] text-center text-[15px] leading-[18px] text-tb-purple">
          {ctaLabel}
        </span>
      </button>
    </div>
  );
}
