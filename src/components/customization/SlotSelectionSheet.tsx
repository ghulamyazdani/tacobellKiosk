/* eslint-disable @typescript-eslint/no-explicit-any --
 * Modifier groups / constituent items flow through untyped from the legacy
 * converters; typed in later domain passes. Do not add NEW anys.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import closeIcon from "../../assets/icons/close.svg";

interface SlotSelectionSheetProps {
  open: boolean;
  group: any; // slot group; title = group.name
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
  const [picked, setPicked] = useState<string>(selectedId ?? "");

  const list: any[] = Array.isArray(options) ? options : [];
  const included = list.filter((o: any) => !(Number(o?.price) > 0));
  const upgrades = list.filter((o: any) => Number(o?.price) > 0);
  const pickedItem = list.find((o: any) => o?.id === picked) ?? null;
  const saveLocked = Number(group?.min ?? 0) > 0 && !pickedItem;

  // Render helper, NOT a component (react-hooks/static-components).
  const renderRow = (item: any) => {
    const isPicked = item?.id === picked;
    const price = Number(item?.price ?? 0);
    const cal = calValue(item);
    const calText = cal ? t("pack.cal", { value: cal }) : "";
    const line =
      price > 0
        ? `+${currency}${price.toFixed(2)}${calText ? ` | ${calText}` : ""}`
        : calText;

    return (
      <div
        key={item?.id}
        className="relative flex items-center gap-[20px] border-b border-tb-grey-4 px-[24px] py-[16px]"
      >
        {item?.image_url ? (
          <img
            alt=""
            src={item.image_url}
            className="h-[80px] w-[80px] shrink-0 rounded-[8px] bg-tb-grey-6 object-contain"
          />
        ) : (
          <span className="h-[80px] w-[80px] shrink-0 rounded-[8px] bg-tb-grey-6" />
        )}

        <span className="flex-1">
          <span className="block text-[20px] font-medium capitalize leading-[24px] text-black">
            {item?.name}
          </span>
          {line && (
            <span className="mt-[2px] block text-[16px] leading-[22px] text-tb-ink-purple/70">
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

        <span
          className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full border-2 ${
            isPicked
              ? "border-tb-purple bg-tb-purple text-tb-surface"
              : "border-tb-purple/40 bg-tb-surface"
          }`}
        >
          {isPicked && (
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

        {/* full-row pick target (last in DOM = on top; Customize sits above via z-10) */}
        <button
          type="button"
          data-testid={`slot-option-${item?.id}`}
          aria-label={item?.name}
          onClick={() => setPicked(item?.id)}
          className="absolute inset-0 h-full w-full min-h-[44px]"
        />
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-40" data-testid="slot-sheet">
      <style>{`@keyframes tbSlotSheetEnter{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70"
      />
      <div
        className="absolute bottom-0 left-0 flex max-h-[1500px] w-[1080px] flex-col rounded-t-[24px] bg-tb-surface pt-[44px]"
        style={{ animation: "tbSlotSheetEnter 0.2s ease-out both" }}
      >
        <h2 className="tb-display mb-[20px] px-[96px] text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-purple-vibrant">
          {t("pack.selectGroup", { name: group?.name ?? "" })}
        </h2>
        <button
          type="button"
          data-testid="slot-sheet-close"
          aria-label={t("language.close")}
          onClick={onClose}
          className="absolute right-[32px] top-[36px] h-[48px] w-[48px] min-h-[44px] min-w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[8px]">
          {included.length > 0 && (
            <>
              <p className="border-b border-tb-grey-4 px-[24px] pb-[10px] pt-[16px] text-[16px] font-medium text-black">
                {t("pack.included")}
              </p>
              {included.map(renderRow)}
            </>
          )}
          {upgrades.length > 0 && (
            <>
              <p className="border-b border-tb-grey-4 px-[24px] pb-[10px] pt-[24px] text-[16px] font-medium text-black">
                {t("pack.upgrades")}
              </p>
              {upgrades.map(renderRow)}
            </>
          )}
        </div>

        <div className="px-[24px] pb-[32px] pt-[16px]">
          <button
            type="button"
            data-testid="slot-sheet-save"
            disabled={saveLocked}
            onClick={() => (pickedItem ? onSave(pickedItem) : onClose())}
            className={`tb-display w-full min-h-[44px] rounded-[8px] py-[24px] text-center text-[22px] ${
              saveLocked ? "bg-tb-grey-4 text-tb-surface" : "bg-tb-purple text-tb-surface"
            }`}
          >
            {t("pack.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Slot selection sheet — Figma "SELECT BURRITO" (1:4761) / "SELECT SIDE"
 * (1:4692): full-width bottom sheet over a purple-tinted backdrop.
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
