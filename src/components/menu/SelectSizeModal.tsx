/* eslint-disable @typescript-eslint/no-explicit-any --
 * Variant entities flow through untyped from the legacy converters; typed in
 * the domain passes. Do not add NEW anys.
 */
import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import closeIcon from "../../assets/icons/close.svg";

interface SelectSizeModalProps {
  entity: any | null;
  onClose: () => void;
  onContinue: (variant: any) => void;
}

const calText = (v: any) => {
  const cal = v?.calorieCount ?? v?.nutritionalInfo?.calorieCount;
  const value = typeof cal === "object" ? cal?.value : cal;
  return value ? ` | ${value} Cal` : "";
};

/**
 * "SELECT A SIZE" — Figma "Select a Size v2" (1:5628/1:5683). Hero card for
 * the first/default variant (BEST VALUE tag), smaller tiles for the rest,
 * radio selection, CONTINUE disabled until a size is chosen. Price shown as
 * a delta vs the cheapest variant (Figma: "+£2.50" / base shows absolute).
 */
export default function SelectSizeModal({
  entity,
  onClose,
  onContinue,
}: SelectSizeModalProps) {
  const { t } = useTranslation();
  const currencySettings = useSelector(selectCurrency) as any;
  const currency = currencySettings?.symbol ?? "";
  const [selectedId, setSelectedId] = useState<string>("");

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
  const rest = variants.slice(1);
  const selected = variants.find((v: any) => v.id === selectedId) ?? null;

  const priceLabel = (v: any) => {
    const p = Number(v?.price ?? 0);
    return p > minPrice
      ? `+${currency}${(p - minPrice).toFixed(2)}`
      : `${currency}${p.toFixed(2)}`;
  };

  // Render helper, NOT a component (react-hooks/static-components).
  const renderRadio = (v: any) => (
    <span
      className={`absolute bottom-[12px] right-[12px] h-[28px] w-[28px] rounded-full border-2 ${
        selectedId === v.id ? "border-tb-purple bg-tb-purple" : "border-tb-purple/40 bg-tb-surface"
      }`}
    />
  );

  return (
    <div className="absolute inset-0 z-40" data-testid="select-size-modal">
      <button
        type="button"
        aria-label={t("language.close")}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple-vibrant/70"
      />
      <div className="tb-modal-enter absolute left-1/2 top-1/2 max-h-[1500px] w-[560px] overflow-y-auto rounded-[16px] bg-tb-surface p-[32px]">
        <h2 className="tb-display mb-[8px] pr-[56px] text-center text-[30px] leading-[1] tracking-[-1px] text-tb-purple-vibrant">
          {t("size.title")}
        </h2>
        <p className="mb-[24px] text-center text-[22px] font-medium text-black">
          {entity?.name}
        </p>
        <button
          type="button"
          aria-label={t("language.close")}
          onClick={onClose}
          className="absolute right-[24px] top-[24px] h-[44px] w-[44px]"
        >
          <img alt="" src={closeIcon} className="h-full w-full" />
        </button>

        {hero && (
          <button
            type="button"
            data-testid={`size-${hero.id}`}
            onClick={() => setSelectedId(hero.id)}
            className="relative mb-[16px] flex w-full flex-col items-center rounded-b-[8px] rounded-t-[400px] bg-tb-grey-6 px-[24px] pb-[20px] pt-[40px]"
          >
            <span className="tb-compressed mb-[8px] bg-tb-yellow px-[10px] py-[8px] text-[20px] leading-[16px] text-black">
              {t("size.bestValue")}
            </span>
            <p className="text-[26px] font-medium capitalize text-black">{hero.name}</p>
            <p className="mb-[8px] text-[17px] text-tb-ink-purple">
              {priceLabel(hero)}
              {calText(hero)}
            </p>
            {hero.image_url && (
              <img alt="" src={hero.image_url} className="h-[220px] w-full object-contain" />
            )}
            {renderRadio(hero)}
          </button>
        )}

        {rest.length > 0 && (
          <div className="mb-[24px] grid grid-cols-2 gap-[16px]">
            {rest.map((v: any) => (
              <button
                key={v.id}
                type="button"
                data-testid={`size-${v.id}`}
                onClick={() => setSelectedId(v.id)}
                className="relative flex flex-col items-start rounded-[8px] bg-tb-grey-6 p-[16px] pb-[44px]"
              >
                {v.image_url && (
                  <img alt="" src={v.image_url} className="mb-2 h-[120px] w-full object-contain" />
                )}
                <p className="text-[19px] font-medium capitalize text-black">{v.name}</p>
                <p className="text-[15px] text-tb-ink-purple">
                  {priceLabel(v)}
                  {calText(v)}
                </p>
                {renderRadio(v)}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          data-testid="size-continue"
          disabled={!selected}
          onClick={() => selected && onContinue(selected)}
          className={`tb-display w-full rounded-[8px] py-[20px] text-center text-[20px] min-h-[44px] ${
            selected ? "bg-tb-purple text-tb-surface" : "bg-tb-grey-4 text-tb-surface"
          }`}
        >
          {t("size.continue")}
        </button>
      </div>
    </div>
  );
}
