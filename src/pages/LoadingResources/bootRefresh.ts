/**
 * Route state of a splash-started boot refresh (P9e, D1). StartScreen
 * navigates to /LoadingResources with it; the boot screen reads it back with
 * {@link readBootRefreshState}. Absent or malformed = a NORMAL boot
 * (registration, ErrorBoundary re-boot): the P9b retry ladder.
 */

/** Who started a refresh — the analytics `trigger`. */
export type BootRefreshTrigger = "brand" | "scheduled" | "operator";

/** `location.state` of a refresh-mode boot. */
export interface BootRefreshState {
  refresh: true;
  trigger: BootRefreshTrigger;
}

const TRIGGERS: readonly unknown[] = ["brand", "scheduled", "operator"];

/**
 * Validates router `location.state` — untyped by the router, and it lives in
 * history.state, so it survives a reload. Returns a fresh refresh state, or
 * null for a normal boot.
 */
export function readBootRefreshState(state: unknown): BootRefreshState | null {
  if (typeof state !== "object" || state === null) return null;
  const { refresh, trigger } = state as { refresh?: unknown; trigger?: unknown };
  return refresh === true && TRIGGERS.includes(trigger)
    ? { refresh: true, trigger: trigger as BootRefreshTrigger }
    : null;
}
