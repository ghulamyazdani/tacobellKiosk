import { useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import {
  kiosSettingsRdx,
  selectMandatoryFullscreen,
  setMandatoryFullscreen,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { isLoyaltyOn } from "@cx-sdk/ordering/state/loyalty.slice";
import {
  selectDeploymentDetails,
  selectLicenseDetails,
} from "@cx-sdk/core/auth/authentication.slice";
import { selectLastBootAt } from "@cx-sdk/devices/updates/autoUpdate.slice";
import {
  formatSoftwareVersion,
  getDeviceDisplayName,
  getFullscreenModeDescription,
  getNotificationStatusDisplay,
  getPrinterStatusDisplay,
  type KioskNotificationPermissionState,
} from "@cx-sdk/devices/diagnostics/activityLogic";
import useAuthHook from "../../hooks/utils/useAuthHook";
import useAppSettings from "../../hooks/utils/useAppSettings";

/**
 * Operator Activity Center — diagnostics modal opened by the hidden 3s
 * top-left hold on the StartScreen (and on the /LoadingResources boot screen,
 * P9b). Logic parity with posistKiosk's ActivityModal (995-line original):
 * device/deployment/version info, notification + printer status (+ loyalty
 * status when enabled, P9b), mandatory-fullscreen toggle (disable is
 * passcode-gated), kiosk logout with confirmation. P9e: when the last
 * successful boot ran ("Data loaded") and, on the splash only, "Reload
 * resources" (a refresh-mode boot; design language, no frame — flagged).
 *
 * SECURITY FLAG (inherited, byte-identical per the extraction's pending
 * decision): the fullscreen passcode is hardcoded. Replace with a
 * server-issued secret before production.
 */
const FULLSCREEN_PASSCODE = "Pos@123";

interface ActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Re-run the boot fetches in refresh mode (P9e). Only the splash passes
   * it: on /LoadingResources a same-path navigate keeps the mounted boot
   * screen, whose startedRef latch would make the button a silent no-op, and
   * that screen has its own retry.
   */
  onReloadResources?: () => void;
}

export default function ActivityModal({
  isOpen,
  onClose,
  onReloadResources,
}: ActivityModalProps) {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const { logoutKiosk } = useAuthHook();
  const { getPrinterName } = useAppSettings();
  const licenseDetails = useSelector(selectLicenseDetails);
  const deploymentDetails = useSelector(selectDeploymentDetails);
  const mandatoryFullscreen = useSelector(selectMandatoryFullscreen);
  // Loyalty degrades at boot (P9b): enabled in settings but no partner
  // resolved means the kiosk is selling loyalty-off until StartScreen's
  // splash-visit retry resolves one.
  const loyaltyEnabled = Boolean(useSelector(kiosSettingsRdx)?.enable_loyalty);
  const loyaltyResolved = Boolean(useSelector(isLoyaltyOn));
  // Epoch ms of the last SUCCESSFUL boot (P9e, D1); 0 = never/unknown.
  const lastBootAt = useSelector(selectLastBootAt);

  const [showPasscodeInput, setShowPasscodeInput] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Read at render — every open re-renders, so the value stays fresh
  // without an effect (react-hooks/set-state-in-effect).
  const notificationPermission: KioskNotificationPermissionState =
    typeof Notification !== "undefined"
      ? (Notification.permission as KioskNotificationPermissionState)
      : "default";

  const notificationStatus = getNotificationStatusDisplay(notificationPermission);
  const printerStatus = getPrinterStatusDisplay(getPrinterName());
  const version = formatSoftwareVersion(process.env.PACKAGE_VERSION);

  const handleToggleFullscreen = useCallback(() => {
    if (!mandatoryFullscreen) {
      // Enabling — no passcode needed (fork parity).
      dispatch(setMandatoryFullscreen(true));
    } else {
      // Disabling — passcode-gated (fork parity).
      setShowPasscodeInput(true);
      setPasscode("");
      setPasscodeError("");
    }
  }, [mandatoryFullscreen, dispatch]);

  const handlePasscodeSubmit = useCallback(() => {
    if (passcode === FULLSCREEN_PASSCODE) {
      dispatch(setMandatoryFullscreen(false));
      setShowPasscodeInput(false);
      setPasscode("");
      setPasscodeError("");
    } else {
      setPasscodeError(t("activity.invalidPasscode"));
      setPasscode("");
    }
  }, [passcode, dispatch, t]);

  const handleLogoutConfirm = useCallback(() => {
    setShowLogoutConfirm(false);
    onClose();
    logoutKiosk();
    // ProtectedRoute redirects to "/" once the token cookie is gone.
    window.location.replace(window.location.origin + "/");
  }, [logoutKiosk, onClose]);

  const infoRows: Array<{ label: string; value: string; tone?: string }> = [
    {
      label: t("activity.device"),
      value: getDeviceDisplayName(licenseDetails?.device_name),
    },
    {
      label: t("activity.deployment"),
      value: deploymentDetails?.deployment_name ?? deploymentDetails?._id ?? "—",
    },
    { label: t("activity.version"), value: version },
    {
      label: t("activity.dataLoaded"),
      value:
        lastBootAt > 0
          ? new Date(lastBootAt).toLocaleString(i18n.language, {
              dateStyle: "medium",
              timeStyle: "medium",
            })
          : "—",
    },
    {
      label: t("activity.notifications"),
      value: notificationStatus.status,
      tone: notificationPermission === "denied" ? "error" : undefined,
    },
    {
      label: t("activity.printer"),
      value: printerStatus.label,
      tone: printerStatus.connected ? undefined : "warning",
    },
    ...(loyaltyEnabled
      ? [
          {
            label: t("activity.loyalty"),
            value: t(
              loyaltyResolved
                ? "activity.loyaltyActive"
                : "activity.loyaltyUnavailable"
            ),
            tone: loyaltyResolved ? undefined : "warning",
          },
        ]
      : []),
  ];

  if (!isOpen) return null;

  // Deliberately NO framer-motion here: rAF-driven animations freeze when
  // Chromium throttles an occluded window, leaving the modal stuck at
  // partial opacity with the centering transform clobbered. Operator UI
  // uses a pure-CSS entrance instead (compositor-driven, cannot stall).
  return (
    <div className="absolute inset-0 z-50" data-testid="activity-modal">
          <button
            type="button"
            aria-label={t("language.close")}
            onClick={onClose}
            className="absolute inset-0 h-full w-full bg-tb-ink-purple/80"
          />
          <div
            // Centering lives ONLY in the tb-modal-enter keyframes: Tailwind 4's
            // -translate-* classes use the CSS `translate` property, which
            // STACKS with the animation's `transform` (double shift).
            className="tb-modal-enter absolute left-1/2 top-1/2 w-[820px] rounded-[16px] bg-tb-surface p-[48px]"
          >
            <h2 className="tb-display mb-[32px] text-[40px] leading-[1] tracking-[-1px] text-tb-purple">
              {t("activity.title")}
            </h2>

            <div className="mb-[32px] flex flex-col divide-y divide-tb-grey-4">
              {infoRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between py-[16px]">
                  <span className="text-[22px] font-medium text-tb-ink-purple">{row.label}</span>
                  <span
                    className={`text-[22px] font-bold ${row.tone === "error" ? "text-red-600" : row.tone === "warning" ? "text-amber-600" : "text-tb-purple"}`}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between py-[16px]">
                <div className="pr-8">
                  <span className="text-[22px] font-medium text-tb-ink-purple">
                    {t("activity.fullscreen")}
                  </span>
                  <p className="mt-1 max-w-[520px] text-[16px] text-tb-ink-purple/70">
                    {getFullscreenModeDescription(Boolean(mandatoryFullscreen))}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="activity-fullscreen-toggle"
                  role="switch"
                  aria-checked={Boolean(mandatoryFullscreen)}
                  aria-label={t("activity.fullscreen")}
                  onClick={handleToggleFullscreen}
                  className={`h-[44px] w-[88px] rounded-full p-[4px] transition-colors ${mandatoryFullscreen ? "bg-tb-purple" : "bg-tb-grey-4"}`}
                >
                  <span
                    className={`block h-[36px] w-[36px] rounded-full bg-tb-surface transition-transform ${mandatoryFullscreen ? "translate-x-[44px]" : "translate-x-0"}`}
                  />
                </button>
              </div>
            </div>

            {showPasscodeInput && (
              <div className="mb-[32px] rounded-[8px] bg-tb-grey-6 p-[24px]" data-testid="activity-passcode">
                <p className="mb-3 text-[18px] font-medium text-tb-ink-purple">
                  {t("activity.passcodePrompt")}
                </p>
                <input
                  type="password"
                  value={passcode}
                  data-testid="activity-passcode-input"
                  aria-label={t("activity.passcodePrompt")}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="mb-3 h-[56px] w-full rounded-[8px] border-2 border-tb-purple/30 px-4 text-[22px] text-tb-purple outline-none"
                />
                {passcodeError && (
                  <p className="mb-3 text-[16px] font-bold text-red-600" data-testid="activity-passcode-error">
                    {passcodeError}
                  </p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    data-testid="activity-passcode-submit"
                    onClick={handlePasscodeSubmit}
                    className="min-h-[44px] rounded-full bg-tb-purple px-8 py-2 text-[18px] font-bold uppercase text-tb-surface"
                  >
                    {t("activity.confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPasscodeInput(false)}
                    className="min-h-[44px] rounded-full border-2 border-tb-purple px-8 py-2 text-[18px] font-bold uppercase text-tb-purple"
                  >
                    {t("activity.cancel")}
                  </button>
                </div>
              </div>
            )}

            {/* px-8: the three Archivo Black 20 px labels share the 724 px
                row on one line (≈670 px); px-10 wrapped two of them. */}
            <div className="flex justify-between gap-[16px]">
              <button
                type="button"
                data-testid="activity-logout"
                onClick={() => setShowLogoutConfirm(true)}
                className="min-h-[44px] rounded-full bg-red-600 px-8 py-4 text-[20px] font-black uppercase text-white"
              >
                {t("activity.logout")}
              </button>
              {onReloadResources && (
                <button
                  type="button"
                  data-testid="activity-reload-resources"
                  onClick={onReloadResources}
                  className="min-h-[44px] rounded-full bg-tb-purple px-8 py-4 text-[20px] font-black uppercase text-tb-surface"
                >
                  {t("activity.reloadResources")}
                </button>
              )}
              <button
                type="button"
                data-testid="activity-close"
                onClick={onClose}
                className="min-h-[44px] rounded-full border-2 border-tb-purple px-8 py-4 text-[20px] font-black uppercase text-tb-purple"
              >
                {t("activity.close")}
              </button>
            </div>

            {showLogoutConfirm && (
              <div className="absolute inset-0 flex items-center justify-center rounded-[16px] bg-tb-ink-purple/70" data-testid="activity-logout-confirm">
                <div className="w-[560px] rounded-[16px] bg-tb-surface p-[40px] text-center">
                  <h3 className="tb-display mb-4 text-[28px] text-tb-purple">
                    {t("activity.logoutConfirmTitle")}
                  </h3>
                  <p className="mb-8 text-[18px] text-tb-ink-purple">
                    {t("activity.logoutConfirmBody")}
                  </p>
                  <div className="flex justify-center gap-4">
                    <button
                      type="button"
                      data-testid="activity-logout-yes"
                      onClick={handleLogoutConfirm}
                      className="min-h-[44px] rounded-full bg-red-600 px-8 py-3 text-[18px] font-bold uppercase text-white"
                    >
                      {t("activity.logoutYes")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowLogoutConfirm(false)}
                      className="min-h-[44px] rounded-full border-2 border-tb-purple px-8 py-3 text-[18px] font-bold uppercase text-tb-purple"
                    >
                      {t("activity.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
    </div>
  );
}
