import { useEffect, useRef } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import ProtectedRouteIfAuthenticated from "./ProtectedRouteIfAuthenticated";
import Registration from "../pages/Registration";
import StartScreen from "../pages/StartScreen";
import SecondLayout from "../pages/SecondLayout";
import LoadingResources from "../pages/LoadingResources";
import CustomerPhone from "../pages/CustomerPhone";
import Menu from "../pages/Menu";
import Customization from "../pages/Customization";
import CustomerName from "../pages/CustomerName";
import Checkout from "../pages/Checkout";
import NotFound from "../pages/NotFound";
import { captureKioskEvent, KioskEventName } from "../utils/analytics";
import useCartHook from "../hooks/menuHooks/useCartHook";

/**
 * Route skeleton (P1) mirroring posistKiosk's structure:
 *   /            Registration (redirects to /start when a token exists)
 *   /start       attract screen (outside the idle subtree, like posistKiosk)
 *   /second      order type
 *   /phone       loyalty identity lookup, pre-menu (P7c; only reachable when
 *                getIsLoyaltyOn() — SecondLayout picks the branch)
 *   /cart        Menu with the bag sheet open (P7a locked decision 1)
 *   /customerName checkout-time name capture (P7c; the PAY preflight returns
 *                "customerName" whenever loyalty is on)
 *   /checkout    P8 stub the PAY preflight routes to (P7a locked decision 5)
 * The idle-guarded subtree, /LoadingResources boot and the remaining screens
 * land with their phases (P3+).
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
        <Route path="/LoadingResources" element={<LoadingResources />} />
        <Route path="/start" element={<StartScreen />} />
        <Route path="/second" element={<SecondLayout />} />
        <Route path="/phone" element={<CustomerPhone />} />
        <Route path="/menu" element={<Menu />} />
        {/* Bag is a sheet over the menu, route-driven: /cart = Menu with the
            sheet open, close = navigate("/menu") — keeps direction:"cart"
            return paths working (resolveCustomizationReturnPath → "/cart"). */}
        <Route path="/cart" element={<Menu bagOpen />} />
        <Route path="/customization" element={<Customization />} />
        <Route path="/customerName" element={<CustomerName />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
