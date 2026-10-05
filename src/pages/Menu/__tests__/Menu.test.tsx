import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import Menu from "../index";
import "../../../i18n";

/** Converted-shape fixture (mirrors legacyMenuConverters output fields the UI reads). */
const CONVERTED_MENU = {
  categories: [
    {
      id: "c1",
      name: "Side Orders",
      subCategories: [
        {
          id: "s1",
          name: "Sides",
          entities: [
            {
              id: "e-new",
              name: "Beefy Fries Box",
              price: 5.99,
              calorieCount: 740,
              image_url: "",
              badges: [{ name: "new" }],
              outOfStock: false,
            },
            {
              id: "e-oos",
              name: "Cheese Burger",
              price: 3.5,
              outOfStock: true,
            },
            {
              id: "e-plain",
              name: "Large Fries",
              price: 2.5,
              calorieCount: 360,
              outOfStock: false,
            },
          ],
        },
      ],
    },
    { id: "c2", name: "Drinks", subCategories: [] },
  ],
};

const renderMenu = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <Menu />
      </MemoryRouter>
    </Provider>
  );

describe("Menu (Figma 1:2595 — rail + grid + CTA)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    // setMenuData expects { menu } (SDK reducer destructures the payload)
    store.dispatch(setMenuData({ menu: CONVERTED_MENU }));
  });

  it("renders the category rail from the converted menu", () => {
    renderMenu();
    expect(screen.getByTestId("rail-c1")).toHaveTextContent("Side Orders");
    expect(screen.getByTestId("rail-c2")).toHaveTextContent("Drinks");
  });

  it("renders item cards with price + calories; NEW/badged items get the hero card", () => {
    renderMenu();
    const hero = screen.getByTestId("item-e-new");
    expect(hero).toHaveTextContent("Beefy Fries Box");
    expect(hero).toHaveTextContent("5.99");
    expect(hero).toHaveTextContent("740 Cal");
    expect(hero.className).toContain("col-span-2"); // hero treatment
    expect(screen.getByTestId("item-e-plain").className).not.toContain("col-span-2");
  });

  it("out-of-stock items show UNAVAILABLE and lose the quick-add", () => {
    renderMenu();
    const oos = screen.getByTestId("item-e-oos");
    expect(oos).toHaveTextContent(/unavailable/i);
    expect(screen.queryByTestId("quick-add-e-oos")).not.toBeInTheDocument();
    expect(screen.getByTestId("quick-add-e-plain")).toBeInTheDocument();
  });

  it("CTA bar shows the (empty) cart total and count", () => {
    renderMenu();
    expect(screen.getByTestId("cta-total")).toHaveTextContent("0.00");
    expect(screen.getByTestId("cta-view-bag")).toHaveTextContent("(0)");
  });

  it("empty menu shows the loading/empty state instead of a blank pane", () => {
    store.dispatch({ type: "RESET_STATE" });
    renderMenu();
    expect(screen.getByText(/menu is loading/i)).toBeInTheDocument();
  });
});
