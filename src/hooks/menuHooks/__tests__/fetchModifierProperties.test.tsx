import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import useMenuConverters from "../useMenuConverters";

/*
  UB6 Fix A — fetchModifierProperties is the ONE TB choke point every
  modifier-group caller goes through (the PDP seed, useCustomization, Tier2,
  PdpIncompleteWarning, LoyaltyRewardsSheet, useOfferConverters). The SDK
  resolver keeps the fork's quirk of an `undefined` entry per id the menu's
  `modifiers` lacks (sorted to the end); the wrapper drops them, so no caller
  ever reads a field off one.
*/

const G1 = { _id: "g1", name: "Sauces", order: 2, isActive: true };
const G2 = { _id: "g2", name: "Toppings", order: 1, isActive: true };
const G3_OFF = { _id: "g3", name: "Extras", order: 3, isActive: false };

const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

describe("useMenuConverters.fetchModifierProperties — dangling group ids (UB6)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setModifiersMap({ modifiersMap: { g1: G1, g2: G2, g3: G3_OFF } }));
  });

  const fetchGroups = () => renderHook(() => useMenuConverters(), { wrapper }).result.current.fetchModifierProperties;

  it("drops the dangling id and keeps the live groups sorted by order", () => {
    expect(fetchGroups()(["g1", "gone", "g2"])).toEqual([G2, G1]);
  });

  it("drops ONLY ids the menu lacks: an inactive group still comes back (callers keep their own isActive rules)", () => {
    expect(fetchGroups()(["g3", "gone", "g1"])).toEqual([G1, G3_OFF]);
  });

  it("only dangling ids → []", () => {
    expect(fetchGroups()(["gone"])).toEqual([]);
  });

  it("no ids (an entity without `modifiers`) → []", () => {
    expect(fetchGroups()(undefined as unknown as string[])).toEqual([]);
  });
});
