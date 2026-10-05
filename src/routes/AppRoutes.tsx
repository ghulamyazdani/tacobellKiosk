import { useEffect, useRef } from "react";
import { Outlet, Route, Routes, useLocation } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import ProtectedRouteIfAuthenticated from "./ProtectedRouteIfAuthenticated";
import IdleGuard from "./IdleGuard";
import Registration from "../pages/Registration";
import StartScreen from "../pages/StartScreen";
import SecondLayout from "../pages/SecondLayout";
import LoadingResources from "../pages/LoadingResources";
import CustomerPhone from "../pages/CustomerPhone";
import Menu from "../pages/Menu";
import Customization from "../pages/Customization";
import ForYou from "../pages/ForYou";
import CustomerName from "../pages/CustomerName";
import Tent from "../pages/Tent";
import PaymentSelection from "../pages/PaymentSelection";
import ReceiptPreference from "../pages/ReceiptPreference";
import OrderSuccess from "../pages/OrderSuccess";
import NotFound from "../pages/NotFound";
import MakeItAMealPrompt from "../components/makeItAMeal/MakeItAMealPrompt";
import RepeatItemSheet from "../components/cart/RepeatItemSheet";
import { captureKioskEvent, KioskEventName } from "../utils/analytics";
import useCartHook from "../hooks/menuHooks/useCartHook";

/**
 * In-session overlay chrome — mounted ONCE for the whole authenticated
 * subtree, as a pathless layout route OUTSIDE any individual page.
 *
 * WHY IT LIVES HERE. Both components are prop-less and read their own open
 * state from redux (makeItAMeal `isOpen`, `cart.repeatItembottomSheet`).
 * useAddEntityToCart answers an "upsell" or a "repeat" card tap by
 * DISPATCHING that state rather than by navigating, so the tap is only alive
 * on a screen that has a renderer mounted. Both used to be mounted inside
 * <Menu> alone, which made every upsell/repeat tap on the standalone /forYou
 * screen a DEAD TAP — and left the modal state open, so the sheet later
 * surfaced over the bag on /cart (which is <Menu bagOpen />, and therefore
 * did render them) for an item tapped two screens earlier.
 *
 * As a layout route these stay mounted across every navigation inside the
 * protected subtree (/menu -> /forYou -> /customization -> /cart), so an
 * open sheet survives a route change instead of dying with its host page,
 * and they are never mounted on the unauthenticated Registration route.
 *
 * Z-STACK — pinned HERE, explicitly, instead of inherited from DOM order.
 * Geometry is unchanged by the move: both roots are `absolute inset-0` and
 * the nearest positioned ancestor is the ReachZone container either way (its
 * `contain: layout paint` makes it the containing block for absolute AND
 * fixed descendants, and a stacking context), so they resolve to the full
 * 1080x1920 stage — or to the bottom reach zone in the ADA view, along with
 * every page and page overlay. What the move changes is PAINT order:
 * page overlays live inside the route element, which now always precedes
 * these two in the DOM, so at equal z they would silently start winning. The
 * wrappers make the outcome explicit rather than positional:
 *
 *   z-45  MakeItAMealPrompt (intrinsically z-40) — above BagSheet's z-40 and
 *         the other z-40 page overlays, below every z-50+ confirm/loyalty
 *         modal, exactly as before EXCEPT against the bag. That exception is
 *         the fix: BagSheet's own CompleteYourMealRail and RewardsSheet call
 *         addEntity, so an upsell prompt raised FROM the open bag has to
 *         paint above it; at the old equal z-40 it was painted UNDER the bag
 *         (BagSheet came later in Menu's DOM) and was invisible.
 *   z-55  RepeatItemSheet (intrinsically z-[60]) — preserves every relative
 *         ordering it had inside Menu: above the bag (40), the confirm
 *         modals (50) and the loyalty rewards sheet (50); below the loyalty
 *         login (60), success (70) and error (80) modals.
 *
 * BagSheet's root is `absolute z-40`, i.e. a stacking context of its own, so
 * its children (RewardsSheet z-50, FreebiePickerSheet z-[80],
 * OfferRemovalNotice z-[90]) all paint inside the bag's z-40 slot — 45 and
 * 55 clear the whole bag subtree, not just its backdrop.
 *
 * POINTER EVENTS. Each wrapper is a full-zone box that exists even while the
 * overlay inside renders null, so it must not swallow taps on the page
 * underneath: the wrapper is `pointer-events-none` and the inner element
 * restores `pointer-events-auto` for the overlay subtree (the property is
 * inherited, so the overlay's own descendants become interactive again).
 * The inner element is zero-height while the overlay is closed, so it has no
 * hit area of its own.
 */
