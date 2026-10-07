import type { ComponentType } from "react";
import { initiateWholeAppUpdate } from "@cx-sdk/devices/updates/autoUpdate.slice";
import { store } from "../../redux/app/store";
import type { ActivityModalProps } from "./ActivityModal";

export type ActivityModalComponent = ComponentType<ActivityModalProps>;

/** The modal once its code has arrived: every later open renders it at once. */
let loadedModal: ActivityModalComponent | null = null;
let pendingLoad: Promise<ActivityModalComponent | null> | null = null;

export const loadedActivityModal = (): ActivityModalComponent | null => loadedModal;

/**
 * Starts (or joins) the Activity Center's load; null = its code did not
 * arrive (ActivityCenter's scrim stays, and closes like the modal).
 * ActivityModal ships in the ONE lazy UI chunk, bagLazyParts (a separate
 * chunk would grow the boot path — see there), so a failure here is the
 * bag's too, and it STICKS for the page's lifetime: Chromium remembers a
 * failed module fetch, so a later import() of it — the next open, the next
 * guest's bag — fails at once without the network. Calls still retry
 * (harmless; a browser that refetches gets it). What heals the page is a
 * reload: chunkRecovery's own on a page that is not itself a fresh reload,
 * else the one flagged here, which the splash applies at its next dwell,
 * between guests (loadPaytmScreen's path). Residual: a guest who taps in
 * before that dwell meets the failed chunk in their bag — the crash screen
 * while the page is under 60 s old, else chunkRecovery's reload (cart kept).
 * `await import()`, never `.then`: in a build a failed chunk reaches
 * chunkRecovery; the dev server rejects instead.
 */
export function loadActivityModal(): Promise<ActivityModalComponent | null> {
  pendingLoad ??= (async () => {
    try {
      const parts: { ActivityModal?: ActivityModalComponent } | undefined =
        await import("../cart/bagLazyParts");
      if (parts?.ActivityModal) return (loadedModal = parts.ActivityModal);
    } catch {
      // The dev server's rejected import.
    }
    pendingLoad = null;
    store.dispatch(initiateWholeAppUpdate());
    return null;
  })();
  return pendingLoad;
}
