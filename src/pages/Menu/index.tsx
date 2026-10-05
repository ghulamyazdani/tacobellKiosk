/* eslint-disable @typescript-eslint/no-explicit-any --
 * The converted menu tree flows through untyped from the legacy converters;
 * typed with the SDK menu types in the P6 pass. Do not add NEW anys.
 */
import { useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { selectMenu } from "@cx-sdk/catalog/state/Menu.slice";
import {
  selectCurrency,
  selectErrorMessageGlobal,
  selectShowErrorModalGlobal,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  openLoyaltyItemsModal,
  selectCoupons,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { selectPhoneNumber } from "@cx-sdk/core/customer/customerInfo.slice";

import useAddEntityToCart from "../../hooks/menuHooks/useAddEntityToCart";
import useCartHook from "../../hooks/menuHooks/useCartHook";
import useMakeItAMeal from "../../hooks/makeItAMeal/useMakeItAMeal";
import useSessionReset from "../../hooks/utils/useSessionReset";
import useAppSettings from "../../hooks/utils/useAppSettings";
import useLoyalty from "../../hooks/loyalty/useLoyalty";
import CategoryRail from "../../components/menu/CategoryRail";
import MakeItAMealPrompt from "../../components/makeItAMeal/MakeItAMealPrompt";
import ProductAddedModal from "../../components/menu/ProductAddedModal";
import SelectSizeModal from "../../components/menu/SelectSizeModal";
import MenuItemCard from "../../components/menu/MenuItemCard";
import MenuCtaBar from "../../components/menu/MenuCtaBar";
import FooterBar from "../../components/chrome/FooterBar";
import LanguageSheet from "../../components/language/LanguageSheet";
import BagSheet from "../../components/cart/BagSheet";
import RepeatItemSheet from "../../components/cart/RepeatItemSheet";
import CancelOrderModal from "../../components/common/CancelOrderModal";
import LoyaltyLoginModal from "../../components/loyalty/LoyaltyLoginModal";
import LoyaltyRewardsSheet from "../../components/loyalty/LoyaltyRewardsSheet";
import LoyaltySuccessModal from "../../components/loyalty/LoyaltySuccessModal";
import LoyaltyErrorModal from "../../components/loyalty/LoyaltyErrorModal";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/**
 * Menu browse — Figma "Menu-basic agency" (1:2595): category rail + item
 * pane (H2 section titles, hero + grid cards, UNAVAILABLE states) + purple
 * TOTAL/VIEW-MY-BAG CTA + chrome footer. Data: the converted menu tree from
 * @cx-sdk legacy converters (fetched at order-type selection).
 * Card interactions land in P6 (PDP/customization) and P7 (cart).
 *
 * P7c makes this page the host of the XENO loyalty surfaces — the rewards
 * sheet, the login modal, the redemption celebration and the guard dialog are
 * all mounted here, so both entry points (the CTA-bar link per locked
 * decision 5a and the bag's LOG-IN & GET REWARDS per 5b) open the same
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

export default function Menu({ bagOpen = false }: MenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const menu = useSelector(selectMenu) as any;
  const currencySettings = useSelector(selectCurrency) as any;
  // P7c loyalty reads: the partner coupon list drives the CTA-bar label and
  // the entry-tap branch table; the customer phone is the XENO identity
  // (written by /phone, or by the login modal when the guest skipped it).
  const loyaltyCoupons = useSelector(selectCoupons) as any[] | null;
  const customerPhone = useSelector(selectPhoneNumber) as any;
  const globalErrorOpen = useSelector(selectShowErrorModalGlobal) as any;
  const globalErrorMessage = useSelector(selectErrorMessageGlobal) as any;

  const [languageOpen, setLanguageOpen] = useState(false);
  const [sizeEntity, setSizeEntity] = useState<any | null>(null);
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  const [loyaltyLoginOpen, setLoyaltyLoginOpen] = useState(false);
  const { getAddIntent, addEntity } = useAddEntityToCart();
  const { addItemToCart, isAnyLoyaltyItemPresentInCart } = useCartHook();
  const { openDoubleTierModal } = useMakeItAMeal();
  const { resetSession } = useSessionReset();
  const { getIsLoyaltyOn } = useAppSettings();
  const { checkAndRevokeLoyaltyReward } = useLoyalty();
  const paneRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  const currency = currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";

  const categories: any[] = useMemo(
    () => (Array.isArray(menu?.categories) ? menu.categories : []),
    [menu]
  );
  const railCategories = useMemo(
    () =>
      categories.map((c: any) => ({
        id: String(c?.id ?? c?.categoryId ?? ""),
        name: String(c?.name ?? c?.categoryName ?? ""),
      })),
    [categories]
  );
  const activeCategoryId = selectedCategoryId || railCategories[0]?.id || "";

  const handleRailSelect = (id: string) => {
    setSelectedCategoryId(id);
    const el = sectionRefs.current[id];
    if (el && paneRef.current) {
      paneRef.current.scrollTo({ top: el.offsetTop - 24, behavior: "smooth" });
    }
    captureKioskEvent(KioskEventName.SupCategoryClicked, { category_id: id });
  };

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
   *                availableCombos) → <MakeItAMealPrompt /> mounted below
   */
  const handleEntityAction = (entity: any, fromQuickAdd = false) => {
    const intent = getAddIntent(entity);
    if (intent === "unavailable") return;
    if (intent === "add") {
      addEntity(entity);
      return;
    }
    if (intent === "variant") {
      if (fromQuickAdd) {
        setSizeEntity(entity);
      } else {
        addEntity(entity); // tier-1 variant session → PDP
      }
      return;
    }
    if (intent === "upsell") {
      addEntity(entity); // executor dispatches openMakeItAMealModal
      return;
    }
    if (intent === "repeat") {
      addEntity(entity); // executor dispatches the repeat-sheet payload
      return;
    }
    // modifiers → tier-1 customization session (navigates to /customization
    // itself).
    openDoubleTierModal(entity, () => {}, undefined);
  };

  const handleSizeContinue = (variant: any) => {
    const parent = sizeEntity;
    setSizeEntity(null);
    if (!parent) return;
    if (variant?.modifiers?.length) {
      // Size chosen but the variant carries modifier groups → P6b builder.
      navigate("/customization");
      return;
    }
    // Engine-native variant row: price/dp/id all read from selectedVariant.
    addItemToCart(
      // total_price: the slice's subTotal reducer multiplies it by quantity.
      { ...parent, selectedVariant: variant, total_price: variant?.price, quantity: 1 },
      "VARIANT"
    );
  };

  /* ------------------------------------------------------------------ *
   * P7c — XENO loyalty                                                  *
   * ------------------------------------------------------------------ */

  const isLoyaltyIdentified = String(customerPhone ?? "").trim().length > 0;

  /**
   * Both loyalty guard branches dispatch the fork's GLOBAL error action —
   * that is what BagSheet's rewards entry already does, and keeping one code
   * path means the bag CTA and the menu link fail identically.
   *
   * BRIDGE, FLAGGED FOR FOLLOW-UP: tacobell-kiosk has no renderer for that
   * flag yet (the fork shows it as an auto-dismissing top banner, ErrorCard
   * mounted in AppRoutes), so a global dispatch is invisible today. Until
   * that banner lands at the app shell this page renders the two loyalty
   * guard messages itself, matched BY VALUE so that no unrelated global error
   * (dp-max-quantity, checkout failure, customization limits) is promoted
   * into a blocking modal by this bridge.
   */
  const loyaltyGuardMessages = useMemo(
    () => [t("loyalty.alreadyAvailed"), t("loyalty.noCoupons")],
    [t]
  );
  const loyaltyGuardError =
    globalErrorOpen && loyaltyGuardMessages.includes(String(globalErrorMessage))
      ? String(globalErrorMessage)
      : null;
  const dismissLoyaltyGuardError = () =>
    dispatch(
      setShowErrorModalGlobal({ showErrorModal: false, errorMessage: "" })
    );
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

  const isEmpty = categories.length === 0;

  return (
    <div
      data-testid="menu-screen"
      className="relative flex h-[1920px] w-[1080px] flex-col bg-tb-surface"
    >
      <div className="flex min-h-0 flex-1">
        <CategoryRail
          categories={railCategories}
          selectedId={activeCategoryId}
          onSelect={handleRailSelect}
        />
        <div ref={paneRef} className="min-h-0 flex-1 overflow-y-auto px-[24px] pb-[48px]">
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
                    {category?.name}
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
                            {subCategory?.name ?? subCategory?.categoryName}
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
      <MenuCtaBar
        currency={currency}
        onViewBag={() => navigate("/cart")}
        onOpenRewards={handleOpenLoyaltyRewards}
      />
      <div className="relative h-[56px] w-full">
        <FooterBar
          onCancelOrder={() => setCancelOrderOpen(true)}
          onOpenLanguage={() => setLanguageOpen(true)}
        />
      </div>
      <LanguageSheet open={languageOpen} onClose={() => setLanguageOpen(false)} />
      <MakeItAMealPrompt />
      <ProductAddedModal
        onQuickAdd={(entity) => addEntity(entity, { suppressAddedModal: true })}
      />
      <SelectSizeModal
        entity={sizeEntity}
        onClose={() => setSizeEntity(null)}
        onContinue={handleSizeContinue}
      />
      {/* P7a overlays — z-stack: BagSheet z-40 (after MakeItAMealPrompt in
          DOM order, so it wins at equal z), confirm modals z-50, repeat
          sheet z-[60] on top so a repeat triggered from the bag rail stacks
          over the sheet. */}
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
      <RepeatItemSheet />
      <CancelOrderModal
        open={cancelOrderOpen}
        // Locked decision 4: teardown only on confirm — and the loyalty
        // revoke runs BEFORE resetSession (contract step 9 / trap 1).
        onConfirm={handleCancelOrderConfirm}
        onCancel={() => setCancelOrderOpen(false)}
      />

      {/* P7c XENO loyalty overlays — z-stack above the bag (z-40):
          LoyaltyRewardsSheet z-50, LoyaltyLoginModal z-[60],
          LoyaltySuccessModal z-[70], LoyaltyErrorModal z-[80] (an error must
          never be occluded). The rewards sheet takes NO open prop: /phone and
          the login modal both open it by dispatching
          openLoyaltyItemsModal({isTimerOn:true}), and it reads that slice
          state itself — which is also how the post-lookup auto-open lands
          when the guest arrives here from /phone. */}
      <LoyaltyRewardsSheet />
      <LoyaltyLoginModal
        open={loyaltyLoginOpen}
        onClose={() => setLoyaltyLoginOpen(false)}
      />
      <LoyaltySuccessModal />
      <LoyaltyErrorModal
        open={loyaltyGuardError !== null}
        message={loyaltyGuardError ?? ""}
        onRetry={dismissLoyaltyGuardError}
      />
    </div>
  );
}