function InSessionOverlays() {
  return (
    <>
      <Outlet />
      <div className="pointer-events-none absolute inset-0 z-[45]">
        <div className="pointer-events-auto">
          <MakeItAMealPrompt />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 z-[55]">
        <div className="pointer-events-auto">
          <RepeatItemSheet />
        </div>
      </div>
    </>
  );
}

/**
 * Route skeleton (P1) mirroring posistKiosk's structure:
 *   /            Registration (redirects to /start when a token exists)
 *   /LoadingResources boot data load (outside the idle subtree)
 *   /start       attract screen (outside the idle subtree, like posistKiosk)
 *   /second      order type
 *   /phone       loyalty identity lookup, pre-menu (P7c; only reachable when
 *                getIsLoyaltyOn() — SecondLayout picks the branch)
 *   /cart        Menu with the bag sheet open (P7a locked decision 1)
 *   /forYou      pre-cart upsell (P7d); the ONLY forward menu->cart edge
 *                routes here when the gate opens, and it exits to /cart
 *   /customerName checkout-time name capture (P7c; the PAY preflight returns
 *                "customerName" whenever loyalty is on)
 *   /tent        table-tent number capture (P8a; preflight route "tent")
 *   /payment     payment-method choice (P8a; PAY AT COUNTER only)
 *   /receipt     receipt preference, after the method tap, before the push
 *   /orderSuccess order complete — the terminal screen of the vertical
 *
 * IDLE SUBTREE (P9a) — every route from /second on (and "*") sits inside the
 * pathless IdleGuard layout route, the fork's IdleChecksRoutes: one timer for
 * the whole session that survives in-session navigation and unmounts, timer
 * and listeners with it, on /start. Boot and Splash have nothing to time
 * out, so they stay outside. IdleGuard nests INSIDE InSessionOverlays, which
 * keeps the overlay mount (which also spans /start) exactly as it was; the
 * prompt's z-[100] clears the hoisted MIAM/repeat wrappers (45/55).
 *
 * P8a ROUTE FAN-OUT — the /checkout stub (P7a locked decision 5) is GONE; the
 * four preflight routes now land on their real screens:
 *
 *   /cart ──┬─ "tent"         → /tent
 *           ├─ "payment"      → /payment
 *           ├─ "customerName" → /customerName
 *           └─ "phone"        → /phone   (checkout mode, see CustomerPhone)
 *   /tent         Continue → skipCRM ? /payment : loyaltyOn ? /customerName : /phone
 *   /phone        Continue → /customerName   (ONLY in checkout mode)
 *   /customerName Continue → directOrder ? push → /orderSuccess : /payment
 *   /payment      PAY AT COUNTER → /receipt → push → /orderSuccess
 *
 * SAFETY (P8a): there is deliberately NO /payment polling route and no
 * gateway screen. `/payment` offers pay-at-counter only; the card tile is
 * rendered disabled. Nothing in this table can reach a payment gateway or a
 * terminal socket, and that is a property of the route table itself.
 */
