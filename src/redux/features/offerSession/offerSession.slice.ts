import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * Offer-session state (lane "offers", item 34 — auto-apply).
 *
 * - `autoApplyOptOut`: the session latch (decision 4, REFINED). ANY customer
 *   offer action sets it, whatever its outcome — a SAVE commit attempt, a
 *   picker commit, or Remove — so the machine never overrides a choice the
 *   customer made or undid. Machine paths (cart-driven removal, auto-apply)
 *   never set it.
 * - `autoAppliedOfferId`: the offer the machine applied; the bag's "Applied
 *   for you" caption shows iff it equals the slot's `_id` (derived, so a
 *   stale id is harmless). A customer action clears it.
 *
 * Persisted with customer scope (see store.ts) and cleared only by
 * resetSession (both scopes) or RESET_STATE.
 */
export interface OfferSessionState {
  autoApplyOptOut: boolean;
  autoAppliedOfferId: string | null;
}

const initialState: OfferSessionState = {
  autoApplyOptOut: false,
  autoAppliedOfferId: null,
};

const offerSessionSlice = createSlice({
  name: "offerSession",
  initialState,
  reducers: {
    /** Latch auto-apply off for the session; a customer action also ends the caption. */
    optOutOfAutoApply: (state) => {
      state.autoApplyOptOut = true;
      state.autoAppliedOfferId = null;
    },
    markOfferAutoApplied: (state, action: PayloadAction<string>) => {
      state.autoAppliedOfferId = action.payload;
    },
    resetOfferSession: () => initialState,
  },
});

export const { optOutOfAutoApply, markOfferAutoApplied, resetOfferSession } =
  offerSessionSlice.actions;

/** Null-safe on a store without the slice (tests mounting partial stores). */
interface OfferSessionRootState {
  offerSession?: Partial<OfferSessionState> | null;
}

export const selectAutoApplyOptOut = (state: OfferSessionRootState): boolean =>
  state?.offerSession?.autoApplyOptOut === true;

export const selectAutoAppliedOfferId = (
  state: OfferSessionRootState,
): string | null => state?.offerSession?.autoAppliedOfferId ?? null;

export default offerSessionSlice.reducer;
