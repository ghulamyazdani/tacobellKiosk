import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { store } from "../../../redux/app/store";
import BagItemRow from "../BagItemRow";
import "../../../i18n";

/*
  Lane addon-customize §7 (the fork's display rule, nestedCardLogic
  computeShowAddonPrices): an add-on's OWN picks are charged only under the
  row's truthy applyAddonsPrice (pricing / orderBuilder), so the bag's
  indented sub-line claims a price only then. The add-on's own line is always
  charged and keeps its "+£".
*/

const row = (applyAddonsPrice: boolean | undefined) => ({
  id: "kiddie",
  itemId: "k-1",
  uniqueItemId: "k-1-u",
  name: "Kiddie Meal",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 16,
  total_price: 19.5,
  applyAddonsPrice,
  customizations: {
    kiddie_snacks_combo: [
      {
        id: "fries",
        name: "Large Fries",
        price: 3,
        quantity: 1,
        customizations: {
          fries_salt_addons: [{ id: "no-salt", name: "No Salt", price: 0.5, quantity: 1 }],
        },
      },
    ],
  },
  baseItem: { id: "kiddie", name: "Kiddie Meal", price: 16, modifiers: ["kiddie_snacks_combo"] },
});

const renderRow = (value: ReturnType<typeof row>) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagItemRow row={value} currency="£" onEdit={vi.fn()} onRequestRemove={vi.fn()} />
      </MemoryRouter>
    </Provider>
  );

const lineTexts = () => [...screen.getByTestId("bag-row-k-1").querySelectorAll("p")].map((p) => p.textContent);

describe("BagItemRow — an add-on's own picks claim a price only under the row's applyAddonsPrice", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it.each([
    ["false", false],
    ["undefined (falsy)", undefined],
  ])("applyAddonsPrice %s: 'No Salt' without '+£', while the add-on line keeps '+£3.00'", (_label, flag) => {
    renderRow(row(flag));

    expect(lineTexts()).toContain("Large Fries +£3.00");
    expect(lineTexts()).toContain("No Salt");
    expect(screen.getByTestId("bag-row-k-1")).not.toHaveTextContent("No Salt +£");
  });

  it("applyAddonsPrice true: 'No Salt +£0.50'", () => {
    renderRow(row(true));

    expect(lineTexts()).toContain("Large Fries +£3.00");
    expect(lineTexts()).toContain("No Salt +£0.50");
  });
});
