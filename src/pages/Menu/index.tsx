/* eslint-disable @typescript-eslint/no-explicit-any --
 * The converted menu tree flows through untyped from the legacy converters;
 * typed with the SDK menu types in the P6 pass. Do not add NEW anys.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { selectMenu } from "@cx-sdk/catalog/state/Menu.slice";
import { selectFilters } from "@cx-sdk/catalog/state/filter.slice";
import { convertCategoryData } from "@cx-sdk/catalog/menu/menuFilteringUtils";
import { buildVariantCommitPayload } from "@cx-sdk/ordering/customization/commitPayload";
import { buildVariantTierPayload } from "@cx-sdk/ordering/cart/addIntent";
import { selectTabId } from "@cx-sdk/core/auth/authentication.slice";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import {
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  closeLoyaltyItemsModal,
  openLoyaltyItemsModal,
  selectCoupons,
  selectLoyaltyItemsModal,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { selectPhoneNumber } from "@cx-sdk/core/customer/customerInfo.slice";
import { cartQuantity } from "@cx-sdk/ordering/state/cart.slice";

import useAddEntityToCart from "../../hooks/menuHooks/useAddEntityToCart";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useMenuConverters from "../../hooks/menuHooks/useMenuConverters";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import useSessionReset from "../../hooks/utils/useSessionReset";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useAdaActive from "../../hooks/utils/useAdaActive";
import usePageEnter from "../../hooks/utils/usePageEnter";
import useLocalized from "../../hooks/utils/useLocalized";
import useLoyalty from "../../hooks/loyalty/useLoyalty";
import useCurrencySymbol from "../../hooks/utils/useCurrencySymbol";
import CategoryRail from "../../components/menu/CategoryRail";
import MenuFilterChips from "../../components/menu/MenuFilterChips";
import ProductAddedModal from "../../components/menu/ProductAddedModal";
import SelectSizeModal from "../../components/menu/SelectSizeModal";
import MenuItemCard from "../../components/menu/MenuItemCard";
import MenuCtaBar from "../../components/menu/MenuCtaBar";
import FooterBar from "../../components/chrome/FooterBar";
import ScrollIndicator from "../../components/chrome/ScrollIndicator";
import LanguageSheet from "../../components/language/LanguageSheet";
import BagSheet from "../../components/cart/BagSheet";
import CancelOrderModal from "../../components/common/CancelOrderModal";
import ErrorModal from "../../components/common/ErrorModal";
import LoyaltyLoginModal from "../../components/loyalty/LoyaltyLoginModal";
import LoyaltySuccessModal from "../../components/loyalty/LoyaltySuccessModal";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import { scrollBehavior } from "../../utils/autoScroll";
import {
  selectAddToCartModal,
  setRecommendationDetour,
  stageUpsellItem,
} from "../../redux/features/menuSelections/menuSelections.slice";
import { ErrorBoundary } from "../../ErrorBoundary";

/** Suggestions and a chosen size never get the repeat sheet. */
const NEW_CUSTOMIZATION = { forceNewCustomization: true } as const;

// D9 — the Xeno rewards sheet rides the ONE lazy UI chunk (bagLazyParts: a
// second dynamic entry grows the boot path). `await import()`, never
// `.then`: a failed chunk must reach chunkRecovery.
const LoyaltyRewardsSheet = lazy(async () => ({
  default: (await import("../../components/cart/bagLazyParts"))
    .LoyaltyRewardsSheet,
}));

/**
 * The rewards sheet while its code is not here (still loading, or a failed
 * chunk inside chunkRecovery's no-reload window): open → its own scrim,
 * closing like it; closed → nothing. It only closes the sheet — never
 * navigates, never resets, never holds idle (a stalled download must not
 * trap the guest or the idle timer). Its own component: the open flag
 * re-renders this button only, never Menu's card grid.
 */
function LoyaltyRewardsFallback() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const open = Boolean(
    (useSelector(selectLoyaltyItemsModal) as { isOpen?: boolean } | undefined)
      ?.isOpen
  );
  if (!open) return null;
  return (
    <button
      type="button"
      data-testid="loyalty-rewards-loading"
      aria-label={t("loyalty.close")}
      onClick={() => dispatch(closeLoyaltyItemsModal())}
      className="absolute inset-0 z-50 h-full w-full bg-tb-purple/80"
    />
  );
}

