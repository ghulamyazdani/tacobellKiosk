import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { UnknownAction } from "@reduxjs/toolkit";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  openMakeItAMealModal,
  openMakeItAMealSession,
  openTier1Modal,
  setIsForceOpenMakeItAMealModal,
  setTeir1SelectedEntity,
  setTier1BottomSheet,
  setTier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { store } from "../../../redux/app/store";
import { setSelectedEntity } from "../../../redux/features/menuSelections/menuSelections.slice";
import BagSheet from "../BagSheet";
import "../../../i18n";

/*
  Item 20 (lane bag-pdp, Figma 1:4460) — the bag half of the split edit: Edit
  on a one-unit row goes straight to the PDP (today's path); on an N-unit row
  it first asks "how many" — k < N seeds the PDP with k units plus the
  `splitEdit` marker, k = N dispatches TODAY's whole-row recipe byte for byte
  (5112a94 handleEditRow, transcribed below), cancel writes nothing.

  Seams: navigation (a spy), analytics (a spy) and auto-apply (to read its
  `blocked` input).
*/

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), capture: vi.fn(), autoApply: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: mocks.capture,
}));

vi.mock("../../../hooks/offerHooks/useOfferAutoApply", () => ({
  default: (input: { blocked: boolean }) => mocks.autoApply(input),
}));

type Row = Record<string, unknown>;

const BURGER = (quantity: number): Row => ({
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1",
  name: "Cheese Burger",
  quantity,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 9,
  subCategoryId: "burgers",
  customizations: { burger_addons: [{ id: "pickles", name: "Extra Pickles", price: 1, quantity: 1 }] },
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8, modifiers: ["burger_addons"] },
});

const PEPSI = (quantity: number): Row => ({
  id: "pepsi",
  itemId: "pe-1",
  uniqueItemId: "pe-1",
  name: "Pepsi",
  quantity,
  type: "VARIANT",
  price: 0,
  variantPrice: 3,
  total_price: 3,
  selectedVariant: { id: "pepsi-l", name: "Large", price: 3 },
  customizations: {},
  baseItem: { id: "pepsi", name: "Pepsi", hasVariant: true },
});

/** A MIAM meal row — its prompt item rides into the tier-1 session. */
const MEAL = (quantity: number): Row => ({
  ...BURGER(quantity),
  itemId: "meal-1",
  uniqueItemId: "meal-1",
  isMakeItAMealItem: true,
  makeItAMealSelectedItem: { id: "cheese-burger", name: "Cheese Burger" },
});

/** 5112a94 BagSheet.handleEditRow — the pre-lane recipe, verbatim. */
const PRE_LANE_RECIPE = (row: Row): UnknownAction[] => [
  openMakeItAMealModal({
    isOpen: false,
    selectedItem: row?.makeItAMealSelectedItem ?? {},
    availableCombos: [],
  }),
  openMakeItAMealSession(),
  openTier1Modal(),
  setTeir1SelectedEntity({
    ...row,
    itemId: row?.itemId,
    quantity: row?.quantity,
    subcategoryId: row?.subCategoryId,
  }),
  setTier1BottomSheet({
    isOpen: true,
    type: row?.type === "VARIANT" ? "variant" : "customizableItem",
    status: row?.type === "VARIANT" ? "variant" : "customizableItem",
    openType: "edit",
    editCustomizationContent: row,
  }),
  setTier1SelectedCustomization(row?.customizations),
  setSelectedEntity({ ...(row?.baseItem as Row), itemId: row?.itemId }),
  setIsForceOpenMakeItAMealModal(false),
];

const EDIT_TYPES = /^(makeItAMeal\/|menuSelections\/setSelectedEntity$)/;

const renderBag = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );

/** The live row as the bag reads it (the reducer may normalise the seed). */
const liveRow = (at = 0) => (store.getState() as unknown as { cart: { cartItems: Row[] } }).cart.cartItems[at];
const tier1 = () =>
  (
    store.getState() as unknown as {
      makeItAMeal: {
        makeItAMealModal: {
          tier1CustomizationModal: { bottomSheet: Row; customizations: { selectedEntity: Row } };
        };
      };
    }
  ).makeItAMeal.makeItAMealModal.tier1CustomizationModal;
