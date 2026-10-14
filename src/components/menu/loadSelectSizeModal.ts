import type SelectSizeModal from "./SelectSizeModal";

/*
  Select a Size rides the ONE lazy UI chunk (bagLazyParts) — lane walk-oos:
  the out-of-stock work on the eager PDP and bag had to be paid for on the
  boot path (P9f budget). loadPdpLazyParts' pattern: plain state + `await
  import()`, never React.lazy (a prevented `vite:preloadError` resolves the
  import to undefined, and Suspense's reveal timer stalls under a frozen e2e
  clock). The menu starts the load at mount; the chunk is normally warm by
  then (the always-mounted rewards sheet loads it at /menu entry).
*/

type SelectSizeModalComponent = typeof SelectSizeModal;

let loaded: SelectSizeModalComponent | null = null;
let pending: Promise<SelectSizeModalComponent | null> | null = null;

/** Once its code has arrived, every later menu renders it at once. */
export const loadedSelectSizeModal = (): SelectSizeModalComponent | null => loaded;

/** Starts (or joins) the load; null = the code did not arrive (the next menu mount retries). */
export function loadSelectSizeModal(): Promise<SelectSizeModalComponent | null> {
  pending ??= (async () => {
    try {
      const parts: { SelectSizeModal?: SelectSizeModalComponent } | undefined = await import(
        "../cart/bagLazyParts"
      );
      if (parts?.SelectSizeModal) {
        loaded = parts.SelectSizeModal;
        return loaded;
      }
    } catch {
      // The dev server's rejected import (a build resolves undefined instead).
    }
    pending = null;
    return null;
  })();
  return pending;
}
