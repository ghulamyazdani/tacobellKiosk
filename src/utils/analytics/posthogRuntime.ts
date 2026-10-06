/**
 * The ONLY posthog-js importer (P9f). trackEvent.ts loads it with import(), so
 * PostHog is its own lazy chunk with a stable name — posthogRuntime-<hash>.js,
 * which chunkRecovery exempts from the reload (a failed analytics chunk must
 * never reload the kiosk mid-order). A direct import("posthog-js") would emit
 * posthog's own module-<hash>.js, which no regex can safely exempt. Also the
 * unit tests' vi.mock seam (fcmRuntime.ts is the precedent).
 */
export { default } from "posthog-js";
