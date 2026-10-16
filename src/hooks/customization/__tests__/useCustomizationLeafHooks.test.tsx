import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { Provider, useSelector } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  makeItAMealTier1BottomSheet,
  setTier1SelectedCustomization,
  tier1CustomizationSelectedEntity,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setAllowMultiplePunch } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import useMenuConverters from "../../menuHooks/useMenuConverters";
import useLoyalty from "../../loyalty/useLoyalty";
import useAppSettings from "../../utils/useAppSettings";
import useCustomization from "../useCustomization";

/*
  Low-end perf pass PDP-2. useCustomization needed four pure functions and
  one boolean from useMenuConverters, useLoyalty, useAppSettings and a bare
  useMakeItAMeal — ~140 store subscriptions and 20 RTK Query hooks re-run on
  every PDP render (each tap) and every tier-2 mount pass. It now uses the
  leaf useAllowMultiplePunch, the shared UB6 resolver and the SDK's own pure
  functions: none of the four hooks is instantiated, and every returned
  function gives the hooks' results (the money paths included).
*/

const instantiated = vi.hoisted(() => [] as string[]);

vi.mock("../../menuHooks/useMenuConverters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../menuHooks/useMenuConverters")>();
  return {
    ...actual,
    default: () => {
      instantiated.push("useMenuConverters");
      return actual.default();
    },
  };
});

vi.mock("../../loyalty/useLoyalty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../loyalty/useLoyalty")>();
  return {
    ...actual,
    default: () => {
      instantiated.push("useLoyalty");
      return actual.default();
    },
  };
});

vi.mock("../../utils/useAppSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/useAppSettings")>();
  return {
    ...actual,
    default: () => {
      instantiated.push("useAppSettings");
      return actual.default();
    },
  };
});

vi.mock("../../makeItAMeal/useMakeItAMeal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../makeItAMeal/useMakeItAMeal")>();
  return {
    ...actual,
    default: () => {
      instantiated.push("useMakeItAMeal");
      return actual.default();
    },
  };
});

const G1 = { _id: "g1", name: "Sauces", order: 2, isActive: true, min: 0, max: 2 };
const G2 = { _id: "g2", name: "Toppings", order: 1, isActive: true, min: 1, max: 1 };
const G3_OFF = { _id: "g3", name: "Extras", order: 3, isActive: false };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/customization"]}>{children}</MemoryRouter>
  </Provider>
);

/** The PDP's binding of the hook (pages/Customization). */
const mountHook = () =>
  renderHook(
    () =>
      useCustomization({
        cartRef: { current: null },
        isOpenBottomSheet: useSelector(makeItAMealTier1BottomSheet),
        SelectedEntity: useSelector(tier1CustomizationSelectedEntity),
        selectedCustomizations: useSelector(tier1SelectedCustomization),
        setSelectedCustomizations: setTier1SelectedCustomization,
      }),
    { wrapper }
  );

describe("useCustomization — leaf hooks and pure functions only (perf pass PDP-2)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setModifiersMap({ modifiersMap: { g1: G1, g2: G2, g3: G3_OFF } }));
    instantiated.length = 0;
  });

  it("instantiates none of useMenuConverters, useLoyalty, useAppSettings, useMakeItAMeal — on mount or re-render", () => {
    const { rerender } = mountHook();
    rerender();

    expect(instantiated).toEqual([]);
  });

  it("same results as the hooks it no longer instantiates: the UB6 resolver, the multi-punch flag, redeemItem, calculationWrapper, the group predicates", () => {
    store.dispatch(setAllowMultiplePunch(true));
    const pdp = mountHook().result.current;
    const hooks = renderHook(
      () => ({ menu: useMenuConverters(), loyalty: useLoyalty(), settings: useAppSettings() }),
      { wrapper }
    ).result.current;

    for (const ids of [["g1", "gone", "g2"], ["g3", "gone", "g1"], ["gone"], undefined as unknown as string[]]) {
      expect(pdp.fetchModifierProperties(ids)).toEqual(hooks.menu.fetchModifierProperties(ids));
    }
    expect(pdp.fetchModifierProperties(["g1", "gone", "g2"])).toEqual([G2, G1]);
    expect(pdp.isAllowMultiplePunch()).toBe(true);
    expect(hooks.menu.isAllowMultiplePunch()).toBe(true);

    // MONEY: a loyalty reward row (percentage, flat, with add-ons) and the bill rounding.
    for (const row of [
      { id: "r1", price: 8.5, total_price: 17, quantity: 2, discount_type: "percentage", discount_value: 25 },
      { id: "r2", price: 6, total_price: 6, quantity: 1, discount_type: "amount", discount_value: 2 },
      { id: "r3", price: 5, total_price: 6.5, discount_type: "percentage", discount_value: 100, customizations: { g1: [{ id: "c", price: 1.5 }] } },
    ]) {
      expect(pdp.redeemItem(row)).toEqual(hooks.loyalty.redeemItem(row));
    }
    for (const value of [12.345, 7.005, 0.1 + 0.2, 0, undefined, 19.999]) {
      expect(pdp.calculationWrapper(value)).toEqual(hooks.settings.calculationWrapper(value));
    }
    for (const [min, max] of [[0, 1], [0, 2], [1, 3], [undefined, undefined]]) {
      expect(pdp.isCheckBoxRequiredFunction(min, max)).toBe(hooks.menu.isCheckBoxRequiredFunction(min, max));
      expect(pdp.isStepperRequired(max)).toBe(hooks.menu.isStepperRequired(max));
    }
  });
});
