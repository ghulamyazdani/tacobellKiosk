import { memo } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { kiosSettingsRdx } from "@cx-sdk/catalog/state/appSettings.slice";

export type VegType = "veg" | "non-veg";

/** Only the fields the diet rule reads (menu entities and cart rows alike). */
interface Taggable {
  type?: unknown;
  tags?: unknown;
  selectedVariant?: { tags?: unknown } | null;
}

/**
 * The diet mark of a menu entity or a cart row (audit-fixes U1). A VARIANT
 * row reads its `selectedVariant.tags`, anything else its own `tags` (the
 * fork's CartItem rule). Tri-state (D-U1a): an entity with neither the "veg"
 * nor the "non-veg" tag gets NO mark — the fork showed non-veg for anything
 * not tagged "veg".
 */
// eslint-disable-next-line react-refresh/only-export-components -- the rule is shared with the menu filter / bag surfaces; HMR falls back to a reload for this file
export function vegTypeOf(entity: unknown): VegType | null {
  const row = (entity ?? {}) as Taggable;
  const variantTags =
    row.type === "VARIANT" ? row.selectedVariant?.tags : undefined;
  const tags = Array.isArray(variantTags) ? variantTags : row.tags;
  if (!Array.isArray(tags)) return null;
  if (tags.includes("veg")) return "veg";
  return tags.includes("non-veg") ? "non-veg" : null;
}

export interface VegMarkProps {
  /** A menu entity or a cart row — see `vegTypeOf`. */
  entity: unknown;
  /** Outer square in design px (default 20). */
  size?: number;
  /** Beside a visible "Veg" / "Non-veg" label: hidden from assistive tech. */
  decorative?: boolean;
  /** Extra classes on the mark (its placement in the host's line). */
  className?: string;
}

/**
 * The veg / non-veg mark: a square with a dot (veg) or a triangle (non-veg),
 * pure CSS — the fork's VegNonVeg shapes in the `tb-veg` / `tb-non-veg`
 * tokens. No Figma frame (design language, sign-off). Renders nothing under
 * the operator's `hide_veg_non_veg` or for an untagged entity. It carries NO
 * text node: the menu card's price `<p>` is read as text by the e2e suite.
 */
function VegMark({ entity, size = 20, decorative = false, className = "" }: VegMarkProps) {
  const { t } = useTranslation();
  const hidden = useSelector((state: unknown) =>
    Boolean(kiosSettingsRdx(state)?.hide_veg_non_veg),
  );
  const type = vegTypeOf(entity);
  if (hidden || !type) return null;

  const veg = type === "veg";
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : t(veg ? "menu.veg" : "menu.nonVeg")}
      aria-hidden={decorative || undefined}
      data-testid={`veg-mark-${type}`}
      className={`pointer-events-none inline-flex shrink-0 items-center justify-center rounded-[2px] border-2 bg-tb-surface ${
        veg ? "border-tb-veg" : "border-tb-non-veg"
      }${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
    >
      <span
        className={
          veg
            ? "h-1/2 w-1/2 rounded-full bg-tb-veg"
            : "h-1/2 w-1/2 bg-tb-non-veg [clip-path:polygon(50%_0,100%_100%,0_100%)]"
        }
      />
    </span>
  );
}

export default memo(VegMark);
