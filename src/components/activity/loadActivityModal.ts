import type { ComponentType } from "react";
import type { ActivityModalProps } from "./ActivityModal";

export type ActivityModalComponent = ComponentType<ActivityModalProps>;

/** The modal once its code has arrived: every later open renders it at once. */
let loadedModal: ActivityModalComponent | null = null;
let pendingLoad: Promise<ActivityModalComponent | null> | null = null;

export const loadedActivityModal = (): ActivityModalComponent | null => loadedModal;

/**
 * Starts (or joins) the Activity Center's load; null = its code did not
 * arrive (the next open tries again). ActivityModal ships in the ONE lazy UI
 * chunk, bagLazyParts (a separate chunk would grow the boot path — see
 * there). `await import()`, never `.then`: in a build a failed chunk reaches
 * chunkRecovery's reload, which is safe here — only the splash and the boot
 * screen open this, never an order. The dev server rejects instead.
 */
export function loadActivityModal(): Promise<ActivityModalComponent | null> {
  pendingLoad ??= (async () => {
    try {
      const parts: { ActivityModal?: ActivityModalComponent } | undefined =
        await import("../cart/bagLazyParts");
      if (parts?.ActivityModal) return (loadedModal = parts.ActivityModal);
    } catch {
      // Not loaded: ActivityCenter's scrim stays, and closes like the modal.
    }
    pendingLoad = null;
    return null;
  })();
  return pendingLoad;
}
