import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  blackListedItems,
  makeItAMealIsOpen,
  makeItAMealIsSessionOpen,
  openMakeItAMealModal,
  selectIsForceOpenMakeItAMealModal,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { selectCart } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import MakeItAMealPrompt from "../MakeItAMealPrompt";
import "../../../i18n";

/** Plain upsell combo (no modifiers/variants → checkCustomizationType "item"). */
const COMBO = {
  id: "combo-1",
  name: "Dream Box",
  price: 7.99,
  isActive: true,
  outOfStock: false,
  image_url: "",
};

/** Plain original item (no modifiers/variants → declined as a straight add). */
const BURGER = {
  id: "burger-1",
  name: "Cheese Burger",
  price: 3.5,
  description: "A cheesy classic",
  upsellItems: [COMBO],
};

const openPrompt = () =>
  store.dispatch(
    openMakeItAMealModal({
      isOpen: true,
      selectedItem: BURGER,
      availableCombos: [COMBO],
    })
  );

const renderPrompt = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <MakeItAMealPrompt />
      </MemoryRouter>
    </Provider>
  );

describe("MakeItAMealPrompt (P6c — MIAM upsell prompt)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("renders nothing while the prompt state is closed", () => {
    renderPrompt();
    expect(screen.queryByTestId("miam-prompt")).not.toBeInTheDocument();
  });

  it("renders headline, combo cards and the decline row when opened", () => {
    openPrompt();
    renderPrompt();
    const prompt = screen.getByTestId("miam-prompt");
    // slice default headline (primaryMakeItAMealText)
    expect(prompt).toHaveTextContent(/would you like to make it a meal/i);
    expect(prompt).toHaveTextContent("A cheesy classic");
    const combo = screen.getByTestId("miam-combo-combo-1");
    expect(combo).toHaveTextContent("Dream Box");
    expect(combo).toHaveTextContent("7.99");
    // decline shows the original item's price
    expect(screen.getByTestId("miam-decline")).toHaveTextContent("3.50");
    expect(screen.getByTestId("miam-close")).toBeInTheDocument();
  });

  it("decline adds the ORIGINAL item to the cart, blacklists it and closes the prompt", async () => {
    openPrompt();
    renderPrompt();
    await userEvent.click(screen.getByTestId("miam-decline"));

    const state = store.getState();
    const cart = selectCart(state);
    expect(cart.cartItems).toHaveLength(1);
    expect(cart.cartItems[0]).toMatchObject({
      id: "burger-1",
      quantity: 1,
      total_price: 3.5,
    });
    expect(cart.subTotal).toBe(3.5);
    // declined → never re-prompt for this item
    expect(blackListedItems(state)["burger-1"]).toBe(true);
    // prompt + session torn down, force latch cleared
    expect(makeItAMealIsOpen(state)).toBe(false);
    expect(makeItAMealIsSessionOpen(state)).toBe(false);
    expect(selectIsForceOpenMakeItAMealModal(state)).toBe(false);
    expect(screen.queryByTestId("miam-prompt")).not.toBeInTheDocument();
  });

  it("accepting a plain combo adds the combo (not the original) and closes", async () => {
    openPrompt();
    renderPrompt();
    await userEvent.click(screen.getByTestId("miam-combo-combo-1"));

    const state = store.getState();
    const cart = selectCart(state);
    expect(cart.cartItems).toHaveLength(1);
    expect(cart.cartItems[0]).toMatchObject({
      id: "combo-1",
      quantity: 1,
      total_price: 7.99,
    });
    // the original item was NOT blacklisted on accept
    expect(blackListedItems(state)["burger-1"]).toBeUndefined();
    expect(makeItAMealIsOpen(state)).toBe(false);
    expect(screen.queryByTestId("miam-prompt")).not.toBeInTheDocument();
  });

  it("the X closes the prompt without adding anything to the cart", async () => {
    openPrompt();
    renderPrompt();
    await userEvent.click(screen.getByTestId("miam-close"));

    const state = store.getState();
    expect(selectCart(state).cartItems).toHaveLength(0);
    expect(blackListedItems(state)["burger-1"]).toBeUndefined();
    expect(makeItAMealIsOpen(state)).toBe(false);
    expect(selectIsForceOpenMakeItAMealModal(state)).toBe(false);
    expect(screen.queryByTestId("miam-prompt")).not.toBeInTheDocument();
  });
});
