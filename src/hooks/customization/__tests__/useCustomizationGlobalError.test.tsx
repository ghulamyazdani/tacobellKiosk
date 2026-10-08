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
  setAllowMultiplePunch,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import useCustomization from "../useCustomization";
import i18n, { isolate } from "../../../i18n";
import { KioskEventName } from "../../../utils/analytics";

const net = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => net.capture(...args),
}));

/*
  Lane figma-polish G1 — the global error is visible now (GlobalErrorHost,
  z-[95]), so the hook must never stack it over the PDP's own completion
  warning (z-80): a min/max failure on the PDP's ADD TO BAG — the button
  path, addCustomizationToCart(undefined) — raises NO global error, in both
  the variant and the customizable flow (the ring + the warning answer it).
  The quick-customization auto-commit (an EXPLICIT map, no warning there)
  still raises its translated copy, and a full group raises
  t("pdp.groupMaxReached"), never the old English literal.

  audit-fixes UB2 — the SDK group-max guard runs first in addCustomizations
  (a tap) and increaseCustomization ("+"): it counts UNITS like the commit,
  so a stepper group can no longer reach "3 of 2". A refused add writes
  nothing (no selection dispatch, no ModifierSelected, no contradictory
  mark) and raises exactly ONE global error "You can choose up to {{max}}
  {{group}}". The 1/1 swap, a removal, "−" and the auto-select pass are
  never refused; the per-ITEM cap keeps toast.alreadyReachedMaximumLimit.
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

    it("a full flexible group refuses a third pick with t('pdp.groupMaxReached') (UB2), never the English literal", () => {
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
        { showErrorModal: true, errorMessage: i18n.t("pdp.groupMaxReached", { max: 2, group: "Extras" }) },
      ]);
      expect(selectErrorMessageGlobal(store.getState())).toBe("You can choose up to 2 Extras");
      expect(selectErrorMessageGlobal(store.getState())).not.toMatch(/Maximum selection\s+limit reached/);
      // The pick was refused: still two.
      expect(tier1SelectedCustomization(store.getState())[EXTRAS._id]).toHaveLength(2);
    });

    it("Arabic: the group-max copy is the Arabic translation", async () => {
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

        expect(selectErrorMessageGlobal(store.getState())).toBe(
          i18n.t("pdp.groupMaxReached", { max: 2, group: "Extras" })
        );
        expect(selectErrorMessageGlobal(store.getState())).toContain("يمكنك اختيار");
        expect(selectErrorMessageGlobal(store.getState())).not.toBe("You can choose up to 2 Extras");
      } finally {
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });

    it("Arabic session: the refusal names the group by its menu `ar` alias (useLocalized), never the English name", async () => {
      store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
      await act(async () => {
        await i18n.changeLanguage("ar");
      });
      try {
        // Menu DATA (the group's alias), not translation copy.
        const AR_EXTRAS = "إضافات";
        const extrasAr = { ...EXTRAS, aliases: [{ value: AR_EXTRAS, name: "Arabic", code: "ar", dir: "rtl" }] };
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
          result.current.addCustomizations(extrasAr, EXTRAS.constituentItems[2], null, {}, false);
        });

        const message = selectErrorMessageGlobal(store.getState());
        // The rendered copy carries the isolates: compare through i18n.t().
        expect(message).toBe(i18n.t("pdp.groupMaxReached", { max: 2, group: isolate(AR_EXTRAS) }));
        expect(message).toContain(AR_EXTRAS);
        expect(message).not.toContain("Extras");
      } finally {
        store.dispatch(setSelectedLanguage({ name: "English", code: "en", dir: "ltr", type: "primary_language" }));
        await act(async () => {
          await i18n.changeLanguage("en");
        });
      }
    });

    it("the engine's own max-limit answer (the auto-select pass, which the guard never sees) is the same group copy", () => {
      const { result } = mountHook();
      const working: Record<string, unknown[]> = {
        [SAUCE._id]: [],
        [EXTRAS._id]: [
          { ...EXTRAS.constituentItems[0], quantity: 1 },
          { ...EXTRAS.constituentItems[1], quantity: 1 },
        ],
      };
      dispatched.mockClear();

      act(() => {
        result.current.addCustomizations(EXTRAS, EXTRAS.constituentItems[2], null, {}, false, true, working);
      });

      expect(globalErrors()).toEqual([
        { showErrorModal: true, errorMessage: i18n.t("pdp.groupMaxReached", { max: 2, group: "Extras" }) },
      ]);
      expect(working[EXTRAS._id]).toHaveLength(2);
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

  describe("UB2 — the group-max guard (tier-1, the PDP's multi-punch path)", () => {
    /** The fixture's Dream box "Snacks" shape: 0 / 2, stepper rows (item cap 2). */
    const SNACKS = {
      _id: "snacks_combo",
      name: "Snacks",
      min: 0,
      max: 2,
      multiplePunchMin: 0,
      multiplePunchMax: 4,
      multiplePunchMaxItem: 2,
      order: 3,
      isActive: true,
      constituentItems: [
        { id: "nuggets", name: "Nuggets", price: 5, isActive: true },
        { id: "donuts", name: "Donuts", price: 5, isActive: true, contradictoryItem: "no-donuts" },
        { id: "wings", name: "Wings", price: 5, isActive: true },
      ],
    };
    const [NUGGETS, DONUTS, WINGS] = SNACKS.constituentItems;
    /** The same rows, a group cap above the item cap (4 units). */
    const BIG_SNACKS = { ...SNACKS, _id: "big_combo", name: "Big snacks", max: 4 };
    const BOX = { id: "box", name: "Box", price: 25, quantity: 1, modifiers: [SAUCE._id, SNACKS._id, BIG_SNACKS._id] };

    const groupMax = (max: number, group: string) =>
      i18n.t("pdp.groupMaxReached", { max, group });
    const snacksIn = () => tier1SelectedCustomization(store.getState())[SNACKS._id];
    const modifierSelected = () =>
      net.capture.mock.calls.filter(([name]) => name === KioskEventName.ModifierSelected);

    beforeEach(() => {
      store.dispatch(setModifiersMap({ modifiersMap: { [SAUCE._id]: SAUCE, [SNACKS._id]: SNACKS, [BIG_SNACKS._id]: BIG_SNACKS } }));
      openSession("customizableItem", BOX);
      store.dispatch(
        setTier1SelectedCustomization({ [SAUCE._id]: [], [SNACKS._id]: [], [BIG_SNACKS._id]: [] })
      );
      net.capture.mockReset();
      dispatched.mockClear();
    });

    it("Snacks: Nuggets, '+' Nuggets, then Donuts → refused; the map is unchanged; exactly ONE global error with pdp.groupMaxReached", () => {
      const { result } = mountHook();
      act(() => {
        result.current.addCustomizations(SNACKS, { ...NUGGETS, quantity: 1 }, null, {}, false);
      });
      act(() => {
        result.current.increaseCustomization(SNACKS, NUGGETS, null, {});
      });
      expect(snacksIn()).toEqual([expect.objectContaining({ id: "nuggets", quantity: 2 })]);
      expect(globalErrors()).toEqual([]);
      expect(modifierSelected()).toHaveLength(1);
      dispatched.mockClear();
      net.capture.mockReset();

      let returned: unknown;
      act(() => {
        returned = result.current.addCustomizations(SNACKS, { ...DONUTS, quantity: 1 }, null, {}, false);
      });

      // Nothing written but the error: no selection dispatch, no event, no contradictory mark.
      expect((dispatched.mock.calls as Array<[UnknownAction]>).map(([action]) => action.type)).toEqual([
        setShowErrorModalGlobal.type,
      ]);
      expect(globalErrors()).toEqual([{ showErrorModal: true, errorMessage: groupMax(2, "Snacks") }]);
      expect(selectErrorMessageGlobal(store.getState())).toBe("You can choose up to 2 Snacks");
      expect(modifierSelected()).toEqual([]);
      expect(result.current.contradictoryItems).toEqual({});
      expect(snacksIn()).toEqual([expect.objectContaining({ id: "nuggets", quantity: 2 })]);
      expect(returned).toBe(tier1SelectedCustomization(store.getState()));
    });

    it("multi-punch ON: the refusal names the EFFECTIVE max — Snacks' multi-punch 4, not its single-punch 2", () => {
      store.dispatch(setAllowMultiplePunch(true));
      try {
        store.dispatch(
          setTier1SelectedCustomization({
            [SAUCE._id]: [],
            [SNACKS._id]: [
              { ...NUGGETS, quantity: 2 },
              { ...WINGS, quantity: 2 },
            ],
            [BIG_SNACKS._id]: [],
          })
        );
        const { result } = mountHook();
        dispatched.mockClear();

        act(() => {
          result.current.addCustomizations(SNACKS, { ...DONUTS, quantity: 1 }, null, {}, false);
        });

        expect(globalErrors()).toEqual([{ showErrorModal: true, errorMessage: groupMax(4, "Snacks") }]);
        expect(selectErrorMessageGlobal(store.getState())).toBe("You can choose up to 4 Snacks");
        expect(snacksIn().map((row: { id: string }) => row.id)).toEqual(["nuggets", "wings"]);
      } finally {
        store.dispatch(setAllowMultiplePunch(false));
      }
    });

    it("'+' at the group max is refused (2 units in 2 rows, item cap not hit); '−' still works and raises nothing", () => {
      store.dispatch(
        setTier1SelectedCustomization({
          [SAUCE._id]: [],
          [SNACKS._id]: [
            { ...NUGGETS, quantity: 1 },
            { ...WINGS, quantity: 1 },
          ],
          [BIG_SNACKS._id]: [],
        })
      );
      const { result } = mountHook();
      dispatched.mockClear();

      act(() => {
        result.current.increaseCustomization(SNACKS, NUGGETS, null, {});
      });
      expect(globalErrors()).toEqual([{ showErrorModal: true, errorMessage: groupMax(2, "Snacks") }]);
      expect(snacksIn().map((row: { id: string; quantity: number }) => [row.id, row.quantity])).toEqual([
        ["nuggets", 1],
        ["wings", 1],
      ]);

      dispatched.mockClear();
      act(() => {
        result.current.decreaseCustomization(SNACKS, NUGGETS);
      });
      expect(globalErrors()).toEqual([]);
      expect(snacksIn().map((row: { id: string }) => row.id)).toEqual(["wings"]);
    });

    it("the per-ITEM cap keeps its own copy (toast.alreadyReachedMaximumLimit) when the group still has room", () => {
      store.dispatch(
        setTier1SelectedCustomization({
          [SAUCE._id]: [],
          [SNACKS._id]: [],
          [BIG_SNACKS._id]: [{ ...NUGGETS, quantity: 2 }],
        })
      );
      const { result } = mountHook();
      dispatched.mockClear();

      act(() => {
        result.current.increaseCustomization(BIG_SNACKS, NUGGETS, null, {});
      });
      expect(globalErrors()).toEqual([
        { showErrorModal: true, errorMessage: i18n.t("toast.alreadyReachedMaximumLimit") },
      ]);
    });

    it("a second tap in a 1/1 group SWAPS the pick — no global error", () => {
      const { result } = mountHook();
      act(() => {
        result.current.addCustomizations(SAUCE, SAUCE.constituentItems[0], null, {}, false);
      });
      act(() => {
        result.current.addCustomizations(SAUCE, SAUCE.constituentItems[1], null, {}, false);
      });

      expect(globalErrors()).toEqual([]);
      expect(tier1SelectedCustomization(store.getState())[SAUCE._id]).toEqual([
        expect.objectContaining({ id: "hot", quantity: 1 }),
      ]);
    });

    it("a tap on a pick at the max removes / decrements it (never refused)", () => {
      store.dispatch(
        setTier1SelectedCustomization({
          [SAUCE._id]: [],
          [SNACKS._id]: [{ ...NUGGETS, quantity: 2 }],
          [BIG_SNACKS._id]: [],
        })
      );
      const { result } = mountHook();
      dispatched.mockClear();

      act(() => {
        result.current.addCustomizations(SNACKS, { ...NUGGETS, quantity: 1 }, null, {}, false);
      });
      expect(globalErrors()).toEqual([]);
      expect(snacksIn()).toEqual([expect.objectContaining({ id: "nuggets", quantity: 1 })]);
    });

    it("the auto-select pass (handleMultiAutoSelect) is never refused", () => {
      const { result } = mountHook();
      const working: Record<string, unknown[]> = {
        [SAUCE._id]: [],
        [SNACKS._id]: [{ ...NUGGETS, quantity: 2 }],
        [BIG_SNACKS._id]: [],
      };
      dispatched.mockClear();

      act(() => {
        result.current.addCustomizations(SNACKS, { ...DONUTS, quantity: 1 }, null, {}, false, true, working);
      });

      expect(globalErrors()).toEqual([]);
      expect(working[SNACKS._id].map((row) => (row as { id: string }).id)).toEqual(["nuggets", "donuts"]);
    });
  });
});
