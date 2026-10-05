/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart-row fixtures and store reads mirror the untyped legacy cart slice;
 * typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setCartItems,
  setRepeatItemBottomSheet,
} from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import RepeatItemSheet from "../RepeatItemSheet";
import "../../../i18n";

/** Customized burger row — the row the repeat sheet snapshots (contract B2). */
const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 8.6,
  customizations: {
    sauce_group: [{ id: "onions", name: "Add Onions", price: 0.6, quantity: 1 }],
  },
  baseItem: {
    id: "cheese-burger",
    name: "Cheese Burger",
    price: 8,
    modifiers: ["sauce_group"],
  },
};

/** Plain base item (no variants/modifiers) so NEW CUSTOMIZATIONS only closes. */
const BASE_ITEM = { id: "cheese-burger", name: "Cheese Burger", price: 8 };

const seedOpenSheet = (rows: any[] = [{ ...BURGER_ROW }]) => {
  store.dispatch(setCartItems(rows));
  // Reducer computes `data` itself from cartItems (contract A1) — the
  // payload only names the base item.
  store.dispatch(
    setRepeatItemBottomSheet({
      isOpen: true,
      status: "repeat",
      baseItem: BASE_ITEM,
      returnTo: "menu",
    } as any)
  );
};

const renderSheet = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <RepeatItemSheet />
      </MemoryRouter>
    </Provider>
  );

const cartState = () => (store.getState() as any).cart;

describe("RepeatItemSheet (contract B2 — repeat customizations)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
  });

  it("renders nothing while the slice sheet is closed", () => {
    renderSheet();
    expect(screen.queryByTestId("repeat-sheet")).not.toBeInTheDocument();
  });

  it("open: lists the snapshot rows with customization summary and line price", () => {
    seedOpenSheet();
    renderSheet();
    expect(screen.getByTestId("repeat-sheet")).toBeInTheDocument();
    const row = screen.getByTestId("repeat-row-cb-1");
    expect(row).toHaveTextContent("Cheese Burger");
    expect(row).toHaveTextContent("Add Onions"); // flattened summary
    expect(row).toHaveTextContent("£8.60"); // unit × qty(1)
    expect(screen.getByTestId("repeat-new-customizations")).toBeInTheDocument();
  });

  it("only PAID rows of the base item are snapshotted (loyalty/freebie rows excluded by the reducer)", () => {
    seedOpenSheet([
      { ...BURGER_ROW },
      { ...BURGER_ROW, itemId: "cb-free", isGetItem: true },
      { ...BURGER_ROW, itemId: "cb-loyal", isLoyaltyItem: true },
    ]);
    renderSheet();
    expect(screen.getByTestId("repeat-row-cb-1")).toBeInTheDocument();
    expect(screen.queryByTestId("repeat-row-cb-free")).not.toBeInTheDocument();
    expect(screen.queryByTestId("repeat-row-cb-loyal")).not.toBeInTheDocument();
  });

  it("stepper + dispatches the real increase: store row and the sheet's qty both bump", async () => {
    seedOpenSheet();
    renderSheet();
    await userEvent.click(screen.getByTestId("repeat-inc-cb-1"));
    expect(cartState().cartItems[0].quantity).toBe(2);
    expect(screen.getByTestId("repeat-row-cb-1")).toHaveTextContent("£17.20");
  });

  it("stepper − at qty 1 deletes the row and (last row gone) closes the sheet", async () => {
    seedOpenSheet();
    renderSheet();
    await userEvent.click(screen.getByTestId("repeat-dec-cb-1"));
    expect(cartState().cartItems).toEqual([]);
    expect(cartState().repeatItembottomSheet.isOpen).toBe(false);
    expect(screen.queryByTestId("repeat-sheet")).not.toBeInTheDocument();
  });

  it("+ NEW CUSTOMIZATIONS closes the sheet (plain base item: no further ladder)", async () => {
    seedOpenSheet();
    renderSheet();
    await userEvent.click(screen.getByTestId("repeat-new-customizations"));
    expect(cartState().repeatItembottomSheet.isOpen).toBe(false);
    expect(screen.queryByTestId("repeat-sheet")).not.toBeInTheDocument();
    // The plain base item neither navigates nor reopens anything — the cart
    // row is untouched (regression anchor for e2e scenario 4's back-out).
    expect(cartState().cartItems).toHaveLength(1);
  });

  it("backdrop and X both close via closeRepeatItemBottomSheet", async () => {
    seedOpenSheet();
    renderSheet();
    await userEvent.click(screen.getByTestId("repeat-sheet-close"));
    expect(cartState().repeatItembottomSheet.isOpen).toBe(false);
    expect(screen.queryByTestId("repeat-sheet")).not.toBeInTheDocument();
  });
});
