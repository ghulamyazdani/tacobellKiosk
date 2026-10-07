import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  sortModifierIdsByOrder,
  type FetchModifierProperties,
  type MinMaxViolation,
} from "@cx-sdk/ordering/customization/groupCompletion";
import {
  listMinMaxViolations,
  listVariantSelectionViolations,
} from "@cx-sdk/ordering/customization/incompleteGroups";
import useAllowMultiplePunch from "../../hooks/customization/useAllowMultiplePunch";
import useLocalized from "../../hooks/utils/useLocalized";
import ErrorModal from "../common/ErrorModal";
import "../../i18n/lazyCopy";

interface PdpIncompleteWarningProps {
  /** The PDP's tier-1 entity. */
  entity: { hasVariant?: unknown; modifiers?: unknown } | null | undefined;
  selectedVariant: { modifiers?: string[] } | null | undefined;
  /** The PDP's tier-1 selectedCustomizations. */
  customizations: unknown;
  fetchModifierProperties: FetchModifierProperties;
  /** The PDP's pack-slot test: a slot group among them → the box title. */
  isBox: (group: unknown) => boolean;
  onClose: () => void;
}

/*
  Every group the failed commit left incomplete, as resolved group objects.
  Same inputs and the same hasVariant / modifiers branch as
  addTier1CustomizationToMIAMCart's validation, and the SDK list functions
  loop the very first-failure scans that validation ran, so the warning and
  the commit can never disagree.
*/
const listIncompleteGroups = (
  { entity, selectedVariant, customizations, fetchModifierProperties }: PdpIncompleteWarningProps,
  allowMultiplePunch: boolean,
): unknown[] => {
  try {
    let violations: MinMaxViolation[] = [];
    if (entity?.hasVariant) {
      if (Object.keys(selectedVariant ?? {}).length === 0) return [];
      violations = listVariantSelectionViolations({
        modifierIds: sortModifierIdsByOrder(
          fetchModifierProperties(selectedVariant?.modifiers ?? []) || [],
        ),
        mergedCustomizations: customizations,
        fetchModifierProperties,
        allowMultiplePunch,
      });
    } else if (Array.isArray(entity?.modifiers) && entity.modifiers.length > 0) {
      violations = listMinMaxViolations(
        customizations,
        fetchModifierProperties,
        allowMultiplePunch,
      );
    }
    return violations
      .map((violation) => fetchModifierProperties([violation.modifierID])?.[0])
      .filter(Boolean);
  } catch {
    return []; // a convenience: the ring + AutoScroll already ran (Rule 2)
  }
};

/**
 * PDP completion warning (item 23, Figma Modal 1:945 / 1:2855: no icon, one
 * full-width GOT IT; z-80 over the PDP, embedded hosts included). Mounted
 * afresh by each failed ADD TO BAG (the PDP keys it per tap); it names every
 * incomplete group as the guest saw them at that tap, and shows nothing when
 * there is none (a rejected split edit fails with every group complete). The
 * non-box title is design language (sign-off). Lazy (bagLazyParts — D7: the
 * one lazy entry).
 */
export default function PdpIncompleteWarning(props: PdpIncompleteWarningProps) {
  const { isBox, onClose } = props;
  const { t, i18n } = useTranslation();
  const { name } = useLocalized();
  const { isAllowMultiplePunch } = useAllowMultiplePunch();
  const [groups] = useState(() => listIncompleteGroups(props, isAllowMultiplePunch()));

  if (groups.length === 0) return null;

  // Lower-cased and joined in the guest's language ("drink and side" / "… و …").
  const names = groups.map((group) => name(group));
  let joined: string;
  try {
    joined = new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(
      names.map((label) => label.toLocaleLowerCase(i18n.language)),
    );
  } catch {
    joined = names.join(", "); // an unknown locale tag must not take the PDP down
  }

  return (
    <ErrorModal
      testId="pdp-incomplete"
      icon={false}
      wide
      title={t(groups.some(isBox) ? "pdp.incomplete.titleBox" : "pdp.incomplete.titleItem")}
      message={t("pdp.incomplete.body", { groups: joined })}
      primary={{
        label: t("offers.gotIt"),
        onClick: onClose,
        testId: "pdp-incomplete-gotit",
      }}
    />
  );
}
