/**
 * Recovery for a failed dynamic import.
 *
 * The app code-splits one `React.lazy` chunk (BagSheet's bagLazyParts: the
 * CompleteYourMealRail, the offers buy stage and celebration) plus two
 * optional runtime chunks (fcmRuntime, posthogRuntime — exempt below), so
 * code can be fetched from the network at the moment a customer taps. On a
 * kiosk the dangerous case is a deploy: the
 * device has been running for hours against an old index.html, the origin now
 * serves re-hashed chunk files, and the next tap requests a filename that no
 * longer exists. `React.lazy` rejects, React 19
 * memoizes that rejection for the life of the page, and the component is dead
 * until someone reboots the terminal.
 *
 * Vite already dispatches `vite:preloadError` for exactly this and nothing was
 * listening. Reloading re-fetches index.html and picks up the current build.
 *
 * Reloading mid-order is safe here: the cart lives in Dexie and is rehydrated
 * exactly once per page load by the ref-guarded `useCartHook().syncCartOnReLoad()`
 * mount effect in `src/routes/AppRoutes.tsx` (P7a, contract E), so the customer
 * keeps their items; the never-persisted menu is refetched by /menu's own
 * mount (P9b).
 */

/**
 * If this page load is ITSELF a recent reload, a second reload would loop —
 * which on an unattended kiosk means a permanently cycling screen. Time-boxed
 * rather than stored, deliberately: this runs before the store exists, and
 * CLAUDE.md Rule 3 forbids reaching for sessionStorage directly.
 */
const RELOAD_LOOP_WINDOW_MS = 60_000;

/** How long the crash screen stays up after a crash on a healthy page. */
const CRASH_RECOVERY_DELAY_MS = 10_000;

const isRetryOfAReload = (): boolean => {
  const [navigation] = performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];
  return (
    navigation?.type === "reload" && performance.now() < RELOAD_LOOP_WINDOW_MS
  );
};

/**
 * Where (and how soon) the app ErrorBoundary reloads to. A crash this soon
 * after a page load is probably a loop: wait a full window, then re-boot with
 * fresh settings instead of reloading straight back into it — at most one
 * cycle a minute. A crash ON the boot screen re-boots too: /start would skip
 * the boot that never finished (the hole P9b closed on /LoadingResources).
 * Otherwise /start, whose mount ends the session.
 * ponytail: time-boxed, not stored (Rule 3, same trade as above) — a
 * deterministic crash cycles at ≤1/min forever rather than stopping on a dead
 * screen. Upgrade: a persisted crash counter if telemetry ever shows loops.
 */
export const planCrashRecovery = (
  pageAgeMs = performance.now(),
  currentPath = window.location.pathname,
) =>
  pageAgeMs < RELOAD_LOOP_WINDOW_MS || currentPath === "/LoadingResources"
    ? { path: "/LoadingResources", delayMs: RELOAD_LOOP_WINDOW_MS }
    : { path: "/start", delayMs: CRASH_RECOVERY_DELAY_MS };

/** Full page load to `path` — the Router is gone once the boundary trips. */
export const reloadTo = (path: string): void => window.location.replace(path);

export const installChunkErrorRecovery = (): void => {
  window.addEventListener("vite:preloadError", (event) => {
    // Stops Vite rethrowing into the app-level ErrorBoundary, which would show
    // the crash screen instead of quietly recovering.
    event.preventDefault();

    // FCM (P9e) and analytics (P9f) are optional: their lazy chunks
    // (src/hooks/firebase/fcmRuntime.ts → assets/fcmRuntime-<hash>.js,
    // src/utils/analytics/posthogRuntime.ts → assets/posthogRuntime-<hash>.js;
    // the browser's message names the URL) must never reload the kiosk, least
    // of all mid-order. Prevented, import() resolves undefined:
    // useFcmRegistration reports fcm_init "import" and FCM stays off, and
    // startAnalytics leaves analytics off, until the next page load.
    if (/fcmRuntime|posthogRuntime/.test(String(event.payload?.message))) return;

    if (isRetryOfAReload()) {
      // Reloading again would cycle. Let the rejection surface instead: the
      // ErrorBoundary then retries no faster than once a minute
      // (planCrashRecovery), and a slow cycle beats a fast one.
      console.error(
        "[chunkRecovery] chunk preload failed again after a reload — not retrying",
        event.payload,
      );
      return;
    }

    console.error(
      "[chunkRecovery] chunk preload failed; reloading to pick up the current build",
      event.payload,
    );
    window.location.reload();
  });
};
