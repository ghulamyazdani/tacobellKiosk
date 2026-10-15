/* eslint-disable @typescript-eslint/no-explicit-any --
 * Modifier groups / constituent items flow through untyped from the legacy
 * converters; typed in later domain passes. Do not add NEW anys.
 */
import { useTranslation } from "react-i18next";
import { resolveEntityImage } from "../../utils/entityImage";
import useLocalized from "../../hooks/utils/useLocalized";
import OptionCard, { formatOptionMeta } from "./OptionCard";

interface PackSlotCardProps {
  group: any; // modifier group (name, _id, min, max)
  selection: any[]; // selectedCustomizations[group._id] ?? []
  previewItem?: any; // first option, in-stock ones first (the empty slot's photo; out of stock = none is)
  currency: string;
  errored?: boolean; // min/max errored ring
  /** The slot has ONE option: once picked it is an included item (FIXED). */
  fixed?: boolean;
  /** A FIXED slot's CUSTOMIZE — passed only when its pick is tier-2 capable. */
  onCustomize?: () => void;
  onOpen: () => void; // open the slot sheet
}

/**
 * Pack slot card — Figma "What's Included" (1:2930) on the shared
 * Menu-Item_Medium card (OptionCard).
 * FIXED (a one-option slot with its pick — Beefy Fries Burrito, Churros): no
 * radio, not tappable, the pick's name / meta, CUSTOMIZE only when the pick
 * can be customized.
 * CHOICE (several options, or an empty one-option slot — Regular Drink,
 * Side): radio; empty = the slot's own name over its first option's photo +
 * "SELECT {group}"; picked (1:2856) = the pick + "SWAP". The card and its CTA
 * both open the slot sheet.
 */
export default function PackSlotCard({
  group,
  selection,
  previewItem,
  currency,
  errored = false,
  fixed = false,
  onCustomize,
  onOpen,
}: PackSlotCardProps) {
  const { t } = useTranslation();
  const { name } = useLocalized();
  const id = group?._id;
  const pick = selection?.[0] ?? null;

  if (fixed && pick) {
    return (
      <OptionCard
        testId={`pack-slot-${id}`}
        image={resolveEntityImage(pick)}
        name={name(pick)}
        meta={formatOptionMeta(pick, currency, t)}
        errored={errored}
        cta={
          onCustomize
            ? { label: t("pack.customize"), onClick: onCustomize, testId: `pack-slot-customize-${id}` }
            : undefined
        }
      />
    );
  }

  const label = pick ? t("pack.swap") : t("pack.selectGroup", { name: name(group) });
  // walk-oos (review F10): the options come in-stock first, so an empty slot
  // previewing a sold-out one has none in stock — the unavailable look.
  const soldOut = !pick && previewItem?.outOfStock === true;
  return (
    <OptionCard
      testId={`pack-slot-${id}`}
      image={resolveEntityImage(pick ?? previewItem)}
      name={pick ? name(pick) : name(group)}
      meta={pick ? formatOptionMeta(pick, currency, t) : undefined}
      radio={pick ? "on" : "off"}
      unavailable={
        soldOut
          ? { label: t("menu.unavailable"), name: t("pdp.optionUnavailable", { name: name(group) }) }
          : undefined
      }
      errored={errored}
      cta={{ label, onClick: onOpen, testId: `pack-slot-cta-${id}` }}
      onSelect={onOpen}
      selectLabel={label}
      selectTestId={`pack-slot-open-${id}`}
    />
  );
}
