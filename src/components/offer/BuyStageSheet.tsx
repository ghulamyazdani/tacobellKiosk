import { Fragment, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
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
import { mechanicSpecFor } from "@cx-sdk/ordering/offer/savingsLinePolicy";
import { isDirectlyAddable } from "@cx-sdk/catalog/recommendation/recommendationUtils";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import type { BuyStage } from "../../hooks/offerHooks/useBuyStage";
import useOfferSavings from "../../hooks/offerHooks/useOfferSavings";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import useLocalized from "../../hooks/utils/useLocalized";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import { resolveEntityImage } from "../../utils/entityImage";
import { formatPrice } from "../../utils/price";
import { formatMenuPriceLine } from "../menu/MenuItemCard";
import VegMark from "../menu/VegMark";
import NoImageBell from "../common/NoImageBell";
import closeIcon from "../../assets/icons/close.svg";
import plusIcon from "../../assets/icons/plus.svg";
import minusIcon from "../../assets/icons/qty-minus.svg?no-inline";
import trashIcon from "../../assets/icons/trash.svg?no-inline";

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
 * 1:2595's card grid (1:2601): 240 px cards, 16 px gaps — four across the
 * 1032 px content box. A wrapping flex row, not a grid: EVERY row centres,
 * so neither a short row nor a 5th card under a full four hugs column 1.
 */
const CARD_ROW = "flex flex-wrap justify-center gap-[16px]";

/**
 * BOGO BUY STAGE — "unlock this reward" (offers lane, item 31). Opened from a
 * locked bogoBuySide row's ADD ITEMS in the rewards sheet; the fork's
 * BuyItemSelection structure in the TB design language (no Figma frame —
 * flagged for client sign-off): RewardsSheet geometry (1:3824 header, X,
 * full-width purple CTA bar) over Figma's Menu-Item grid card (1:2609, the
 * menu card's encoding) four across in 1:2595's 16 px grid, picked the
 * product-added way (the whole card adds, a count pill, a "−").
 *
 * The tiles read and write the REAL paid cart: a buy item is an ordinary
 * purchase. The counters mirror the engine (buyStageUtils) and the display is
 * clamped to "unlocked" whenever the engine predicate passes; CONTINUE only
 * reaches onContinue once satisfied — and, with the buy side met, any other
 * gap (an item or bill minimum) is named at once and CONTINUE waits for it
 * (lane offers-parity). Nothing here navigates: customizable tiles open the
 * in-place paid tier session hosted by OfferTierHost.
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
  const currency = useCurrencySymbol();
  const {
    addItemToCart,
    IncreaseItemQuantityById,
    decreaseItemQuantityById,
    doesItemExistInCart,
  } = useCartHook();
  const { openBuyItemTierModal } = useMakeItAMeal();
  const { gapFor } = useOfferSavings();
  // Menu names at render; offer and buy-group labels stay English (no data).
  const { name: localName } = useLocalized();

  const [guard, setGuard] = useState<GuardKey | null>(null);
  // CONTINUE tapped while locked → name the gap inline (the fork popped its
  // global error modal here).
  const [hintRequested, setHintRequested] = useState(false);
  // UX-13 (R20): each refused CONTINUE re-keys the hint's text, which shakes —
  // never the button. `shaking` drops with the hint, so a hint that comes back
  // unasked (a re-lock after an unlock) never shakes.
  const [refusals, setRefusals] = useState(0);
  const [shaking, setShaking] = useState(false);

  const { offer, view } = stage;
  const cartItems = cart?.cartItems;
  const excludeLoyalty = excludesLoyalty(view.mode);

  const progress = getBuyStageProgress(offer as BuyStageOffer, view, cartItems);
  // The engine predicate outranks the mirror (fork parity): once it unlocks,
  // the counter and bar read full.
  const met =
    Boolean(isBOGOOfferApplicable(offer, offer?.applicable, cartItems)) ||
    progress.satisfied;
  // Lane offers-parity (D4 / P5): with the buy side met, any OTHER gap — an
  // item minimum (paid units, D3) or a bill minimum — still blocks the offer:
  // named at once, and CONTINUE waits for it, so a stage never applies an
  // offer the bag's revalidation removes a moment later.
  const gap = gapFor(offer);
  const blocker = met && gap && gap.reason !== "bogoBuySide" ? gap : null;
  const satisfied = met && !blocker;
  const need = progress.totalNeed;
  const have = met ? need : Math.min(progress.totalHave, need);
  const fill = met ? 1 : need > 0 ? have / need : 0;
  const counterText = t("offers.buyStage.addedCount", { have, need });

  // How many of the cheapest go free — the rewards row's own source
  // (mechanicSpecFor), so the stage never contradicts the row it came from —
  // and at what discount: "free" only at 100 % (computeLeastValueDiscount's
  // rule: no getDiscount is 100).
  const least = mechanicSpecFor(offer, "leastValue", null);
  const freeCount = least?.code === "leastValueOther" ? least.get : 1;
  const leastOff = Number(offer?.leastItemValueCount?.getDiscount ?? 100);
  const leastDiscounted = Number.isFinite(leastOff) && leastOff !== 100;
  const leastCopy = { count: freeCount, value: leastOff };
  const subtitle =
    view.mode === "least"
      ? t(leastDiscounted ? "offers.buyStage.subtitleLeastDiscount" : "offers.buyStage.subtitleLeast", {
          ...leastCopy,
          buy: view.sharedRequiredQuantity,
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
  const blockerText = !blocker
    ? null
    : blocker.reason === "minItems"
      ? t("offers.addNudgeItems", { count: blocker.countShort })
      : blocker.reason === "minBill"
        ? t("offers.addNudge", {
            amount: `${currency}${formatPrice(blocker.amountShort)}`,
          })
        : t("offers.notApplicable");
  const hint =
    blockerText ??
    (hintRequested && !met
      ? remaining <= 1 || !Number.isFinite(remaining)
        ? t("offers.buyStage.hintMoreOne")
        : t("offers.buyStage.hintMoreOther", { count: remaining })
      : null);
  const guardText = guard ? t(`offers.buyStage.${guard}`) : blockedMessage;
  if (shaking && !hint) setShaking(false);

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
      setRefusals((n) => n + 1);
      setShaking(true);
      return;
    }
    onContinue();
  };

  /** The size a variant-id tile stands for (resolveBuyStageView subsets the entity's variants to it). */
  const tileSize = (group: BuyStageGroup, entity: BuyMenuEntity) =>
    group.requiredVariantId
      ? entity?.variants?.find((variant) => variant?.id === group.requiredVariantId)
      : undefined;

  /**
   * A tile's name: the menu name in the guest's language, and a variant-id
   * entry's size, in the guest's language too.
   */
  const tileName = (group: BuyStageGroup, entity: BuyMenuEntity) => {
    const size = group.requiredVariantId
      ? (tileSize(group, entity) ?? { name: group.requiredVariantName })
      : null;
    const sizeName = size ? localName(size) : "";
    return `${localName(entity)}${sizeName ? ` (${sizeName})` : ""}`;
  };

  /**
   * A header says something the cards don't: which items a category group
   * (several cards) draws from, or a lone item's per-group need above 1
   * (plain-and / plain-or). A lone card already names the item and its size,
   * whatever the backoffice label says — walk w3: 'Veg hakka noddles quarter'
   * over 'Noodles (QUARTER)' headed each card alone in its row — and a least
   * stage's threshold is shared.
   */
  const needsHeader = (group: BuyStageGroup) =>
    group.entities.length > 1 || (view.mode !== "least" && group.requiredQuantity > 1);
  // Headers are on or off for the WHOLE stage: a heading groups every card
  // below it, so a header-less card after a headed group would read as one
  // of that group's options.
  const headed = view.groups.length > 1 && view.groups.some(needsHeader);

  // Render helper, NOT a component (react-hooks/static-components) — Figma's
  // Menu-Item grid card as MenuItemCard draws it (1:2609: 240×277 grey-6 r8,
  // Md 20/24 name clamped at 2, the price line with its veg mark, the 172
  // photo band object-cover × multiply, the 36 px Quick Add at 192 / 12),
  // picked the product-added way: the WHOLE card adds (an empty overlay,
  // the "+" its aria-hidden twin), a count pill and a "−" once picked.
  // Logical insets: "+" top-end, the pill bottom-start, the "−" bottom-end.
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
    const name = tileName(group, entity);
    // A size tile prices the size it names (its own calories when it has
    // them) — the entity is the BASE item, priced alike for every size.
    const size = tileSize(group, entity);
    const imageUrl = resolveEntityImage(entity);
    // walk-oos 2: a sized tile lists only the sizes the offer counts
    // (resolveBuyStageView narrows them: its one size, or a category's) — out
    // when every one on offer is (sold out, or no guest can complete it).
    const flags = (v: unknown) => (v ?? {}) as { isActive?: unknown; outOfStock?: unknown };
    const onOffer =
      entity?.hasVariant && !entity?.isVariant
        ? (entity.variants ?? []).filter((v) => flags(v).isActive !== false)
        : [];
    const unavailable =
      !!entity?.outOfStock ||
      (onOffer.length > 0 && onOffer.every((v) => flags(v).outOfStock === true));
    // handleAdd's own split, side-effect free: a variant or customizable
    // entity opens the tier session (planStagedTierModal), anything else adds.
    const oneTap = isDirectlyAddable(entity as unknown as RecommendedEntity);

    return (
      <div
        key={`${group.key}-${id}`}
        data-testid={`buy-stage-tile-${id}`}
        className={`tb-press-card relative flex h-[277px] w-[240px] flex-col justify-between overflow-hidden rounded-[8px] bg-tb-grey-6 ${
          qty > 0 ? "ring-[3px] ring-tb-purple" : ""
        }`}
      >
        {/* line-clamp-2: a 70-character TB India name ends in an ellipsis,
            never a sliced third line; the photo yields (min-h-0) to a
            wrapped price line. */}
        <div
          className={`flex flex-col gap-[4px] pe-[64px] ps-[24px] pt-[24px] ${
            unavailable ? "opacity-40" : ""
          }`}
        >
          <p className="line-clamp-2 text-[20px] font-medium capitalize leading-[24px] tracking-[-0.5px] text-black">
            {name}
          </p>
          <p className="flex items-center gap-[8px] text-[18px] leading-[20px] text-tb-ink-purple">
            <VegMark entity={entity} />
            {formatMenuPriceLine(size ? { ...entity, ...size } : entity, currency, t)}
          </p>
        </div>
        {imageUrl ? (
          <img
            alt=""
            src={imageUrl}
            className={`h-[172px] min-h-0 w-full object-cover mix-blend-multiply ${
              unavailable ? "opacity-40 grayscale" : ""
            }`}
          />
        ) : (
          <NoImageBell className={`h-[172px] min-h-0 w-full ${unavailable ? "opacity-40" : ""}`} />
        )}
        {/* Before the overlay, so a tap on the pill still adds. ForYouCard's
            pill at the photo band's corner (design language, no frame): it
            pops in, the re-keyed number bumps on each change; the status is
            always mounted so changes are spoken. */}
        <span role="status" className="absolute bottom-[12px] start-[12px]">
          {qty > 0 && (
            <>
              <span
                aria-hidden="true"
                data-testid={`buy-stage-qty-${id}`}
                className="tb-pop-in flex h-[36px] min-w-[36px] items-center justify-center rounded-full bg-tb-purple px-[8px] text-[18px] font-bold text-tb-surface"
              >
                <span key={qty} className="tb-bump">
                  {qty}
                </span>
              </span>
              <span className="sr-only">{t("added.selected", { value: qty })}</span>
            </>
          )}
        </span>
        {/* A DIRECT, EMPTY child: tb-press-card squeezes the card while it
            is pressed. "Customize" names a tap that opens the tier session. */}
        {!unavailable && (
          <button
            type="button"
            data-testid={`buy-stage-add-${id}`}
            aria-label={`${t(oneTap ? "menu.quickAdd" : "pack.customize")} ${name}`}
            disabled={continuing}
            onClick={() => handleAdd(entity)}
            className="absolute inset-0"
          />
        )}
        {/* The added modal's "−" (design language, no frame): the trash
            glyph at 1, "−" from 2 (D6). */}
        {qty > 0 && (
          <button
            type="button"
            data-testid={`buy-stage-dec-${id}`}
            aria-label={t("offers.buyStage.decrease", { name })}
            disabled={continuing}
            onClick={() => handleDecrease(entity, group)}
            className="group absolute bottom-[8px] end-[8px] z-10 flex h-[44px] w-[44px] items-center justify-center"
          >
            <span className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-tb-surface shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)] group-active:bg-tb-lilac">
              <img alt="" src={qty === 1 ? trashIcon : minusIcon} className="h-[16px] w-[16px]" />
            </span>
          </button>
        )}
        {unavailable ? (
          // Picked before it went out of stock: above the pill and the "−".
          <span
            className={`tb-display absolute ${
              qty > 0 ? "bottom-[56px]" : "bottom-[16px]"
            } left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-tb-ink-purple/80 px-3 py-1.5 text-[14px] text-tb-surface`}
          >
            {t("menu.unavailable")}
          </span>
        ) : (
          // The overlay's visual twin: one accessible control per card, and
          // a tap never focuses it (review UIA-1). Figma Quick Add pressed:
          // the white circle turns lilac.
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            data-testid={`buy-stage-inc-${id}`}
            disabled={continuing}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => handleAdd(entity)}
            className="group absolute end-[8px] top-[8px] z-10 flex h-[44px] w-[44px] items-center justify-center"
          >
            <span className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-tb-surface shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)] group-active:bg-tb-lilac">
              <img alt="" src={plusIcon} className="h-[16px] w-[16px]" />
            </span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-50" data-testid="buy-stage-sheet">
      {/* The scrim never animates (motion D-M3); the panel rises (tb-sheet-enter). */}
      <button
        type="button"
        aria-label={t("offers.close")}
        disabled={continuing}
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-tb-purple/80"
      />
      {/* RewardsSheet's cap: the X and the CTA bar stay on screen in the
          1122 ADA reach zone; only the tile grid scrolls. */}
      {/* Named dialog; NOT aria-modal — the in-bag PDP (OfferTierHost,
          z-[85]) stacks over it for a customizable buy item. */}
      <div
        role="dialog"
        aria-labelledby="buy-stage-title"
        className="tb-sheet-enter absolute bottom-0 left-0 flex h-[min(1470px,calc(100%_-_96px))] w-[1080px] flex-col overflow-hidden rounded-t-[60px] bg-tb-surface"
      >
        <div className="relative shrink-0 border-b border-tb-grey-4 px-[120px] pb-[28px] pt-[54px] text-center">
          <p className="text-[18px] font-bold uppercase leading-[22px] tracking-[2px] text-tb-ink-purple/70">
            {t("offers.buyStage.step")}
          </p>
          <h2
            id="buy-stage-title"
            className="tb-display mt-[12px] line-clamp-2 text-[36px] leading-[40px] tracking-[-1px] text-tb-purple"
          >
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

        {/* bg-transparent (perf PAINT-1 opt-out): the tiles' photos
            multiply-blend, so a composited list would split each into its own
            layer and re-sample it (as the menu pane, pages/Menu). */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-transparent">
          {/* Header-less groups share one card row. Headed, each group is
              its header over its OWN card row (a header spanning a shared
              grid kept all four tracks, so a lone card sat in column 1 —
              walk w3); the 16 px rhythm stays. */}
          <div className={`${headed ? "flex flex-col gap-[16px]" : CARD_ROW} px-[24px] py-[32px]`}>
            {view.groups.map((group: BuyStageGroup) => {
              const tiles = group.entities.map((entity: BuyMenuEntity, index: number) =>
                renderTile(group, entity, index),
              );
              if (!headed) return <Fragment key={group.key}>{tiles}</Fragment>;
              return (
                <Fragment key={group.key}>
                  <p
                    data-testid={`buy-stage-group-${group.key}`}
                    className="text-center text-[22px] font-bold leading-[26px] text-black"
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
                  <div className={CARD_ROW}>{tiles}</div>
                </Fragment>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 px-[24px] pb-[24px] pt-[16px] drop-shadow-[0px_0px_64px_rgba(0,0,0,0.08)]">
          {view.mode === "least" && (
            <p
              data-testid="buy-stage-least-note"
              className="mb-[16px] rounded-[8px] bg-tb-grey-6 px-[24px] py-[16px] text-center text-[20px] leading-[24px] text-tb-ink-purple"
            >
              {t(
                leastDiscounted ? "offers.buyStage.leastNoteDiscount" : "offers.buyStage.leastNote",
                leastCopy,
              )}
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
            {/* A block leaf: the text wraps exactly as before; a NEW node per refusal. */}
            {hint && (
              <span key={refusals} className={shaking ? "block tb-shake" : "block"}>
                {hint}
              </span>
            )}
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
              className="tb-display min-h-[84px] shrink-0 rounded-[8px] border border-tb-purple bg-tb-surface px-[56px] text-center text-[24px] leading-[20px] text-tb-purple"
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
