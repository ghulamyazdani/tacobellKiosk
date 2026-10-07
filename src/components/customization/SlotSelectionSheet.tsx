/* eslint-disable @typescript-eslint/no-explicit-any --
 * Modifier groups / constituent items flow through untyped from the legacy
 * converters; typed in later domain passes. Do not add NEW anys.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveEntityImage } from "../../utils/entityImage";
import useLocalized from "../../hooks/utils/useLocalized";
import closeIcon from "../../assets/icons/close.svg";
// ?no-inline: emitted as a precached file. Inlined (<4 KB → data URI) this
// path-heavy icon cost +0.4 KiB gzip on the boot path (measured, D7).
import radioCheckIcon from "../../assets/icons/radio-check.svg?no-inline";

interface SlotSelectionSheetProps {
  open: boolean;
  group: any; // slot group; title = useLocalized().name(group)
  options: any[]; // active constituent items (already filtered)
  selectedId?: string; // current pick id
  currency: string;
  canCustomize: (item: any) => boolean;
  onSave: (item: any) => void; // radio pick confirmed
  onCustomize: (item: any) => void; // Customize link (new OR selected row)
  onClose: () => void;
}

const calValue = (item: any) => {
  const cal = item?.calorieCount ?? item?.nutritionalInfo?.calorieCount;
  return typeof cal === "object" ? cal?.value : cal;
};

/**
 * Sheet body — mounted only while open, keyed by group id from the default
 * export, so the local radio state re-seeds from selectedId whenever the
 * sheet (re)opens or targets another slot group (no setState-in-effect).
 */