export function AppRoutes() {
  const location = useLocation();
  const { syncCartOnReLoad } = useCartHook();

  // Dexie crash-recovery (P7a, contract E): a full page load/refresh
  // re-mounts this top-level component, so rehydrate the Redux cart from the
  // IndexedDB mirror exactly once. The write side (every useCartHook mutator
  // mirrors to Dexie) was already wired; this is the missing read side.
  // Ref-guarded so the effect stays one-shot without a stale-closure lint
  // suppression (useCartHook returns a fresh function each render).
  const didRehydrateCart = useRef(false);
  useEffect(() => {
    if (didRehydrateCart.current) return;
    didRehydrateCart.current = true;
    const rehydrate = async () => {
      try {
        await syncCartOnReLoad();
      } catch (error) {
        // Dexie unavailable (corrupted DB, private mode): start with an
        // empty cart rather than crash the shell — Rule 2. The write mirror
        // keeps working independently.
        console.error("[AppRoutes] cart rehydrate from Dexie failed:", error);
      }
    };
    void rehydrate();
  }, [syncCartOnReLoad]);

  // Route-view analytics — same event vocabulary as posistKiosk.
  useEffect(() => {
    captureKioskEvent(KioskEventName.pageViewed, {
      route_path: location.pathname,
    });
  }, [location.pathname]);

  // Back-navigation neutralisation: an unattended kiosk must never respond
  // to browser back (hardware keyboards, gesture navigation). One listener,
  // bound once; a pushState per navigation keeps the trap armed.
  useEffect(() => {
    const arm = () => window.history.pushState(null, "", window.location.href);
    arm();
    window.addEventListener("popstate", arm);
    return () => window.removeEventListener("popstate", arm);
  }, []);

  return (
    <Routes>
      <Route element={<ProtectedRouteIfAuthenticated />}>
        <Route path="/" element={<Registration />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        {/* Pathless layout route: the redux-driven upsell/repeat overlays are
            mounted once for the whole in-session subtree, outside the switch,
            so they are reachable from EVERY screen that can raise them (and
            from none of the unauthenticated ones). See InSessionOverlays. */}
        <Route element={<InSessionOverlays />}>
          <Route path="/LoadingResources" element={<LoadingResources />} />
          <Route path="/start" element={<StartScreen />} />
          {/* Idle subtree (P9a): one timer across every in-session screen,
              torn down on /start. See IdleGuard. */}
          <Route element={<IdleGuard />}>
            <Route path="/second" element={<SecondLayout />} />
            <Route path="/phone" element={<CustomerPhone />} />
            <Route path="/menu" element={<Menu />} />
            {/* Bag is a sheet over the menu, route-driven: /cart = Menu with
                the sheet open, close = navigate("/menu") — keeps
                direction:"cart" return paths working
                (resolveCustomizationReturnPath → "/cart"). */}
            <Route path="/cart" element={<Menu bagOpen />} />
            <Route path="/customization" element={<Customization />} />
            {/* P7d pre-cart upsell. A genuine STANDALONE page, deliberately a
                sibling of /customization rather than another <Menu> variant:
                /cart is <Menu bagOpen />, so mounting the upsell as a Menu
                skin would bleed the bag sheet and the CTA bar through it. It
                owns its own chrome and renders no MenuCtaBar and no FooterBar.

                Being a sibling is also what makes the baseline a redux
                concern: a customization detour from this screen UNMOUNTS it
                and remounts it on return, so nothing visit-scoped may live in
                useState/useRef there (cart.slice cartUpsellEntryQuantity). */}
            <Route path="/forYou" element={<ForYou />} />
            <Route path="/customerName" element={<CustomerName />} />
            {/* P8a checkout vertical. All four live INSIDE ProtectedRoute +
                InSessionOverlays: a repeat/upsell sheet raised from the bag
                must survive the hop to /tent or /payment, and none of these
                screens may be reachable on an unregistered device. */}
            <Route path="/tent" element={<Tent />} />
            <Route path="/payment" element={<PaymentSelection />} />
            <Route path="/receipt" element={<ReceiptPreference />} />
            <Route path="/orderSuccess" element={<OrderSuccess />} />
            {/* Inside the guard on purpose: a stray URL self-heals to Splash. */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