const lastBlocked = () => (mocks.autoApply.mock.calls.at(-1)?.[0] as { blocked: boolean }).blocked;

/** Edit → the lazy numpad, inside act so its chunk resolves in scope. */
const tapEdit = async (itemId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`bag-edit-${itemId}`));
  });
  return screen.findByTestId("edit-how-many");
};

/** Edit → the (lazy) numpad → type k → EDIT; returns the edit dispatches. */
const editHowMany = async (itemId: string, keys: string[]) => {
  const dispatch = vi.spyOn(store, "dispatch");
  await tapEdit(itemId);
  expect(mocks.navigate).not.toHaveBeenCalled();
  dispatch.mockClear();
  for (const key of keys) fireEvent.click(screen.getByTestId(`numpad-key-${key}`));
  await act(async () => {
    fireEvent.click(screen.getByTestId("edit-how-many-confirm"));
  });
  const actions = dispatch.mock.calls
    .map(([action]) => action as UnknownAction)
    .filter((action) => EDIT_TYPES.test(String(action?.type)));
  dispatch.mockRestore();
  return actions;
};

describe("BagSheet — Edit asks how many on a multi-unit row (item 20)", () => {
  beforeAll(async () => {
    await import("../bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    mocks.navigate.mockReset();
    mocks.capture.mockReset();
    mocks.autoApply.mockReset();
  });

  it("qty 1: Edit goes straight to the PDP with today's recipe — no numpad, no splitEdit", () => {
    store.dispatch(setCartItems([BURGER(1)]));
    // Spy before render: useDispatch hands the component the function it saw then.
    const dispatch = vi.spyOn(store, "dispatch");
    renderBag();
    dispatch.mockClear();
    fireEvent.click(screen.getByTestId("bag-edit-cb-1"));

    expect(screen.queryByTestId("edit-how-many")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-how-many-loading")).not.toBeInTheDocument();
    const actions = dispatch.mock.calls
      .map(([action]) => action as UnknownAction)
      .filter((action) => EDIT_TYPES.test(String(action?.type)));
    expect(JSON.stringify(actions)).toBe(JSON.stringify(PRE_LANE_RECIPE(liveRow())));
    expect(tier1().bottomSheet).not.toHaveProperty("splitEdit");
    expect(mocks.navigate).toHaveBeenCalledWith("/customization", { state: { direction: "cart" } });
    expect(mocks.capture).toHaveBeenCalledWith("item_customize_in_cart_clicked", { item_id: "cheese-burger" });
    dispatch.mockRestore();
  });

  it("qty 3: Edit opens the numpad (lazy) and holds auto-apply off; nothing reaches the tier-1 session yet", async () => {
    store.dispatch(setCartItems([BURGER(3)]));
    const dispatch = vi.spyOn(store, "dispatch"); // before render: see the qty-1 case
    renderBag();
    dispatch.mockClear();
    expect(lastBlocked()).toBe(false);
    await tapEdit("cb-1");
    const dialog = screen.getByRole("dialog", { name: "You have 3 Cheese Burger" });
    expect(dialog).toHaveAttribute("data-testid", "edit-how-many");
    expect(lastBlocked()).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(
      dispatch.mock.calls.some(([action]) => EDIT_TYPES.test(String((action as UnknownAction)?.type))),
    ).toBe(false);
    expect(tier1().bottomSheet?.openType).not.toBe("edit");
    dispatch.mockRestore();
  });

  it("confirm(2) of 3: the PDP is seeded with 2 units plus splitEdit { sourceItemId, editQuantity }", async () => {
    store.dispatch(setCartItems([BURGER(3)]));
    renderBag();
    const actions = await editHowMany("cb-1", ["2"]);
    const row = liveRow();

    const expected = PRE_LANE_RECIPE(row);
    expected[3] = setTeir1SelectedEntity({ ...row, itemId: "cb-1", quantity: 2, subcategoryId: "burgers" });
    expected[4] = setTier1BottomSheet({
      isOpen: true,
      type: "customizableItem",
      status: "customizableItem",
      openType: "edit",
      editCustomizationContent: row,
      splitEdit: { sourceItemId: "cb-1", editQuantity: 2 },
    });
    expect(actions).toEqual(expected);
    expect(tier1().bottomSheet.splitEdit).toEqual({ sourceItemId: "cb-1", editQuantity: 2 });
    expect(tier1().customizations.selectedEntity).toMatchObject({ itemId: "cb-1", quantity: 2 });
    // The bag row itself is untouched until the PDP commits.
    expect(liveRow()).toMatchObject({ itemId: "cb-1", quantity: 3 });
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/customization", { state: { direction: "cart" } });
    expect(screen.queryByTestId("edit-how-many")).not.toBeInTheDocument();
  });

  it("confirm(3) of 3 dispatches TODAY's whole-row recipe byte for byte — no splitEdit key", async () => {
    store.dispatch(setCartItems([BURGER(3)]));
    renderBag();
    const actions = await editHowMany("cb-1", ["3"]);

    expect(JSON.stringify(actions)).toBe(JSON.stringify(PRE_LANE_RECIPE(liveRow())));
    expect(tier1().bottomSheet).not.toHaveProperty("splitEdit");
    expect(tier1().customizations.selectedEntity.quantity).toBe(3);
    expect(mocks.navigate).toHaveBeenCalledWith("/customization", { state: { direction: "cart" } });
  });

  it("a sized (VARIANT) row splits as a variant edit", async () => {
    store.dispatch(setCartItems([PEPSI(2)]));
    renderBag();
    await editHowMany("pe-1", ["1"]);
    expect(tier1().bottomSheet).toMatchObject({
      type: "variant",
      status: "variant",
      openType: "edit",
      splitEdit: { sourceItemId: "pe-1", editQuantity: 1 },
    });
    expect(tier1().customizations.selectedEntity).toMatchObject({ itemId: "pe-1", quantity: 1 });
  });

  it("a MIAM meal row keeps its prompt item in the split session", async () => {
    store.dispatch(setCartItems([MEAL(4)]));
    renderBag();
    const actions = await editHowMany("meal-1", ["3"]);
    expect(actions[0]).toEqual(
      openMakeItAMealModal({
        isOpen: false,
        selectedItem: { id: "cheese-burger", name: "Cheese Burger" },
        availableCombos: [],
      }),
    );
    expect(tier1().bottomSheet.splitEdit).toEqual({ sourceItemId: "meal-1", editQuantity: 3 });
    expect(tier1().customizations.selectedEntity).toMatchObject({ isMakeItAMealItem: true, quantity: 3 });
  });

  it("X cancels: nothing reaches the tier-1 session, no navigation, auto-apply released", async () => {
    store.dispatch(setCartItems([BURGER(3)]));
    const dispatch = vi.spyOn(store, "dispatch");
    renderBag();
    dispatch.mockClear();
    await tapEdit("cb-1");
    fireEvent.click(screen.getByTestId("numpad-key-2"));
    fireEvent.click(screen.getByTestId("edit-how-many-close"));

    expect(screen.queryByTestId("edit-how-many")).not.toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(
      dispatch.mock.calls.some(([action]) => EDIT_TYPES.test(String((action as UnknownAction)?.type))),
    ).toBe(false);
    expect(tier1().bottomSheet?.openType).not.toBe("edit");
    expect(lastBlocked()).toBe(false);
    expect(liveRow()).toMatchObject({ quantity: 3 });
    dispatch.mockRestore();
  });

  it("EDIT at 0 is inert (aria-disabled): the numpad stays, nothing is dispatched", async () => {
    store.dispatch(setCartItems([BURGER(3)]));
    renderBag();
    await tapEdit("cb-1");
    const confirm = screen.getByTestId("edit-how-many-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(confirm);
    expect(screen.getByTestId("edit-how-many")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
