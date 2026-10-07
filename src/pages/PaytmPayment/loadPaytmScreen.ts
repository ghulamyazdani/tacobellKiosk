import type { ComponentType } from "react";
import { initiateWholeAppUpdate } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { store } from "../../redux/app/store";
import { captureKioskEvent, KioskEventName } from "../../utils/analytics";

export type PaytmScreen = ComponentType;

/** The screen once its chunk has arrived: every later caller gets it at once. */
let loadedScreen: PaytmScreen | null = null;
let pendingLoad: Promise<PaytmScreen | null> | null = null;

export const loadedPaytmScreen = (): PaytmScreen | null => loadedScreen;

/**
 * The /paymentPolling screen's lazy chunk (paytmRuntime, P8b × the P9f boot
 * budget). Starts (or joins) the load; never rejects — null = it failed.
 * Callers: usePaytmCheckout awaits it BEFORE an initiate (no money moves
 * without the screen that settles it), PaytmPaymentRoute for a resumed session.
 *
 * A failure STICKS for the page's lifetime: Chromium remembers a failed module
 * fetch, so a later import() of the same URL fails at once without the
 * network. Calls still retry (harmless, and a browser that refetches gets
 * it); what heals the page is the reload flagged here, which the splash
 * applies at its next dwell (the whole-app update path) — never mid-session.
 *
 * `await import()`, NEVER `import().then()` (see trackEvent.ts): in a build a
 * failed chunk fires vite:preloadError, chunkRecovery prevents it WITHOUT a
 * reload (/paytmRuntime/) and the import RESOLVES undefined; the dev server
 * rejects.
 */
export function loadPaytmScreen(): Promise<PaytmScreen | null> {
  pendingLoad ??= (async () => {
    try {
      const chunk: { default?: PaytmScreen } | undefined = await import("./paytmRuntime");
      if (chunk?.default) return (loadedScreen = chunk.default);
    } catch {
      // The dev server's rejected import.
    }
    pendingLoad = null;
    captureKioskEvent(KioskEventName.ErrorOccurred, { error_source: "paytm_chunk" });
    store.dispatch(initiateWholeAppUpdate());
    return null;
  })();
  return pendingLoad;
}