/**
 * Menu browse — Figma "Menu-basic agency" (1:2595): category rail + item
 * pane (H2 section titles, hero + grid cards, UNAVAILABLE states) + purple
 * TOTAL/VIEW-MY-BAG CTA + chrome footer. Data: the converted menu tree from
 * @cx-sdk legacy converters (fetched at order-type selection).
 * Card interactions land in P6 (PDP/customization) and P7 (cart).
 *
 * P7c makes this page the host of the XENO loyalty surfaces — the rewards
 * sheet, the login modal and the redemption celebration are all mounted
 * here (the entry-guard errors go to the global GlobalErrorHost), so both
 * entry points (the CTA-bar link per locked decision 5a and the bag's
 * LOG-IN & GET REWARDS per 5b) open the same
 * instances. It also owns the two loyalty ordering constraints that live on
 * this screen: the entry-tap branch table, and the revoke that must fire
 * before the cancel-order session reset.
 */
interface MenuProps {
  /**
   * Bag = sheet, route-driven (P7a locked decision 1): the /cart route
   * renders this same page with the bag sheet open; closing navigates
   * back to /menu so direction:"cart" return paths keep working.
   */
  bagOpen?: boolean;
}

/** The raw fields B3's item events read (primary-language, never localized). */
type TrackedEntity = { id?: unknown; name?: unknown } | null | undefined;

