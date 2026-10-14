import type { PostHog } from "posthog-js";
import type { KioskEventName } from "@cx-sdk/core";

/**
 * Free-form, JSON-serializable properties sent alongside a kiosk event.
 * Never put PII or payment secrets (card tokens, full phone numbers,
 * transaction tokens) in here — mask/hash or send length only.
 */
export type KioskEventProperties = Record<string, unknown>;

/**
 * PostHog kill switch (CLAUDE.md rule 6): analytics exist ONLY in production
 * analytics builds. A build-time constant, so every other build drops the
 * import() below — posthog-js is neither shipped nor fetched.
 */
const ENABLED = import.meta.env.VITE_POST_HOG_TYPE === "production";

/**
 * Calls made before the lazy chunk resolves (the boot burst) are replayed in
 * order once PostHog is up. ponytail: overflow is dropped, never blocks;
 * raise if boot ever emits more.
 */
export const MAX_QUEUED_ANALYTICS_CALLS = 100;

type Call = (client: PostHog) => void;

let client: PostHog | null = null;
/** Non-null only while the chunk may still arrive; null = off, failed, or ready. */
let pending: Call[] | null = ENABLED ? [] : null;
let started = false;
/** The last identity sent — resetAnalyticsSession re-sends exactly this. */
let identity: { id: string; props: KioskEventProperties } | null = null;

function run(call: Call): void {
  try {
    if (client) call(client);
    else if (pending && pending.length < MAX_QUEUED_ANALYTICS_CALLS) pending.push(call);
  } catch {
    // Analytics must never break the kiosk (Rule 2).
  }
}

/**
 * Loads and initialises PostHog off the boot chunk (main.tsx, right after
 * setAnalyticsPort — CLAUDE.md rule 8). Idempotent; never rejects. A failed
 * chunk is prevented by chunkRecovery WITHOUT a reload (exempt), so import()
 * RESOLVES undefined (Vite's preload helper) — like every other failure here,
 * that ends in "analytics off for this page load".
 */
export async function startAnalytics(): Promise<void> {
  if (!ENABLED || started) return;
  started = true;
  try {
    // `await`, NEVER import().then(...): Vite's build moves a chained .then
    // INTO its preload wrapper, so a failed chunk would skip this code (the
    // queue never released) and a throw below would surface as
    // vite:preloadError — which chunkRecovery answers with a page RELOAD.
    const mod: { default?: PostHog } | undefined = await import("./posthogRuntime");
    const posthog = mod?.default;
    if (!posthog) throw new Error("posthog chunk unavailable");
    posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
      api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
      defaults: "2025-05-24",
    });
    // A successful init sets __loaded (an empty key leaves it unset).
    if (posthog.__loaded !== true) throw new Error("posthog did not initialise");
    client = posthog;
    const calls = pending ?? [];
    pending = null;
    calls.forEach(run);
  } catch {
    pending = null; // drop the boot burst; later calls are no-ops
  }
}

/** The events window.__kioskEvents keeps (DEV only). */
export const DEV_EVENT_LOG_SIZE = 50;

/**
 * Safely send a kiosk analytics event — the single entry point (also the
 * SDK's analytics port). Never throws, never awaits.
 * DEV only (dead code in builds — store.ts's __kioskStore precedent): each
 * event is also kept on window.__kioskEvents, the last DEV_EVENT_LOG_SIZE —
 * analytics are off on the dev server, so a walk reads there which step
 * failed (ErrorOccurred's stage; walk w4 #1). No console (Rule 4).
 */
export function captureKioskEvent(
  event: KioskEventName,
  properties?: KioskEventProperties,
): void {
  if (import.meta.env.DEV) {
    const log = ((window as unknown as { __kioskEvents?: unknown[] }).__kioskEvents ??= []);
    log.push({ event, properties });
    if (log.length > DEV_EVENT_LOG_SIZE) log.splice(0, log.length - DEV_EVENT_LOG_SIZE);
  }
  run((c) => c.capture(event, properties));
}

/** Tenant identity (App.tsx). Same queue, so it lands before later events. */
export function identifyKiosk(
  distinctId: string,
  properties: KioskEventProperties,
): void {
  identity = { id: distinctId, props: properties };
  run((c) => c.identify(distinctId, properties));
}

/**
 * A new PostHog session for the next guest (audit-fixes B3): the splash
 * tap. reset() drops the previous guest's session, then the
 * kiosk re-identifies with the SAME six fields (PROGRESS: identify payload
 * kept as is) — never an anonymous guest. Same queue and kill switch as every
 * call here; never throws.
 */
export function resetAnalyticsSession(): void {
  const who = identity;
  run((c) => {
    c.reset();
    if (who) c.identify(who.id, who.props);
  });
}
