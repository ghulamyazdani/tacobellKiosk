import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  openMakeItAMealModal,
  openMakeItAMealSession,
  openTier1Modal,
  setIsForceOpenMakeItAMealModal,
  setTeir1SelectedEntity,
  setTier1BottomSheet,
  setTier1BottomSheetAndSelectedEntity,
  setTier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { store } from "../../../redux/app/store";
import { setSelectedEntity } from "../../../redux/features/menuSelections/menuSelections.slice";
import Customization from "../index";
import "../../../i18n";

/*
  Lane bag-pdp — the PDP's lazy parts ride in the ONE bag chunk (D7). When
  that chunk fails to load (a deploy re-hashed it; Chromium caches the failed
  fetch for the life of the page) the PDP must keep a working path:
  - item 23: a failed ADD TO BAG shows no warning — today's ring only — and
    finishing the group still adds;
  - item 20: a split edit has no planner, so UPDATE writes nothing and the PDP
    stays; BACK still leaves with the bag untouched.
  The whole chunk REALLY rejects here: one of its modules fails to evaluate.
*/

const mocks = vi.hoisted(() => ({ capture: vi.fn(), navigate: vi.fn() }));

vi.mock("../../../components/cart/OrderTypeSwitchFlow", () => {
  throw new TypeError("Failed to fetch dynamically imported module: /assets/bagLazyParts-0ld.js");
});

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: mocks.capture,
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

type Row = Record<string, unknown>;
const cartItems = () => (store.getState() as unknown as { cart: { cartItems: Row[] } }).cart.cartItems;

const ADDONS = {
  _id: "burger_addons",
  name: "Toppings",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "pickles", name: "Extra Pickles", price: 1, isActive: true },
    { id: "cheese", name: "Add Cheese", price: 1, isActive: true },
  ],
};

const DRINK = {
  _id: "pack1_2_combo",
  name: "Drink",
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "cola", name: "Cola", price: 0, isActive: true }],
};

const BURGER: Row = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1",
  name: "Cheese Burger",
  quantity: 3,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 9,
  customizations: { burger_addons: [{ id: "pickles", name: "Extra Pickles", price: 1, quantity: 1 }] },
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8, modifiers: ["burger_addons"] },
  modifiers: ["burger_addons"],
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[{ pathname: "/customization", state: { direction: "cart" } }]}>
        <Customization />
      </MemoryRouter>
    </Provider>,
  );

const tap = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

/** Let a rejected dynamic import settle (it is not on React's clock). */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("the PDP keeps working when the lazy bag chunk failed (lane bag-pdp)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mocks.capture.mockReset();
    mocks.navigate.mockReset();
    // React reports boundary-caught errors; the hook logs its caught commit.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the simulation is a real rejection: the chunk cannot be imported", async () => {
    await expect(import("../../../components/cart/bagLazyParts")).rejects.toThrow();
  });

  it("item 23: a failed ADD TO BAG shows no warning — the ring stays — and finishing the slot still adds", async () => {
    store.dispatch(setModifiersMap({ modifiersMap: { [DRINK._id]: DRINK } }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
        selectedEntity: { id: "pack1", name: "Pack", price: 9.99, modifiers: [DRINK._id] },
      }),
    );
    renderPdp();
    await tap("pdp-add-to-bag");
    await waitFor(() =>
      expect(mocks.capture).toHaveBeenCalledWith(
        "error_occurred",
        expect.objectContaining({ error_source: "react_boundary", recovery_path: "local_fallback" }),
      ),
    );
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(screen.getByTestId(`pack-slot-${DRINK._id}`)).toHaveClass("ring-4", "ring-red-500");
    expect(cartItems()).toHaveLength(0);

    await tap(`pack-slot-open-${DRINK._id}`);
    await tap("slot-option-cola");
    await tap("slot-sheet-save");
    await tap("pdp-add-to-bag");
    expect(cartItems()).toHaveLength(1);
    expect(cartItems()[0]).toMatchObject({ id: "pack1", quantity: 1 });
  });

  it("item 20: without its planner a split edit writes nothing and the PDP stays; BACK leaves, bag untouched", async () => {
    store.dispatch(setModifiersMap({ modifiersMap: { burger_addons: ADDONS } }));
    store.dispatch(setCartItems([{ ...BURGER }]));
    store.dispatch(openMakeItAMealModal({ isOpen: false, selectedItem: {}, availableCombos: [] }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(openTier1Modal());
    store.dispatch(setTeir1SelectedEntity({ ...BURGER, quantity: 2 }));
    store.dispatch(
      setTier1BottomSheet({
        isOpen: true,
        type: "customizableItem",
        status: "customizableItem",
        openType: "edit",
        editCustomizationContent: BURGER,
        splitEdit: { sourceItemId: "cb-1", editQuantity: 2 },
      }),
    );
    store.dispatch(setTier1SelectedCustomization(BURGER.customizations));
    store.dispatch(setSelectedEntity({ ...(BURGER.baseItem as Row), itemId: "cb-1" }));
    store.dispatch(setIsForceOpenMakeItAMealModal(false));
    const before = cartItems();
    renderPdp();
    await settle();

    await tap("pdp-option-cheese");
    await tap("pdp-add-to-bag");
    await settle();
    expect(cartItems()).toBe(before);
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(mocks.capture).not.toHaveBeenCalledWith("cart_modified", expect.anything());

    await tap("pdp-back");
    expect(cartItems()).toBe(before);
    expect(mocks.navigate.mock.calls.map(([path]) => path)).toContain("/cart");
  });
});
