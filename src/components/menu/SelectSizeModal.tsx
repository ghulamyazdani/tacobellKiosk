/* eslint-disable @typescript-eslint/no-explicit-any --
 * Variant entities flow through untyped from the legacy converters; typed in
 * the domain passes. Do not add NEW anys.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveEntityImage } from "../../utils/entityImage";
import { formatPrice } from "../../utils/price";
import useLocalized from "../../hooks/utils/useLocalized";
import useAdaActive from "../../hooks/utils/useAdaActive";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import ScrollIndicator from "../chrome/ScrollIndicator";
import NoImageBell from "../common/NoImageBell";
import { ErrorBoundary } from "../../ErrorBoundary";
import { ADA_MODAL_MAX_HEIGHT } from "../stage/KioskStage";
import closeIcon from "../../assets/icons/close.svg";
// ?no-inline: a precached file, off the boot JS (SlotSelectionSheet's D7).
import radioCheckIcon from "../../assets/icons/radio-check.svg?no-inline";

/**
 * ADA: the size list's box in the card at the zone's cap, where the list
 * overflows (4+ sizes) — pt 48 + header 92 (title 32 + 24 + name 36) + gap 24
 * down, the CTA band (gap 24 + CTA 60 + pb 24) up from the cap: 164 / 802.
 * ponytail: a one-line name; a two-line name starts the bar 36 px above the
 * list — measure the header if names that long reach a sized item.
 */
const ADA_LIST_TOP = 164;
const ADA_LIST_HEIGHT = ADA_MODAL_MAX_HEIGHT - ADA_LIST_TOP - 108;

/** Never behind a modal dialog: this one in a dev re-run, or one its CONTINUE opened. */
const restoreFocus = (opener: Element | null) => {
  if (opener instanceof HTMLElement && !document.querySelector('[aria-modal="true"]')) opener.focus({ preventScroll: true });
};

interface SelectSizeModalProps {
  entity: any | null;
  onClose: () => void;
  onContinue: (variant: any) => void;
}

/**
 * D12: the BEST VALUE claim needs data — only a hero variant that carries a
 * "best value" badge shows it (MenuItemCard's NEW-badge precedent). No
 * variant carries one today, so it is hidden.
 */
const isBestValue = (variant: { badges?: unknown } | null | undefined): boolean => {
  const badges = variant?.badges;
  // A badge is `{ name }` or a bare string; RegExp#test coerces either.
  return (
    Array.isArray(badges) &&
    badges.some((b: { name?: unknown } | null) =>
      /best\s*value/i.test((b?.name ?? b ?? "") as string),
    )
  );
};

/**
 * "SELECT A SIZE" — Figma "Select a Size v2" modal 1:5701 (1:5683 complete /
 * 1:5628 incomplete). Arch hero for the first variant, 247 px tiles for the
 * rest, 36 px radios (hero bottom-right, tiles top-right), CONTINUE disabled
 * (Grey 3) until a size is chosen. Price shown as a delta vs the cheapest
 * variant (Figma: "+£2.50" / base shows absolute).
 */
