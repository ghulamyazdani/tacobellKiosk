/* eslint-disable @typescript-eslint/no-explicit-any --
 * Group / row fixtures mirror the untyped legacy converters + slices.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  openMakeItAMealModal,
  openMakeItAMealSession,
  openTier1Modal,
  setIsForceOpenMakeItAMealModal,
  setTeir1SelectedEntity,
  setTier1BottomSheet,
  setTier1BottomSheetAndSelectedEntity,
  setTier1SelectedCustomization,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import {
  setOutOfStockItems,
  setSelectedEntity,
} from "../../../redux/features/menuSelections/menuSelections.slice";
import Customization from "../index";
import "../../../i18n";

/*
  Lane walk-oos (user report 2026-10-14, the Honey BBQ Wings PDP, group
  "Test 3"): posistKiosk greys "Maharaja MAC" and "Veg Aloo Tikki Burger@"
  ("Unavailable", not pickable) where TB offered CHOOSE — and even had the
  out-of-stock default picked. The menu's stamp (`outOfStock` on each
  constituent item, from get_out_of_stock at conversion) was loaded all
  along; the PDP never read it, nor PAY's fresher feed map (posistKiosk
  GroupCustomizationGrid). Seams: navigation.
*/

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

/** "Test 3": up to 4, the two burgers the menu's stamp marks out of stock first in menu order. */
const TEST3 = {
  _id: "wings_3_addons",
  name: "Test 3",
  min: 0,
  max: 4,
  multiplePunchMin: 0,
  multiplePunchMax: 4,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "mac", name: "Maharaja MAC", price: 15, isActive: true, entityType: "Addon", outOfStock: true, image_url: "https://e2e.test/mac.png" },
    { id: "tikki", name: "Veg Aloo Tikki Burger@", price: 2.4, isActive: true, entityType: "Addon", isDefault: true, outOfStock: true },
    { id: "chikken", name: "Mc Chikken Burger", price: 12, isActive: true, entityType: "Addon", isDefault: true, outOfStock: false },
    { id: "butter", name: "Butter Chicken Burger", price: 19, isActive: true, entityType: "Addon", outOfStock: false },
  ],
};

/** A required 1/1 group whose every option is out of stock. */
const SAUCE = {
  _id: "wings_sauce_addons",
  name: "Sauce",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 2,
  isActive: true,
  constituentItems: [
    { id: "bbq", name: "BBQ", price: 0, isActive: true, entityType: "Addon", outOfStock: true },
    { id: "hot", name: "Hot", price: 0, isActive: true, entityType: "Addon", outOfStock: true },
  ],
};

/** A multi-punch group: stepper rows. */
const DIPS = {
  _id: "wings_dips_addons",
  name: "Dips",
  min: 0,
  max: 4,
  multiplePunchMin: 0,
  multiplePunchMax: 4,
  multiplePunchMaxItem: 3,
  order: 3,
  isActive: true,
  constituentItems: [
    { id: "ranch", name: "Ranch", price: 1, isActive: true, entityType: "Addon", outOfStock: true },
    { id: "mayo", name: "Mayo", price: 1, isActive: true, entityType: "Addon", outOfStock: false },
  ],
};

const WINGS = { id: "wings", name: "Honey BBQ Wings", price: 100, modifiers: [TEST3._id] };

const groupsMap = (...groups: any[]) =>
  Object.fromEntries(groups.map((group) => [group._id, group]));

const openNew = (entity: any, groups: any[]) => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: groupsMap(...groups) }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: {
        isOpen: true,
        status: "",
        type: entity.hasVariant ? "variant" : "customizableItem",
        openType: "new",
        editCustomizationContent: {},
        ...(entity.preselectedVariantId ? { preselectedVariantId: entity.preselectedVariantId } : {}),
      },
      selectedEntity: entity,
    })
  );
};

/** BagSheet.handleEditRow's recipe (a CUSTOMIZABLE row, or a VARIANT one). */
const openEdit = (row: any, groups: any[]) => {
  const type = row.type === "VARIANT" ? "variant" : "customizableItem";
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: groupsMap(...groups) }));
  store.dispatch(setCartItems([{ ...row }]));
  store.dispatch(openMakeItAMealModal({ isOpen: false, selectedItem: {}, availableCombos: [] }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(openTier1Modal());
  store.dispatch(setTeir1SelectedEntity({ ...row, itemId: row.itemId, quantity: row.quantity }));
  store.dispatch(
    setTier1BottomSheet({
      isOpen: true,
      type,
      status: type,
      openType: "edit",
      editCustomizationContent: row,
    })
  );
  store.dispatch(setTier1SelectedCustomization(row.customizations));
  store.dispatch(setSelectedEntity({ ...row.baseItem, itemId: row.itemId }));
  store.dispatch(setIsForceOpenMakeItAMealModal(false));
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[{ pathname: "/customization", state: { direction: "cart" } }]}>
        <Customization />
      </MemoryRouter>
    </Provider>
  );

