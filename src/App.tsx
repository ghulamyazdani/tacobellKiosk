import { useEffect } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { useSelector } from "react-redux";
import posthog from "posthog-js";
import { AppRoutes } from "./routes";
import { KioskStage } from "./components/stage/KioskStage";
import NetworkStatusOverlay from "./components/common/NetworkStatusOverlay";
import { PWAUpdateHandler } from "./components/autoUpdate/PWAUpdateHandler";
import { selectSelectedLanguage } from "./redux/features/multiLanguage/multiLanguage.slice";
import { selectLicenseDetails } from "@cx-sdk/core/auth/authentication.slice";
import i18n from "./i18n";

/**
 * App shell. Boot-order invariants (see CLAUDE.md):
 * - NetworkStatusOverlay / PWAUpdateHandler are always mounted.
 * - Kiosk hardening: zoom, devtools keys, context menu blocked; every
 *   listener detached on unmount (24/7 uptime — leaks are real leaks).
 * - FCM init + FullscreenPrompt + accessibility-mode transform land in
 *   P3/P9 with their features.
 */
const App = () => {
  const selectedLanguage = useSelector(selectSelectedLanguage);
  const licenseDetails = useSelector(selectLicenseDetails);

  // Language sync: the shell pushes the store's language into i18n (the
  // detector never reads the store — that coupling stays broken).
  useEffect(() => {
    if (selectedLanguage?.code) {
      i18n.changeLanguage(selectedLanguage.code);
    }
  }, [selectedLanguage]);

  // Tenant identity for analytics (guarded: posthog is init-ed only when
  // VITE_POST_HOG_TYPE === "production").
  useEffect(() => {
    if (licenseDetails?.tenant_id) {
      try {
        posthog.identify(licenseDetails.tenant_id, {
          login_code: licenseDetails.login_code,
          license_key: licenseDetails.license_key,
          deployment_id: licenseDetails.deployment_id,
          type: licenseDetails.type,
          expiry_date: licenseDetails.expiry_date,
          tenant_id: licenseDetails.tenant_id,
        });
      } catch {
        // analytics must never break the kiosk (Rule 2)
      }
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
          <AppRoutes />
        </KioskStage>
      </Router>
    </>
  );
};

export default App;
