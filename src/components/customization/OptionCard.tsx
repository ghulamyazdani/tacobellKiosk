import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
// ?no-inline: emitted as precached files. Inlined (<4 KB → data URIs) they
// cost boot-path gzip (SlotSelectionSheet's radio-check precedent, D7).
import radioCheckIcon from "../../assets/icons/radio-check.svg?no-inline";
import minusIcon from "../../assets/icons/qty-minus.svg?no-inline";
import plusIcon from "../../assets/icons/qty-plus.svg?no-inline";
import trashIcon from "../../assets/icons/trash.svg?no-inline";
import chevronLeftIcon from "../../assets/icons/chevron-left.svg?no-inline";
// Plain import: the menu CTA bar already inlines this exact module.
import bagIcon from "../../assets/icons/bag.svg";

/*
  The PDP / customize-page building blocks (item 42), from the Figma
  components: Menu-Item_Medium (1:2930 / 1:4904 / 1:5332), Cards/Item/Old
  rows (1:2936 / 1:4914), Title/H7 group labels, the Counter (1:615) and
  CTA/Bottom screen (1:589). Presentational only: callers pass localized
  names (useLocalized) and their own handlers. Never `dir` on a card, grid or
  row (PROGRESS: it mirrors flex/grid layout).
*/

export interface OptionCardProps {
  testId: string;
  image: string | null;
  name: string;
  meta?: string;
  /** Omitted = no radio (a fixed pack slot). */
  radio?: "on" | "off";
  dimmed?: boolean;
  /** A nested control → the overlay-button pattern (see below). */
  cta?: { label: string; onClick: () => void; testId: string };
  onSelect?: () => void;
  selectLabel?: string;
  /** Testid of the overlay select button (PackSlotCard's pack-slot-open-*). */
  selectTestId?: string;
  errored?: boolean;
}

/** The fields formatOptionMeta reads off a constituent item / pick. */
type MetaItem = {
  price?: unknown;
  calorieCount?: unknown;
  nutritionalInfo?: { calorieCount?: unknown };
} | null | undefined;

/** "+£0.50 | 360 Cal": a price only when it costs, calories only when known. */
// eslint-disable-next-line react-refresh/only-export-components -- shared by every option surface; HMR falls back to a reload for this file
export function formatOptionMeta(item: MetaItem, currency: string, t: TFunction): string {
  const cal = item?.calorieCount ?? item?.nutritionalInfo?.calorieCount;
  const calValue = typeof cal === "object" ? (cal as { value?: unknown } | null)?.value : cal;
  const parts: string[] = [];
  if (Number(item?.price) > 0) parts.push(`+${currency}${Number(item?.price).toFixed(2)}`);
  if (calValue) parts.push(t("pack.cal", { value: calValue }));
  return parts.join(" | ");
}

const CARD =
  "relative flex h-full min-h-[400px] w-full flex-col justify-between gap-[24px] rounded-[8px] bg-tb-grey-6 p-[24px] text-left";

/**
 * Menu-Item_Medium: a 172 px image box, then the name / meta and an optional
 * outlined CTA (wraps — "SELECT SANDWICH" already fills 230 of its 232 px).
 * Radio (Type=Radio): 36 px at top-right 12 — a 1 px purple ring, or a purple
 * fill with the exported check at inset 16.67 %.
 * Without a CTA the whole card is ONE button carrying the testid (named by its
 * text). With one, the P9f overlay-button pattern: the container keeps the
 * testid, the CTA sits above at z-10, the named overlay goes LAST in the DOM.
 * Motion (lane motion): the button card bumps when it turns selected
 * (tb-select, driven by aria-pressed); the overlay card squeezes while its
 * overlay is pressed (tb-press-card); the check pops in; an errored card
 * shakes once with its ring (a selected one keeps tb-select — accepted).
 */
