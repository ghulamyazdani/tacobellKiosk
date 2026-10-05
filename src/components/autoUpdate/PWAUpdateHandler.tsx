import { useEffect, useRef } from "react";
import useAutoUpdate from "../../hooks/autoUpdates/useAutoUpdate";
import useAuthHook from "../../hooks/utils/useAuthHook";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";
import {
  DEFAULT_UPDATE_POLICY_CONFIG,
  buildStorageDiagnostics,
  computeFailureBackoffMs,
  isInstalledUpdateReady,
  isRecoverableStorageErrorName,
  isTerminalWorkerState,
  isWaitingUpdateReady,
  shouldAttemptStorageRecovery,
  shouldDeferCheckForInFlightInstall,
  shouldReportUpdateFailure,
  shouldSkipCheckWhileOffline,
  withJitter,
  type ServiceWorkerStorageDiagnostics,
} from "@cx-sdk/devices/updates/updatePolicy";

/**
 * All poll cadence / backoff / recovery-gate policy now lives in
 * `@cx-sdk/devices/updates/updatePolicy` (extracted verbatim). This component
 * keeps ONLY the service-worker mechanics: registration lookup and scope
 * matching, listener lifecycle, timers, navigator/window reads and analytics.
 */
const POLICY_CONFIG = DEFAULT_UPDATE_POLICY_CONFIG;

/** The app's own service worker, as registered by vite-plugin-pwa. */
const APP_SW_URL = "/sw.js";

/**
 * Module-level ownership token for the polling effect.
 *
 * `PWAUpdateHandler` is mounted once (src/App.tsx), but React StrictMode
 * double-invokes effects in development and a future refactor could mount this
 * twice. Two concurrent pollers would double the update traffic and could race
 * `attemptStorageRecovery`, so only the first effect to claim the token polls.
 */
let activePollerToken: symbol | null = null;

/**
 * Errors raised by Chromium when the service-worker script cache or storage
 * layer cannot be read or written. The `DOMException` guard stays here (it is
 * a platform global, not available to the platform-neutral policy engine); the
 * name classification is the engine's.
 */
function isRecoverableStorageError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }
  return isRecoverableStorageErrorName(error.name);
}

/**
 * Asks the browser to exempt this origin from quota eviction.
 *
 * Chromium's quota manager purges an origin's storage *completely* once the
 * disk drops below roughly max(1GB, 1%) free, which wipes the service-worker
 * script cache out from under a running kiosk and produces exactly the
 * "Failed to access storage." failure above. Persisted origins are skipped by
 * eviction. Chrome grants or denies this silently for installed PWAs (no user
 * prompt), so it is safe to call unattended and is best-effort only.
 */
async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator.storage?.persist !== "function") {
      return;
    }
    const alreadyPersisted =
      typeof navigator.storage.persisted === "function"
        ? await navigator.storage.persisted()
        : false;
    if (!alreadyPersisted) {
      await navigator.storage.persist();
    }
  } catch {
    // Best-effort only — never allow a diagnostic to affect startup.
  }
}

/**
 * Best-effort storage snapshot attached to failure telemetry, so the ops team
 * can tell a full/evicted profile apart from a corrupted script cache without
 * physically visiting the kiosk. Never throws. This wrapper only reads the
 * `navigator.storage` APIs; the snapshot object itself is assembled by the
 * engine's `buildStorageDiagnostics` with identical key-presence semantics.
 */
async function readStorageDiagnostics(): Promise<ServiceWorkerStorageDiagnostics> {
  let persisted: boolean | undefined;
  try {
    if (typeof navigator.storage?.persisted === "function") {
      persisted = await navigator.storage.persisted();
    }
    if (typeof navigator.storage?.estimate !== "function") {
      return buildStorageDiagnostics({ persisted });
    }
    const { usage, quota } = await navigator.storage.estimate();
    return buildStorageDiagnostics({ persisted, estimate: { usage, quota } });
  } catch {
    // Matches the legacy partial-accumulation behavior: whatever was read
    // before the throw still ships (e.g. persisted() succeeded, estimate()
    // threw).
    return buildStorageDiagnostics({ persisted });
  }
}

