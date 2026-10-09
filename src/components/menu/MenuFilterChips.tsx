import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectTags } from "@cx-sdk/catalog/state/Menu.slice";
import {
  kiosSettingsRdx,
  selectHideFilter,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { selectFilters, setFilters } from "@cx-sdk/catalog/state/filter.slice";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import VegMark from "./VegMark";

const DIET_TAGS = ["veg", "non-veg"] as const;
type DietTag = (typeof DIET_TAGS)[number];

const LABEL_KEY: Record<DietTag, string> = { veg: "menu.veg", "non-veg": "menu.nonVeg" };
/** Stable stand-in entities for the chips' marks (VegMark is memoised). */
const MARK_ENTITY: Record<DietTag, { tags: string[] }> = {
  veg: { tags: ["veg"] },
  "non-veg": { tags: ["non-veg"] },
};

interface MenuFilterChipsProps {
  /** After every toggle: the menu returns its pane to the top. */
  onChange?: () => void;
}

/**
 * VEG / NON-VEG filter chips in the category rail (audit-fixes U1, PAR-05;
 * no Figma frame — design language, sign-off). A chip shows only when the
 * menu carries its tag and neither `hide_filter` nor `hide_veg_non_veg` is
 * on (the flag is re-checked here: `setTags` is skipped for an empty tag
 * set, so the menu's tag list can be stale). One diet at a time, the fork's
 * rule: a tap selects it, a second tap clears it.
 * ponytail: diet tags only — the fork's sectioned chips and FILTERS sheet
 * come if a menu ever ships non-diet tags.
 *
 * The selection is `state.filter.filters` (cleared by the session reset):
 * Menu filters the rail and the sections by it, and useTagFilter already
 * narrows MIAM, the repeat sheet, the upsell and the tenant suggestions.
 */
export default function MenuFilterChips({ onChange }: MenuFilterChipsProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const tags = useSelector(selectTags) as unknown;
  const filters = (useSelector(selectFilters) as string[] | undefined) ?? [];
  const hideFilter = Boolean(useSelector(selectHideFilter));
  const hideVegNonVeg = Boolean(
    (useSelector(kiosSettingsRdx) as { hide_veg_non_veg?: unknown } | undefined)
      ?.hide_veg_non_veg
  );

  const chips =
    hideFilter || hideVegNonVeg
      ? []
      : DIET_TAGS.filter((tag) => Array.isArray(tags) && tags.includes(tag));
  if (chips.length === 0) return null;

  const toggle = (tag: DietTag) => {
    const next = filters.includes(tag) ? [] : [tag];
    dispatch(setFilters(next));
    if (next.length > 0) {
      captureKioskEvent(KioskEventName.filterApplied, { tag_count: next.length, tags: next });
    } else {
      captureKioskEvent(KioskEventName.filterRemoved, { previous_tag_count: filters.length });
    }
    onChange?.();
  };

  return (
    <div
      role="group"
      aria-label={t("menu.filters")}
      className="mb-[24px] flex w-full flex-col gap-[12px]"
    >
      {chips.map((tag) => {
        const on = filters.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={on}
            data-testid={`menu-filter-${tag}`}
            onClick={() => toggle(tag)}
            className={`tb-select tb-compressed flex h-[56px] w-full items-center gap-[12px] rounded-[8px] border-2 border-tb-purple pl-[16px] text-[24px] leading-[24px] ${
              on ? "bg-tb-purple text-tb-surface" : "text-tb-purple"
            }`}
          >
            <VegMark entity={MARK_ENTITY[tag]} decorative />
            {t(LABEL_KEY[tag])}
          </button>
        );
      })}
    </div>
  );
}
