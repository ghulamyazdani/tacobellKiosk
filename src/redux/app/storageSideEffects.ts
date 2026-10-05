import { createListenerMiddleware, isAnyOf } from "@reduxjs/toolkit";
import {
  setValidDpSessions,
  setCurrentSession,
} from "@cx-sdk/catalog/state/dynamicPricing.slice";
import { stopTimer } from "@cx-sdk/core/session/timer.slice";
import { removeCustomerDetails } from "@cx-sdk/core/customer/customerInfo.slice";

/**
 * Web-shell listener middleware carrying the localStorage side effects that
 * used to live INSIDE reducers (dynamicPricing/setValidDpSessions,
 * dynamicPricing/setCurrentSession, timer/stopTimer,
 * customerInfo/removeCustomerDetails).
 *
 * Why: reducers must be pure — the in-reducer writes broke time-travel and
 * made the slices un-importable off-web (P3a of the CX-SDK extraction; the
 * slices head to @cx-sdk packages, and React Native has no localStorage).
 * Listener effects run synchronously right after the reducer inside the same
 * dispatch, so externally observable timing is unchanged.
 *
 * This file is deliberately app-side (web-only vocabulary). When the slices
 * move into packages, these keys fold into the persistence manifest and this
 * file shrinks to nothing.
 */
export const storageSideEffects = createListenerMiddleware();

storageSideEffects.startListening({
  matcher: isAnyOf(setValidDpSessions, setCurrentSession),
  effect: (action) => {
    // Narrow via .match so `payload` is typed (RTK 2.12 no longer infers it
    // from isAnyOf in the effect signature). Behavior identical.
    const key = setValidDpSessions.match(action)
      ? "validDpSessions"
      : "currentSession";
    const payload = setValidDpSessions.match(action)
      ? action.payload
      : setCurrentSession.match(action)
        ? action.payload
        : undefined;
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Storage may be unavailable/full — state remains the source of truth.
    }
  },
});

storageSideEffects.startListening({
  actionCreator: stopTimer,
  effect: () => {
    try {
      window.localStorage.removeItem("timeRemaining");
    } catch {
      // ignore — key absence is the desired end state anyway
    }
  },
});

storageSideEffects.startListening({
  actionCreator: removeCustomerDetails,
  effect: () => {
    try {
      window.localStorage.removeItem("tent");
      window.localStorage.removeItem("customerPhone");
      window.localStorage.removeItem("customerName");
    } catch {
      // ignore — key absence is the desired end state anyway
    }
  },
});