export default function Menu({ bagOpen = false }: MenuProps) {
  // Motion §2.4: Menu mounting under the product-added modal (Figma 1:5502:
  // the menu stays still), the bag or the rewards sheet is quiet. Read from
  // the store, never a new useSelector (that would re-render the card grid);
  // the hook keeps only the mount-time value. /menu <-> /cart is this SAME
  // instance (no key), so the bag opening never replays the entrance.
  const storeState = useStore().getState();
  const enter = usePageEnter(
    bagOpen ||
      Boolean(selectAddToCartModal(storeState)) ||
      Boolean(selectLoyaltyItemsModal(storeState)?.isOpen)
  );
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const menu = useSelector(selectMenu) as any;
  const currency = useCurrencySymbol();
  // P7c loyalty reads: the partner coupon list drives the CTA-bar label and
  // the entry-tap branch table; the customer phone is the XENO identity
  // (written by /phone, or by the login modal when the guest skipped it).
  const loyaltyCoupons = useSelector(selectCoupons) as any[] | null;
  const customerPhone = useSelector(selectPhoneNumber) as any;
  const totalQuantity = Number(useSelector(cartQuantity) ?? 0);

  const [languageOpen, setLanguageOpen] = useState(false);
  const [sizeEntity, setSizeEntity] = useState<any | null>(null);
  /** Select a Size → the PDP under way (handleSizeContinue): CONTINUE is spent. */
  const sizeHandoff = useRef(false);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  const [loyaltyLoginOpen, setLoyaltyLoginOpen] = useState(false);
  const { getAddIntent, addEntity } = useAddEntityToCart();
  const { addItemToCart, isAnyLoyaltyItemPresentInCart } = useCartHook();
  const { openDoubleTierModal } = useMakeItAMeal();
  const { resetSession } = useSessionReset();
  const { getIsLoyaltyOn, getSelectedPipeline } = useAppSettings();
  const { checkAndRevokeLoyaltyReward } = useLoyalty();
  const { fetchMenu } = useMenuConverters();
  const tabId = useSelector(selectTabId);
  const ada = useAdaActive();
  const { name } = useLocalized();
  const paneRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const filters = useSelector(selectFilters) as string[] | undefined;

  const allCategories: any[] = useMemo(
    () => (Array.isArray(menu?.categories) ? menu.categories : []),
    [menu]
  );
  /**
   * U1 — the VEG / NON-VEG chips' selection (`state.filter.filters`) narrows
   * the rail AND the sections through the SDK's non-mutating filter (emptied
   * sub-categories and categories drop out; no tag → the menu itself).
   */
  const categories: typeof allCategories = useMemo(
    () =>
      filters?.length
        ? (convertCategoryData({ categories: allCategories }, filters).categories ?? [])
        : allCategories,
    [allCategories, filters]
  );
  const railCategories = useMemo(
    () =>
      categories.map((c: any) => ({
        id: String(c?.id ?? c?.categoryId ?? ""),
        name: name(c) || String(c?.categoryName ?? ""),
      })),
    [categories, name]
  );
  // A filter can take the selected category away: the first row stands in.
  const activeCategoryId = railCategories.some((c) => c.id === selectedCategoryId)
    ? selectedCategoryId
    : (railCategories[0]?.id ?? "");
  // The UNFILTERED menu: emptiness drives the P9b refetch and the menu-error
  // dialog below — a filter that empties the grid is neither.
  const isEmpty = allCategories.length === 0;

  /**
   * B3 (PAR-07) — MenuViewed once per mount, when the menu is there (a late
   * refetch counts on arrival; fork Menu.tsx:227-252). /cart's
   * `<Menu bagOpen />` is the SAME instance as /menu (sibling routes, no key
   * — verified in lane motion), so a mount under the open bag is not a menu
   * view: the event waits for the bag to close. Ref-latched: StrictMode
   * re-runs effects.
   */
  const menuViewedRef = useRef(false);
  useEffect(() => {
    if (bagOpen || menuViewedRef.current || allCategories.length === 0) return;
    menuViewedRef.current = true;
    captureKioskEvent(KioskEventName.MenuViewed, {
      category_count: allCategories.length,
      total_items: allCategories.reduce(
        (count: number, category: { subCategories?: unknown }) =>
          count +
          (Array.isArray(category?.subCategories) ? category.subCategories : []).reduce(
            (sum: number, sub: { entities?: unknown }) =>
              sum + (Array.isArray(sub?.entities) ? sub.entities.length : 0),
            0
          ),
        0
      ),
    });
  }, [allCategories, bagOpen]);

  /* ------------------------------------------------------------------ *
   * P9b — menu re-drive (Rule 2; fork parity, posistKiosk Menu.tsx:218) *
   * ------------------------------------------------------------------ */

  /**
   * `menu` is neverPersist (store.ts), so a reload mid-session (chunk
   * recovery, crash, power blip) lands here with the cart rehydrated and NO
   * menu — and nothing else would ever fetch it. Refetch once per mount when
   * empty. getSelectedPipeline() is the persisted pipeline and never
   * undefined (fetchMenu reads pipeline.tab_type synchronously). fetchMenu
   * resolves {} on ANY failure, so the return value is judged; the state
   * write lives in the promise callback (house react-hooks rules forbid
   * set-state-in-effect). No mounted guard: a late answer only sets this
   * screen's own (dead) state, and useMenuConverters already drops late
   * menus. The H1 cancel-order reset empties the menu on THIS mount, so it
   * never triggers a refetch.
   */
  const [menuLoadFailed, setMenuLoadFailed] = useState(false);
  const refetchedRef = useRef(false);
  const reloadMenu = () =>
    fetchMenu(tabId, false, false, getSelectedPipeline()).then((result) => {
      if (!result?.categories?.length) setMenuLoadFailed(true);
    });

  useEffect(() => {
    // Ref-latched: StrictMode re-runs mount effects.
    if (isEmpty && !refetchedRef.current) {
      refetchedRef.current = true;
      void reloadMenu();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only re-drive (fork parity)
  }, []);

  const handleRailSelect = (id: string) => {
    setSelectedCategoryId(id);
    const el = sectionRefs.current[id];
    if (el && paneRef.current) {
      // Instant under reduced motion (motion §3.9).
      paneRef.current.scrollTo({ top: el.offsetTop - 24, behavior: scrollBehavior() });
    }
    captureKioskEvent(KioskEventName.SupCategoryClicked, { category_id: id });
  };

  /** A filter chip changed the sections: back to the top, first rail row. */
  const handleFilterChange = () => {
    setSelectedCategoryId("");
    if (paneRef.current) paneRef.current.scrollTop = 0;
  };

  /**
   * B3 — analytics carry the RAW primary-language fields (names resolve only
   * at render, never into analytics).
   */
  const trackItem = (
    event: KioskEventName,
    entity: TrackedEntity,
    extra?: Record<string, unknown>
  ) => captureKioskEvent(event, { item_id: entity?.id, item_name: entity?.name, ...extra });
  /** A quick add that LANDED (addEntity / addItemToCart returned true). */
  const trackAdded = (entity: TrackedEntity, itemPrice: unknown, itemType: unknown) =>
    trackItem(KioskEventName.ItemAddedToCart, entity, {
      item_price: itemPrice,
      quantity: 1,
      item_type: itemType,
    });

  /**
   * Intent routing (classifier = SDK addIntent via useAddEntityToCart):
   * - add        → straight into the cart (increments an existing row)
   * - variant    → quick-add "+" opens the Select-a-Size fast lane; a card
   *                tap goes through addEntity → tier-1 session → PDP
   * - modifiers  → openDoubleTierModal → tier-1 session → /customization PDP
   * - repeat     → addEntity → the executor dispatches
   *                setRepeatItemBottomSheet(buildRepeatSheetPayload(...))
   *                → the repeat-selections sheet
   * - upsell     → addEntity → openMakeItAMealModal (selectedItem +
   *                availableCombos) → <MakeItAMealPrompt />
   * The last two render NOTHING here: both overlays are mounted once for the
   * whole in-session subtree by AppRoutes' InSessionOverlays layout route, so
   * the same tap works from /customization and the bag too. Do NOT re-mount
   * them on this page.
   *
   * B3 events (fork ItemCard parity): ItemClicked on a card tap (never the
   * "+"), before the unavailable return; ItemAddedToCart only when the item
   * landed (a DP-cap rejection returns false and sends nothing); the PDP
   * opens → CustomizationOpened; the combo prompt → MakeItAMealOpened.
   */
  const handleEntityAction = (entity: any, fromQuickAdd = false) => {
    // A fresh menu tap is never a suggestion detour's add.
    dispatch(setRecommendationDetour(false));
    if (!fromQuickAdd) {
      trackItem(KioskEventName.ItemClicked, entity, {
        item_price: entity?.price,
        category: entity?.subCategoryId,
      });
    }
    const intent = getAddIntent(entity);
    if (intent === "unavailable") return;
    if (intent === "add") {
      if (addEntity(entity)) trackAdded(entity, entity?.price, entity?.type);
      return;
    }
    if (intent === "variant") {
      if (fromQuickAdd) {
        setSizeEntity(entity);
      } else {
        trackItem(KioskEventName.CustomizationOpened, entity, { source: "menu" });
        addEntity(entity); // tier-1 variant session → PDP
      }
      return;
    }
    if (intent === "upsell") {
      trackItem(KioskEventName.MakeItAMealOpened, entity);
      addEntity(entity); // executor dispatches openMakeItAMealModal
      return;
    }
    if (intent === "repeat") {
      addEntity(entity); // executor dispatches the repeat-sheet payload
      return;
    }
    // modifiers → tier-1 customization session (navigates to /customization
    // itself).
    trackItem(KioskEventName.CustomizationOpened, entity, { source: "menu" });
    openDoubleTierModal(entity, () => {}, undefined);
  };

  /**
   * A product-added suggestion tap — STAGED, as in posistKiosk: nothing
   * reaches the bag until the modal's ADD TO ORDER. A one-tap item is
   * PICKED on its tile. One that needs a choice opens what the same item's
   * menu "+" opens — Select a Size, or the PDP for options / a pack; never
   * the repeat sheet, whose "+" writes to the bag — with recommendationDetour
   * set: the modal hides (still open, its picks kept), the add the chooser
   * ends in is parked with them (useCartHook), and every chooser exit clears
   * the flag, which brings the modal back.
   * ponytail: a MIAM prompt from a suggestion keeps the flag — the modal
   * hidden — until the next menu tap, modal open or reset; unreachable today
   * (raw upsellItems are ids, Q5). Clear it on the prompt's X if suggestions
   * ever offer the meal.
   */
  const handleSuggestionAdd = (entity: RecommendedEntity) => {
    const intent = getAddIntent(entity, NEW_CUSTOMIZATION);
    if (intent === "unavailable") return;
    if (intent === "add") {
      dispatch(stageUpsellItem({ id: entity.id, delta: 1 }));
      return;
    }
    const detour = () => dispatch(setRecommendationDetour(true));
    if (intent === "variant") {
      detour();
      setSizeEntity(entity);
      return;
    }
    addEntity(entity, { ...NEW_CUSTOMIZATION, onBeforeLeave: detour });
  };

  const handleSizeContinue = (variant: any) => {
    const parent = sizeEntity;
    if (!parent || sizeHandoff.current) return;
    if (variant?.modifiers?.length) {
      // Size chosen but the variant carries modifier groups → the PDP, through
      // the card tap's own tier-1 variant session (a bare navigate had none,
      // so the PDP bounced back), with the chosen size already confirmed.
      // Select a Size stays up as the cover until the PDP's route replaces
      // this page: RR7 navigates inside a transition, and a sheet closed
      // first left the bare menu under the finger — a suggestion's modal
      // hidden, its detour still set, nothing to arm DetourTapGuard — so a
      // double tap's second half added the card beneath or opened the bag.
      sizeHandoff.current = true;
      trackItem(KioskEventName.CustomizationOpened, parent, { source: "menu" });
      // The size is chosen: never the repeat sheet (it would drop it).
      addEntity(parent, { preselectedVariantId: variant.id, ...NEW_CUSTOMIZATION });
      return;
    }
    setSizeEntity(null);
    // B5 (CX-07): the PDP's commit builder — one money shape. The PDP's own
    // SelectedEntity (buildVariantTierPayload) and no modifiers, so the row
    // carries baseItem / baseItemPrice / variantPrice / customizations like
    // a PDP-built one (a bag Edit reads baseItem) and the bill prices it by
    // variantPrice. A plain paid row: the MIAM flags off (the
    // stripBuyStageMarkers precedent).
    const landed = addItemToCart(
      buildVariantCommitPayload({
        selectedEntity: buildVariantTierPayload(parent).selectedEntity,
        selectedVariant: variant,
        mergedCustomizations: {},
        quantity: 1,
        isMakeItAMealItem: false,
        makeItAMealSelectedItem: {},
      }),
      "VARIANT"
    );
    // After a suggestion's Select a Size the add was parked (useCartHook):
    // ending the detour brings the modal back — a DP-cap refusal too.
    dispatch(setRecommendationDetour(false));
    if (landed) trackAdded(parent, variant?.price, "VARIANT");
  };

  /* ------------------------------------------------------------------ *
   * P7c — XENO loyalty                                                  *
   * ------------------------------------------------------------------ */

  const isLoyaltyIdentified = String(customerPhone ?? "").trim().length > 0;

  /**
   * Both loyalty guard branches dispatch the fork's GLOBAL error action —
   * that is what BagSheet's rewards entry already does, and keeping one code
   * path means the bag CTA and the menu link fail identically. The app-wide
   * GlobalErrorHost (IdleGuard, z-[95]) renders it; never render it here.
   */
  const raiseLoyaltyGuardError = (errorMessage: string) =>
    dispatch(setShowErrorModalGlobal({ showErrorModal: true, errorMessage }));

  /**
   * Rewards entry — contract §Partner-branch table (Xeno column), which the
   * bag's LOG-IN & GET REWARDS button runs verbatim too:
   *   reward already in the cart → "Loyalty Item already availed"
   *   coupons on file            → open the items modal, isTimerOn:false
   *   otherwise                  → "No coupons available for you at the moment"
   *
   * DIVERGENCE (flagged): an UNIDENTIFIED guest gets the login modal instead
   * of the "no coupons" dead end. The contract's table assumes the fork's
   * flow, where /phone always runs before the menu; here the phone screen is
   * skippable (!crm_phone_mandatory), and the CTA's pre-lookup label is
   * "REWARDS" precisely because the lookup has not happened yet. Same branch
   * the bag already added under locked decision 5b, so the two entries behave
   * identically. Revert = delete this one `if`.
   */
  const handleOpenLoyaltyRewards = () => {
    if (!getIsLoyaltyOn()) return;
    if (!isLoyaltyIdentified) {
      setLoyaltyLoginOpen(true);
      return;
    }
    if (isAnyLoyaltyItemPresentInCart()) {
      raiseLoyaltyGuardError(t("loyalty.alreadyAvailed"));
      return;
    }
    if (!loyaltyCoupons?.length) {
      raiseLoyaltyGuardError(t("loyalty.noCoupons"));
      return;
    }
    dispatch(openLoyaltyItemsModal({ isTimerOn: false }));
  };

  /**
   * Cancel order (contract step 9 / trap 1). `checkAndRevokeLoyaltyReward`
   * reads the claimed coupon out of a RENDER-TIME closure that
   * resetSession("full") wipes, so it must be kicked off BEFORE the reset —
   * the await is deliberately not taken (the fork does not block either) and
   * the rejection is swallowed so a dead xeno.in can never strand the guest
   * on a half-cancelled kiosk (Rule 2).
   */
  const handleCancelOrderConfirm = () => {
    setCancelOrderOpen(false);
    checkAndRevokeLoyaltyReward().catch(() => {});
    resetSession("full");
    navigate("/start");
  };

  /** VIEW MY BAG → the bag (Complete Your Meal is its rail, Figma 1:3171). */
  const handleViewBag = () => {
    if (totalQuantity > 0) navigate("/cart");
  };

  return (
    <div
      data-testid="menu-screen"
      data-enter={enter}
      // h-full = ReachZone's container: 1920, or the ADA reach zone (Figma
      // 1:5392 — only the rail+pane viewport shrinks; CTA and footer stay
      // pinned to the bottom).
      className="relative flex h-full w-[1080px] flex-col bg-tb-surface"
    >
      {/* The rail + pane row is the one arriving block (motion §2.7); the
          scrollbar, the CTA bar, the footer and every overlay stay. */}
      <div className="tb-enter [--i:0] flex min-h-0 flex-1">
        <CategoryRail
          categories={railCategories}
          selectedId={activeCategoryId}
          onSelect={handleRailSelect}
        >
          {/* U1 chips under the bell; a crash fails open (no chips). */}
          <ErrorBoundary fallback={null}>
            <MenuFilterChips onChange={handleFilterChange} />
          </ErrorBoundary>
        </CategoryRail>
        <div ref={paneRef} className="min-h-0 flex-1 overflow-y-auto px-[24px] pb-[48px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-6">
              <h1 className="tb-display text-center text-5xl text-tb-purple">
                {t("menu.empty")}
              </h1>
            </div>
          ) : (
            categories.map((category: any) => {
              const categoryId = String(category?.id ?? "");
              const subCategories: any[] = Array.isArray(category?.subCategories)
                ? category.subCategories
                : [];
              return (
                <section
                  key={categoryId}
                  ref={(el) => {
                    sectionRefs.current[categoryId] = el;
                  }}
                  data-testid={`section-${categoryId}`}
                  className="pt-[48px]"
                >
                  <h2 className="tb-display mb-[32px] text-[64px] leading-[0.85] tracking-[-3px] text-tb-purple">
                    {name(category)}
                  </h2>
                  {subCategories.map((subCategory: any, subIndex: number) => {
                    const entities: any[] = Array.isArray(subCategory?.entities)
                      ? subCategory.entities
                      : [];
                    if (entities.length === 0) return null;
                    return (
                      <div key={subCategory?.id ?? subIndex} className="mb-[40px]">
                        {subCategories.length > 1 && (
                          <h3 className="tb-display mb-[24px] text-[28px] leading-[1] tracking-[-1px] text-tb-ink-purple">
                            {name(subCategory) || subCategory?.categoryName}
                          </h3>
                        )}
                        <div className="grid grid-cols-3 gap-[24px]">
                          {entities.map((entity: any) => (
                            <MenuItemCard
                              key={entity?.id}
                              entity={entity}
                              currency={currency}
                              large={
                                Array.isArray(entity?.badges) && entity.badges.length > 0
                              }
                              onOpen={(e: any) => handleEntityAction(e, false)}
                              onQuickAdd={(e: any) => handleEntityAction(e, true)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </section>
              );
            })
          )}
        </div>
      </div>
      {/* Figma 1:5263 bar (menu 1:2613 / ADA 1:5412): the root is the
          containing block and the rail+pane row starts at its top. */}
      <ErrorBoundary fallback={null}>
        <ScrollIndicator
          target={paneRef}
          top={ada ? 170 : 505}
          height={ada ? 578 : 790}
          testId="menu-scrollbar"
        />
      </ErrorBoundary>
      <MenuCtaBar
        currency={currency}
        onViewBag={handleViewBag}
        onOpenRewards={handleOpenLoyaltyRewards}
      />
      <div className="relative h-[56px] w-full">
        <FooterBar
          onCancelOrder={() => setCancelOrderOpen(true)}
          onOpenLanguage={() => setLanguageOpen(true)}
        />
      </div>
      <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
      <ProductAddedModal onQuickAdd={handleSuggestionAdd} />
      {/* Mounted only while open, so every open starts with no size ticked
          and CONTINUE disabled (1:5628) — an abandoned pick never survives
          (review R3). */}
      {sizeEntity && (
        <SelectSizeModal
          entity={sizeEntity}
          onClose={() => {
            sizeHandoff.current = false;
            setSizeEntity(null);
            dispatch(setRecommendationDetour(false));
          }}
          onContinue={handleSizeContinue}
        />
      )}
      {/* P7a overlays — z-stack: BagSheet z-40 (a stacking context, so its
          RewardsSheet/FreebiePicker/OfferRemovalNotice children all paint in
          its z-40 slot), confirm modals z-50. The MIAM prompt and the repeat
          sheet are NOT here any more — AppRoutes pins them above this sheet
          at z-45 / z-55, which is what lets a repeat or an upsell triggered
          from the bag rail stack over the bag instead of under it. */}
      <BagSheet
        open={bagOpen}
        onClose={() => navigate("/menu")}
        // Locked decision 5b — LOG-IN & GET REWARDS stops being inert. The
        // bag applies the same branch table as the CTA link and then asks
        // this page (which owns the overlays) to open the right surface.
        onOpenLoyaltyLogin={() => setLoyaltyLoginOpen(true)}
        onOpenLoyaltyRewards={() =>
          dispatch(openLoyaltyItemsModal({ isTimerOn: false }))
        }
      />
      <CancelOrderModal
        open={cancelOrderOpen}
        // Locked decision 4: teardown only on confirm — and the loyalty
        // revoke runs BEFORE resetSession (contract step 9 / trap 1).
        onConfirm={handleCancelOrderConfirm}
        onCancel={() => setCancelOrderOpen(false)}
      />

      {/* P7c XENO loyalty overlays — z-stack above the bag (z-40):
          LoyaltyRewardsSheet z-50, LoyaltyLoginModal z-[60],
          LoyaltySuccessModal z-[70]; the two entry-guard errors render in
          the app-wide GlobalErrorHost (z-[95], IdleGuard) above all of
          them (an error must never be occluded). The rewards sheet takes NO
          open prop: /phone and the login modal both open it by dispatching
          openLoyaltyItemsModal({isTimerOn:true}), and it reads that slice
          state itself — which is also how the post-lookup auto-open lands
          when the guest arrives here from /phone. It is lazy (D9) and
          ALWAYS mounted (null while closed), so its chunk loads at /menu
          entry; the local boundary keeps a failed chunk from crashing /menu
          (LoyaltyRewardsFallback, z-50, stands in for it). No key on either
          boundary: a remount would drop the parked OTP step. */}
      <ErrorBoundary fallback={<LoyaltyRewardsFallback />}>
        <Suspense fallback={<LoyaltyRewardsFallback />}>
          <LoyaltyRewardsSheet />
        </Suspense>
      </ErrorBoundary>
      <LoyaltyLoginModal
        open={loyaltyLoginOpen}
        onClose={() => setLoyaltyLoginOpen(false)}
      />
      <LoyaltySuccessModal />
      {/* P9b menu-load failure (z-80, last in the DOM so it wins any z-80
          tie). START OVER only navigates: /start's mount owns
          the revoke + reset (hazard H1) — and the restored cart may belong to
          a pipeline this session can no longer switch away from. */}
      {isEmpty && menuLoadFailed && (
        <ErrorModal
          testId="menu-error"
          title={t("menuError.title")}
          message={t("menuError.message")}
          primary={{
            label: t("menuError.retry"),
            testId: "menu-error-retry",
            onClick: () => {
              setMenuLoadFailed(false);
              void reloadMenu();
            },
          }}
          secondary={{
            label: t("menuError.startOver"),
            testId: "menu-error-start-over",
            onClick: () => navigate("/start"),
          }}
        />
      )}
    </div>
  );
}
