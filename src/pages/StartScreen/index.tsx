import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { emptyCart } from "@cx-sdk/ordering/state/cart.slice";
import { kiosSettingsRdx } from "@cx-sdk/catalog/state/appSettings.slice";
import { selectPipelines } from "@cx-sdk/catalog/state/pipeline.slice";
import { selectDeploymentDetails } from "@cx-sdk/core/auth/authentication.slice";
import { useGetLoyaltyPartnerMutation } from "@cx-sdk/ordering/services/loyaltyApi";
import {
  isLoyaltyOn,
  setLoyaltyPartner,
} from "@cx-sdk/ordering/state/loyalty.slice";
import {
  selectLastBootAt,
  selectLastRefreshFailedAt,
  selectShouldBrandUpdate,
  selectShouldWholeAppUpdate,
} from "@cx-sdk/devices/updates/autoUpdate.slice";
import {
  msUntilScheduledRefresh,
  resolveSplashUpdateAction,
} from "@cx-sdk/devices/updates/updatePolicy";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import useLongPress from "../../hooks/utils/useLongPress";
import useSessionReset from "../../hooks/utils/useSessionReset";
import useLoyalty from "../../hooks/loyalty/useLoyalty";
import usePaytmSessionRelease from "../../hooks/paymentsHooks/usePaytmSessionRelease";
import useCartIndexedDb from "../../hooks/cartHooks/useCartIndexedDb";
import useAutoUpdate from "../../hooks/autoUpdates/useAutoUpdate";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import ActivityCenter from "../../components/activity/ActivityCenter";
import UpdateCountdownModal from "../../components/autoUpdate/UpdateCountdownModal";
import { ErrorBoundary } from "../../ErrorBoundary";
import type {
  BootRefreshState,
  BootRefreshTrigger,
} from "../LoadingResources/bootRefresh";
import SplashMedia, { SplashWelcome } from "./SplashMedia";

/**
 * While the scheduled boot refresh is not yet due, re-read the wall clock at
 * least this often: a timer runs on the monotonic clock, so an NTP/RTC jump
 * would otherwise move the due instant unseen.
 */
const BOOT_REFRESH_RECHECK_MS = 15 * 60 * 1000;

/**
 * Attract/splash screen, laid out in design pixels on the 1080×1920
 * KioskStage. Content is the getMedia `home_screen` media (SplashMedia: none →
 * WELCOME 1:5617, one → full-bleed 1:5604, several → carousel 1:2203). The
 * whole screen is one tap target (kiosk convention); its accessible name is
 * the visible copy of whichever layout is showing. It is also the ONLY place
 * updates apply (P9e), which is what keeps them from ever landing mid-order.
 */
