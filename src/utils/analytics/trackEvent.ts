import posthog from "posthog-js";
import { KioskEventName } from "@cx-sdk/core";

/**
 * Free-form, JSON-serializable properties sent alongside a kiosk event.
 * Never put PII or payment secrets (card tokens, full phone numbers,
 * transaction tokens) in here — mask/hash or send length only.
 */
export type KioskEventProperties = Record<string, unknown>;

/**
 * Returns true only when the PostHog SDK has actually been initialized.
 *
 * PostHog is mounted conditionally in src/main.tsx (only when
 * VITE_POST_HOG_TYPE === "production"). In every other environment the
 * singleton exists but was never `init`-ed, so we must not call capture.
 */
function isPostHogReady(): boolean {
  // `__loaded` is set by posthog-js after init; access defensively so we do
  // not depend on it being part of the public type across SDK versions.
  const loaded = (posthog as unknown as { __loaded?: boolean })?.__loaded;
  return loaded === true && typeof posthog.capture === "function";
}

/**
 * Safely send a kiosk analytics event to PostHog.
 *
 * This is the single entry point for analytics across the kiosk. It is a
 * no-op when PostHog is not initialized and is fully wrapped in try/catch so
 * that analytics can NEVER throw, crash, or hang the kiosk flow
 * (CLAUDE.md Guardrail Rule 2). Always prefer this over calling
 * `posthog.capture` directly.
 *
 * @param event      One of the canonical {@link KioskEventName} values.
 * @param properties Optional, JSON-serializable, non-sensitive event payload.
 */
export function captureKioskEvent(
  event: KioskEventName,
  properties?: KioskEventProperties,
): void {
  try {
    if (!isPostHogReady()) {
      return;
    }
    posthog.capture(event, properties);
  } catch {
    // Intentionally swallow: analytics failures must never break the kiosk.
  }
}
