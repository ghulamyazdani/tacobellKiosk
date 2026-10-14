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
import { setCurrency, setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  makeItAMealIsOpen,
  tier1CustomizationSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { store } from "../../../redux/app/store";
import {
  selectRecommendationDetour,
  setRecommendationDetour,
} from "../../../redux/features/menuSelections/menuSelections.slice";
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
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
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

  it("motion D-M3: the panel rises (tb-sheet-enter), the scrim never animates, no inline keyframes remain", () => {
    seedOpenSheet();
    renderSheet();
    const sheet = screen.getByTestId("repeat-sheet");
    const [scrim, panel] = Array.from(sheet.children);
    expect(scrim.tagName).toBe("BUTTON");
    expect(scrim).not.toHaveAttribute("style");
    expect(scrim.className).not.toMatch(/(^|\s)(tb-|animate-)/);
    expect(panel).toHaveClass("tb-sheet-enter");
    expect(panel).not.toHaveAttribute("style");
    expect(panel).toContainElement(screen.getByTestId("repeat-row-cb-1"));
    expect(sheet.querySelector("style")).toBeNull();
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

  /*
    Lane added-modal: an in-bag suggestion from the product-added strip opens
    this sheet with recommendationDetour set. Every way the sheet closes ends
    the detour (the add it would confirm never comes), so it can never hide
    the NEXT add's strip; "+ NEW CUSTOMIZATIONS" continues the detour into the
    PDP, whose own exits end it.
  */
  it.each([
    ["X", () => screen.getByTestId("repeat-sheet-close")],
    ["the backdrop", () => screen.getByTestId("repeat-sheet").children[0]],
    ["'−' on the last row", () => screen.getByTestId("repeat-dec-cb-1")],
  ])("%s closes the sheet and ends a suggestion detour", async (_exit, target) => {
    seedOpenSheet();
    store.dispatch(setRecommendationDetour(true));
    renderSheet();
    await userEvent.click(target());
    expect(cartState().repeatItembottomSheet.isOpen).toBe(false);
    expect(selectRecommendationDetour(store.getState())).toBe(false);
  });

  it("+ NEW CUSTOMIZATIONS keeps a suggestion detour (it continues into the PDP)", async () => {
    seedOpenSheet();
    store.dispatch(setRecommendationDetour(true));
    renderSheet();
    await userEvent.click(screen.getByTestId("repeat-new-customizations"));
    expect(cartState().repeatItembottomSheet.isOpen).toBe(false);
    expect(selectRecommendationDetour(store.getState())).toBe(true);
  });

  // Test stage (guard): only a CLOSE ends the detour — a '−' that leaves a
  // unit keeps the sheet, and the detour, going.
  it("'−' that leaves a unit keeps the sheet open and the suggestion detour", async () => {
    seedOpenSheet([{ ...BURGER_ROW, quantity: 2 }]);
    store.dispatch(setRecommendationDetour(true));
    renderSheet();
    await userEvent.click(screen.getByTestId("repeat-dec-cb-1"));
    expect(cartState().cartItems).toEqual([expect.objectContaining({ itemId: "cb-1", quantity: 1 })]);
    expect(cartState().repeatItembottomSheet.isOpen).toBe(true);
    expect(selectRecommendationDetour(store.getState())).toBe(true);
  });

  it("ADA (P9c): capped by its containing block with the X and the CTA outside the scroller", () => {
    seedOpenSheet();
    renderSheet();
    const close = screen.getByTestId("repeat-sheet-close");

    expect(
      close.closest('[class*="max-h-[min(1200px,calc(100%_-_96px))]"]')
    ).not.toBeNull();
    expect(close.closest(".overflow-y-auto")).toBeNull();
    expect(
      screen.getByTestId("repeat-new-customizations").closest(".overflow-y-auto")
    ).toBeNull();
    expect(
      screen.getByTestId("repeat-row-cb-1").closest(".overflow-y-auto")
    ).not.toBeNull();
  });
});

/*
  walk-oos 2 (review oos-2 #1): "+ NEW CUSTOMIZATIONS" re-runs the menu's
  ladder with the meal combos the prompt can offer — a base item whose every
  combo is dead (its required drink: every option out) is no upsell: it goes
  on to its customization, never to a meal prompt with no meal on it.
*/
describe("RepeatItemSheet — walk-oos 2: no meal prompt without a meal to offer", () => {
  const DEAD_BOX = { id: "box-dead", name: "Cravings Box", price: 9, isActive: true, modifiers: ["meal_drink"] };
  const LIVE_BOX = { id: "box-live", name: "Dream Box", price: 8, isActive: true };
  const seed = (upsellItems: object[]) => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(
      setRepeatItemBottomSheet({
        isOpen: true,
        status: "repeat",
        baseItem: { ...BURGER_ROW.baseItem, upsellItems },
        returnTo: "menu",
      } as any)
    );
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setKioskSettings({ enable_combo_upsell: true }));
    store.dispatch(
      setModifiersMap({
        modifiersMap: {
          sauce_group: {
            _id: "sauce_group",
            isActive: true,
            min: 0,
            max: 1,
            constituentItems: [{ id: "onions", name: "Add Onions", isActive: true }],
          },
          meal_drink: {
            _id: "meal_drink",
            isActive: true,
            min: 1,
            max: 1,
            constituentItems: [{ id: "cola", isActive: true, outOfStock: true }],
          },
        },
      })
    );
  });

  it("the only combo dead: the burger's customization opens, no prompt", async () => {
    seed([DEAD_BOX]);
    renderSheet();
    await userEvent.click(screen.getByTestId("repeat-new-customizations"));

    expect(makeItAMealIsOpen(store.getState())).toBe(false);
    expect(tier1CustomizationSelectedEntity(store.getState())).toMatchObject({ id: "cheese-burger" });
  });

  it("a live combo beside it: the meal prompt opens", async () => {
    seed([DEAD_BOX, LIVE_BOX]);
    renderSheet();
    await userEvent.click(screen.getByTestId("repeat-new-customizations"));

    expect(makeItAMealIsOpen(store.getState())).toBe(true);
  });
});
