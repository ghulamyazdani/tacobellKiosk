import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  MIAMTier2Open,
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  setEntityMenuObject,
  setModifiersMap,
} from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import "../../../i18n";

// ---- Pack fixtures (brief: `_combo` min1/max1 → slot card; everything else
// keeps the classic renderGroup path) --------------------------------------

const BURRITO_GROUP = {
  _id: "pack1_1_combo",
  name: "Burrito",
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    {
      id: "b-beef",
      name: "Beefy Burrito",
      price: 0,
      calorieCount: 170,
      isActive: true,
      isDefault: true,
    },
    {
      id: "b-bean",
      name: "Bean Burrito",
      price: 0,
      calorieCount: 150,
      isActive: true,
      isDefault: false,
    },
  ],
};

const DRINK_GROUP = {
  _id: "pack1_2_combo",
  name: "Drink",
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 2,
  isActive: true,
  constituentItems: [
    {
      id: "d-cola",
      name: "Cola",
      price: 0,
      calorieCount: 170,
      isActive: true,
      isDefault: false,
    },
    {
      id: "d-large",
      name: "Large Cola",
      price: 0.75,
      calorieCount: 360,
      isActive: true,
      isDefault: false,
    },
  ],
};

/** BYO-shaped combo (min!==1) — must stay on the classic path (brief rule). */
const SNACKS_GROUP = {
  _id: "pack1_6_combo",
  name: "Snacks",
  type: "Combo",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 4,
  multiplePunchMaxItem: 1,
  order: 3,
  isActive: true,
  constituentItems: [
    { id: "s-churros", name: "Churros", price: 5, isActive: true },
  ],
};

const ADDON_GROUP = {
  _id: "pack1_addons",
  name: "Add Ons",
  min: 0,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 4,
  isActive: true,
  constituentItems: [
    { id: "a-salsa", name: "Salsa", price: 0.5, isActive: true },
  ],
};

/** REQUIRED nested group on Large Cola (drives the tier-2 SAVE gate). */
const ICE_GROUP = {
  _id: "dl_addons",
  name: "Ice Level",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "ice", name: "Regular Ice", price: 0, isActive: true },
    { id: "no-ice", name: "No Ice", price: 0, isActive: true },
  ],
};

const MODIFIERS_MAP = {
  [BURRITO_GROUP._id]: BURRITO_GROUP,
  [DRINK_GROUP._id]: DRINK_GROUP,
  [SNACKS_GROUP._id]: SNACKS_GROUP,
  [ADDON_GROUP._id]: ADDON_GROUP,
  [ICE_GROUP._id]: ICE_GROUP,
};

const PACK = {
  id: "pack1",
  name: "Cravings Burrito Pack",
  price: 9.99,
  applyAddonsPrice: true,
  description: "Four burritos, a drink and a side",
  modifiers: [
    BURRITO_GROUP._id,
    DRINK_GROUP._id,
    SNACKS_GROUP._id,
    ADDON_GROUP._id,
  ],
};

const seedSession = (entity: Record<string, unknown> = PACK) => {
  store.dispatch(setModifiersMap({ modifiersMap: MODIFIERS_MAP }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: {
        isOpen: true,
        status: "",
        type: "customizableItem",
        openType: "new",
        editCustomizationContent: {},
      },
      selectedEntity: entity,
    })
  );
};

const renderPage = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
      </MemoryRouter>
    </Provider>
  );

