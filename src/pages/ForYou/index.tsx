import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { selectCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  cartQuantity,
  markCartUpsellSeen,
  selectCart,
  selectCartUpsellEntryQuantity,
  setCartUpsellEntryQuantity,
} from "@cx-sdk/ordering/state/cart.slice";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import useCartUpsell from "../../hooks/menuHooks/useCartUpsell";
import useAddEntityToCart from "../../hooks/menuHooks/useAddEntityToCart";
import useAdaActive from "../../hooks/utils/useAdaActive";
import useLocalized from "../../hooks/utils/useLocalized";
import { STAGE_HEIGHT, STAGE_WIDTH } from "../../components/stage/KioskStage";
import {
  cartUpsellGridCapacity,
  CART_UPSELL_CARD_HEIGHT_PX,
  CART_UPSELL_CARD_WIDTH_PX,
  CART_UPSELL_GRID_GAP_PX,
} from "../../hooks/menuHooks/cartUpsellUtils";
import ForYouCard from "../../components/cart/ForYouCard";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

/** Only the slices this screen reads. */
interface CartLike {
  cartItems?: { id?: string; quantity?: number }[];
}
interface CurrencyLike {
  symbol?: string;
  currency_symbol?: string;
}

/**
 * /forYou — the pre-cart upsell screen (P7d).
 *
 * Sits on the ONE forward Menu -> Cart edge (Menu's `handleViewBag`). Every
 * other `navigate("/cart")` in the app is a BACKWARD return — ProductAddedModal's
 * view-bag, CustomerName, Checkout, the bag sheet's own close — and goes
 * straight to the cart: re-offering "complete your meal" to somebody reversing
 * OUT of the cart is the worst outcome available.
 *
 * A GENUINE STANDALONE ROUTE, not a variant of Menu. /cart is `<Menu bagOpen />`
 * (P7a locked decision 1), so anything rendered as part of that tree would let
 * the bag sheet bleed through. This page owns its own chrome and deliberately
 * renders NO MenuCtaBar and NO FooterBar — the two exits below the grid are the
 * only controls, and a purple CTA bar underneath them would compete with the
 * one call to action this screen is allowed.
 *
 * THE DETOUR IS THE HARD PART. Tapping a card that opens a chooser navigates to
 * /customization, which UNMOUNTS this component; the return trip remounts it
 * with the item already in the cart. So nothing visit-scoped may live in
 * useState/useRef — the visit baseline lives in redux (cart.cartUpsellEntryQuantity,
 * cleared by both session-reset paths) and the mount guards below re-seed it
 * only when this screen was reached some other way.
 *
 * No Figma frame exists for /forYou (node 1:3070 turned out to be the Make It A
 * Meal prompt, and the design puts Complete-Your-Meal inside the bag instead),
 * so this is TB design language — 1080x1920 absolute px, tb-* tokens, the
 * shared Menu-Item card — and is FLAGGED for client sign-off. It is settings
 * gated (`enable_cart_upsell_screen: false`), so it is reversible by config.
 */
