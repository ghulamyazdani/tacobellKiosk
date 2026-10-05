import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { setLastRefreshFailedAt } from "@cx-sdk/devices/updates/autoUpdate.slice";
import useLoaders, { type BootFailure } from "../../hooks/utils/useLoaders";
import useLongPress from "../../hooks/utils/useLongPress";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import ErrorModal from "../../components/common/ErrorModal";
import ActivityModal from "../../components/activity/ActivityModal";
import tbBell from "../../assets/brand/tb-bell.svg";
import { readBootRefreshState } from "./bootRefresh";

/**
 * Seconds before each automatic retry: 10, 30, 60, then every 60 forever.
 * An unattended kiosk must never give up on boot (Rule 2): after a power cut
 * it usually starts before the router or the backend is reachable, and a
 * Cockpit fix to a config failure is picked up without anyone touching it.
 * Each call inside a boot keeps its own transport timeout/retries; this is
 * the screen-level cadence (≈ one boot burst a minute at most).
 */
const RETRY_DELAYS_S = [10, 30, 60] as const;

const FAILURE_MESSAGE: Record<BootFailure, string> = {
  unavailable: "loading.unavailableBody",
  noLanguage: "loading.configNoLanguage",
  noPipelines: "loading.configNoPipelines",
  noStartText: "loading.configNoStartText",
};

/**
 * Boot screen: runs the P3 resource loader. Success → /start.
 *
 * Failure (P9b) → translated, categorised error dialog with an automatic
 * retry countdown, TRY AGAIN NOW, and an immediate retry when the network
 * comes back. There is no customer exit — there is nothing to exit TO before
 * boot succeeds (the old "Back to registration" opened an un-booted splash).
 * Operators get the splash's hidden 3 s top-left hold → Activity Center
 * (diagnostics, logout). A 401 never reaches the dialog for long: the
 * transport's recoverFromAuthFailure clears the token and reloads to "/".
 *
 * Refresh mode (P9e, route state from the splash, see bootRefresh.ts): the
 * kiosk already has working data, so a failed refresh goes straight back to
 * /start on it (the boot committed nothing). There is no dialog, no ladder
 * and no reconnect retry; the splash backs off before trying again.
 */
export default function LoadingResources() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  // Router state lives in history.state: fixed while mounted, kept on reload.
  const refresh = readBootRefreshState(useLocation().state);
  const { LoadResourcesInitially } = useLoaders();
  const isOnline = useNetworkStatus();
  const [failure, setFailure] = useState<BootFailure | null>(null);
  const [retryIn, setRetryIn] = useState(0);
  const [activityOpen, setActivityOpen] = useState(false);
  const startedRef = useRef(false);
  const runningRef = useRef(false);
  const failuresRef = useRef(0);
  const mountedRef = useRef(false);

  /** Starts a boot unless one is running (countdown, reconnect and a tap can coincide). */
  const runBoot = () => {
    if (runningRef.current) return;
    runningRef.current = true;
    void LoadResourcesInitially(
      (reason) => {
        runningRef.current = false;
        if (refresh) {
          // The stamp spaces the splash's next scheduled attempt, so it is
          // recorded even if this screen is gone, and BEFORE the navigate:
          // the splash must mount already backing off.
          dispatch(setLastRefreshFailedAt(Date.now()));
          captureKioskEvent(KioskEventName.ErrorOccurred, {
            source: "boot_refresh",
            trigger: refresh.trigger,
            failure: reason,
          });
          if (mountedRef.current) navigate("/start");
          return;
        }
        if (!mountedRef.current) return;
        const step = Math.min(failuresRef.current, RETRY_DELAYS_S.length - 1);
        failuresRef.current += 1;
        setRetryIn(RETRY_DELAYS_S[step]);
        setFailure(reason);
      },
      () => {
        runningRef.current = false;
        if (mountedRef.current) navigate("/start");
      }
    );
  };

  /** Back to "Preparing your kiosk…" and boot again. */
  const retry = () => {
    setFailure(null);
    runBoot();
  };

  useEffect(() => {
    mountedRef.current = true;
    // StrictMode re-runs mount effects; the boot fan-out must run once.
    if (!startedRef.current) {
      startedRef.current = true;
      runBoot();
    }
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot boot
  }, []);

  // Countdown → automatic retry: one 1 s timeout per tick, re-armed by the
  // tick's own state change, cleared on unmount and when a retry starts.
  // State is only written in timer callbacks (house react-hooks rules forbid
  // set-state-in-effect).
  useEffect(() => {
    if (!failure) return;
    const id = window.setTimeout(() => {
      if (retryIn > 1) setRetryIn(retryIn - 1);
      else retry();
    }, 1000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retry is re-created each render; this re-runs every tick anyway
  }, [failure, retryIn]);

  // Reconnect → retry now instead of waiting out the countdown. Keyed on
  // isOnline alone, so a NEW failure still waits its countdown.
  useEffect(() => {
    if (!isOnline || !failure) return;
    const id = window.setTimeout(retry, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the offline→online edge only (see above)
  }, [isOnline]);

  // Hidden operator gesture (StartScreen's): hold the top-left corner 3 s.
  const activityLongPress = useLongPress(
    () => setActivityOpen(true),
    () => {},
    { delay: 3000, shouldPreventDefault: true }
  );

  return (
    <div
      data-testid="loading-resources"
      className="relative flex h-[1920px] w-[1080px] flex-col items-center justify-center gap-10 bg-tb-purple"
    >
      <img alt="Taco Bell" src={tbBell} className="h-[110px]" />
      {!failure && (
        <>
          <div className="h-[8px] w-[520px] overflow-hidden rounded-full bg-tb-surface/20">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-tb-pink" />
          </div>
          <p className="text-2xl text-tb-cream">{t("loading.preparing")}</p>
        </>
      )}
      {/* Hidden while the Activity Center (z-50) is open, or it would cover it. */}
      {failure && !activityOpen && (
        <ErrorModal
          testId="loading-error"
          title={t(
            failure === "unavailable"
              ? "loading.unavailableTitle"
              : "loading.errorTitle"
          )}
          message={t(FAILURE_MESSAGE[failure])}
          note={t("loading.retryIn", { seconds: retryIn })}
          primary={{
            label: t("loading.retryNow"),
            testId: "loading-error-retry",
            onClick: retry,
          }}
        />
      )}
      {/* z-90 clears the error dialog; gone while the Activity Center is
          open, or it would eat taps on that corner of its close backdrop. */}
      {!activityOpen && (
        <div
          data-testid="loading-activity-hotspot"
          aria-hidden
          {...activityLongPress}
          className="absolute left-0 top-0 z-[90] h-[180px] w-[180px]"
        />
      )}
      <ActivityModal
        isOpen={activityOpen}
        onClose={() => setActivityOpen(false)}
      />
    </div>
  );
}