const picks = (groupId: string) =>
  ((tier1SelectedCustomization(store.getState()) as Record<string, any[]>)?.[groupId] ?? []).map(
    (pick) => pick.id
  );
const optionOrder = (groupId: string) =>
  Array.from(
    screen.getByTestId(`pdp-group-${groupId}`).querySelectorAll('[data-testid^="pdp-option-"]')
  )
    .map((node) => node.getAttribute("data-testid"))
    .filter((id) => !/-(cta|select|customize)-/.test(String(id)));

describe("PDP out-of-stock options (walk-oos)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("the menu's stamp: the options sit last, in the menu card's unavailable look — named 'unavailable', aria-disabled, no radio or CHOOSE, and a tap picks nothing", () => {
    openNew(WINGS, [TEST3]);
    renderPdp();

    expect(optionOrder(TEST3._id)).toEqual([
      "pdp-option-chikken",
      "pdp-option-butter",
      "pdp-option-mac",
      "pdp-option-tikki",
    ]);
    const mac = screen.getByRole("group", { name: "Maharaja MAC, unavailable" });
    expect(mac).toHaveAttribute("data-testid", "pdp-option-mac");
    expect(mac).toHaveAttribute("aria-disabled", "true");
    expect(mac).toHaveTextContent("Unavailable");
    expect(within(mac).queryByRole("button")).not.toBeInTheDocument();
    expect(within(mac).queryByText("Choose")).not.toBeInTheDocument();
    expect(mac.querySelector("img")).toHaveClass("opacity-40", "grayscale");
    expect(screen.getByRole("group", { name: "Veg Aloo Tikki Burger@, unavailable" })).toBeInTheDocument();

    fireEvent.click(mac);
    expect(picks(TEST3._id)).not.toContain("mac");
    // An in-stock option is still the ordinary card.
    expect(screen.getByTestId("pdp-option-butter").tagName).toBe("BUTTON");
  });

  it("an out-of-stock DEFAULT is never pre-selected; the in-stock default is — the count says 1 of 4", () => {
    openNew(WINGS, [TEST3]);
    renderPdp();

    expect(picks(TEST3._id)).toEqual(["chikken"]);
    expect(screen.getByTestId(`pdp-group-${TEST3._id}`)).toHaveTextContent("1 of 4");
    expect(screen.getByTestId("pdp-option-chikken")).toHaveAttribute("aria-pressed", "true");
  });

  it("PAY's feed map wins over the stamp (posistKiosk's overlay): an option-typed entry greys an in-stock option and frees a stamped one; an item-typed entry changes nothing", () => {
    openNew(WINGS, [TEST3]);
    store.dispatch(
      setOutOfStockItems({
        butter: { _id: "butter", type: "addon", inStock: false },
        mac: { _id: "mac", type: "addon", inStock: true },
        chikken: { _id: "chikken", type: "item", inStock: false },
      })
    );
    renderPdp();

    expect(screen.getByRole("group", { name: "Butter Chicken Burger, unavailable" })).toBeInTheDocument();
    expect(screen.getByTestId("pdp-option-mac").tagName).toBe("BUTTON");
    expect(screen.getByTestId("pdp-option-chikken").tagName).toBe("BUTTON");
    fireEvent.click(screen.getByTestId("pdp-option-mac"));
    expect(picks(TEST3._id)).toContain("mac");
  });

  it("a stepper row out of stock: the chip where the stepper sits, no − / +, named unavailable", () => {
    openNew({ ...WINGS, modifiers: [DIPS._id] }, [DIPS]);
    renderPdp();

    const ranch = screen.getByRole("group", { name: "Ranch, unavailable" });
    expect(ranch).toHaveAttribute("data-testid", "pdp-option-ranch");
    expect(ranch).toHaveTextContent("Unavailable");
    expect(within(ranch).queryByRole("button")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("pdp-option-mayo")).getAllByRole("button")).toHaveLength(2);
    expect(optionOrder(DIPS._id)).toEqual(["pdp-option-mayo", "pdp-option-ranch"]);
  });

  it("a REQUIRED group with every option out of stock stays required (posistKiosk): ADD TO BAG is refused and the group rings", () => {
    openNew({ ...WINGS, modifiers: [SAUCE._id] }, [SAUCE]);
    renderPdp();

    expect(screen.getByRole("group", { name: "BBQ, unavailable" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pdp-add-to-bag"));
    expect((store.getState() as any).cart.cartItems).toEqual([]);
    expect(screen.getByTestId(`pdp-group-${SAUCE._id}`)).toHaveClass("ring-red-500");
  });

  it("EDIT from the bag: a pick out of stock now is deselected (the stamp, nested picks too); a kept pick's stale PAY flag clears; UPDATE commits without it", () => {
    const NEST = {
      _id: "chikken_nest_addons",
      name: "Extras",
      min: 0,
      max: 2,
      multiplePunchMin: 0,
      multiplePunchMax: 2,
      multiplePunchMaxItem: 1,
      order: 1,
      isActive: true,
      constituentItems: [
        { id: "salt", name: "Salt", price: 0, isActive: true, entityType: "Addon", outOfStock: true },
        { id: "pepper", name: "Pepper", price: 0, isActive: true, entityType: "Addon", outOfStock: false },
      ],
    };
    const row = {
      id: "wings",
      itemId: "w-1",
      name: "Honey BBQ Wings",
      quantity: 1,
      type: "CUSTOMIZABLE",
      price: 100,
      total_price: 127,
      modifiers: [TEST3._id],
      baseItem: { id: "wings", name: "Honey BBQ Wings", price: 100, modifiers: [TEST3._id] },
      customizations: {
        [TEST3._id]: [
          { id: "mac", name: "Maharaja MAC", price: 15, quantity: 1, entityType: "Addon", outOfStock: true },
          {
            id: "chikken",
            itemId: "c-1",
            name: "Mc Chikken Burger",
            price: 12,
            quantity: 1,
            entityType: "Addon",
            outOfStock: true,
            customizations: {
              [NEST._id]: [
                { id: "salt", name: "Salt", price: 0, quantity: 1 },
                { id: "pepper", name: "Pepper", price: 0, quantity: 1 },
              ],
            },
          },
        ],
      },
    };
    openEdit(row, [TEST3, NEST]);
    renderPdp();

    const selections = tier1SelectedCustomization(store.getState()) as Record<string, any[]>;
    expect(selections[TEST3._id].map((pick) => pick.id)).toEqual(["chikken"]);
    expect(selections[TEST3._id][0].outOfStock).toBe(false);
    expect(selections[TEST3._id][0].customizations[NEST._id].map((pick: any) => pick.id)).toEqual(["pepper"]);
    expect(screen.getByTestId(`pdp-group-${TEST3._id}`)).toHaveTextContent("1 of 4");

    act(() => {
      fireEvent.click(screen.getByTestId("pdp-add-to-bag"));
    });
    const [committed] = (store.getState() as any).cart.cartItems;
    expect(committed.customizations[TEST3._id].map((pick: any) => pick.id)).toEqual(["chikken"]);
    expect(committed.customizations[TEST3._id][0].outOfStock).toBe(false);
  });

  it("EDIT: a pick PAY's feed map marks out of stock is deselected even where the menu's stamp still says in stock", () => {
    const row = {
      id: "wings",
      itemId: "w-1",
      name: "Honey BBQ Wings",
      quantity: 1,
      type: "CUSTOMIZABLE",
      price: 100,
      total_price: 131,
      modifiers: [TEST3._id],
      baseItem: { id: "wings", name: "Honey BBQ Wings", price: 100, modifiers: [TEST3._id] },
      customizations: {
        [TEST3._id]: [
          { id: "butter", name: "Butter Chicken Burger", price: 19, quantity: 1, entityType: "Addon", outOfStock: true },
          { id: "chikken", name: "Mc Chikken Burger", price: 12, quantity: 1, entityType: "Addon" },
        ],
      },
    };
    openEdit(row, [TEST3]);
    store.dispatch(setOutOfStockItems({ butter: { _id: "butter", type: "addon", inStock: false } }));
    renderPdp();

    expect(picks(TEST3._id)).toEqual(["chikken"]);
  });

  // Review F2: the sized-row branch restores the row's picks itself (its
  // add-on fetch wipes them) — a flagged add-on kept there would sit
  // Unavailable with no REMOVE, and every PAY would block on it again.
  it("EDIT a SIZED row: its add-ons out of stock now are deselected too — the stamp's and the feed map's", () => {
    const EXTRAS_L = { ...TEST3, _id: "cola_l_addons" };
    const LARGE = { id: "cola-l", name: "Large", price: 3, isActive: true, outOfStock: false, modifiers: [EXTRAS_L._id] };
    const row = {
      id: "cola",
      itemId: "c-1",
      name: "Cola",
      quantity: 1,
      type: "VARIANT",
      price: 2,
      variantPrice: 3,
      total_price: 49,
      selectedVariant: LARGE,
      baseItem: { id: "cola", name: "Cola", price: 2, hasVariant: true, variants: [LARGE] },
      customizations: {
        [EXTRAS_L._id]: [
          { id: "mac", name: "Maharaja MAC", price: 15, quantity: 1, entityType: "Addon" },
          { id: "butter", name: "Butter Chicken Burger", price: 19, quantity: 1, entityType: "Addon", outOfStock: true },
          { id: "chikken", name: "Mc Chikken Burger", price: 12, quantity: 1, entityType: "Addon" },
        ],
      },
    };
    openEdit(row, [EXTRAS_L]);
    store.dispatch(setOutOfStockItems({ butter: { _id: "butter", type: "addon", inStock: false } }));
    renderPdp();

    expect(picks(EXTRAS_L._id)).toEqual(["chikken"]);
  });

  it("EDIT: a pick whose option left the menu goes by its own PAY flag — flagged, it is deselected", () => {
    const row = {
      id: "wings",
      itemId: "w-1",
      name: "Honey BBQ Wings",
      quantity: 1,
      type: "CUSTOMIZABLE",
      price: 100,
      total_price: 117,
      modifiers: [TEST3._id],
      baseItem: { id: "wings", name: "Honey BBQ Wings", price: 100, modifiers: [TEST3._id] },
      customizations: {
        [TEST3._id]: [
          { id: "retired", name: "Retired Burger", price: 5, quantity: 1, entityType: "Addon", outOfStock: true },
          { id: "chikken", name: "Mc Chikken Burger", price: 12, quantity: 1, entityType: "Addon" },
        ],
      },
    };
    openEdit(row, [TEST3]);
    renderPdp();

    expect(picks(TEST3._id)).toEqual(["chikken"]);
  });
});

describe("PDP out-of-stock sizes and pack slots (walk-oos)", () => {
  const EXTRAS = { ...TEST3, _id: "cola_l_addons", constituentItems: [TEST3.constituentItems[3]] };
  const COLA = {
    id: "cola",
    name: "Cola",
    price: 2,
    hasVariant: true,
    variants: [
      { id: "cola-l", name: "Large", price: 3, isActive: true, outOfStock: true, modifiers: [EXTRAS._id] },
      { id: "cola-s", name: "Small", price: 2, isActive: true, outOfStock: false, modifiers: [] },
      { id: "cola-m", name: "Medium", price: 2.5, isActive: true, outOfStock: false, modifiers: [] },
    ],
  };

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("the size grid: an out-of-stock size is last, disabled and named unavailable — a tap chooses nothing", () => {
    openNew(COLA, [EXTRAS]);
    renderPdp();

    const tiles = Array.from(
      screen.getByTestId("pdp-variant-picker").querySelectorAll('[data-testid^="pdp-variant-cola"]')
    ).map((node) => node.getAttribute("data-testid"));
    expect(tiles).toEqual(["pdp-variant-cola-s", "pdp-variant-cola-m", "pdp-variant-cola-l"]);
    const large = screen.getByRole("button", { name: "Large, unavailable" });
    expect(large).toBeDisabled();
    expect(large).toHaveTextContent("Unavailable");
    fireEvent.click(large);
    expect(screen.getByTestId("pdp-variant-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-change-size")).not.toBeInTheDocument();
  });

  it.each([
    ["preselected by Select a Size", { ...COLA, preselectedVariantId: "cola-l" }],
    ["the lone size", { ...COLA, variants: [COLA.variants[0]] }],
  ])("an out-of-stock size is never opened on (%s): the grid shows instead", (_label, entity) => {
    openNew(entity, [EXTRAS]);
    renderPdp();

    expect(screen.getByTestId("pdp-variant-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-change-size")).not.toBeInTheDocument();
  });

  it("a pack slot: the sheet lists an out-of-stock option last, greyed and inert; the slot previews an in-stock one", () => {
    const SLOT = {
      _id: "box_1_combo",
      name: "Side",
      type: "Combo",
      min: 1,
      max: 1,
      multiplePunchMin: 1,
      multiplePunchMax: 1,
      multiplePunchMaxItem: 1,
      order: 1,
      isActive: true,
      constituentItems: [
        { id: "fries", name: "Fries", price: 0, isActive: true, entityType: "Combo", outOfStock: true, image_url: "https://e2e.test/fries.png" },
        { id: "nachos", name: "Nachos", price: 0, isActive: true, entityType: "Combo", outOfStock: false, image_url: "https://e2e.test/nachos.png" },
      ],
    };
    openNew({ id: "box", name: "Box", price: 9, modifiers: [SLOT._id] }, [SLOT]);
    renderPdp();

    expect(screen.getByTestId(`pack-slot-${SLOT._id}`).querySelector("img")?.getAttribute("src")).toBe(
      "https://e2e.test/nachos.png"
    );
    fireEvent.click(screen.getByTestId(`pack-slot-open-${SLOT._id}`));
    const fries = screen.getByRole("group", { name: "Fries, unavailable" });
    expect(fries).toHaveAttribute("data-testid", "slot-option-fries");
    expect(within(fries).queryByRole("button")).not.toBeInTheDocument();
    const rows = Array.from(
      screen.getByTestId("slot-sheet").querySelectorAll('[data-testid^="slot-option-"]')
    ).map((node) => node.getAttribute("data-testid"));
    expect(rows).toEqual(["slot-option-nachos", "slot-option-fries"]);
  });

  /** "Side": Fries out of stock by the menu's stamp, Nachos and Salad in stock. */
  const SIDE = {
    _id: "box_1_combo",
    name: "Side",
    type: "Combo",
    min: 1,
    max: 1,
    multiplePunchMin: 1,
    multiplePunchMax: 1,
    multiplePunchMaxItem: 1,
    order: 1,
    isActive: true,
    constituentItems: [
      { id: "fries", name: "Fries", price: 0, isActive: true, entityType: "Combo", outOfStock: true, image_url: "https://e2e.test/fries.png" },
      { id: "nachos", name: "Nachos", price: 0, isActive: true, entityType: "Combo", outOfStock: false, image_url: "https://e2e.test/nachos.png" },
      { id: "salad", name: "Salad", price: 0, isActive: true, entityType: "Combo", outOfStock: false, image_url: "https://e2e.test/salad.png" },
    ],
  };
  const boxOf = (slot: { _id: string }) => ({ id: "box", name: "Box", price: 9, modifiers: [slot._id] });
  const sheetRows = () =>
    Array.from(screen.getByTestId("slot-sheet").querySelectorAll('[data-testid^="slot-option-"]')).map((node) =>
      node.getAttribute("data-testid")
    );

  // Review F3: the sheet reads PAY's fresher feed map (a combo row), not the
  // stamp alone — else Edit drops the pick and the sheet sells it again.
  it("a pack slot: PAY's feed map greys a side the menu's stamp still sells — unavailable in the sheet, last, nothing to tap", () => {
    openNew(boxOf(SIDE), [SIDE]);
    store.dispatch(setOutOfStockItems({ nachos: { _id: "nachos", type: "combo", inStock: false } }));
    renderPdp();

    expect(screen.getByTestId(`pack-slot-${SIDE._id}`).querySelector("img")?.getAttribute("src")).toBe(
      "https://e2e.test/salad.png"
    );
    fireEvent.click(screen.getByTestId(`pack-slot-open-${SIDE._id}`));
    const nachos = screen.getByRole("group", { name: "Nachos, unavailable" });
    expect(nachos).toHaveAttribute("data-testid", "slot-option-nachos");
    expect(within(nachos).queryByRole("button")).not.toBeInTheDocument();
    expect(sheetRows()).toEqual(["slot-option-salad", "slot-option-fries", "slot-option-nachos"]);
  });

  // Review F10: no in-stock option to preview — the empty slot never shows a
  // sold-out photo in full colour under SELECT: it takes the unavailable look.
  it.each([
    ["every option", SIDE.constituentItems],
    ["its one option", [SIDE.constituentItems[0]]],
  ])("a pack slot with %s out of stock: the slot card is unavailable — grey photo, the chip, nothing to open", (_label, options) => {
    const gone = { ...SIDE, constituentItems: options.map((o) => ({ ...o, outOfStock: true })) };
    openNew(boxOf(gone), [gone]);
    renderPdp();

    const card = screen.getByRole("group", { name: "Side, unavailable" });
    expect(card).toHaveAttribute("data-testid", `pack-slot-${SIDE._id}`);
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(card).toHaveTextContent("Unavailable");
    expect(card.querySelector("img")).toHaveClass("opacity-40", "grayscale");
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });
});