export default function OptionCard({
  testId,
  image,
  name,
  meta,
  radio,
  dimmed = false,
  cta,
  onSelect,
  selectLabel,
  selectTestId,
  errored = false,
}: OptionCardProps) {
  const className = `${CARD} ${errored ? "tb-shake ring-4 ring-red-500" : ""}`;
  const content = (
    <>
      <span className="flex h-[172px] w-full shrink-0 items-center justify-center">
        {image && (
          <img
            alt=""
            src={image}
            className={`h-full w-full object-contain ${dimmed ? "opacity-40" : ""}`}
          />
        )}
      </span>
      {/* The frame's 134 px content box (1:4905 / 1:4907): the name sits
          under the photo at card y 242 with or without a CTA, and the CTA
          is pinned to the foot. Only a 2-line name + meta + CTA outgrows it
          (156 px: the name rises 22 px, as Figma's bottom-anchored name box
          would). */}
      <span className="flex min-h-[134px] w-full flex-col gap-[24px]">
        <span className="flex flex-col gap-[4px]">
          <span className="block text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
            {name}
          </span>
          {meta && (
            <span className="block text-[18px] leading-[20px] text-tb-ink-purple">{meta}</span>
          )}
        </span>
        {cta && (
          <button
            type="button"
            data-testid={cta.testId}
            onClick={cta.onClick}
            className="tb-display relative z-10 mt-auto flex min-h-[60px] w-full items-center justify-center rounded-[4px] border border-tb-purple px-[12px] py-[8px] text-center text-[18px] leading-[16px] text-tb-purple"
          >
            {cta.label}
          </button>
        )}
      </span>
      {radio && (
        <span
          aria-hidden="true"
          className={`absolute right-[12px] top-[12px] flex h-[36px] w-[36px] items-center justify-center rounded-full ${
            radio === "on" ? "bg-tb-purple" : "border border-tb-purple"
          }`}
        >
          {radio === "on" && (
            <img alt="" src={radioCheckIcon} className="tb-pop-in h-[24px] w-[24px]" />
          )}
        </span>
      )}
    </>
  );

  if (onSelect && !cta) {
    return (
      <button
        type="button"
        data-testid={testId}
        aria-label={selectLabel}
        aria-pressed={radio ? radio === "on" : undefined}
        onClick={onSelect}
        className={`tb-select ${className}`}
      >
        {content}
      </button>
    );
  }
  return (
    <div data-testid={testId} className={`tb-press-card ${className}`}>
      {content}
      {onSelect && (
        <button
          type="button"
          data-testid={selectTestId}
          aria-label={selectLabel}
          onClick={onSelect}
          className="absolute inset-0 h-full w-full rounded-[8px]"
        />
      )}
    </div>
  );
}

/**
 * Cards/Item/Old: 152 px plate, Md 28/32 name + Rg 24/24 meta, and the
 * 188×68 quantity picker (BagItemRow's pill, 44 px buttons). D6: the trash
 * glyph replaces "−" ONLY at quantity 1 — the same −1 action, the same name
 * ("−" stays at 2+: a trash that removes one of two would mislead).
 */
