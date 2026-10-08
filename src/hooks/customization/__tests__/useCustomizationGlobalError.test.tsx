import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider, useSelector } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  makeItAMealTier1BottomSheet,
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
  setTier1SelectedCustomization,
  tier1CustomizationSelectedEntity,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  selectErrorMessageGlobal,
  selectShowErrorModalGlobal,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import useCustomization from "../useCustomization";
import i18n from "../../../i18n";

/*
  Lane figma-polish G1 — the global error is visible now (GlobalErrorHost,
  z-[95]), so the hook must never stack it over the PDP's own completion
  warning (z-80): a min/max failure on the PDP's ADD TO BAG — the button
  path, addCustomizationToCart(undefined) — raises NO global error, in both
  the variant and the customizable flow (the ring + the warning answer it).
  The quick-customization auto-commit (an EXPLICIT map, no warning there)
  still raises its translated copy, and the single-punch max limit raises
  t("toast.alreadyReachedMaximumLimit"), never the old English literal.
*/

const SAUCE = {
  _id: "sauce_addons",
  name: "Sauce",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "mild", name: "Mild", price: 0, isActive: true },
    { id: "hot", name: "Hot", price: 0, isActive: true },
  ],
};
/** A flexible single-punch group: up to two picks. */
const EXTRAS = {
  _id: "extras_addons",
  name: "Extras",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 1,
  order: 2,
  isActive: true,
  constituentItems: [
    { id: "cheese", name: "Cheese", price: 1, isActive: true },
    { id: "onion", name: "Onion", price: 1, isActive: true },
    { id: "jalapeno", name: "Jalapeno", price: 1, isActive: true },
  ],
};

const BURGER = { id: "burger", name: "Burger", price: 8, quantity: 1, modifiers: [SAUCE._id, EXTRAS._id] };
const LARGE = { id: "taco-l", name: "Large", price: 6, isActive: true, modifiers: [SAUCE._id] };
const TACO = { id: "taco", name: "Taco", price: 0, quantity: 1, hasVariant: true, variants: [LARGE] };

const openSession = (type: "customizableItem" | "variant", selectedEntity: object) => {
  store.dispatch(setModifiersMap({ modifiersMap: { [SAUCE._id]: SAUCE, [EXTRAS._id]: EXTRAS } }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type, openType: "new", editCustomizationContent: {} },
      selectedEntity,
    })
  );
};

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

let dispatched: ReturnType<typeof vi.spyOn>;
const globalErrors = () =>
  (dispatched.mock.calls as Array<[UnknownAction]>)
    .map(([action]) => action)
    .filter(setShowErrorModalGlobal.match)
    .map((action) => action.payload);

describe("useCustomization — the global error only where no completion warning answers (G1)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    dispatched = vi.spyOn(store, "dispatch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("customizable flow", () => {
    beforeEach(() => {
      openSession("customizableItem", BURGER);
      store.dispatch(setTier1SelectedCustomization({ [SAUCE._id]: [], [EXTRAS._id]: [] }));
      dispatched.mockClear();
    });

    it("PDP button path (no map): the min failure answers false and dispatches NO global error", () => {
      const { result } = mountHook();

      let added: unknown;
      act(() => {
        added = result.current.addCustomizationToCart(undefined);
      });

      expect(added).toBe(false);
      expect(globalErrors()).toEqual([]);
      expect(selectShowErrorModalGlobal(store.getState())).toBe(false);
    });

    it("quick-customization (an explicit map) still raises t('toast.fillCustomizationFields')", () => {
      const { result } = mountHook();

      let added: unknown;
      act(() => {
        added = result.current.addCustomizationToCart({ [SAUCE._id]: [], [EXTRAS._id]: [] });
      });

      expect(added).toBe(false);
      expect(globalErrors()).toEqual([
        { showErrorModal: true, errorMessage: i18n.t("toast.fillCustomizationFields") },
      ]);
    });

    it("the single-punch max limit raises t('toast.alreadyReachedMaximumLimit'), never the English literal", () => {
      store.dispatch(
        setTier1SelectedCustomization({
          [SAUCE._id]: [],
          [EXTRAS._id]: [
            { ...EXTRAS.constituentItems[0], quantity: 1 },
            { ...EXTRAS.constituentItems[1], quantity: 1 },
          ],
        })
      );
      const { result } = mountHook();
      dispatched.mockClear();

      act(() => {
        result.current.addCustomizations(EXTRAS, EXTRAS.constituentItems[2], null, {}, false);
      });

      expect(globalErrors()).toEqual([
        { showErrorModal: true, errorMessage: i18n.t("toast.alreadyReachedMaximumLimit") },
      ]);
      expect(selectErrorMessageGlobal(store.getState())).toBe(
        "You've already reached the maximum for this option"
      );
      expect(selectErrorMessageGlobal(store.getState())).not.toMatch(/Maximum selection\s+limit reached/);
      // The pick was refused: still two.
      expect(tier1SelectedCustomization(store.getState())[EXTRAS._id]).toHaveLength(2);
    });

    it("Arabic: the max-limit copy is the Arabic translation", async () => {
      await act(async () => {
        await i18n.changeLanguage("ar");
      });
      try {
        store.dispatch(
          setTier1SelectedCustomization({
            [SAUCE._id]: [],
            [EXTRAS._id]: [
              { ...EXTRAS.constituentItems[0], quantity: 1 },
              { ...EXTRAS.constituentItems[1], quantity: 1 },
            ],
          })
        );
        const { result } = mountHook();

        act(() => {
          result.current.addCustomizations(EXTRAS, EXTRAS.constituentItems[2], null, {}, false);
        });

        expect(selectErrorMessageGlobal(store.getState())).toBe(i18n.t("toast.alreadyReachedMaximumLimit"));
        expect(selectErrorMessageGlobal(store.getState())).not.toBe(
          "You've already reached the maximum for this option"
        );
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });
  });

  describe("variant flow", () => {
    beforeEach(() => {
      openSession("variant", TACO);
      dispatched.mockClear();
    });

    /** The size picked on the PDP: the hook's own variant state + its groups (selections reset to empty). */
    const pickLarge = (result: ReturnType<typeof mountHook>["result"]) =>
      act(() => {
        result.current.setSelectedVariant(LARGE);
        result.current.fetchAddonsForSelectedVariant(LARGE);
      });

    it("PDP button path (no map): the min failure answers false and dispatches NO global error", () => {
      const { result } = mountHook();
      pickLarge(result);
      expect(tier1SelectedCustomization(store.getState())).toEqual({ [SAUCE._id]: [] });

      let added: unknown;
      act(() => {
        added = result.current.addCustomizationToCart(undefined);
      });

      expect(added).toBe(false);
      expect(globalErrors()).toEqual([]);
      expect(selectShowErrorModalGlobal(store.getState())).toBe(false);
    });

    it("quick-customization (an explicit map) still raises t('toast.selectAllCustomizations')", () => {
      const { result } = mountHook();
      pickLarge(result);

      let added: unknown;
      act(() => {
        added = result.current.addCustomizationToCart({ [SAUCE._id]: [] });
      });

      expect(added).toBe(false);
      expect(globalErrors()).toEqual([
        { showErrorModal: true, errorMessage: i18n.t("toast.selectAllCustomizations") },
      ]);
    });
  });
});