/**
 * Watches for a newly deployed build of the kiosk PWA.
 *
 * It does NOT reload the app itself. When a new service worker finishes
 * installing it flags the update in Redux via `setAutoUpdateOnNextStartOver`,
 * and `StartScreen` performs the actual reload once the kiosk is back at the
 * splash screen — so an update can never interrupt a customer mid-order or
 * mid-payment (CLAUDE.md Guardrail Rule 1).
 *
 * This component renders nothing.
 */
export function PWAUpdateHandler(): React.ReactElement {
  const { checkAndUpdateDeviceVersionDeviceWise, setAutoUpdateOnNextStartOver } =
    useAutoUpdate();
  // The app's own token resolution (cookie, else redux), reactive to both:
  // registration dispatches setToken and sets the cookie together.
  const token = useAuthHook().getAuthToken();

  // `useAutoUpdate` returns fresh function identities on every render. Holding
  // the latest ones in refs lets the effects below run exactly once for the
  // lifetime of the component while still invoking current code.
  const setAutoUpdateOnNextStartOverRef = useRef(setAutoUpdateOnNextStartOver);
  const checkDeviceVersionRef = useRef(checkAndUpdateDeviceVersionDeviceWise);
  // Latest-ref pattern, updated in an effect (react-hooks/refs forbids
  // writing refs during render). Poll timers only read these later, so
  // after-render assignment is equivalent.
  useEffect(() => {
    setAutoUpdateOnNextStartOverRef.current = setAutoUpdateOnNextStartOver;
    checkDeviceVersionRef.current = checkAndUpdateDeviceVersionDeviceWise;
  });

  // D8: report this build's version only once the device HAS a token — never
  // "Bearer undefined" from Registration — and right after registration,
  // without waiting for the next reload. Once per token per page load:
  // StrictMode's double-invoked effect would otherwise POST twice (the
  // persisted version is still unrecorded while the first POST is in flight);
  // a new token (re-registration without a reload) reports again.
  const reportedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!token || reportedForRef.current === token) {
      return;
    }
    reportedForRef.current = token;
    void Promise.resolve(checkDeviceVersionRef.current()).catch(() => {
      // `useAutoUpdate` never rejects; this guard only stops a future
      // refactor from turning the report into an unhandled rejection.
    });
  }, [token]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // StrictMode / double-mount guard: only one poller per document.
    const token = Symbol("pwa-update-poller");
    if (activePollerToken !== null) {
      return;
    }
    activePollerToken = token;

    const appScope = `${window.location.origin}/`;

    let cancelled = false;
    let pollTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let registration: ServiceWorkerRegistration | undefined;
    let consecutiveFailures = 0;
    let recoveryAttempts = 0;
    let updateFlagged = false;

    // Every listener we attach is tracked so it can be detached again. A kiosk
    // runs for days on one page load, so a leaked listener is a real memory
    // leak (CLAUDE.md Guardrail Rule 5).
    const workerStateListeners = new Map<ServiceWorker, () => void>();
    let detachUpdateFound: (() => void) | undefined;

    /** Flags the update for `StartScreen` to apply at the next splash. */
    const flagUpdateAvailable = (): void => {
      if (cancelled || updateFlagged) {
        return;
      }
      updateFlagged = true;
      setAutoUpdateOnNextStartOverRef.current();
    };

    const watchInstallingWorker = (worker: ServiceWorker | null): void => {
      if (!worker || cancelled || workerStateListeners.has(worker)) {
        return;
      }

      const handleStateChange = (): void => {
        if (
          isInstalledUpdateReady(
            worker.state,
            navigator.serviceWorker.controller !== null,
          )
        ) {
          flagUpdateAvailable();
        }
        if (isTerminalWorkerState(worker.state)) {
          worker.removeEventListener("statechange", handleStateChange);
          workerStateListeners.delete(worker);
        }
      };

      worker.addEventListener("statechange", handleStateChange);
      workerStateListeners.set(worker, handleStateChange);
    };

    const detachRegistrationListeners = (): void => {
      detachUpdateFound?.();
      detachUpdateFound = undefined;
      workerStateListeners.forEach((handler, worker) => {
        worker.removeEventListener("statechange", handler);
      });
      workerStateListeners.clear();
    };

    const attachRegistrationListeners = (
      appRegistration: ServiceWorkerRegistration,
    ): void => {
      const handleUpdateFound = (): void => {
        watchInstallingWorker(appRegistration.installing);
      };

      appRegistration.addEventListener("updatefound", handleUpdateFound);
      detachUpdateFound = (): void => {
        appRegistration.removeEventListener("updatefound", handleUpdateFound);
      };

      // An update may already be in flight or waiting from before we mounted
      // (registerSW.js registers on window load, which itself triggers an
      // update check). Without this the kiosk would miss that update entirely.
      watchInstallingWorker(appRegistration.installing);
      if (
        isWaitingUpdateReady(
          appRegistration.waiting !== null,
          navigator.serviceWorker.controller !== null,
        )
      ) {
        flagUpdateAvailable();
      }
    };

    /**
     * Resolves the registration for THIS app's service worker (`/sw.js`,
     * scope `/`).
     *
     * Scope must be matched exactly. Firebase Cloud Messaging registers a
     * SECOND worker on the same origin at
     * `/firebase-cloud-messaging-push-scope`, and the previous
     * `scope.includes(window.location.origin)` check matched both — whichever
     * `getRegistrations()` happened to return first won. On boots where that
     * was the Firebase worker, the kiosk polled the wrong registration and
     * could never detect an app update at all.
     */
    const resolveAppRegistration = async (): Promise<
      ServiceWorkerRegistration | undefined
    > => {
      const direct = await navigator.serviceWorker.getRegistration(appScope);
      if (direct && direct.scope === appScope) {
        return direct;
      }
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.find((candidate) => candidate.scope === appScope);
    };

    /**
     * Rebuilds the registration after repeated recoverable storage failures.
     *
     * A "Failed to access storage." update failure means the registration
     * points at a script-cache entry the browser can no longer read. Chromium
     * does NOT self-heal this on the update path — unlike the LevelDB path it
     * never calls `ScheduleDeleteAndStartOver`, and the corrupt-data
     * `ForceDelete` lives only on the worker-START path. So on a kiosk that
     * never restarts Chrome, every subsequent update check fails forever and
     * the device silently stops receiving new builds while looking perfectly
     * healthy. Unregistering and re-registering rebuilds the script cache and
     * is the only escape without a full browser restart.
     *
     * Only runs at the splash screen, so the worker is never swapped while a
     * customer has an order or a payment in progress. Cache Storage is not
     * touched by `unregister()`, so the precached shell survives.
     */
    const attemptStorageRecovery = async (): Promise<boolean> => {
      recoveryAttempts += 1;
      try {
        detachRegistrationListeners();
        if (registration) {
          await registration.unregister();
        }
        registration = undefined;
        if (cancelled) {
          return false;
        }

        const fresh = await navigator.serviceWorker.register(APP_SW_URL, {
          scope: appScope,
        });
        if (cancelled) {
          return false;
        }

        registration = fresh;
        attachRegistrationListeners(fresh);
        consecutiveFailures = 0;

        captureKioskEvent(KioskEventName.ErrorOccurred, {
          error_source: "pwa_service_worker_recovery",
          recovery_attempt: recoveryAttempts,
          recovered: true,
        });
        return true;
      } catch (error) {
        captureKioskEvent(KioskEventName.ErrorOccurred, {
          error_source: "pwa_service_worker_recovery",
          recovery_attempt: recoveryAttempts,
          recovered: false,
          error_name: error instanceof Error ? error.name : "UnknownError",
          error_message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    };

    /**
     * Structured, rate-limited failure report.
     *
     * This repo has no `logger` module (see the fix notes) — `captureKioskEvent`
     * is the only structured observability primitive, and it is itself
     * try/catch-wrapped and a no-op when PostHog is not initialised.
     */
    const reportFailure = async (error: unknown): Promise<void> => {
      if (!shouldReportUpdateFailure(consecutiveFailures, POLICY_CONFIG)) {
        return;
      }

      const diagnostics = await readStorageDiagnostics();
      if (cancelled) {
        return;
      }

      captureKioskEvent(KioskEventName.ErrorOccurred, {
        error_source: "pwa_service_worker_update",
        error_name: error instanceof Error ? error.name : "UnknownError",
        error_message: error instanceof Error ? error.message : String(error),
        recoverable: isRecoverableStorageError(error),
        consecutive_failures: consecutiveFailures,
        is_online: navigator.onLine,
        ...diagnostics,
      });
    };

    const scheduleNextPoll = (delayMs: number): void => {
      if (cancelled) {
        return;
      }
      pollTimeoutId = setTimeout(() => {
        void runUpdateCheck();
      }, withJitter(delayMs, POLICY_CONFIG));
    };

    /**
     * One update check. Self-scheduling via `setTimeout` rather than
     * `setInterval`, so two checks can never be in flight at once. Chromium
     * coalesces concurrent same-scope `update()` calls onto one job but
     * replays that job's result to every queued callback, so overlapping calls
     * turn a single storage failure into an unbounded number of identical
     * rejections — which is precisely what made this the top reported error.
     */
    const runUpdateCheck = async (): Promise<void> => {
      if (cancelled) {
        return;
      }

      // Nothing to do while the device is offline. Retry at the normal cadence
      // without counting it as a failure.
      if (shouldSkipCheckWhileOffline(navigator.onLine)) {
        scheduleNextPoll(POLICY_CONFIG.basePollIntervalMs);
        return;
      }

      try {
        if (!registration) {
          registration = await resolveAppRegistration();
          if (cancelled) {
            return;
          }
          if (registration) {
            attachRegistrationListeners(registration);
          }
        }

        if (!registration) {
          // The worker may not have registered yet (registerSW.js runs on
          // window load). Retry instead of giving up forever, otherwise the
          // kiosk would never auto-update again for this page's lifetime.
          scheduleNextPoll(POLICY_CONFIG.basePollIntervalMs);
          return;
        }

        if (
          shouldDeferCheckForInFlightInstall(
            registration.installing !== null,
            registration.waiting !== null,
          )
        ) {
          scheduleNextPoll(POLICY_CONFIG.basePollIntervalMs);
          return;
        }

        await registration.update();
        consecutiveFailures = 0;
        scheduleNextPoll(POLICY_CONFIG.basePollIntervalMs);
      } catch (error) {
        // Nothing may escape this catch. An un-caught rejection here becomes
        // an unhandled promise rejection, which posthog-js exception
        // autocapture reports as a top-level DOMException.
        consecutiveFailures += 1;
        await reportFailure(error);

        if (cancelled) {
          return;
        }

        const shouldRecover = shouldAttemptStorageRecovery(
          {
            errorIsRecoverable: isRecoverableStorageError(error),
            consecutiveFailures,
            recoveryAttempts,
            isOnline: navigator.onLine,
            currentPath: window.location.pathname,
          },
          POLICY_CONFIG,
        );

        if (shouldRecover && (await attemptStorageRecovery())) {
          scheduleNextPoll(POLICY_CONFIG.basePollIntervalMs);
          return;
        }

        if (cancelled) {
          return;
        }

        const backoffMs = computeFailureBackoffMs(
          consecutiveFailures,
          POLICY_CONFIG,
        );
        scheduleNextPoll(backoffMs);
      }
    };

    void requestPersistentStorage();
    void runUpdateCheck();

    return () => {
      cancelled = true;
      if (pollTimeoutId !== undefined) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = undefined;
      }
      detachRegistrationListeners();
      if (activePollerToken === token) {
        activePollerToken = null;
      }
    };
  }, []);

  return <></>;
}
