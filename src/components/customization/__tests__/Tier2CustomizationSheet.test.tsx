import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  MIAMTier2Open,
  setTeir2SelectedEntity,
  setTier1SelectedCustomization,
  setTier2BottomSheet,
  tier1SelectedCustomization,
  tier2SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  selectErrorMessageGlobal,
  selectShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Tier2CustomizationSheet from "../Tier2CustomizationSheet";
import "../../../i18n";

/** Parent (tier-1) slot group the tier-2 result lands back into. */
const SLOT_GROUP = {
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
};

/** REQUIRED nested group (min 1) on the tier-2 entity. */
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

/** The tier-2 entity being customized (a slot constituent with own groups). */
const ENTITY = {
  id: "d-large",
  name: "Large Cola",
  price: 0.75,
  quantity: 1,
  modifiers: ["dl_addons"],
};

const TIER1_SELECTIONS = { [SLOT_GROUP._id]: [] };

const seedOpenTier2 = () => {
  store.dispatch(setModifiersMap({ modifiersMap: { dl_addons: ICE_GROUP } }));
  store.dispatch(setTier1SelectedCustomization(TIER1_SELECTIONS));
  store.dispatch(
    setTeir2SelectedEntity({
      entity: ENTITY,
      groupId: SLOT_GROUP._id,
      currentCustomizations: {
        selectedCustomizations: TIER1_SELECTIONS,
        group: SLOT_GROUP,
      },
    })
  );
  store.dispatch(
    setTier2BottomSheet({
      isOpen: true,
      type: "customizableItem",
      openType: "new",
      status: "",
      editCustomizationContent: {},
    })
  );
};

const renderSheet = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Tier2CustomizationSheet />
      </MemoryRouter>
    </Provider>
  );

describe("Tier2CustomizationSheet (P6c — nested customize sheet)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the sheet's error path auto-scrolls.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("renders nothing while the tier-2 modal is closed", () => {
    renderSheet();
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
  });

  it("open (new): shows the entity header, its groups and options, qty and price line", () => {
    seedOpenTier2();
    renderSheet();
    const sheet = screen.getByTestId("tier2-sheet");
    expect(sheet).toHaveTextContent("Large Cola");
    expect(screen.getByTestId("tier2-group-dl_addons")).toHaveTextContent(
      "Ice Level"
    );
    expect(screen.getByTestId("tier2-option-ice")).toBeInTheDocument();
    expect(screen.getByTestId("tier2-option-no-ice")).toBeInTheDocument();
    expect(screen.getByTestId("tier2-qty")).toHaveTextContent("1");
    expect(screen.getByTestId("tier2-price-line")).toHaveTextContent("0.75");
    // required nested group seeded empty in redux
    expect(tier2SelectedCustomization(store.getState())).toEqual({
      dl_addons: [],
    });
  });

  it("SAVE with an unsatisfied min: no commit, errored ring + global error, sheet stays open", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-sheet-save"));

    const state = store.getState();
    expect(MIAMTier2Open(state)).toBe(true); // still open
    expect(tier1SelectedCustomization(state)).toEqual(TIER1_SELECTIONS); // untouched
    expect(selectShowErrorModalGlobal(state)).toBe(true);
    expect(selectErrorMessageGlobal(state)).toBe(
      "Please check the customization errors"
    );
    expect(screen.getByTestId("tier2-group-dl_addons").className).toContain(
      "ring-red-500"
    );
  });

  it("pick + SAVE commits the nested row into the tier-1 selections and closes", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    expect(
      tier2SelectedCustomization(store.getState()).dl_addons
    ).toHaveLength(1);

    await userEvent.click(screen.getByTestId("tier2-sheet-save"));

    const state = store.getState();
    const tier1 = tier1SelectedCustomization(state);
    expect(tier1[SLOT_GROUP._id]).toHaveLength(1);
    const row = tier1[SLOT_GROUP._id][0];
    expect(row).toMatchObject({
      id: "d-large",
      name: "Large Cola",
      quantity: 1,
      isActive: true,
      isConfigurationError: false,
    });
    // unique tier-1 row id: `${Date.now()}_${entity.id}`
    expect(String(row.itemId)).toMatch(/_d-large$/);
    // the nested pick travels on the row
    expect(row.customizations.dl_addons).toHaveLength(1);
    expect(row.customizations.dl_addons[0]).toMatchObject({
      id: "ice",
      quantity: 1,
    });
    expect(MIAMTier2Open(state)).toBe(false);
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
  });

  it("X on a dirty NEW session asks to discard; confirming closes without committing", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    await userEvent.click(screen.getByTestId("tier2-sheet-close"));

    // discard-confirm overlay, not an instant close
    expect(screen.getByTestId("tier2-discard-overlay")).toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(true);

    await userEvent.click(screen.getByTestId("tier2-discard-confirm"));
    const state = store.getState();
    expect(MIAMTier2Open(state)).toBe(false);
    expect(tier1SelectedCustomization(state)).toEqual(TIER1_SELECTIONS);
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
  });

  it("'Keep editing' dismisses the discard prompt and keeps the session", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    await userEvent.click(screen.getByTestId("tier2-sheet-close"));
    await userEvent.click(screen.getByTestId("tier2-discard-cancel"));

    expect(
      screen.queryByTestId("tier2-discard-overlay")
    ).not.toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(true);
    expect(screen.getByTestId("tier2-sheet")).toBeInTheDocument();
  });

  it("X on a clean NEW session closes immediately without a discard prompt", async () => {
    seedOpenTier2();
    renderSheet();
    await userEvent.click(screen.getByTestId("tier2-sheet-close"));

    expect(
      screen.queryByTestId("tier2-discard-overlay")
    ).not.toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(false);
    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
  });
});
