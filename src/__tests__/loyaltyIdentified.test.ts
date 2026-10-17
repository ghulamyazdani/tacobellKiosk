import { describe, expect, it } from "vitest";
import loyaltyReducer, {
  resetLoyaltySession,
  selectIsLoyaltyIdentified,
  setLoyaltyIdentified,
  setLoyaltyPartner,
} from "@cx-sdk/ordering/state/loyalty.slice";

/*
  User 2026-10-17 — the SDK loyalty slice's `isLoyaltyIdentified`
  (packages/ordering/src/state/loyalty.slice.ts), tested here because the SDK
  has no runner (cf. loyaltyOfferRules.test.ts): a balance lookup answered
  200 for the phone in the store. It is customer state — the session reset
  clears it — and a state persisted before the field existed reads false.
*/

const initial = loyaltyReducer(undefined, { type: "@@INIT" });
const asRoot = (loyalty: unknown) => ({ loyalty });

describe("loyalty.slice — isLoyaltyIdentified", () => {
  it("starts false; setLoyaltyIdentified sets it either way", () => {
    expect(initial.isLoyaltyIdentified).toBe(false);
    const identified = loyaltyReducer(initial, setLoyaltyIdentified(true));

    expect(identified.isLoyaltyIdentified).toBe(true);
    expect(loyaltyReducer(identified, setLoyaltyIdentified(false)).isLoyaltyIdentified).toBe(false);
  });

  it("resetLoyaltySession clears it with the rest of the customer's state; the partner config stays", () => {
    let state = loyaltyReducer(initial, setLoyaltyPartner({ partner: { partner_name: "Xeno" } }));
    state = loyaltyReducer(state, setLoyaltyIdentified(true));
    state = loyaltyReducer(state, resetLoyaltySession());

    expect(state.isLoyaltyIdentified).toBe(false);
    expect(state.isLoyaltyOn).toBe(true);
    expect(loyaltyReducer(initial, resetLoyaltySession())).toEqual(initial);
  });

  it("selectIsLoyaltyIdentified reads it — false for a state persisted before the field existed", () => {
    const { isLoyaltyIdentified: _absent, ...older } = initial;

    expect(selectIsLoyaltyIdentified(asRoot(loyaltyReducer(initial, setLoyaltyIdentified(true))))).toBe(true);
    expect(selectIsLoyaltyIdentified(asRoot(initial))).toBe(false);
    expect(selectIsLoyaltyIdentified(asRoot(older))).toBe(false);
    expect(selectIsLoyaltyIdentified({})).toBe(false);
  });
});
