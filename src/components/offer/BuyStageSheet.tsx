import { Fragment, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { buildDirectAddPayload } from "@cx-sdk/ordering/cart/addIntent";
import { isBOGOOfferApplicable } from "@cx-sdk/ordering/offer/offerEngine";
import {
  countCartQuantityForTile,
  countPaidCartQuantity,
  excludesLoyalty,
  findCartRowsForTile,
  getBuyStageProgress,
  type BuyCartRow,
  type BuyMenuEntity,
  type BuyStageGroup,
  type BuyStageOffer,
} from "@cx-sdk/ordering/offer/buyStageUtils";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import type { BuyStage } from "../../hooks/offerHooks/useBuyStage";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import { resolveEntityImage } from "../../utils/entityImage";
import {
  CART_UPSELL_IMAGE_HEIGHT_PX,
  CART_UPSELL_TITLE_HEIGHT_PX,
  CART_UPSELL_TITLE_LINE_HEIGHT_PX,
} from "../../hooks/menuHooks/cartUpsellUtils";
import closeIcon from "../../assets/icons/close.svg";
import plusIcon from "../../assets/icons/plus.svg";

export interface BuyStageSheetProps {
  /** The offer being unlocked and its resolved buy side (useBuyStage). */
  stage: BuyStage;
  /** CONTINUE's commit is in flight — every control is inert meanwhile. */
  continuing: boolean;
  /** The page's verdict when a CONTINUE was refused (e.g. sameOrLess). */
  blockedMessage: string | null;
  /** Abandon + back to the rewards list (the page rolls the cart back). */
  onBack(): void;
  /** X / backdrop: abandon (the page rolls the cart back). */
  onClose(): void;
  /** Commit the unlocked offer (the page awaits useBuyStage.continueStage). */
  onContinue(): void;
}

/** Decrement refusals, rendered inline (TB mounts no global error modal). */
type GuardKey = "loyaltyRowGuard" | "cartEmptyGuard";

/**
 * Converted menu entities may carry an object-shaped calorie count — read
 * through this widening rather than `any`. Lifted verbatim from ForYouCard.
 */
type ConvertedEntityExtras = {
  calorieCount?: number | string | { value?: number | string };
  nutritionalInfo?: {
    calorieCount?: number | string | { value?: number | string };
  };
};

const calorieValue = (
  entity: BuyMenuEntity,
): number | string | undefined => {
  const extras = entity as BuyMenuEntity & ConvertedEntityExtras;
  const cal = extras?.calorieCount ?? extras?.nutritionalInfo?.calorieCount;
  if (cal !== null && typeof cal === "object") return cal?.value;
  return cal;
};

/**
 * BOGO BUY STAGE — "unlock this reward" (offers lane, item 31). Opened from a
 * locked bogoBuySide row's ADD ITEMS in the rewards sheet; the fork's
 * BuyItemSelection structure re-skinned in the TB design language (no Figma
 * frame — flagged for client sign-off): RewardsSheet geometry (1:3824 header,
 * X, full-width purple CTA bar), Suggested-rail card tiles, bag-style steppers.
 *
 * The tiles read and write the REAL paid cart: a buy item is an ordinary
 * purchase. The counters mirror the engine (buyStageUtils) and the display is
 * clamped to "unlocked" whenever the engine predicate passes; CONTINUE only
 * reaches onContinue once satisfied. Nothing here navigates: customizable
 * tiles open the in-place paid tier session hosted by OfferTierHost.
 */
export default function BuyStageSheet({
  stage,
  continuing,
  blockedMessage,
  onBack,
  onClose,
  onContinue,
}: BuyStageSheetProps) {
  const { t } = useTranslation();
  const cart = useSelector(selectCart) as
    | { cartItems?: BuyCartRow[] }
    | null
    | undefined;
  const currencySettings = useSelector(selectCurrency) as
    | { symbol?: string; currency_symbol?: string }
    | null
    | undefined;
  const {
    addItemToCart,
    IncreaseItemQuantityById,
    decreaseItemQuantityById,
    doesItemExistInCart,
  } = useCartHook();
  const { openBuyItemTierModal } = useMakeItAMeal();

  const [guard, setGuard] = useState<GuardKey | null>(null);
  // CONTINUE tapped while locked → name the gap inline (the fork popped its
  // global error modal here).
  const [hintRequested, setHintRequested] = useState(false);

  const { offer, view } = stage;
  const cartItems = cart?.cartItems;
  const currency =
    currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";
  const excludeLoyalty = excludesLoyalty(view.mode);

  const progress = getBuyStageProgress(offer as BuyStageOffer, view, cartItems);
  // The engine predicate outranks the mirror (fork parity): once it unlocks,
  // the counter and bar read full.
  const satisfied =
    Boolean(isBOGOOfferApplicable(offer, offer?.applicable, cartItems)) ||
    progress.satisfied;
  const need = progress.totalNeed;
  const have = satisfied ? need : Math.min(progress.totalHave, need);
  const fill = satisfied ? 1 : need > 0 ? have / need : 0;
  const counterText = t("offers.buyStage.addedCount", { have, need });

  const subtitle =
    view.mode === "least"
      ? t("offers.buyStage.subtitleLeast", {
          count: view.sharedRequiredQuantity,
        })
      : view.mode === "plain-and"
        ? t("offers.buyStage.subtitleAnd")
        : t("offers.buyStage.subtitleOr");

  // How far from unlocking, measured the way the engine measures it.
  const remaining = (() => {
    if (view.mode === "plain-and") {
      return progress.perGroup.reduce(
        (sum, g) => sum + Math.max(0, g.need - g.have),
        0,
      );
    }
    if (view.mode === "plain-or") {
      return progress.perGroup.reduce(
        (min, g) => Math.min(min, Math.max(0, g.need - g.have)),
        Number.POSITIVE_INFINITY,
      );
    }
    return Math.max(0, progress.totalNeed - progress.totalHave);
  })();
  const hint =
    hintRequested && !satisfied
      ? remaining <= 1 || !Number.isFinite(remaining)
        ? t("offers.buyStage.hintMoreOne")
        : t("offers.buyStage.hintMoreOther", { count: remaining })
      : null;
  const guardText = guard ? t(`offers.buyStage.${guard}`) : blockedMessage;

  const handleAdd = (entity: BuyMenuEntity) => {
    if (continuing || entity?.outOfStock) return;
    setGuard(null);
    // Customizable / variant: the paid in-place tier session (OfferTierHost
    // renders the PDP inside the bag) — never a /customization hop.
    if (openBuyItemTierModal(entity)) return;
    // Plain: the menu cards' dedupe add WITHOUT the intent classifier, so a
    // MIAM upsell or the repeat sheet can never stack over the stage.
    if (doesItemExistInCart(entity?.id)?.itemExist) {
      IncreaseItemQuantityById(entity?.id, "ITEM", "id", entity);
    } else {
      // Same converted menu entity the menu cards hand the builder; the SDK
      // types its parameter as the narrower recommendation shape.
      addItemToCart(
        buildDirectAddPayload(entity as unknown as RecommendedEntity),
        "ITEM",
        { suppressAddedModal: true },
      );
    }
  };

  const handleDecrease = (entity: BuyMenuEntity, group: BuyStageGroup) => {
    if (continuing) return;
    const rows = findCartRowsForTile(entity, group, cartItems);
    if (rows.length === 0) {
      // The counter is backed by loyalty rows only — never removed from here.
      setGuard("loyaltyRowGuard");
      return;
    }
    // The last paid unit would trip the bag's empty-cart exit mid-stage.
    if (countPaidCartQuantity(cartItems) <= 1) {
      setGuard("cartEmptyGuard");
      return;
    }
    setGuard(null);
    decreaseItemQuantityById(rows[rows.length - 1]?.itemId, "ITEM", "itemId")
      .catch(() => undefined);
  };

  const handleContinue = () => {
    if (continuing) return;
    setGuard(null);
    if (!satisfied) {
      setHintRequested(true);
      return;
    }
    onContinue();
  };

  // Render helper, NOT a component (react-hooks/static-components) — the
  // Suggested-rail card skin with an ADD / stepper control under the image.
  const renderTile = (
    group: BuyStageGroup,
    entity: BuyMenuEntity,
    index: number,
  ) => {
    const id = String(entity?.id ?? index);
    const qty = countCartQuantityForTile(
      entity,
      group,
      cartItems,
      excludeLoyalty,
    );
    const name = `${entity?.name ?? ""}${
      group.requiredVariantId && group.requiredVariantName
        ? ` (${group.requiredVariantName})`
        : ""
    }`;
    const imageUrl = resolveEntityImage(entity);
    const cal = calorieValue(entity);
    const priceLine = `${currency}${entity?.price ?? ""}${
      cal ? ` | ${t("pack.cal", { value: cal })}` : ""
    }`;
    const unavailable = !!entity?.outOfStock;

    return (
      <div
        key={`${group.key}-${id}`}
        data-testid={`buy-stage-tile-${id}`}
        className={`flex flex-col overflow-hidden rounded-[8px] bg-tb-grey-6 ${
          qty > 0 ? "ring-[3px] ring-tb-purple" : ""
        }`}
      >
        <span className="flex flex-col gap-[4px] px-[24px] pt-[24px]">
          <span
            className="block overflow-hidden text-[20px] font-medium capitalize tracking-[-0.5px] text-black"
            style={{
              lineHeight: `${CART_UPSELL_TITLE_LINE_HEIGHT_PX}px`,
              height: CART_UPSELL_TITLE_HEIGHT_PX,
            }}
          >
            {name}
          </span>
          <span className="block text-[18px] leading-[20px] text-tb-ink-purple">
            {priceLine}
          </span>
        </span>
        {imageUrl ? (
          <img
            alt=""
            src={imageUrl}
            className={`w-full object-contain ${
              unavailable ? "opacity-40 grayscale" : ""
            }`}
            style={{ height: CART_UPSELL_IMAGE_HEIGHT_PX }}
          />
        ) : (
          <span
            className="block w-full"
            style={{ height: CART_UPSELL_IMAGE_HEIGHT_PX }}
          />
        )}
        <div className="px-[16px] pb-[16px] pt-[8px]">
          {qty === 0 ? (
            <button
              type="button"
              data-testid={`buy-stage-add-${id}`}
              aria-label={
                unavailable
                  ? undefined
                  : t("offers.buyStage.increase", { name })
              }
              disabled={continuing || unavailable}
              onClick={() => handleAdd(entity)}
              className={`tb-display flex h-[64px] w-full items-center justify-center rounded-full bg-tb-purple text-[20px] leading-[20px] text-tb-surface ${
                continuing || unavailable ? "opacity-40" : ""
              }`}
            >
              {unavailable ? t("menu.unavailable") : t("offers.buyStage.add")}
            </button>
          ) : (
            <div className="flex h-[64px] w-full items-center justify-between rounded-full border-[1.72px] border-[#b9b9b9] bg-tb-surface">
              <button
                type="button"
                data-testid={`buy-stage-dec-${id}`}
                aria-label={t("offers.buyStage.decrease", { name })}
                disabled={continuing}
                onClick={() => handleDecrease(entity, group)}
                className="flex h-full w-[64px] items-center justify-center text-tb-purple"
              >
                {/* Minus glyph (Figma icon 3601ce08) — BagItemRow's inline copy. */}
                <svg
                  viewBox="0 0 24 24"
                  className="h-[24px] w-[24px]"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M2.5 12C2.5 11.1716 3.17157 10.5 4 10.5L20 10.5C20.8284 10.5 21.5 11.1716 21.5 12C21.5 12.8284 20.8284 13.5 20 13.5L4 13.5C3.17157 13.5 2.5 12.8284 2.5 12Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <span
                data-testid={`buy-stage-qty-${id}`}
                className="text-[22px] font-black leading-[22px] text-black"
              >
                {qty}
              </span>
              <button
                type="button"
                data-testid={`buy-stage-inc-${id}`}
                aria-label={t("offers.buyStage.increase", { name })}
                disabled={continuing || unavailable}
                onClick={() => handleAdd(entity)}
                className={`flex h-full w-[64px] items-center justify-center ${
                  unavailable ? "opacity-40" : ""
                }`}
              >
                <img alt="" src={plusIcon} className="h-[24px] w-[24px]" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-50" data-testid="buy-stage-sheet">
      {/* Own position-neutral entrance keyframe — tb-modal-enter is reserved
          for centered modals (it carries a -50% translate). */}
      <style>{`@keyframes tbBuyStageSheetEnter{from{opacity:0;transform:translateY(80px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <button
        type="button"
        aria-label={t("offers.close")}
        disabled={continuing}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* RewardsSheet's cap: the X and the CTA bar stay on screen in the
          1122 ADA reach zone; only the tile grid scrolls. */}
      <div
        role="dialog"
        aria-label={offer?.name ?? ""}
        style={{ animation: "tbBuyStageSheetEnter 0.2s ease-out both" }}
        className="absolute bottom-0 left-0 flex h-[min(1470px,calc(100%_-_96px))] w-[1080px] flex-col overflow-hidden rounded-t-[60px] bg-tb-surface"
      >
        <div className="relative shrink-0 border-b border-tb-grey-4 px-[120px] pb-[28px] pt-[54px] text-center">
          <p className="text-[18px] font-bold uppercase leading-[22px] tracking-[2px] text-tb-ink-purple/70">
            {t("offers.buyStage.step")}
          </p>
          <h2 className="tb-display mt-[12px] line-clamp-2 text-[36px] leading-[40px] tracking-[-1px] text-tb-purple">
            {offer?.name}
          </h2>
          <p className="mt-[12px] text-[22px] leading-[26px] text-tb-ink-purple/80">
            {subtitle}
          </p>
          <div className="mt-[24px] flex flex-wrap items-center justify-center gap-[12px]">
            <span
              data-testid="buy-stage-counter"
              aria-live="polite"
              className="rounded-full bg-tb-lilac px-[20px] py-[8px] text-[20px] font-bold leading-[24px] text-tb-purple"
            >
              {counterText}
            </span>
            {satisfied && (
              <span
                data-testid="buy-stage-unlocked"
                className="rounded-full bg-tb-purple px-[20px] py-[8px] text-[20px] font-bold leading-[24px] text-tb-surface"
              >
                {t("offers.buyStage.unlocked")}
              </span>
            )}
          </div>
          <div
            role="progressbar"
            aria-label={counterText}
            aria-valuemin={0}
            aria-valuemax={need}
            aria-valuenow={have}
            className="mt-[20px] h-[12px] w-full overflow-hidden rounded-full bg-tb-grey-4"
          >
            {/* scaleX, never width (compositor-only); one transform owner. */}
            <div
              data-testid="buy-stage-progress"
              className="h-full w-full rounded-full bg-tb-purple transition-transform duration-300 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${fill})`, transformOrigin: "left" }}
            />
          </div>
          <button
            type="button"
            data-testid="buy-stage-close"
            aria-label={t("offers.close")}
            disabled={continuing}
            onClick={onClose}
            className="absolute right-[44px] top-[44px] h-[48px] min-h-[44px] w-[48px] min-w-[44px]"
          >
            <img alt="" src={closeIcon} className="h-full w-full" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-3 gap-[24px] px-[48px] py-[32px]">
            {view.groups.map((group: BuyStageGroup) => (
              <Fragment key={group.key}>
                {view.groups.length > 1 && (
                  <p
                    data-testid={`buy-stage-group-${group.key}`}
                    className="col-span-3 text-[22px] font-bold leading-[26px] text-black"
                  >
                    {/* least: the threshold is shared, so a per-group
                        "Any N" would mislead — the label alone (fork). */}
                    {view.mode === "least"
                      ? group.label || t("offers.buyStage.groupFallbackLabel")
                      : t("offers.buyStage.groupNeed", {
                          need: group.requiredQuantity,
                          label:
                            group.label ||
                            t("offers.buyStage.groupFallbackLabel"),
                        })}
                  </p>
                )}
                {group.entities.map((entity: BuyMenuEntity, index: number) =>
                  renderTile(group, entity, index),
                )}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="shrink-0 px-[24px] pb-[24px] pt-[16px] drop-shadow-[0px_0px_64px_rgba(0,0,0,0.08)]">
          {view.mode === "least" && (
            <p
              data-testid="buy-stage-least-note"
              className="mb-[16px] rounded-[8px] bg-tb-grey-6 px-[24px] py-[16px] text-center text-[20px] leading-[24px] text-tb-ink-purple"
            >
              {t("offers.buyStage.leastNote")}
            </p>
          )}
          {/* Both always mounted: a live region must exist before its text does. */}
          <p
            data-testid="buy-stage-hint"
            role="status"
            className={`text-center text-[20px] font-medium leading-[24px] text-tb-pink-dark ${
              hint ? "mb-[16px]" : ""
            }`}
          >
            {hint}
          </p>
          <p
            data-testid="buy-stage-guard"
            aria-live="polite"
            className={`text-center text-[20px] font-medium leading-[24px] text-tb-pink-dark ${
              guardText ? "mb-[16px]" : ""
            }`}
          >
            {guardText}
          </p>
          <div className="flex gap-[24px]">
            <button
              type="button"
              data-testid="buy-stage-back"
              disabled={continuing}
              onClick={onBack}
              className="tb-display min-h-[84px] shrink-0 rounded-[8px] border-2 border-tb-purple bg-tb-surface px-[56px] text-center text-[24px] leading-[20px] text-tb-purple"
            >
              {t("offers.buyStage.back")}
            </button>
            <button
              type="button"
              data-testid="buy-stage-continue"
              aria-busy={continuing}
              // Locked still answers a tap with the hint (freebie-confirm pattern).
              aria-disabled={!satisfied}
              disabled={continuing}
              onClick={handleContinue}
              className={`tb-display min-h-[84px] flex-1 rounded-[8px] bg-tb-purple py-[32px] text-center text-[24px] leading-[20px] text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)] ${
                satisfied && !continuing ? "" : "opacity-40"
              }`}
            >
              {view.mode === "least"
                ? t("offers.buyStage.apply")
                : t("offers.buyStage.continue")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
