import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Provider, useSelector } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  makeItAMealTier1BottomSheet,
  openMakeItAMealModal,
  openMakeItAMealSession,
  openTier1Modal,
  setIsForceOpenMakeItAMealModal,
  setTeir1SelectedEntity,
  setTier1BottomSheet,
  setTier1BottomSheetAndSelectedEntity,
  setTier1SelectedCustomization,
  tier1CustomizationSelectedEntity,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrentSession } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { getCalculatedBill } from "@cx-sdk/ordering/order/orderBuilder";
import { store } from "../../../redux/app/store";
import { setSelectedEntity } from "../../../redux/features/menuSelections/menuSelections.slice";
import Customization from "../../../pages/Customization";
import useCustomization from "../useCustomization";
import "../../../i18n";

/*
  Item 20 (lane bag-pdp) — the PDP half of the split edit, through the real
  PDP + useCustomization: with the bag's `splitEdit` marker the commit is ONE
  setCartItems + ONE Dexie replace + CartModified{split_edit} (split / merge),
  nothing at all (noop, a DP refusal), and without the marker it is today's
  updateItemCart exactly. BACK writes nothing. Item 23's
  addCustomizationToCart now answers true / false.

  Seams: the Dexie cart writes, analytics and navigation (spies).
*/

const mocks = vi.hoisted(() => ({
  replaceDexie: vi.fn(),
  updateRowDexie: vi.fn(),
  capture: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("../../cartHooks/useCartIndexedDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cartHooks/useCartIndexedDb")>();
  return {
    ...actual,
    default: () => ({
      ...actual.default(),
      replaceIndexedDbCart: mocks.replaceDexie,
      updateItemIndexedDbCart: mocks.updateRowDexie,
    }),
  };
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
const SAUCE = { ...ADDONS, _id: "sauce_addons", name: "Sauce", min: 1, max: 1, multiplePunchMin: 1, multiplePunchMax: 1, constituentItems: [{ id: "mild", name: "Mild", price: 0, isActive: true }] };
const PICKLES = { id: "pickles", name: "Extra Pickles", price: 1, quantity: 1 };

/** Paid CUSTOMIZABLE row: Cheese Burger + Extra Pickles × 3 (£9 a unit). */
const BURGER = (extra: Row = {}): Row => ({
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1",
  name: "Cheese Burger",
  quantity: 3,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 9,
  isMakeItAMealItem: false,
  customizations: { burger_addons: [PICKLES] },
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8, modifiers: ["burger_addons"] },
  modifiers: ["burger_addons"],
  ...extra,
});
const FRIES: Row = { id: "fries", itemId: "fr-1", name: "Fries", type: "ITEM", price: 3, quantity: 1, total_price: 3 };

/** BagSheet.handleEditRow(row, k) — the I6 recipe (k < N carries the marker). */
const seedEdit = (row: Row, k: number | undefined, cart: Row[] = [row, FRIES]) => {
  const split = k !== undefined && k < Number(row.quantity);
  store.dispatch(setModifiersMap({ modifiersMap: { burger_addons: ADDONS, sauce_addons: SAUCE } }));
  store.dispatch(setCartItems(cart));
  store.dispatch(openMakeItAMealModal({ isOpen: false, selectedItem: row.makeItAMealSelectedItem ?? {}, availableCombos: [] }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(openTier1Modal());
  store.dispatch(setTeir1SelectedEntity({ ...row, itemId: row.itemId, quantity: split ? k : row.quantity, subcategoryId: row.subCategoryId }));
  store.dispatch(
    setTier1BottomSheet({
      isOpen: true,
      type: "customizableItem",
      status: "customizableItem",
      openType: "edit",
      editCustomizationContent: row,
      ...(split ? { splitEdit: { sourceItemId: row.itemId, editQuantity: k } } : {}),
    }),
  );
  store.dispatch(setTier1SelectedCustomization(row.customizations));
  store.dispatch(setSelectedEntity({ ...(row.baseItem as Row), itemId: row.itemId }));
  store.dispatch(setIsForceOpenMakeItAMealModal(false));
};

const cartItems = () => (store.getState() as unknown as { cart: { cartItems: Row[] } }).cart.cartItems;

/** Sub Total through the real bill engine (no round-off, no charges, no offer). */
const subTotalOf = (rows: unknown[]) =>
  Number(
    getCalculatedBill(
      { cartItems: rows, charges: [], cartOffer: {} },
      {
        tabId: "",
        deploymentInfo: [{ name: "disable_roundoff", selected: true }],
        discountOnAddon: false,
        cartRdx: { cartOffer: {} },
        getAmountBasedItemValue: () => 0,
        getImageUrl: () => "",
      },
    ).getSubtotal(),
  );

/** Render the PDP and wait for the split planner handle (the bag chunk, pre-warmed). */
const renderPdp = async (reactStrictMode = false) => {
  const dispatch = vi.spyOn(store, "dispatch");
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[{ pathname: "/customization", state: { direction: "cart" } }]}>
        <Customization />
      </MemoryRouter>
    </Provider>,
    { reactStrictMode },
  );
  await act(async () => {
    await import("../../../components/cart/bagLazyParts");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  dispatch.mockClear();
  const cartActions = () =>
    dispatch.mock.calls
      .map(([action]) => String((action as UnknownAction)?.type))
      .filter((type) => type.startsWith("cart/"));
  return { cartActions };
};

const tap = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const splitEvents = () => mocks.capture.mock.calls.filter(([name]) => name === "cart_modified");

describe("useCustomization — the split-edit commit (item 20)", () => {
  beforeAll(async () => {
    Element.prototype.scrollTo = () => {};
    await import("../../../components/cart/bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mocks.replaceDexie.mockReset();
    mocks.updateRowDexie.mockReset();
    mocks.capture.mockReset();
    mocks.navigate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    "split (StrictMode %s): k = 2 of 3 + cheese → ONE setCartItems, ONE Dexie replace, CartModified split_edit; the bill is 1×9 + 2×10 + 3",
    async (strict) => {
      seedEdit(BURGER(), 2);
      expect(subTotalOf(cartItems())).toBeCloseTo(27 + 3, 2);
      const { cartActions } = await renderPdp(strict);
      expect(screen.getByTestId("pdp-qty")).toHaveTextContent("2");

      await tap("pdp-option-cheese");
      await tap("pdp-add-to-bag");

      expect(cartActions()).toEqual(["cart/setCartItems"]);
      const rows = cartItems();
      expect(mocks.replaceDexie).toHaveBeenCalledTimes(1);
      expect(mocks.replaceDexie).toHaveBeenCalledWith(rows);
      expect(mocks.updateRowDexie).not.toHaveBeenCalled();
      expect(splitEvents()).toEqual([
        ["cart_modified", { modification_type: "split_edit", item_id: "cheese-burger", quantity: 2 }],
      ]);

      expect(rows.map((row) => [row.id, row.quantity])).toEqual([
        ["cheese-burger", 1],
        ["cheese-burger", 2],
        ["fries", 1],
      ]);
      expect(rows[0]).toMatchObject({ itemId: "cb-1", total_price: 9 });
      expect((rows[0].customizations as Record<string, Row[]>).burger_addons.map((p) => p.id)).toEqual(["pickles"]);
      expect(rows[1].itemId).not.toBe("cb-1");
      expect(rows[1].total_price).toBeCloseTo(10, 2);
      expect((rows[1].customizations as Record<string, Row[]>).burger_addons.map((p) => p.id).sort()).toEqual([
        "cheese",
        "pickles",
      ]);
      expect(rows[2]).toEqual(FRIES);
      expect(subTotalOf(rows)).toBeCloseTo(9 + 20 + 3, 2);
      expect(mocks.navigate.mock.calls.map(([path]) => path)).toContain("/cart");
    },
  );

  it("merge: the same configuration at a raised stepper → the source becomes N − k + q, still one write", async () => {
    seedEdit(BURGER(), 2);
    const { cartActions } = await renderPdp();
    await tap("pdp-qty-increase");
    expect(screen.getByTestId("pdp-qty")).toHaveTextContent("3");
    await tap("pdp-add-to-bag");

    expect(cartActions()).toEqual(["cart/setCartItems"]);
    expect(mocks.replaceDexie).toHaveBeenCalledTimes(1);
    expect(cartItems().map((row) => [row.itemId, row.quantity])).toEqual([
      ["cb-1", 3 - 2 + 3],
      ["fr-1", 1],
    ]);
    expect(subTotalOf(cartItems())).toBeCloseTo(4 * 9 + 3, 2);
    expect(splitEvents()).toHaveLength(1);
  });

  it("noop: UPDATE with nothing changed writes nothing and leaves the PDP", async () => {
    seedEdit(BURGER(), 2);
    const before = cartItems();
    const { cartActions } = await renderPdp();
    await tap("pdp-add-to-bag");

    expect(cartActions()).toEqual([]);
    expect(cartItems()).toBe(before);
    expect(mocks.replaceDexie).not.toHaveBeenCalled();
    expect(mocks.updateRowDexie).not.toHaveBeenCalled();
    expect(splitEvents()).toEqual([]);
    expect(mocks.navigate.mock.calls.map(([path]) => path)).toContain("/cart");
  });

  it("a split the DP cap refuses (checked on the SHRUNK cart) writes nothing; the PDP stays, no warning", async () => {
    // 3 DP burgers + 1 DP taco = 4 units at a cap of 4. Moving 2 units is fine;
    // raising them to 3 would hold 1 + 1 + 3 = 5.
    const taco: Row = { id: "taco", itemId: "ta-1", type: "ITEM", price: 2, quantity: 1, total_price: 2, isDpItem: true };
    const row = BURGER({ isDpItem: true });
    seedEdit(row, 2, [row, taco]);
    store.dispatch(setCurrentSession({ _id: "s-lunch", _extras: { maxQtyItem: "4" } }));
    const before = cartItems();
    const { cartActions } = await renderPdp();
    await tap("pdp-qty-increase");
    await tap("pdp-option-cheese");
    await tap("pdp-add-to-bag");

    expect(cartActions()).toEqual([]);
    expect(cartItems()).toBe(before);
    expect(mocks.replaceDexie).not.toHaveBeenCalled();
    expect(splitEvents()).toEqual([]);
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("the split source left the bag meanwhile: nothing is written, the PDP stays", async () => {
    seedEdit(BURGER(), 2);
    const { cartActions } = await renderPdp();
    act(() => {
      store.dispatch(setCartItems([FRIES]));
    });
    const before = cartItems();
    await tap("pdp-option-cheese");
    await tap("pdp-add-to-bag");
    expect(cartActions()).toEqual(["cart/setCartItems"]); // only the test's own removal above
    expect(cartItems()).toBe(before);
    expect(mocks.replaceDexie).not.toHaveBeenCalled();
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
  });

  it("without the marker (one unit, or k = N) it is today's whole-row updateItemCart — no setCartItems, no Dexie replace", async () => {
    seedEdit(BURGER(), undefined);
    const { cartActions } = await renderPdp();
    expect(screen.getByTestId("pdp-qty")).toHaveTextContent("3");
    await tap("pdp-option-cheese");
    await tap("pdp-add-to-bag");

    expect(cartActions()).toEqual(["cart/updateItemCartRdx"]);
    expect(mocks.updateRowDexie).toHaveBeenCalledTimes(1);
    expect(mocks.replaceDexie).not.toHaveBeenCalled();
    expect(splitEvents()).toEqual([]);
    expect(cartItems().map((row) => [row.itemId, row.quantity])).toEqual([
      ["cb-1", 3],
      ["fr-1", 1],
    ]);
  });

  it("BACK writes nothing — split marker or not", async () => {
    seedEdit(BURGER(), 2);
    const before = cartItems();
    const { cartActions } = await renderPdp();
    await tap("pdp-option-cheese");
    await tap("pdp-back");
    expect(cartActions()).toEqual([]);
    expect(cartItems()).toBe(before);
    expect(mocks.replaceDexie).not.toHaveBeenCalled();
    expect(mocks.updateRowDexie).not.toHaveBeenCalled();
    expect(mocks.navigate.mock.calls.map(([path]) => path)).toContain("/cart");
  });

  it("a MIAM meal row splits into two meal rows, both still carrying the meal", async () => {
    const meal = BURGER({
      itemId: "meal-1",
      uniqueItemId: "meal-1",
      quantity: 2,
      isMakeItAMealItem: true,
      makeItAMealSelectedItem: { id: "cheese-burger", name: "Cheese Burger" },
    });
    seedEdit(meal, 1);
    await renderPdp();
    await tap("pdp-option-cheese");
    await tap("pdp-add-to-bag");
    const rows = cartItems();
    expect(rows.map((row) => [row.itemId === "meal-1", row.quantity])).toEqual([
      [true, 1],
      [false, 1],
      [false, 1],
    ]);
    for (const row of rows.slice(0, 2)) {
      expect(row).toMatchObject({ isMakeItAMealItem: true, makeItAMealSelectedItem: { id: "cheese-burger" } });
    }
  });

  /* ---- mutation-verifier additions (lane bag-pdp, item 20) ---- */

  it("a 'replace' plan (the live source already holds only k units) is today's whole-row update: one updateItemCartRdx, no Dexie replace", async () => {
    seedEdit(BURGER(), 2);
    const { cartActions } = await renderPdp();
    act(() => {
      store.dispatch(setCartItems([BURGER({ quantity: 2 }), FRIES]));
    });
    await tap("pdp-option-cheese");
    await tap("pdp-add-to-bag");

    expect(cartActions()).toEqual(["cart/setCartItems", "cart/updateItemCartRdx"]); // the test's own write, then the update
    expect(mocks.updateRowDexie).toHaveBeenCalledTimes(1);
    expect(mocks.replaceDexie).not.toHaveBeenCalled();
    expect(splitEvents()).toEqual([]);
    const rows = cartItems();
    expect(rows.map((row) => [row.itemId, row.quantity])).toEqual([
      ["cb-1", 2],
      ["fr-1", 1],
    ]);
    expect((rows[0].customizations as Record<string, Row[]>).burger_addons.map((p) => p.id).sort()).toEqual([
      "cheese",
      "pickles",
    ]);
    expect(mocks.navigate.mock.calls.map(([path]) => path)).toContain("/cart");
  });

  describe("a VARIANT row (Pepsi Medium × 2, edit 1)", () => {
    const MEDIUM = { id: "pepsi-m", name: "Medium", price: 4, modifiers: [], isActive: true };
    const LARGE = { id: "pepsi-l", name: "Large", price: 5, modifiers: [], isActive: true };
    const PEPSI_BASE = { id: "pepsi", name: "Pepsi", price: 0, hasVariant: true, variants: [MEDIUM, LARGE] };
    const PEPSI: Row = {
      ...PEPSI_BASE,
      itemId: "pe-1",
      uniqueItemId: "pe-1",
      quantity: 2,
      type: "VARIANT",
      baseItem: { ...PEPSI_BASE, selectedVariantId: "pepsi-m" },
      selectedVariant: MEDIUM,
      variantPrice: 4,
      total_price: 4,
      customizations: {},
    };
    /** BagSheet.handleEditRow(PEPSI, 1) for a VARIANT row; split false = handleEditRow(PEPSI). */
    const seedVariantEdit = (split = true) => {
      store.dispatch(setModifiersMap({ modifiersMap: {} }));
      store.dispatch(setCartItems([PEPSI, FRIES]));
      store.dispatch(openMakeItAMealModal({ isOpen: false, selectedItem: {}, availableCombos: [] }));
      store.dispatch(openMakeItAMealSession());
      store.dispatch(openTier1Modal());
      store.dispatch(setTeir1SelectedEntity({ ...PEPSI, quantity: split ? 1 : PEPSI.quantity }));
      store.dispatch(
        setTier1BottomSheet({
          isOpen: true,
          type: "variant",
          status: "variant",
          openType: "edit",
          editCustomizationContent: PEPSI,
          ...(split ? { splitEdit: { sourceItemId: "pe-1", editQuantity: 1 } } : {}),
        }),
      );
      store.dispatch(setTier1SelectedCustomization({}));
      store.dispatch(setSelectedEntity({ ...(PEPSI.baseItem as Row), itemId: "pe-1" }));
      store.dispatch(setIsForceOpenMakeItAMealModal(false));
    };

    it("control: an unchanged UPDATE is a noop — nothing written, the PDP leaves", async () => {
      seedVariantEdit();
      const before = cartItems();
      const { cartActions } = await renderPdp();
      await tap("pdp-add-to-bag");
      expect(cartActions()).toEqual([]);
      expect(cartItems()).toBe(before);
      expect(mocks.navigate.mock.calls.map(([path]) => path)).toContain("/cart");
    });

    it("the split source left the bag meanwhile: nothing is written and the PDP stays (a rejected plan is not a save)", async () => {
      seedVariantEdit();
      const { cartActions } = await renderPdp();
      act(() => {
        store.dispatch(setCartItems([FRIES]));
      });
      const before = cartItems();
      await tap("pdp-add-to-bag");
      expect(cartActions()).toEqual(["cart/setCartItems"]); // only the test's own removal above
      expect(cartItems()).toBe(before);
      expect(mocks.replaceDexie).not.toHaveBeenCalled();
      expect(mocks.updateRowDexie).not.toHaveBeenCalled();
      expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
      expect(mocks.navigate).not.toHaveBeenCalled();
    });

    /* The edit commit keeps the session's size over the row's own (the add
       builder's trailing row spread put the old one back). */
    const updateToLarge = async () => {
      await tap("pdp-change-size");
      await tap("pdp-variant-pepsi-l");
      await tap("pdp-add-to-bag");
    };

    it("split with a size change: 1 × Medium stays, 1 × Large is a new row, in one write", async () => {
      seedVariantEdit();
      const { cartActions } = await renderPdp();
      await updateToLarge();

      expect(cartActions()).toEqual(["cart/setCartItems"]);
      const rows = cartItems();
      expect(mocks.replaceDexie).toHaveBeenCalledWith(rows);
      expect(rows.map((row) => [row.itemId === "pe-1", row.quantity, (row.selectedVariant as Row)?.id])).toEqual([
        [true, 1, "pepsi-m"],
        [false, 1, "pepsi-l"],
        [false, 1, undefined],
      ]);
      expect(rows[0]).toMatchObject({ variantPrice: 4, total_price: 4 });
      expect(rows[1]).toMatchObject({
        id: "pepsi",
        type: "VARIANT",
        variantPrice: 5,
        total_price: 5,
        baseItem: { id: "pepsi", selectedVariantId: "pepsi-l", selectedVariantName: "Large" },
      });
      expect((rows[1].baseItem as Row).baseItem).toBeUndefined();
      expect(subTotalOf(rows)).toBeCloseTo(4 + 5 + 3, 2);
      expect(splitEvents()).toEqual([
        ["cart_modified", { modification_type: "split_edit", item_id: "pepsi", quantity: 1 }],
      ]);
    });

    it("whole-row edit with a size change: the row itself becomes Large (one updateItemCartRdx)", async () => {
      seedVariantEdit(false);
      const { cartActions } = await renderPdp();
      await updateToLarge();

      expect(cartActions()).toEqual(["cart/updateItemCartRdx"]);
      expect(mocks.updateRowDexie).toHaveBeenCalledTimes(1);
      const rows = cartItems();
      expect(rows.map((row) => [row.itemId, row.quantity, (row.selectedVariant as Row)?.id])).toEqual([
        ["pe-1", 2, "pepsi-l"],
        ["fr-1", 1, undefined],
      ]);
      expect(rows[0]).toMatchObject({
        variantPrice: 5,
        total_price: 5,
        baseItem: { id: "pepsi", selectedVariantId: "pepsi-l", selectedVariantName: "Large" },
      });
      expect(subTotalOf(rows)).toBeCloseTo(2 * 5 + 3, 2);
    });
  });
});

describe("useCustomization.addCustomizationToCart answers whether it added (item 23)", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>{children}</MemoryRouter>
    </Provider>
  );
  const mount = () =>
    renderHook(
      () =>
        useCustomization({
          cartRef: { current: null },
          isOpenBottomSheet: useSelector(makeItAMealTier1BottomSheet),
          SelectedEntity: useSelector(tier1CustomizationSelectedEntity),
          selectedCustomizations: useSelector(tier1SelectedCustomization),
          setSelectedCustomizations: setTier1SelectedCustomization,
        }),
      { wrapper },
    );
  const openNew = (selections: Record<string, unknown[]>) => {
    store.dispatch(setModifiersMap({ modifiersMap: { sauce_addons: SAUCE } }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
        selectedEntity: { id: "burger", name: "Burger", price: 8, modifiers: ["sauce_addons"], quantity: 1 },
      }),
    );
    store.dispatch(setTier1SelectedCustomization(selections));
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mocks.capture.mockReset();
  });

  it("false when a required group is incomplete (nothing added)", () => {
    openNew({ sauce_addons: [] });
    const { result } = mount();
    let added: unknown;
    act(() => {
      added = result.current.addCustomizationToCart(undefined);
    });
    expect(added).toBe(false);
    expect(cartItems()).toHaveLength(0);
    expect(mocks.capture).not.toHaveBeenCalledWith("item_added_to_cart", expect.anything());
  });

  it("true when the row was committed", () => {
    openNew({ sauce_addons: [{ id: "mild", name: "Mild", price: 0, quantity: 1 }] });
    const { result } = mount();
    let added: unknown;
    act(() => {
      added = result.current.addCustomizationToCart(undefined);
    });
    expect(added).toBe(true);
    expect(cartItems()).toHaveLength(1);
    expect(mocks.capture).toHaveBeenCalledWith("item_added_to_cart", expect.objectContaining({ item_id: "burger" }));
  });
});
