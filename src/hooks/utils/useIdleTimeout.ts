import { createContext, useContext, useEffect } from "react";

/*
 * Idle-timeout policy + the hold primitive (P9a). Consumed by
 * routes/IdleGuard (the timer) and by the shared hooks that must suspend it.
 * Deliberately a NON-component module: exporting these from IdleGuard.tsx
 * would trip react-refresh/only-export-components.
 */

/** The prompt is the LAST 20 s of the period — WCAG 2.2.1 needs >= 20 s to extend. */
export const IDLE_PROMPT_SECONDS = 20;
/** Rule 1: 120 s of inactivity returns the kiosk to Splash. */
export const IDLE_FALLBACK_SECONDS = 120;
/** Floor for a configured ideal_time — shorter cuts a customer off mid-read. */
export const IDLE_MIN_SECONDS = 60;
/** Rule 1 is a CEILING: the server may shorten the timeout, never lengthen it. */
export const IDLE_MAX_SECONDS = 120;
// ponytail: the cap is now a BACKSTOP. TB's apiSlice bounds every request
// (10 s; getMenu 30 s), so today's holders release on their own — the push
// ladder in ≤ 46 s, a loyalty event in ≤ 10 s. It stays for awaits the
// transport does not bound (a future holder, a non-network hang, a host
// config without a timeout): no hold may disable the idle reset forever.
// Ceiling: such a hang delays Splash by up to 120 s + one idle period.
export const IDLE_HOLD_MAX_MS = 120_000;

/**
 * `appSettings.idealTimeout` (server `ideal_time`, seconds) -> the TOTAL
 * inactivity before the session ends; the prompt is its last
 * IDLE_PROMPT_SECONDS. Unparseable / missing / not longer than the prompt ->
 * 120 (Rule 1); anything else is clamped to [60, 120] (e2e fixtures send
 * "180" -> 120). The guarantee `prompt < total` is also what keeps
 * react-idle-timer from throwing (it rejects promptBeforeIdle >= timeout
 * inside an effect, i.e. a render crash).
 */
export function resolveIdleSeconds(raw: unknown): number {
  const seconds = Number.parseInt(String(raw), 10);
  if (Number.isNaN(seconds) || seconds <= IDLE_PROMPT_SECONDS) {
    return IDLE_FALLBACK_SECONDS;
  }
  return Math.min(Math.max(seconds, IDLE_MIN_SECONDS), IDLE_MAX_SECONDS);
}

/**
 * +1 / -1 hold counter, provided by IdleGuard. null outside the idle subtree
 * (/start, /LoadingResources, tests without the guard) — useIdleHold is then
 * a no-op. Holds are React state on purpose, never redux: a persisted "held"
 * flag would disable idle for good after a crash-reload mid-push.
 */
export const IdleHoldContext = createContext<((delta: 1 | -1) => void) | null>(
  null,
);

/**
 * Suspends the idle clock while `active` — idle must never end a session
 * under work that is still writing to it (an order push, a loyalty call).
 * Release starts a fresh FULL period. Call it in the SHARED hook that owns
 * the async state, so every screen using that hook is covered.
 */
export function useIdleHold(active: boolean): void {
  const adjust = useContext(IdleHoldContext);
  useEffect(() => {
    if (!active || !adjust) return;
    let held = true;
    adjust(1);
    // Released exactly once — by the cap or by cleanup, whichever is first.
    const clearHold = () => {
      if (!held) return;
      held = false;
      window.clearTimeout(cap);
      adjust(-1);
    };
    const cap = window.setTimeout(clearHold, IDLE_HOLD_MAX_MS);
    return clearHold;
  }, [active, adjust]);
}