export default function SelectSizeModal({
  entity,
  onClose,
  onContinue,
}: SelectSizeModalProps) {
  const { t } = useTranslation();
  const { name } = useLocalized();
  const ada = useAdaActive();
  const currency = useCurrencySymbol();
  const [selectedId, setSelectedId] = useState<string>("");
  const firstSize = useRef<HTMLButtonElement>(null);
  const sizeList = useRef<HTMLDivElement>(null);

  // The app's modal focus (ErrorModal / EditHowManyModal): focus moves in on
  // open — CONTINUE is `disabled` until a size is picked, so the first size
  // takes it — and back to the opener when a close leaves no modal dialog
  // open (Menu mounts this only while open). A CONTINUE that opens the added
  // modal or the DP-cap error leaves focus to it: this cleanup runs after
  // GOT IT's autoFocus. The opener is read at first render, before focus
  // moves in, because StrictMode's dev re-run of the effect finds this dialog
  // still mounted and skips the restore. No scroll, so nothing under moves.
  const [opener] = useState(() => document.activeElement);
  useEffect(() => {
    firstSize.current?.focus({ preventScroll: true });
    return () => restoreFocus(opener);
  }, [opener]);

  const variants: any[] = useMemo(() => {
    const list = Array.isArray(entity?.variants) ? [...entity.variants] : [];
    return list.filter((v: any) => v && v.isActive !== false);
  }, [entity]);

  const minPrice = useMemo(
    () => Math.min(...variants.map((v: any) => Number(v?.price ?? 0))),
    [variants]
  );

  if (!entity) return null;

  const hero = variants[0];
  const heroImage = resolveEntityImage(hero);
  const rest = variants.slice(1);
  const selected = variants.find((v: any) => v.id === selectedId) ?? null;

  const priceLabel = (v: any) => {
    const p = Number(v?.price ?? 0);
    return p > minPrice
      ? `+${currency}${formatPrice(p - minPrice)}`
      : `${currency}${formatPrice(p)}`;
  };

  const calText = (v: any) => {
    const cal = v?.calorieCount ?? v?.nutritionalInfo?.calorieCount;
    const value = typeof cal === "object" ? cal?.value : cal;
    return value ? ` | ${t("pack.cal", { value })}` : "";
  };

  // Render helper, NOT a component (react-hooks/static-components).
  // Figma Status 1:5708 / 1:5722: 36 px; a 1 px purple ring, or a purple
  // fill with the check at inset 16.67 % (24 px).
  const renderRadio = (v: any, corner: string) => (
    <span
      aria-hidden
      className={`absolute ${corner} flex h-[36px] w-[36px] items-center justify-center rounded-full ${
        selectedId === v.id ? "bg-tb-purple" : "border border-tb-purple"
      }`}
    >
      {selectedId === v.id && (
        <img alt="" src={radioCheckIcon} className="tb-pop-in h-[24px] w-[24px]" />
      )}
    </span>
  );

  return (
    <div
      className="absolute inset-0 z-40"
      data-testid="select-size-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="select-size-title"
    >
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* Capped by the containing block (Menu's h-full root → the reach
          container) minus 2×24 px: 1500 on the 1920 stage (the 1133 px card
          never binds), 1074 in the 1122 ADA reach zone (=
          ADA_MODAL_MAX_HEIGHT). Header + X and CONTINUE are pinned and only
          the sizes scroll, so a capped card never pushes the CTA out of
          reach. Figma: pt 80 · header 92 · 75 · sizes 727 · 75 · CTA 60 ·
          pb 24 = 1133. ADA (no frame; design language, flagged): pt 48 and
          24 gaps = 999, so the standard hero + one tile row fits the 1074
          cap: no tile name or price below the fold of a list that shows no
          scrollbar (a 2-line name still fits). 4+ sizes scroll, under the
          ADA list's bar (below). */}
      <div className={`tb-modal-enter absolute left-1/2 top-1/2 flex max-h-[min(1500px,calc(100%_-_48px))] w-[680px] flex-col items-center overflow-hidden rounded-[16px] bg-tb-surface px-[24px] pb-[24px] ${ada ? "gap-[24px] pt-[48px]" : "gap-[75px] pt-[80px]"}`}>
        <div className="flex w-[502px] shrink-0 flex-col items-center gap-[24px] text-center">
          <h2
            id="select-size-title"
            className="tb-display text-[32px] leading-[32px] tracking-[-1px] text-tb-purple"
          >
            {t("size.title")}
          </h2>
          <p className="text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black">
            {name(entity)}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("language.close")}
          onClick={onClose}
          className="absolute right-[25px] top-[25px] h-[48px] w-[48px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div
          ref={sizeList}
          className="flex min-h-0 w-[504px] flex-col gap-[26px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {hero && (
            <button
              ref={firstSize}
              type="button"
              data-testid={`size-${hero.id}`}
              aria-pressed={selectedId === hero.id}
              onClick={() => setSelectedId(hero.id)}
              className="tb-select relative flex h-[453px] w-[504px] shrink-0 flex-col items-center rounded-b-[8px] rounded-t-[500px] bg-tb-grey-6 pt-[48px]"
            >
              {/* Figma 1:5707: the 326 px image band sits at the hero's foot,
                  the photo at 7.25 % / 20.25 % of it (445 × 232). */}
              {heroImage ? (
                <img
                  alt=""
                  src={heroImage}
                  className="absolute left-[36px] top-[193px] h-[232px] w-[445px] object-contain"
                />
              ) : (
                <NoImageBell className="absolute left-[36px] top-[193px] h-[232px] w-[445px]" />
              )}
              <span className="relative flex w-[352px] flex-col items-center gap-[16px] text-center">
                {isBestValue(hero) && (
                  <span
                    data-testid="size-best-value"
                    className="tb-compressed bg-tb-yellow px-[8px] py-[9px] text-[24px] leading-[18px] text-black"
                  >
                    {t("size.bestValue")}
                  </span>
                )}
                <span className="flex w-full flex-col items-center gap-[8px]">
                  <span className="w-full text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black">
                    {name(hero)}
                  </span>
                  <span className="text-[18px] leading-[20px] text-tb-ink-purple">
                    {priceLabel(hero)}
                    {calText(hero)}
                  </span>
                </span>
              </span>
              {renderRadio(hero, "bottom-[12px] right-[12px]")}
            </button>
          )}

          {rest.length > 0 && (
            <div className="grid shrink-0 grid-cols-2 gap-[10px]">
              {rest.map((v: any) => {
                const imageUrl = resolveEntityImage(v);
                return (
                  <button
                    key={v.id}
                    type="button"
                    data-testid={`size-${v.id}`}
                    aria-pressed={selectedId === v.id}
                    onClick={() => setSelectedId(v.id)}
                    className="tb-select relative flex flex-col items-center justify-center gap-[20px] rounded-[8px] bg-tb-grey-6 px-[24px] pb-[24px] pt-[48px] text-left"
                  >
                    <span className="h-[108px] w-[206px]">
                      {imageUrl ? (
                        <img alt="" src={imageUrl} className="h-full w-full object-contain" />
                      ) : (
                        <NoImageBell />
                      )}
                    </span>
                    <span className="flex w-full flex-col items-start gap-[4px]">
                      <span className="w-full text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
                        {name(v)}
                      </span>
                      <span className="text-[18px] leading-[20px] text-tb-ink-purple">
                        {priceLabel(v)}
                        {calText(v)}
                      </span>
                    </span>
                    {renderRadio(v, "right-[13px] top-[11px]")}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* ADA (residual R3): the app's draggable Figma 1:5263 bar over the
            list's box at the cap, shown only while the sizes overflow (4+).
            No frame draws it here — design language, flagged. The full view's
            1500 cap holds five sizes, so it mounts none. */}
        {ada && (
          <ErrorBoundary fallback={null}>
            <ScrollIndicator
              target={sizeList}
              top={ADA_LIST_TOP}
              height={ADA_LIST_HEIGHT}
              testId="size-scrollbar"
            />
          </ErrorBoundary>
        )}

        <button
          type="button"
          data-testid="size-continue"
          disabled={!selected}
          onClick={() => selected && onContinue(selected)}
          className={`tb-display h-[60px] w-full shrink-0 rounded-[4px] text-center text-[18px] leading-[16px] text-tb-surface ${
            selected ? "bg-tb-purple" : "bg-tb-grey-3"
          }`}
        >
          {t("size.continue")}
        </button>
      </div>
    </div>
  );
}