function SheetBody({
  group,
  options,
  selectedId,
  currency,
  canCustomize,
  onSave,
  onCustomize,
  onClose,
}: SlotSelectionSheetProps) {
  const { t } = useTranslation();
  const { name } = useLocalized();
  const [picked, setPicked] = useState<string>(selectedId ?? "");

  const list: any[] = Array.isArray(options) ? options : [];
  const included = list.filter((o: any) => !(Number(o?.price) > 0));
  const upgrades = list.filter((o: any) => Number(o?.price) > 0);
  const pickedItem = list.find((o: any) => o?.id === picked) ?? null;
  const saveLocked = Number(group?.min ?? 0) > 0 && !pickedItem;

  // Render helper, NOT a component (react-hooks/static-components).
  const renderRow = (item: any) => {
    const isPicked = item?.id === picked;
    const imageUrl = resolveEntityImage(item);
    const price = Number(item?.price ?? 0);
    const cal = calValue(item);
    const calText = cal ? t("pack.cal", { value: cal }) : "";
    const line =
      price > 0
        ? `+${currency}${price.toFixed(2)}${calText ? ` | ${calText}` : ""}`
        : calText;

    // Figma 1:2814 card: 1px #EBEBEB divider on top, the row 24 px below it
    // (176 = 1 + 23 + 152), 152 px grey thumb, Md 32/36 name, Rg 24/24 meta.
    return (
      <div
        key={item?.id}
        className="relative flex items-center gap-[24px] border-t border-tb-grey-4 pt-[23px]"
      >
        <span className="flex h-[152px] w-[152px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-tb-grey-6">
          {imageUrl && (
            <img alt="" src={imageUrl} className="h-[130px] w-[130px] object-contain" />
          )}
        </span>

        <span className="flex flex-1 flex-col gap-[8px]">
          <span className="block text-[32px] font-medium capitalize leading-[36px] tracking-[-1px] text-black">
            {name(item)}
          </span>
          {line && (
            <span className="block text-[24px] leading-[24px] tracking-[-0.12px] text-tb-ink-purple">
              {line}
            </span>
          )}
          {canCustomize(item) && (
            <button
              type="button"
              data-testid={`slot-customize-${item?.id}`}
              onClick={() => onCustomize(item)}
              className="relative z-10 -ml-[8px] inline-flex min-h-[44px] min-w-[44px] items-center px-[8px] text-[16px] font-bold text-tb-purple underline"
            >
              {t("pack.customize")}
            </button>
          )}
        </span>

        {/* Figma Radio 1:401/1:402: 36 px; 1 px purple ring, or a purple
            fill with the exported check at inset 16.67 % (24 px). */}
        <span
          className={`flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full ${
            isPicked ? "bg-tb-purple" : "border border-tb-purple bg-tb-surface"
          }`}
        >
          {isPicked && (
            <img alt="" src={radioCheckIcon} className="h-[24px] w-[24px]" />
          )}
        </span>

        {/* full-row pick target (last in DOM = on top; Customize sits above via z-10) */}
        <button
          type="button"
          data-testid={`slot-option-${item?.id}`}
          aria-label={name(item)}
          onClick={() => setPicked(item?.id)}
          className="absolute inset-0 h-full w-full min-h-[44px]"
        />
      </div>
    );
  };

  // Figma section: Md 20/24 label, 16 px to its cards, cards 24 px apart.
  const renderSection = (label: string, items: readonly unknown[]) => (
    <div className="flex flex-col gap-[16px]">
      <p className="text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
        {label}
      </p>
      <div className="flex flex-col gap-[24px]">{items.map(renderRow)}</div>
    </div>
  );

  return (
    <div className="absolute inset-0 z-40" data-testid="slot-sheet">
      <style>{`@keyframes tbSlotSheetEnter{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* Figma 1:2814: rounded-t 60, pt 54 / px 24 / pb 24, 75 px between
          title, sections and SAVE. Cap = containing block (the PDP's h-full
          root → the reach container) minus a 96 px scrim band: 1500 on the
          1920 stage, 1026 in the 1122 ADA reach zone. Title/X and SAVE keep
          their content height; only the options shrink and scroll. */}
      <div
        className="absolute bottom-0 left-0 flex max-h-[min(1500px,calc(100%_-_96px))] w-[1080px] flex-col gap-[75px] rounded-t-[60px] bg-tb-surface px-[24px] pb-[24px] pt-[54px]"
        style={{ animation: "tbSlotSheetEnter 0.2s ease-out both" }}
      >
        <h2 className="tb-display px-[72px] text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple">
          {t("pack.selectGroup", { name: name(group) })}
        </h2>
        <button
          type="button"
          data-testid="slot-sheet-close"
          aria-label={t("language.close")}
          onClick={onClose}
          className="absolute right-[44px] top-[44px] h-[48px] w-[48px] min-h-[44px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div className="flex min-h-0 flex-1 flex-col gap-[75px] overflow-y-auto">
          {included.length > 0 && renderSection(t("pack.included"), included)}
          {upgrades.length > 0 && renderSection(t("pack.upgrades"), upgrades)}
        </div>

        <button
          type="button"
          data-testid="slot-sheet-save"
          disabled={saveLocked}
          onClick={() => (pickedItem ? onSave(pickedItem) : onClose())}
          className={`tb-display w-full min-h-[44px] shrink-0 rounded-[8px] py-[32px] text-center text-[24px] leading-[32px] ${
            saveLocked
              ? "bg-tb-grey-4 text-tb-surface"
              : "bg-tb-purple text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)]"
          }`}
        >
          {t("pack.save")}
        </button>
      </div>
    </div>
  );
}

/**
 * Slot selection sheet — Figma "SELECT SIDE" 1:2814 (bag-pdp restyle; same
 * component family as the pack sheets 1:4761 / 1:4692): full-width bottom
 * sheet over the purple 80% skrim.
 * "Included" rows (falsy price) then "Upgrades" rows (+price | cal); purple
 * underlined Customize link only where canCustomize(item); radio at the
 * right; SAVE locks while group.min > 0 and nothing is picked. Pure
 * presentational — selection legality is the caller's job. Entrance is the
 * tb-modal-enter pattern adapted for bottom anchoring (pure CSS keyframe,
 * scoped here because index.css's transform targets centered modals).
 */
export default function SlotSelectionSheet(props: SlotSelectionSheetProps) {
  if (!props.open || !props.group) return null;
  return <SheetBody key={String(props.group?._id ?? "")} {...props} />;
}
