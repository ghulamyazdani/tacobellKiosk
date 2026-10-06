/**
 * The applied bar's celebration budget — spent PER (offer id, amount), held
 * OUTSIDE React so it survives the bag unmounting on close. That is what lets
 * a reopen with an unchanged offer render the bar QUIET: replaying the pop on
 * every open is the "nice the first time, annoying the third" failure, and
 * the moment worth animating is the value CHANGING (a different offer, or the
 * same offer now worth more because the cart grew).
 *
 * Verbatim port of the fork's components/offer/appliedBarCelebration.ts. It
 * lives in utils so hooks and components can both import it without a
 * components→hooks edge. Reset contract — the spent key must never mute a
 * genuinely fresh apply, so it is cleared by:
 *   - useOfferApply's removal paths (customer Remove and cart-driven
 *     removal), so a remove-then-reapply of the same offer plays again;
 *   - useSessionReset (both scopes): no leftover celebration state may greet
 *     the next customer.
 * Module state leaks across tests in one file — call
 * resetAppliedBarCelebration() in beforeEach.
 */
let lastCelebratedBarKey: string | null = null;

export const getCelebratedBarKey = (): string | null => lastCelebratedBarKey;

export const setCelebratedBarKey = (key: string): void => {
  lastCelebratedBarKey = key;
};

export const resetAppliedBarCelebration = (): void => {
  lastCelebratedBarKey = null;
};