export default function ForYou() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Every hook is instantiated ONCE here; the cards are props-only and memoized.
  const { items, shouldShowUpsell } = useCartUpsell();
  const { addEntity, getAddIntent } = useAddEntityToCart();
  const { name } = useLocalized();

  const cart = useSelector(selectCart) as CartLike | null | undefined;
  const currencySettings = useSelector(selectCurrency) as
    | CurrencyLike
    | null
    | undefined;
  /**
   * UNITS, not ROWS. `cartQuantity` is `state.cart.totalQuantity` — the same
   * read the gate in Menu makes. A cart holding two of one item is ONE row and
   * TWO units, so baselining on rows would flip the button on the wrong event
   * for every multi-quantity cart.
   */
  const cartQuantityRdx = Number(useSelector(cartQuantity) ?? 0);
  /**
   * Cart quantity when this VISIT began — redux, NOT useRef/useState. The
   * detour above tears this screen down and rebuilds it AFTER the item is
   * already in the cart, so a component-scoped baseline would re-seed from the
   * post-add cart and the button would never leave "Not Today".
   */
  const entryQuantityRdx = useSelector(selectCartUpsellEntryQuantity);
  /** The ADA view renders this page into the reach zone (ReachZone), so only
   *  the grid's height budget changes. */
  const adaActive = useAdaActive();

  /**
   * Snapshot on mount. The selector is cart-independent, but freezing it means
   * the grid can never reflow under a moving finger — a mis-tap hazard on a
   * hoverless touchscreen — even if stock or filters change mid-screen.
   */
  const [snapshot] = useState<RecommendedEntity[]>(() => items);

  /**
   * How many cards this kiosk can show at once. Nothing here scrolls, so this
   * is a hard budget: render one row more than fits and the two exits below the
   * grid leave the screen with no gesture that brings them back.
   *
   * Measured in STAGE design px, never window px: KioskStage scales the fixed
   * 1080x1920 stage to fit any window, so this page always has the stage (16
   * cards) — or, in the ADA view, the reach zone (8). Window px were only
   * right at scale 1 (wrong in dev, e2e, or on a non-1920 panel).
   */
  const capacity = cartUpsellGridCapacity(STAGE_WIDTH, STAGE_HEIGHT, adaActive);

  /**
   * Sliced from the frozen snapshot, so which items get dropped is stable for
   * the whole visit — and it is always the TAIL of the merchandiser's own menu
   * order, never an arbitrary subset.
   */
  const visible = useMemo(
    () => snapshot.slice(0, capacity),
    [snapshot, capacity],
  );

  /* -------------------- MOUNT GUARDS -------------------- */
  /*
    Deliberately mount-only. The gate is evaluated at the choke point in Menu so
    the customer never sees this screen flash up and redirect itself away; these
    guards exist for the ways in that bypass it — a hand-typed URL, or an F5
    (the menu slice is not persisted, so entityMap is null until fetchMenu
    completes). `replace` so Back cannot ping-pong between here and the cart.
  */
  useEffect(() => {
    if (cartQuantityRdx === 0) {
      // "Complete your meal" with an empty bag is nonsense, and /cart would be
      // an empty cart — send them back to the menu.
      navigate("/menu", { replace: true });
      return;
    }
    if (!shouldShowUpsell || snapshot.length === 0) {
      navigate("/cart", { replace: true });
      return;
    }
    /*
      Menu sets the baseline at the real forward edge. Seed it here ONLY when we
      were reached some other way — NEVER on a detour return, where it is
      already a number and re-seeding would swallow the very item the customer
      just customized. `typeof !== "number"` rather than `=== null` so a
      rehydrated `undefined` also seeds.
    */
    if (typeof entryQuantityRdx !== "number") {
      dispatch(setCartUpsellEntryQuantity(cartQuantityRdx));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design: these are entry conditions, not live invariants (re-running would redirect mid-visit as the cart moves).
  }, []);

  const currency =
    currencySettings?.symbol ?? currencySettings?.currency_symbol ?? "";

  /** One pass over the cart instead of a lookup per card. */
  const cartItems = cart?.cartItems;
  const quantityById = useMemo(() => {
    const totals: Record<string, number> = {};
    (cartItems ?? []).forEach((row) => {
      if (!row?.id) return;
      totals[row.id] = (totals[row.id] ?? 0) + Number(row?.quantity ?? 0);
    });
    return totals;
  }, [cartItems]);

  const handleAdd = useCallback(
    (entity: RecommendedEntity) => {
      /*
        A tap that opens a chooser LEAVES this screen, and one of those exits
        cannot be brought back: useAddEntityToCart's "upsell" branch dispatches
        openMakeItAMealModal WITHOUT forwarding navigationState (unlike repeat /
        modifiers / variant, which all do), so the MIAM prompt navigates bare
        and the customer lands on /menu. Left unmarked, hitting VIEW MY BAG
        again would bring this screen straight back. So A DETOUR COUNTS AS SEEN.

        Deliberately NOT marked for intent "add" (the customer stays right here)
        or "unavailable" (nothing happens at all) — marking those would quietly
        undo the decision that Back to Menu is not a dismissal.
      */
      const intent = getAddIntent(entity);
      if (intent !== "add" && intent !== "unavailable") {
        dispatch(markCartUpsellSeen());
      }

      addEntity(entity, {
        // The bag row / the card's own count pill IS the confirmation; a modal
        // on top of a suggestion grid buries the exits.
        suppressAddedModal: true,
        // Come back HERE after a customization detour. returnPath (not
        // direction) — resolveCustomizationReturnPath gives it precedence, so a
        // CANCELLED customization returns to this screen rather than being
        // pushed forward into a cart the customer never asked for.
        returnPath: "/forYou",
      });
    },
    [addEntity, getAddIntent, dispatch],
  );

  /*
    Fallback is cartQuantityRdx, NOT 0: for the one render before the seed above
    commits, the baseline is still null, and falling back to 0 would count the
    whole pre-existing cart as "taken here" and flash "Proceed to Order".
  */
  const addedHere = Math.max(
    0,
    cartQuantityRdx - (entryQuantityRdx ?? cartQuantityRdx),
  );

  const goToCart = useCallback(
    (skipped: boolean) => {
      if (skipped) {
        captureKioskEvent(KioskEventName.CartUpsellSkipped, {
          // What the customer was actually looking at, not what qualified — the
          // grid shows what fits and drops the tail. Both are reported so a
          // tenant whose flagged items outnumber the grid can see it.
          offered: visible.length,
          eligible: snapshot.length,
        });
      }
      dispatch(markCartUpsellSeen());
      navigate("/cart");
    },
    [dispatch, navigate, snapshot.length, visible.length],
  );

  // Render NOTHING rather than a blank shell — the guard above is already
  // navigating away, and an empty "complete your meal" is a broken screen.
  if (snapshot.length === 0) return null;

  const takenSomething = addedHere > 0;

  return (
    <div
      data-testid="foryou-screen"
      // h-full = ReachZone's container: the zone already lowers the page in
      // the ADA view, so it centres in both modes (8 cards fit 1122).
      className="relative flex h-full w-[1080px] flex-col items-center justify-center bg-tb-surface px-[24px]"
    >
      {/* Quiet centred ask. One heading, no brand band — the suggestion should
          read as an offer, not an interstitial advert. */}
      <h1
        data-testid="foryou-heading"
        className="tb-display text-center text-[56px] leading-[0.9] tracking-[-2px] text-tb-purple"
      >
        {t("upsell.anythingElse")}
      </h1>

      {/* A wrapping grid that NEVER scrolls — the whole offer is on screen at
          once, because a touchscreen gives no cue that there is more below.
          Four 240px cards plus three 24px gaps come to exactly the 1032px the
          stage leaves inside its padding.

          The card box and the gap come from the SAME constants the capacity
          math uses (cartUpsellUtils), applied inline rather than as Tailwind
          classes: if the two ever disagreed the grid would overflow a page that
          cannot scroll, taking the buttons below it off screen. */}
      <div
        className="mt-[48px] flex w-full flex-wrap items-stretch justify-center"
        style={{ gap: CART_UPSELL_GRID_GAP_PX }}
      >
        {visible.map((entity) => (
          <div
            key={entity.id}
            // Fixed BOX, not a content-sized one. A two-line product name must
            // not make its card taller than the one beside it, and on a page
            // with no scroll it must not push the row below it off screen.
            style={{
              width: CART_UPSELL_CARD_WIDTH_PX,
              height: CART_UPSELL_CARD_HEIGHT_PX,
            }}
          >
            <ForYouCard
              entity={entity}
              testId={`foryou-card-${entity.id}`}
              title={name(entity)}
              // RAW menu price, matching the menu tile. The taxed bill total is
              // a cart concept and does not belong on a suggestion.
              price={entity?.price}
              currency={currency}
              quantity={quantityById[entity.id] ?? 0}
              addLabel={t("menu.quickAdd")}
              customizeLabel={t("pack.customize")}
              onAdd={handleAdd}
            />
          </div>
        ))}
      </div>

      <div className="mt-[48px] flex w-full flex-col items-center gap-[24px]">
        {/* ONE button. It is a plain decline until something is taken, at which
            point both its label and its fill become the way forward — so there
            is never a moment with no visible exit, and never two competing
            calls to action. */}
        <button
          type="button"
          data-testid="foryou-primary"
          onClick={() => goToCart(!takenSomething)}
          className={`tb-display min-h-[84px] w-[560px] rounded-[8px] py-[32px] text-center text-[24px] leading-[20px] ${
            takenSomething
              ? "bg-tb-purple text-tb-surface shadow-[0px_20px_40px_0px_rgba(0,0,0,0.15)]"
              : "border border-tb-purple bg-tb-surface text-tb-purple"
          }`}
        >
          {takenSomething ? t("upsell.proceedToOrder") : t("upsell.notToday")}
        </button>

        {/* Rule 1: this route renders no footer, so the page owns the way back.
            Kept visually quiet so it never competes with the button above.

            Deliberately does NOT mark the screen as seen — going back to browse
            is not dismissing the offer. The customer is still mid-order and
            will pass this way again, so they get it once more on their next
            trip to the bag. Only the two FORWARD exits count as seen. */}
        <button
          type="button"
          data-testid="foryou-back"
          onClick={() => navigate("/menu")}
          className="flex min-h-[44px] items-center px-[16px] text-[20px] font-medium leading-[24px] text-tb-ink-purple underline underline-offset-[6px]"
        >
          {t("customization.backToMenu")}
        </button>
      </div>
    </div>
  );
}
