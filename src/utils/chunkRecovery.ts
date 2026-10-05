/**
 * Recovery for a failed dynamic import.
 *
 * The app code-splits with `React.lazy` in ~16 files, so some components are
 * fetched from the network at the moment a customer taps. On a kiosk the
 * dangerous case is a deploy: the device has been running for hours against an
 * old index.html, the origin now serves re-hashed chunk files, and the next tap
 * requests a filename that no longer exists. `React.lazy` rejects, React 19
 * memoizes that rejection for the life of the page, and the component is dead
 * until someone reboots the terminal.
 *
 * Vite already dispatches `vite:preloadError` for exactly this and nothing was
 * listening. Reloading re-fetches index.html and picks up the current build.
 *
 * Reloading mid-order is safe here: the cart lives in Dexie and is rehydrated
 * exactly once per page load by the ref-guarded `useCartHook().syncCartOnReLoad()`
 * mount effect in `src/routes/AppRoutes.tsx` (P7a, contract E), so the customer
 * keeps their items.
 */

/**
 * If this page load is ITSELF a recent reload, a second reload would loop —
 * which on an unattended kiosk means a permanently cycling screen. Time-boxed
 * rather than stored, deliberately: this runs before the store exists, and
 * CLAUDE.md Rule 3 forbids reaching for sessionStorage directly.
 */
const RELOAD_LOOP_WINDOW_MS = 60_000;

const isRetryOfAReload = (): boolean => {
  const [navigation] = performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];
  return (
    navigation?.type === "reload" && performance.now() < RELOAD_LOOP_WINDOW_MS
  );
};

export const installChunkErrorRecovery = (): void => {
  window.addEventListener("vite:preloadError", (event) => {
    // Stops Vite rethrowing into the app-level ErrorBoundary, which would show
    // the untranslated developer crash card instead of quietly recovering.
    event.preventDefault();

    if (isRetryOfAReload()) {
      // Reloading again would cycle. Let the rejection surface instead: the
      // ErrorBoundary card is a bad outcome, but a looping kiosk is worse.
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