export default function StartScreen() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [activityOpen, setActivityOpen] = useState(false);
  const { resetSession } = useSessionReset();
  const { checkAndRevokeLoyaltyReward } = useLoyalty();
  const releasePaytmSession = usePaytmSessionRelease();
  const { clearIndexedDbCart } = useCartIndexedDb();

  // True only while the splash is on screen — gates the late re-empty below.
  const onSplashRef = useRef(false);
  useEffect(() => {
    onSplashRef.current = true;
    return () => {
      onSplashRef.current = false;
    };
  }, []);

  // SESSION TEARDOWN OWNER (fork parity: StartOverResourceLoading on mount).
  // Every exit to the splash — idle timeout, START AGAIN, the /second and
  // /phone footer cancels, NotFound — only navigates here; this mount ends
  // the session. Never reset-then-navigate from a screen with guard effects
  // (hazard H1): RR7's BrowserRouter runs navigate inside startTransition, so
  // the emptied store renders on the OLD route first and the /cart, /tent,
  // /payment, /forYou, /customization guards re-navigate to /menu instead.
  // Callers that already reset (Menu/CustomerName cancel, OrderSuccess) are
  // harmless: their reset cleared the claim, so the revoke below no-ops.
  // Ref-latched: StrictMode re-runs mount effects with the SAME closure (claim
  // still set), which would otherwise fire undoRewardRedemption twice.
  const didTeardownRef = useRef(false);
  useEffect(() => {
    if (didTeardownRef.current) return;
    didTeardownRef.current = true;
    // Revoke FIRST — it reads the claimed coupon from this render's closure,
    // which the reset wipes. Fire-and-forget: a dead xeno.in must never hold
    // the splash (Rule 2).
    checkAndRevokeLoyaltyReward().catch(() => {});
    // P8b-12: a Paytm session still open (unknown panel → FINISH, idle on an
    // end panel, crash recovery, relaunch) gets one status read — and an EDC
    // void only after a fresh "pending" — built from the store NOW, before
    // the reset empties the payment slice. Fire-and-forget, never throws.
    releasePaytmSession();
    resetSession("full");
    // Reload race: a relaunch lands on "/" and is redirected here one
    // transition commit later, so AppRoutes' Dexie rehydrate may already be
    // reading the previous customer's rows and dispatch them AFTER the reset
    // above. IndexedDB starts overlapping transactions in creation order, so
    // this clear commits only after that read — emptying redux then is
    // ordered after the rehydrate's dispatch (no timer).
    void clearIndexedDbCart().then(() => {
      if (onSplashRef.current) dispatch(emptyCart());
    });
  }, [
    checkAndRevokeLoyaltyReward,
    releasePaytmSession,
    resetSession,
    clearIndexedDbCart,
    dispatch,
  ]);

  // Loyalty that degraded at boot (P9b, R6) is retried HERE: TB boots only
  // after registration — a relaunch with a token lands straight on /start —
  // so "the next boot" would mean re-registering. Once per splash visit while
  // enabled-but-off, bounded by the transport's 10 s; applied only while the
  // splash is still up, so loyalty never switches on under a guest mid-order.
  const loyaltyEnabled = Boolean(useSelector(kiosSettingsRdx)?.enable_loyalty);
  const loyaltyOn = Boolean(useSelector(isLoyaltyOn));
  const deploymentId = useSelector(selectDeploymentDetails)?._id;
  const [getLoyaltyPartner] = useGetLoyaltyPartnerMutation();
  const didRetryLoyaltyRef = useRef(false);
  useEffect(() => {
    if (didRetryLoyaltyRef.current || !loyaltyEnabled || loyaltyOn) return;
    didRetryLoyaltyRef.current = true;
    getLoyaltyPartner({ deployment_id: deploymentId })
      .unwrap()
      .then((partner: unknown) => {
        if (partner && onSplashRef.current) dispatch(setLoyaltyPartner(partner));
      })
      .catch(() =>
        captureKioskEvent(KioskEventName.ErrorOccurred, {
          source: "loyalty_partner",
          stage: "splash_retry",
        })
      );
  }, [loyaltyEnabled, loyaltyOn, deploymentId, getLoyaltyPartner, dispatch]);

  // UPDATE APPLY (P9e). Pending, by precedence: a new build (whole_app), an
  // FCM brand push (brand), boot data older than BOOT_DATA_MAX_AGE_MS or a
  // refresh (any trigger) that failed since the last good boot (scheduled,
  // D1, 30 min after the failure). Armed only while online — a refresh would
  // fail and burn its backoff, an ack would be lost — and with the Activity
  // Center closed.
  // The dwell is a CHILD mounted only while armed: a guest tap leaves for
  // /second and its unmount defers the update to the next splash visit.
  const shouldWholeAppUpdate = Boolean(useSelector(selectShouldWholeAppUpdate));
  const shouldBrandUpdate = Boolean(useSelector(selectShouldBrandUpdate));
  const lastBootAt = useSelector(selectLastBootAt);
  const lastRefreshFailedAt = useSelector(selectLastRefreshFailedAt);
  const hasPipelines = Boolean(useSelector(selectPipelines)?.length);
  const isOnline = useNetworkStatus();
  const { updateDeviceUpdateStatus, applyWholeAppUpdate } = useAutoUpdate();

  // The D1 clock: `now` advances ONLY from this timer, so render stays pure.
  // It fires at the due instant, or within 15 min to notice a clock jump; a
  // due refresh (0) needs no timer — only a new boot stamp un-stales it.
  const [now, setNow] = useState(() => Date.now());
  const refreshInMs = msUntilScheduledRefresh(
    lastBootAt,
    lastRefreshFailedAt,
    now
  );
  useEffect(() => {
    if (refreshInMs === 0) return;
    const id = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(refreshInMs, BOOT_REFRESH_RECHECK_MS)
    );
    return () => window.clearTimeout(id);
  }, [refreshInMs]);

  const kind = isOnline
    ? resolveSplashUpdateAction({
        shouldWholeAppUpdate,
        shouldBrandUpdate,
        bootDataStale: refreshInMs === 0,
      })
    : null;

  // Refresh mode: a failed refresh returns here on the old data. With no
  // pipelines there is no old data worth keeping, so a NORMAL boot (its
  // retry ladder) heals an evicted-storage kiosk instead (OV4).
  const startRefresh = (trigger: BootRefreshTrigger) =>
    navigate(
      "/LoadingResources",
      hasPipelines
        ? { state: { refresh: true, trigger } satisfies BootRefreshState }
        : undefined
    );

  // Latched, so the apply runs once and "Updating…" stays up even after the
  // brand ack lowers its flag: that store update renders on THIS route
  // before the navigation transition commits (hazard H1). No reset here —
  // this mount's teardown already ended the session.
  const [applying, setApplying] = useState(false);
  const applyUpdate = () => {
    if (applying || kind === null) return;
    setApplying(true);
    captureKioskEvent(KioskEventName.UpdateTriggered, { update_type: kind });
    if (kind === "whole_app") return applyWholeAppUpdate();
    // Fire-and-forget (OV2): the flag drops synchronously; the ack retries in
    // the background (≤ ~31 s) and must never hold the splash.
    if (kind === "brand") void updateDeviceUpdateStatus();
    startRefresh(kind);
  };
  const counting = applying || (kind !== null && !activityOpen);

  // Hidden operator gesture: press-and-hold the top-left corner for 3s to
  // open the Activity Center (diagnostics). Deliberately invisible; a short
  // tap on the hotspot falls through to nothing (not to start-order) so the
  // corner cannot mis-trigger an order start during servicing.
  const activityLongPress = useLongPress(
    () => setActivityOpen(true),
    () => {},
    { delay: 3000, shouldPreventDefault: true }
  );

  return (
    <div className="relative h-[1920px] w-[1080px]">
    <button
      type="button"
      data-testid="start-screen"
      onClick={() => navigate("/second")}
      className="relative isolate block h-full w-full cursor-pointer overflow-hidden bg-tb-purple text-left"
    >
      {/* `isolate`: nothing in the media layer can stack over the z-20
          operator hotspot (a sibling). A decorative crash shows WELCOME in
          place — never the global crash screen — and this tap still works. */}
      <ErrorBoundary fallback={<SplashWelcome />}>
        <SplashMedia />
      </ErrorBoundary>
    </button>
    <div
      data-testid="activity-hotspot"
      aria-hidden
      {...activityLongPress}
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 top-0 z-20 h-[180px] w-[180px]"
    />
    <ActivityCenter
      isOpen={activityOpen}
      onClose={() => setActivityOpen(false)}
      onReloadResources={() => startRefresh("operator")}
    />
    {counting && <UpdateCountdownModal onElapsed={applyUpdate} />}
    </div>
  );
}
