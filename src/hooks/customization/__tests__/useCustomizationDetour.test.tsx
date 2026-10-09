import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider, useSelector } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  makeItAMealTier1BottomSheet,
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
  setTier1SelectedCustomization,
  tier1CustomizationSelectedEntity,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrentSession } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import { selectShowErrorModalGlobal } from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import {
  selectAddToCartItem,
  selectAddToCartModal,
  selectRecommendationDetour,
  setRecommendationDetour,
} from "../../../redux/features/menuSelections/menuSelections.slice";
import useCustomization from "../useCustomization";
import "../../../i18n";

// Analytics are asserted per event (review R2).
const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mocks.capture(...args),
}));

/*
  Lane added-modal F3 — a strip suggestion that needs a choice leaves the
  product-added modal with recommendationDetour set, and the next added-modal
  open consumes it (useCartHook: that modal shows no strip — one hop). Every
  PDP exit runs closeModalStates (BACK, "−" at 1, ADD TO BAG, a DP refusal),
  which ends the detour, so an abandoned one never hides the NEXT add's strip.
  Never an (un)mount effect: TB renders in <StrictMode> and its dev re-mount
  would clear the flag as the PDP opens, before ADD TO BAG reads it.
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
const BURGER = { id: "burger", name: "Burger", price: 8, quantity: 1, modifiers: [SAUCE._id] };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/customization"]}>{children}</MemoryRouter>
  </Provider>
);

/** The PDP's binding of the hook (pages/Customization). */
const mountHook = (reactStrictMode = false) =>
  renderHook(
    () =>
      useCustomization({
        cartRef: { current: null },
        isOpenBottomSheet: useSelector(makeItAMealTier1BottomSheet),
        SelectedEntity: useSelector(tier1CustomizationSelectedEntity),
        selectedCustomizations: useSelector(tier1SelectedCustomization),
        setSelectedCustomizations: setTier1SelectedCustomization,
      }),
    { wrapper, reactStrictMode }
  );

const detour = () => selectRecommendationDetour(store.getState());

describe("useCustomization — every PDP exit ends a suggestion detour (added-modal F3)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    // A suggestion with options left the modal: its PDP session is open.
    store.dispatch(setModifiersMap({ modifiersMap: { [SAUCE._id]: SAUCE } }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
        selectedEntity: BURGER,
      })
    );
    store.dispatch(setTier1SelectedCustomization({ [SAUCE._id]: [] }));
    store.dispatch(setRecommendationDetour(true));
  });

  it("T7: closeModalStates (BACK / '−' at 1 / a DP refusal) clears a set flag", async () => {
    const { result } = mountHook();
    expect(detour()).toBe(true);

    await act(() => result.current.closeModalStates());

    expect(detour()).toBe(false);
  });

  it("guard: a StrictMode mount (dev re-mount) leaves a set flag set", () => {
    mountHook(true);
    expect(detour()).toBe(true);
  });

  it("guard: ADD TO BAG opens the modal WITHOUT a strip (the open consumed the flag), then the flag is false", () => {
    store.dispatch(setTier1SelectedCustomization({ [SAUCE._id]: [{ ...SAUCE.constituentItems[0], quantity: 1 }] }));
    const { result } = mountHook();

    let added: unknown;
    act(() => {
      added = result.current.addCustomizationToCart(undefined);
    });

    expect(added).toBe(true);
    expect(selectAddToCartModal(store.getState())).toBe(true);
    expect(selectAddToCartItem(store.getState())).toMatchObject({ id: BURGER.id, suppressRecommendations: true });
    expect(detour()).toBe(false);
  });

  /*
    Review R2: the DP cap refusing ADD TO BAG (addItemToCart → false) still
    answered true, so ItemAddedToCart reported a row that never landed. The
    answer is now neither true (no event) nor false (the completion warning —
    never two modals over the global error).
  */
  const HELD = { id: "held", itemId: "h-1", name: "Held", quantity: 1, type: "ITEM", isDpItem: true, price: 3, total_price: 3 };
  const LARGE = { id: "burger-l", name: "Large", price: 9, isActive: true, isDpItem: true, modifiers: [SAUCE._id] };

  it.each([
    ["options (CUSTOMIZABLE)", "customizableItem", { ...BURGER, isDpItem: true }],
    ["a size (VARIANT)", "variant", { ...BURGER, modifiers: [], hasVariant: true, variants: [LARGE] }],
    // Test stage: an offer's buy stage commits the same paid row through its
    // own add (suppressAddedModal) — the same answer when the cap refuses it.
    ["options at an offer's buy stage", "customizableItem", { ...BURGER, isDpItem: true, isBuyStageItem: true }],
    ["a size at an offer's buy stage", "variant", { ...BURGER, modifiers: [], hasVariant: true, variants: [LARGE], isBuyStageItem: true }],
  ] as const)("%s: a DP-cap refusal at ADD TO BAG — the global error alone, nothing added, no ItemAddedToCart, the detour ended", (_kind, type, entity) => {
    store.dispatch(setCurrentSession({ _id: "dp-lunch", sessionName: "Lunch", _extras: { maxQtyItem: "1" } }));
    store.dispatch(setCartItems([HELD]));
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, status: "", type, openType: "new", editCustomizationContent: {} },
        selectedEntity: entity,
      })
    );
    const { result } = mountHook();
    if (type === "variant") {
      act(() => {
        result.current.setSelectedVariant(LARGE);
        result.current.fetchAddonsForSelectedVariant(LARGE);
      });
    }
    act(() => {
      store.dispatch(setTier1SelectedCustomization({ [SAUCE._id]: [{ ...SAUCE.constituentItems[0], quantity: 1 }] }));
    });
    mocks.capture.mockClear();

    let answered: unknown = "unset";
    act(() => {
      answered = result.current.addCustomizationToCart(undefined);
    });

    expect(answered).toBeUndefined();
    expect(selectShowErrorModalGlobal(store.getState())).toBe(true);
    expect((store.getState() as unknown as { cart: { cartItems: unknown[] } }).cart.cartItems).toEqual([HELD]);
    expect(mocks.capture).not.toHaveBeenCalledWith("item_added_to_cart", expect.anything());
    expect(selectAddToCartModal(store.getState())).toBe(false);
    expect(detour()).toBe(false);
  });
});
