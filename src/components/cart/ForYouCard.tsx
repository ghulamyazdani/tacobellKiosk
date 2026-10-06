import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { resolveEntityImage } from "../../utils/entityImage";
import {
  CART_UPSELL_CARD_HEIGHT_PX,
  CART_UPSELL_CARD_WIDTH_PX,
  CART_UPSELL_IMAGE_HEIGHT_PX,
  CART_UPSELL_TITLE_HEIGHT_PX,
  CART_UPSELL_TITLE_LINE_HEIGHT_PX,
} from "../../hooks/menuHooks/cartUpsellUtils";
import plusIcon from "../../assets/icons/plus.svg";

/**
 * The engine's RecommendedEntity is deliberately narrow; the converted menu
 * entities additionally carry `image_url` and sometimes an object-shaped
 * calorie count (MenuItemCard precedent). Read those through this widening
 * rather than `any`. Lifted verbatim from CompleteYourMealRail.
 */
type ConvertedEntityExtras = {
  image_url?: string;
  calorieCount?: number | string | { value?: number | string };
  nutritionalInfo?: {
    calorieCount?: number | string | { value?: number | string };
  };
};

const calorieValue = (
  entity: RecommendedEntity,
): number | string | undefined => {
  const extras = entity as RecommendedEntity & ConvertedEntityExtras;
  const cal = extras?.calorieCount ?? extras?.nutritionalInfo?.calorieCount;
  if (cal !== null && typeof cal === "object") return cal?.value;
  return cal;
};

export interface ForYouCardProps {
  /** The suggestion itself — handed straight back to `onAdd`. */
  entity: RecommendedEntity;
  /** Display name, resolved at render via `useLocalized().name(entity)` — never raw `entity.name`. */
  title: string;
  /**
   * The RAW menu price, currency-symbol-free and untaxed — the same number
   * the menu tile shows. The bill's taxed total is a cart concept and must
   * never appear on a suggestion card.
   */
  price?: number | string;
  /** Currency symbol, resolved by the consumer from `selectCurrency`. */
  currency: string;
  /** Live quantity of this product in the cart; > 0 renders the count pill. */
  quantity: number;
  /** Accessible verb for a tap that adds straight to the cart. */
  addLabel: string;
  /**
   * Accessible verb for a tap that opens a chooser. Accessible name ONLY —
   * nothing visible marks those items (fork product call, 2026-08-17): on a
   * suggestion grid a "CUSTOMIZE" strip reads as a warning label. Screen
   * reader users keep it because the label is the only warning they get that
   * the tap leaves the screen.
   */
  customizeLabel: string;
  /**
   * `bag-rail-item-<id>` on the bag rail, `foryou-card-<id>` on /forYou. The
   * two surfaces are addressed by different suites, so the id is the
   * consumer's to choose — the card never invents one.
   */
  testId: string;
  onAdd: (entity: RecommendedEntity) => void;
}

/**
 * ONE suggestion tile, shared by the bag's Complete-Your-Meal rail and the
 * pre-cart /forYou grid.
 *
 * Extracted from `CompleteYourMealRail.renderCard` (P7d) — the Figma
 * "Menu-Item" card as it appears on the bag rail (mybag 1:3171 / node
 * I1:3196;6618:5020): a fixed 240x277 box, name + `price | cal` above a 172px
 * `object-contain` image, a decorative circle-plus top-right and the in-cart
 * count top-left. `renderCard` was a render helper, not a component
 * (react-hooks/static-components); this IS a component, so it is memoized and
 * props-only — NO redux, and no hook beyond `useTranslation` for the calorie
 * unit. Both consumers own their own store reads and hand the results down.
 *
 * FIXED SIZE, NOT CONTENT SIZE. The width/height come from the same constants
 * the /forYou capacity math uses (cartUpsellUtils), applied inline rather than
 * as Tailwind classes: if the two ever disagreed the grid would overflow a
 * page that cannot scroll, taking its buttons off screen. The name box is two
 * lines tall whether the name needs one or two, so a long name can never make
 * one card taller than the one beside it.
 *
 * The WHOLE tile is the tap target (240x277) — an order of magnitude past the
 * 44px floor (Rule 4) — so the circle-plus is decorative and `aria-hidden`.
 */
function ForYouCardBase({
  entity,
  title,
  price,
  currency,
  quantity,
  addLabel,
  customizeLabel,
  testId,
  onAdd,
}: ForYouCardProps) {
  const { t } = useTranslation();

  const imageUrl = resolveEntityImage(entity);
  const cal = calorieValue(entity);
  const priceLine = `${currency}${price ?? ""}${
    cal ? ` | ${t("pack.cal", { value: cal })}` : ""
  }`;

  /*
    One tap = straight into the cart; anything else opens a chooser and LEAVES
    the surface. `isDirectlyAddable` is stamped on every entity by
    collectCartUpsellEntities (it is `isOneTapAddable`, the flow invariant), so
    both consumers get the same answer without this component reading a store.
  */
  const oneTap = !!entity?.isDirectlyAddable;

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={`${oneTap ? addLabel : customizeLabel} ${title}`}
      onClick={() => onAdd(entity)}
      className="relative flex shrink-0 flex-col items-stretch justify-between overflow-hidden rounded-[8px] bg-tb-grey-6 text-left"
      style={{
        width: CART_UPSELL_CARD_WIDTH_PX,
        height: CART_UPSELL_CARD_HEIGHT_PX,
      }}
    >
      <span className="flex flex-col gap-[4px] pl-[24px] pr-[64px] pt-[24px]">
        <span
          className="block overflow-hidden text-[20px] font-medium capitalize tracking-[-0.5px] text-black"
          style={{
            lineHeight: `${CART_UPSELL_TITLE_LINE_HEIGHT_PX}px`,
            maxHeight: CART_UPSELL_TITLE_HEIGHT_PX,
          }}
        >
          {title}
        </span>
        <span className="block text-[18px] leading-[20px] text-tb-ink-purple">
          {priceLine}
        </span>
      </span>
      {imageUrl ? (
        <img
          alt=""
          src={imageUrl}
          className="w-full object-contain"
          style={{ height: CART_UPSELL_IMAGE_HEIGHT_PX }}
        />
      ) : (
        // Reserve the band rather than collapsing it: the card height is
        // fixed, so an imageless item must keep its text where its neighbours
        // keep theirs.
        <span
          className="block w-full"
          style={{ height: CART_UPSELL_IMAGE_HEIGHT_PX }}
        />
      )}
      <span
        aria-hidden="true"
        className="absolute right-[12px] top-[12px] flex h-[44px] w-[44px] items-center justify-center rounded-full bg-tb-surface shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)]"
      >
        <img alt="" src={plusIcon} className="h-[16px] w-[16px]" />
      </span>
      {quantity > 0 && (
        <span className="absolute left-[12px] top-[12px] flex h-[36px] min-w-[36px] items-center justify-center rounded-full bg-tb-purple px-[8px] text-[18px] font-bold text-tb-surface">
          {quantity}
        </span>
      )}
    </button>
  );
}

/**
 * Memoized: /forYou renders a whole grid of these and the cart quantity moves
 * under them on every add, so only the tile whose `quantity` actually changed
 * should re-render. Every prop is a primitive or a stable entity reference.
 */
const ForYouCard = memo(ForYouCardBase);
ForYouCard.displayName = "ForYouCard";

export default ForYouCard;
