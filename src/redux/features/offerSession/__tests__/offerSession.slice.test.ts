/**
 * offerSession slice (lane "offers", item 34): the auto-apply session latch
 * and the "Applied for you" id. Persisted with customer scope ON PURPOSE —
 * a crash-reload keeps the Dexie cart and the persisted cartOffer, so the
 * latch must survive too, or a removed offer would be re-applied.
 */
import { describe, expect, it, vi } from "vitest";
import reducer, {
  markOfferAutoApplied,
  optOutOfAutoApply,
  resetOfferSession,
  selectAutoAppliedOfferId,
  selectAutoApplyOptOut,
  type OfferSessionState,
} from "../offerSession.slice";
import { persistor, store } from "../../../app/store";

const INITIAL: OfferSessionState = {
  autoApplyOptOut: false,
  autoAppliedOfferId: null,
};

describe("offerSession reducers", () => {
  it("starts unlatched with no auto-applied id", () => {
    expect(reducer(undefined, { type: "@@init" })).toEqual(INITIAL);
  });

  it("markOfferAutoApplied records the id without latching", () => {
    expect(reducer(INITIAL, markOfferAutoApplied("offer-flat-2"))).toEqual({
      autoApplyOptOut: false,
      autoAppliedOfferId: "offer-flat-2",
    });
  });

  it("optOutOfAutoApply latches AND clears the auto-applied id (a customer action ends the caption)", () => {
    const applied = reducer(INITIAL, markOfferAutoApplied("offer-flat-2"));
    expect(reducer(applied, optOutOfAutoApply())).toEqual({
      autoApplyOptOut: true,
      autoAppliedOfferId: null,
    });
  });

  it("resetOfferSession returns to the initial state", () => {
    const dirty = reducer(reducer(INITIAL, optOutOfAutoApply()), markOfferAutoApplied("x"));
    expect(dirty).toEqual({ autoApplyOptOut: true, autoAppliedOfferId: "x" });
    expect(reducer(dirty, resetOfferSession())).toEqual(INITIAL);
  });
});

describe("offerSession selectors are null-safe on a store without the slice", () => {
  it.each([
    ["no slice", {}],
    ["null slice", { offerSession: null }],
    ["empty slice", { offerSession: {} }],
  ])("%s → unlatched, no id", (_label, state) => {
    expect(selectAutoApplyOptOut(state)).toBe(false);
    expect(selectAutoAppliedOfferId(state)).toBeNull();
  });

  it("read the live fields", () => {
    const state = { offerSession: { autoApplyOptOut: true, autoAppliedOfferId: "a" } };
    expect(selectAutoApplyOptOut(state)).toBe(true);
    expect(selectAutoAppliedOfferId(state)).toBe("a");
  });
});

/*
  The round trip is real (store.test.ts recipe): write, flush, then a fresh
  store (a new module instance) rehydrates from the same storage.
*/
describe("offerSession persistence (customer scope)", () => {
  type Persisted = { offerSession: OfferSessionState };

  const onDisk = (): Record<string, unknown> => {
    const root = JSON.parse(window.localStorage.getItem("persist:root") ?? "{}") as Record<
      string,
      string
    >;
    return JSON.parse(root.offerSession ?? "{}") as Record<string, unknown>;
  };

  const bootstrapped = (handle: { getState: () => { bootstrapped: boolean } }) =>
    vi.waitFor(() => expect(handle.getState().bootstrapped).toBe(true));

  it("registers the slice in the app store", () => {
    expect((store.getState() as unknown as Persisted).offerSession).toEqual(INITIAL);
  });

  it("RESET_STATE zeroes it, in memory and on disk", async () => {
    await bootstrapped(persistor);
    store.dispatch(optOutOfAutoApply());
    store.dispatch(markOfferAutoApplied("offer-flat-2"));
    await persistor.flush();
    expect(onDisk()).toEqual({ autoApplyOptOut: true, autoAppliedOfferId: "offer-flat-2" });

    store.dispatch({ type: "RESET_STATE" });
    await persistor.flush();

    expect((store.getState() as unknown as Persisted).offerSession).toEqual(INITIAL);
    expect(onDisk()).toEqual(INITIAL);
  });

  // Last in the file: it re-imports the store (a second instance on the same storage).
  it("the latch and the id survive a relaunch, and only the whitelisted fields are on disk", async () => {
    await bootstrapped(persistor);
    store.dispatch(optOutOfAutoApply());
    store.dispatch(markOfferAutoApplied("auto-1"));
    await persistor.flush();

    expect(Object.keys(onDisk()).sort()).toEqual(["autoAppliedOfferId", "autoApplyOptOut"]);

    vi.resetModules();
    const relaunched = await import("../../../app/store");
    await bootstrapped(relaunched.persistor);
    expect((relaunched.store.getState() as unknown as Persisted).offerSession).toEqual({
      autoApplyOptOut: true,
      autoAppliedOfferId: "auto-1",
    });
  });
});