describe("Customization page — pack partition (P6c)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the hook's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("renders slot cards for `_combo` min1/max1 groups and the classic grid for the rest", () => {
    seedSession();
    renderPage();

    expect(screen.getByText("Cravings Burrito Pack")).toBeInTheDocument();

    // slot presentation for the two true slot groups
    expect(screen.getByTestId("pack-slot-grid")).toBeInTheDocument();
    expect(screen.getByTestId("pack-slot-pack1_1_combo")).toBeInTheDocument();
    expect(screen.getByTestId("pack-slot-pack1_2_combo")).toBeInTheDocument();
    // ...and NOT the classic section for them
    expect(
      screen.queryByTestId("pdp-group-pack1_1_combo")
    ).not.toBeInTheDocument();

    // BYO-shaped combo (min 0/max 2) and the addons group keep the classic path
    expect(screen.getByTestId("pdp-group-pack1_6_combo")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-option-s-churros")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-group-pack1_addons")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-option-a-salsa")).toBeInTheDocument();
    // ...and no slot card for the BYO group
    expect(
      screen.queryByTestId("pack-slot-pack1_6_combo")
    ).not.toBeInTheDocument();
  });

  it("seeds defaults: a defaulted slot shows SWAP, an empty slot shows SELECT {group}", () => {
    seedSession();
    renderPage();

    const burrito = screen.getByTestId("pack-slot-pack1_1_combo");
    expect(burrito).toHaveTextContent("Beefy Burrito");
    expect(burrito).toHaveTextContent("Swap");

    const drink = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(drink).toHaveTextContent("Select Drink");
    expect(drink).not.toHaveTextContent("Swap");

    // redux seed: default pre-selected for burrito, drink empty
    const tier1 = tier1SelectedCustomization(store.getState());
    expect(tier1[BURRITO_GROUP._id]).toHaveLength(1);
    expect(tier1[BURRITO_GROUP._id][0].id).toBe("b-beef");
    expect(tier1[DRINK_GROUP._id]).toEqual([]);
  });

  it("a non-pack entity renders no slot grid at all (zero change)", () => {
    seedSession({
      id: "single1",
      name: "Loaded Fries",
      price: 3.99,
      modifiers: [ADDON_GROUP._id],
    });
    renderPage();

    expect(screen.queryByTestId("pack-slot-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-group-pack1_addons")).toBeInTheDocument();
  });

  it("slot sheet: open → pick → SAVE writes the pick into the tier-1 selections (plain path)", async () => {
    seedSession();
    renderPage();

    await userEvent.click(screen.getByTestId("pack-slot-open-pack1_2_combo"));
    const sheet = screen.getByTestId("slot-sheet");
    expect(sheet).toHaveTextContent("Select Drink");
    // included (free) vs upgrades (priced) partition
    expect(sheet).toHaveTextContent("Included");
    expect(sheet).toHaveTextContent("Upgrades");
    // no entity/variant map seeded → nothing is tier-2 capable → no Customize
    expect(screen.queryByTestId("slot-customize-d-cola")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("slot-customize-d-large")
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("slot-option-d-large"));
    await userEvent.click(screen.getByTestId("slot-sheet-save"));

    // sheet closed, pick landed in redux, card flipped to SWAP + price
    expect(screen.queryByTestId("slot-sheet")).not.toBeInTheDocument();
    const tier1 = tier1SelectedCustomization(store.getState());
    expect(tier1[DRINK_GROUP._id]).toHaveLength(1);
    expect(tier1[DRINK_GROUP._id][0]).toMatchObject({
      id: "d-large",
      quantity: 1,
    });
    const drink = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(drink).toHaveTextContent("Large Cola");
    expect(drink).toHaveTextContent("Swap");
    // default store has no currency symbol configured → bare "+0.75"
    expect(drink).toHaveTextContent("+0.75");
    // tier-2 never opened on the plain path
    expect(MIAMTier2Open(store.getState())).toBe(false);
  });

  it("SAVE on a pick with a REQUIRED nested group routes to tier-2 NEW instead of a plain save", async () => {
    seedSession();
    // Large Cola exists as an entity with a required (min 1) addon group →
    // tier-2 capable AND not all-optional → SAVE must open the tier-2 sheet.
    store.dispatch(
      setEntityMenuObject({
        menuEntityObject: {
          "d-large": {
            id: "d-large",
            name: "Large Cola",
            price: 0.75,
            isActive: true,
            outOfStock: false,
            min: 1,
            max: 1,
            modifiers: [ICE_GROUP._id],
          },
        },
      })
    );
    renderPage();

    await userEvent.click(screen.getByTestId("pack-slot-open-pack1_2_combo"));
    // tier-2 capable row now offers the Customize link; the plain one doesn't
    expect(screen.getByTestId("slot-customize-d-large")).toBeInTheDocument();
    expect(screen.queryByTestId("slot-customize-d-cola")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("slot-option-d-large"));
    await userEvent.click(screen.getByTestId("slot-sheet-save"));

    // slot sheet closed, tier-2 sheet opened on the nested group — the pick
    // was NOT committed as a plain save
    expect(screen.queryByTestId("slot-sheet")).not.toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(true);
    expect(screen.getByTestId("tier2-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("tier2-group-dl_addons")).toBeInTheDocument();
    expect(
      tier1SelectedCustomization(store.getState())[DRINK_GROUP._id]
    ).toEqual([]);

    // completing tier-2 lands the customized row back into the slot
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    await userEvent.click(screen.getByTestId("tier2-sheet-save"));

    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
    const tier1 = tier1SelectedCustomization(store.getState());
    expect(tier1[DRINK_GROUP._id]).toHaveLength(1);
    expect(tier1[DRINK_GROUP._id][0]).toMatchObject({ id: "d-large" });
    expect(tier1[DRINK_GROUP._id][0].customizations.dl_addons[0].id).toBe(
      "ice"
    );
    const drink = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(drink).toHaveTextContent("Large Cola");
    expect(drink).toHaveTextContent("Swap");
  });
});
