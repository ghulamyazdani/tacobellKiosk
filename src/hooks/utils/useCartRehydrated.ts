import { createContext, useContext } from "react";

/**
 * True once AppRoutes' Dexie crash-recovery rehydrate has SETTLED this page
 * load (rows restored, nothing to restore, or Dexie failed). Before that an
 * empty redux cart may only mean the rows are still on their way, so an
 * empty-cart exit must not judge it. false without a provider (unit tests) —
 * consumers then fall back to their own "the cart held rows" latch. React
 * state on purpose (IdleHoldContext precedent): never persisted, never reset
 * by a session reset.
 */
export const CartRehydratedContext = createContext(false);

export const useCartRehydrated = (): boolean => useContext(CartRehydratedContext);
