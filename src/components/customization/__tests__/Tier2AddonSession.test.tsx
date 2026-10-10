import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setTeir1SelectedEntity,
  setTeir2SelectedEntity,
  setTier1SelectedCustomization,
  setTier2BottomSheet,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Tier2CustomizationSheet from "../Tier2CustomizationSheet";
import i18n from "../../../i18n";

/*
  Lane addon-customize §3.4 / §3.5: a customize session opened from a PDP
  option card (its parent group is NOT a pack slot) follows the fork's
  tier-2 card: every own group is toggle cards (the fork forces item max 1 on
  tier-2, GroupCustomizationGrid.tsx:204-209), and own-pick prices plus the
  page's amount show only under the PDP parent's truthy applyAddonsPrice
  (nestedCardLogic.computeShowAddonPrices). Pack-slot sessions are unchanged.
*/

/** A non-slot parent: Figma 1:5332's BYO grid (`_combo` 0/2). */
const CARD_PARENT = {
  _id: "pack_snacks_combo",
  name: "Snacks",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
};
/** A pack slot (`_combo` raw 1/1). */
const SLOT_PARENT = { ...CARD_PARENT, _id: "pack_drink_combo", name: "Drink", min: 1, max: 1, multiplePunchMin: 1, multiplePunchMax: 1 };

/** The add-on's own group, item max 2 (stepper rows on a slot session). */
const SALT = {
  _id: "fries_salt_addons",
  name: "Salt",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 2,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "no-salt", name: "No Salt", price: 0.5, isActive: true },
    { id: "sea-salt", name: "Sea Salt", price: 0.25, isActive: true },
  ],
};
const FRIES = { id: "fries", name: "Large Fries", price: 3, quantity: 1, calorieCount: 360, modifiers: [SALT._id] };

const seed = (parent: typeof CARD_PARENT, applyAddonsPrice: boolean | undefined) => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: { [SALT._id]: SALT } }));
  store.dispatch(setTeir1SelectedEntity({ id: "pack", name: "Pack", price: 16, applyAddonsPrice }));
  const tier1 = { [parent._id]: [] };
  store.dispatch(setTier1SelectedCustomization(tier1));
  store.dispatch(
    setTeir2SelectedEntity({
      entity: FRIES,
      groupId: parent._id,
      currentCustomizations: { selectedCustomizations: tier1, group: parent },
    })
  );
  store.dispatch(
    setTier2BottomSheet({ isOpen: true, type: "customizableItem", openType: "new", status: "", editCustomizationContent: {} })
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

const increase = (name: string) => screen.queryByRole("button", { name: `${i18n.t("pdp.increase")} ${name}` });

describe("Tier2CustomizationSheet — a session opened from a PDP option card (lane addon-customize)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("a NON-slot parent: an own group with item max 2 is toggle cards (one unit each), never stepper rows", () => {
    seed(CARD_PARENT, true);
    renderSheet();

    expect(increase("No Salt")).toBeNull();
    expect(screen.getByTestId("tier2-option-no-salt").tagName).toBe("BUTTON");
    expect(screen.getByTestId("tier2-option-no-salt")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("tier2-option-sea-salt").tagName).toBe("BUTTON");
  });

  it("a pack-slot parent keeps the stepper rows (unchanged)", () => {
    seed(SLOT_PARENT, true);
    renderSheet();

    expect(increase("No Salt")).not.toBeNull();
    expect(increase("Sea Salt")).not.toBeNull();
  });

  it.each([
    ["false", false],
    ["undefined", undefined],
  ])("parent applyAddonsPrice %s on a non-slot session: no own-pick price and no amount — the calories alone, no leading separator", (_label, flag) => {
    seed(CARD_PARENT, flag);
    renderSheet();

    const line = screen.getByTestId("tier2-price-line");
    expect(line).not.toHaveTextContent("£");
    expect(line.textContent?.trim()).toBe(i18n.t("pack.cal", { value: 360 }));
    expect(screen.getByTestId("tier2-option-no-salt")).not.toHaveTextContent("+£");
    expect(screen.getByTestId("tier2-option-sea-salt")).not.toHaveTextContent("+£");
  });

  it("parent applyAddonsPrice true: the amount and the own-pick prices show", () => {
    seed(CARD_PARENT, true);
    renderSheet();

    expect(screen.getByTestId("tier2-price-line")).toHaveTextContent(`£3.00 | ${i18n.t("pack.cal", { value: 360 })}`);
    expect(screen.getByTestId("tier2-option-no-salt")).toHaveTextContent("+£0.50");
  });

  it("a pack-slot parent always shows prices (unchanged), even under a falsy parent flag", () => {
    seed(SLOT_PARENT, false);
    renderSheet();

    expect(screen.getByTestId("tier2-price-line")).toHaveTextContent("£3.00");
    expect(screen.getByTestId("tier2-option-no-salt")).toHaveTextContent("+£0.50");
  });
});
