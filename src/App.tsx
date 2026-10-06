import { useEffect, useRef } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { useSelector } from "react-redux";
import { identifyKiosk } from "./utils/analytics";
import { AppRoutes } from "./routes";
import { KioskStage } from "./components/stage/KioskStage";
import { ReachZone } from "./components/stage/ReachZone";
import NetworkStatusOverlay from "./components/common/NetworkStatusOverlay";
import { PWAUpdateHandler } from "./components/autoUpdate/PWAUpdateHandler";
import useFcmRegistration from "./hooks/firebase/useFcmRegistration";
import useTenantRecommendations from "./hooks/recommendation/useTenantRecommendations";
import { selectSelectedLanguage } from "./redux/features/multiLanguage/multiLanguage.slice";
import { selectLicenseDetails } from "@cx-sdk/core/auth/authentication.slice";
import i18n, { DEFAULT_LANGUAGE } from "./i18n";

/**
 * App shell. Boot-order invariants (see CLAUDE.md):
 * - NetworkStatusOverlay / PWAUpdateHandler are always mounted.
 * - Kiosk hardening: zoom, devtools keys, context menu blocked; every
 *   listener detached on unmount (24/7 uptime — leaks are real leaks).
 * - ReachZone wraps the routes INSIDE KioskStage: it is the containing block
 *   for every page and overlay, full-stage normally and the bottom reach
 *   zone in the ADA view (P9c). It must sit inside Router (useLocation).
 * - FCM (P9e): useFcmRegistration — latch-, config- and permission-gated,
 *   never prompts; firebase is a lazy chunk, never on the boot path.
 *   FullscreenPrompt lands with its feature.
 * - Tenant recommendations (post-P9 29a): their Dexie copy loads once per
 *   launch, because a relaunch never boots (P9e) — without it a reload
 *   loses the bag rail's tenant source until the next boot (≤ 6 h).
 */
const App = () => {
  const selectedLanguage = useSelector(selectSelectedLanguage);
  const licenseDetails = useSelector(selectLicenseDetails);
  useFcmRegistration();
  const { loadCached } = useTenantRecommendations();
  const recommendationsLoaded = useRef(false);

  // Once per launch (the ref survives StrictMode's effect replay). Never
  // rejects, and never overwrites a map a boot already stored.
  useEffect(() => {
    if (recommendationsLoaded.current) return;
    recommendationsLoaded.current = true;
    void loadCached();
  }, [loadCached]);

  // Language sync: the shell pushes the store's language into i18n (the
  // detector never reads the store — that coupling stays broken). Every
  // session reset blanks the code to "" (emptySelectedLanguage), so "" must
  // mean the default — skipping it left the next customer in the previous
  // customer's language.
  useEffect(() => {
    i18n.changeLanguage(selectedLanguage?.code || DEFAULT_LANGUAGE);
  }, [selectedLanguage]);

  // Tenant identity for analytics: queued until PostHog loads, dropped when
  // the VITE_POST_HOG_TYPE kill switch is off; never throws (the adapter
  // swallows). Payload kept as is (user decision 2026-10-05).
  useEffect(() => {
    if (licenseDetails?.tenant_id) {
      identifyKiosk(licenseDetails.tenant_id, {
        login_code: licenseDetails.login_code,
        license_key: licenseDetails.license_key,
        deployment_id: licenseDetails.deployment_id,
        type: licenseDetails.type,
        expiry_date: licenseDetails.expiry_date,
        tenant_id: licenseDetails.tenant_id,
      });
    }
  }, [licenseDetails]);

  // Kiosk hardening.
  useEffect(() => {
    const blockInstallPrompt = (e: Event) => e.preventDefault();
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const handleKeyDownZoom = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "+" || e.key === "-" || e.key === "=")
      ) {
        e.preventDefault();
      }
    };
    const handleDevTools = (e: KeyboardEvent) => {
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J")) ||
        (e.ctrlKey && e.key === "U")
      ) {
        e.preventDefault();
      }
    };
    const handleContextMenu = (e: Event) => e.preventDefault();

    document.body.style.overflow = "hidden";
    window.addEventListener("beforeinstallprompt", blockInstallPrompt);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDownZoom);
    window.addEventListener("keydown", handleDevTools);
    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      window.removeEventListener("beforeinstallprompt", blockInstallPrompt);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDownZoom);
      window.removeEventListener("keydown", handleDevTools);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  return (
    <>
      <NetworkStatusOverlay />
      <PWAUpdateHandler />
      <Router>
        <KioskStage>
          <ReachZone>
            <AppRoutes />
          </ReachZone>
        </KioskStage>
      </Router>
    </>
  );
};

export default App;