export function OptionRow({
  testId,
  image,
  name,
  meta,
  qty,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
}: {
  testId: string;
  image: string | null;
  name: string;
  meta?: string;
  qty: number;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-h-[176px] items-start gap-[24px] border-t border-tb-grey-4 pt-[23px]"
    >
      <span className="flex h-[152px] w-[152px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-tb-grey-6">
        {image && <img alt="" src={image} className="h-[130px] w-[130px] object-contain" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[8px]">
        <span className="block text-[28px] font-medium capitalize leading-[32px] tracking-[-0.5px] text-black">
          {name}
        </span>
        {meta && (
          <span className="block text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple">
            {meta}
          </span>
        )}
      </span>
      <div className="flex h-[68px] w-[188px] shrink-0 items-center justify-between rounded-full border-[1.72px] border-tb-grey-3 bg-tb-surface px-[10px]">
        <button
          type="button"
          aria-label={decreaseLabel}
          onClick={onDecrease}
          className="flex h-[44px] w-[44px] items-center justify-center"
        >
          <img alt="" src={qty === 1 ? trashIcon : minusIcon} className="h-[24px] w-[24px]" />
        </button>
        <span key={qty} className="tb-bump text-[20px] font-black leading-[16px] text-black">
          {qty}
        </span>
        <button
          type="button"
          aria-label={increaseLabel}
          onClick={onIncrease}
          className="flex h-[44px] w-[44px] items-center justify-center"
        >
          <img alt="" src={plusIcon} className="h-[24px] w-[24px]" />
        </button>
      </div>
    </div>
  );
}

/**
 * Title/H7 group label (S4 #8): the name, TB's Required marker, and — when
 * the group takes more than one — "count of max" right-aligned (1:4911).
 */
export function GroupHeader({
  name,
  count,
  max,
  required = false,
  errored = false,
}: {
  name: string;
  count?: number;
  max?: number;
  required?: boolean;
  errored?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-baseline gap-[16px]">
      <h3 className="text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
        {name}
      </h3>
      {required && (
        <span
          className={`text-[18px] leading-[20px] ${errored ? "font-bold text-red-600" : "text-tb-ink-purple/60"}`}
        >
          {t("pdp.required")}
        </span>
      )}
      {max !== undefined && max > 1 && (
        <span
          key={count ?? 0}
          className="tb-bump ml-auto shrink-0 text-[20px] font-medium leading-[24px] tracking-[-0.5px] text-black"
        >
          {t("pdp.groupCount", { count: count ?? 0, max })}
        </span>
      )}
    </div>
  );
}

/**
 * Counter (1:615): "−" and "+" white 64 px circles with a 2 px Grey 4 ring,
 * the count a filled purple circle. Testids `${testId}-decrease`, `${testId}`,
 * `${testId}-increase`; no onIncrease = no "+" (the hide-plus setting).
 * Pressed (1:604): the white fill turns lilac (index.css) and so does the
 * ring; the value re-keys an inner span so tb-bump replays on each change.
 */
export function Counter({
  testId,
  value,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
}: {
  testId: string;
  value: number;
  onDecrease: () => void;
  onIncrease?: () => void;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  const control =
    "flex h-[64px] w-[64px] items-center justify-center rounded-full border-2 border-tb-grey-4 bg-tb-surface active:border-tb-lilac";
  return (
    <div className="flex shrink-0 items-center gap-[12px]">
      <button
        type="button"
        data-testid={`${testId}-decrease`}
        aria-label={decreaseLabel}
        onClick={onDecrease}
        className={control}
      >
        <img alt="" src={minusIcon} className="h-[24px] w-[24px]" />
      </button>
      <span
        data-testid={testId}
        className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-tb-purple text-[20px] font-black leading-[16px] text-tb-surface"
      >
        <span key={value} className="tb-bump">
          {value}
        </span>
      </span>
      {onIncrease && (
        <button
          type="button"
          data-testid={`${testId}-increase`}
          aria-label={increaseLabel}
          onClick={onIncrease}
          className={control}
        >
          <img alt="" src={plusIcon} className="h-[24px] w-[24px]" />
        </button>
      )}
    </div>
  );
}

/**
 * CTA/Bottom screen (1:589): the 148 px purple bar — BACK (chevron + an
 * underlined label, 168 px) and the action (label + the 50 px bag icon).
 * BACK pressed (set 1:558): the label turns #883ED2 (tb-purple-press).
 */
export function CtaBar({
  backTestId,
  backLabel,
  onBack,
  actionTestId,
  action,
  onAction,
  actionDisabled = false,
}: {
  backTestId: string;
  backLabel: string;
  onBack: () => void;
  actionTestId: string;
  action: ReactNode;
  onAction: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <div className="flex h-[148px] w-full shrink-0 items-center justify-between bg-tb-purple pr-[48px] shadow-[0_0_32px_rgba(0,0,0,0.08)]">
      <button
        type="button"
        data-testid={backTestId}
        onClick={onBack}
        className="group flex h-full min-w-[168px] items-center justify-center gap-[10px] px-[37px]"
      >
        <img alt="" src={chevronLeftIcon} className="h-[23px] w-[23px]" />
        <span className="tb-display text-[18px] leading-[20px] text-tb-surface underline group-active:text-tb-purple-press">
          {backLabel}
        </span>
      </button>
      <button
        type="button"
        data-testid={actionTestId}
        disabled={actionDisabled}
        onClick={onAction}
        className="tb-display flex min-h-[44px] items-center gap-[24px] text-right text-[24px] leading-[32px] text-tb-surface disabled:opacity-50"
      >
        <span>{action}</span>
        <img alt="" src={bagIcon} className="h-[50px] w-[50px]" />
      </button>
    </div>
  );
}
