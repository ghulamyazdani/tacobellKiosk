/**
 * BuyStageSheet — "unlock this reward" (lane "offers", item 31; no Figma
 * frame, TB design language). The tiles read and write the REAL paid cart;
 * the counters mirror the engine and CONTINUE only reaches onContinue once
 * isBOGOOfferApplicable passes. Nothing here navigates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  resolveBuyStageView,
  type BuyStageOffer,
  type BuyStageView,
} from "@cx-sdk/ordering/offer/buyStageUtils";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { store } from "../../../redux/app/store";
import BuyStageSheet from "../BuyStageSheet";
import "../../../i18n";

type Row = { id?: string; itemId?: string; quantity?: number; [key: string]: unknown };

const SAUCE = {
  id: "tortilla-sauce",
  name: "Tortilla Sauce",
  price: 2,
  subCategoryId: "sauces",
  modifiers: [] as string[],
  hasVariant: false,
  calorieCount: 50,
};
const CAESAR = { ...SAUCE, id: "caesar-dressing", name: "Caesar Dressing", calorieCount: 30 };
const BURGER = {
  id: "cheese-burger",
  name: "Cheese Burger",
  price: 8,
  subCategoryId: "burgers",
  modifiers: ["sauce_group"],
  hasVariant: false,
};
const ENTITY_MAP = { [SAUCE.id]: SAUCE, [CAESAR.id]: CAESAR, [BURGER.id]: BURGER };

const sauceRow = (itemId: string, quantity = 1, extra: object = {}): Row => ({
  ...SAUCE,
  itemId,
  uniqueItemId: itemId,
  quantity,
  type: "ITEM",
  total_price: 2,
  customizations: {},
  ...extra,
});
const BURGER_ROW: Row = {
  ...BURGER,
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  quantity: 1,
  type: "CUSTOMIZABLE",
  total_price: 8,
  customizations: { sauce_group: [] },
};

const base = {
  isAvailable: true,
  isComplimentary: false,
  autoApplied: false,
  sameOrLess: false,
  getItemOnly: false,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  isAndOffer: true,
  type: { name: "item", value: 0 },
};
const applicable = (rawItems: object[]) => ({
  on: "complete",
  isExclude: false,
  isInclude: false,
  rawItems,
});

/** Plain-and: buy TWO Tortilla Sauces, get a Caesar free. */
const BOGO = {
  ...base,
  _id: "offer-bogo",
  name: "Buy 2 sauces get a Caesar free",
  applicable: applicable([{ item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: 2, relation: "and" }]),
  getItems: { items: [] },
};
/** Plain-and over a CUSTOMIZABLE buy item. */
const BURGER_BOGO = {
  ...BOGO,
  _id: "offer-burger",
  name: "Buy a burger, get a Caesar",
  applicable: applicable([{ item: { baseItemId: BURGER.id, name: "Cheese Burger" }, quantity: 1, relation: "and" }]),
};
/** Least-value: any 2 sauces, the cheapest is free. */
const LEAST = {
  ...base,
  _id: "offer-least",
  name: "Buy 2 sauces, cheapest free",
  getLeastValueItem: true,
  leastItemValueCount: { buyQuantity: 2, getQuantity: 1, getDiscount: 100 },
  applicable: applicable([
    { item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: 1, relation: "or" },
    { item: { baseItemId: CAESAR.id, name: "Caesar Dressing" }, quantity: 1, relation: "or" },
  ]),
  getItems: { items: [], categories: [] },
};
/** The buy entry IS a variant id (Large fries), resolved via variantObject. */
const FRIES_BASE = {
  id: "fries",
  name: "Fries",
  price: 0,
  hasVariant: true,
  variants: [
    { id: "fries-m", name: "Medium", price: 3 },
    { id: "fries-l", name: "Large", price: 5 },
  ],
};
const LARGE_FRIES_BOGO = {
  ...BOGO,
  _id: "offer-large-fries",
  name: "Buy large fries",
  applicable: applicable([{ item: { baseItemId: "fries-l" }, quantity: 1, relation: "and" }]),
};

const viewFor = (offer: object, variantObject = {}): BuyStageView => {
  const view = resolveBuyStageView(offer as BuyStageOffer, ENTITY_MAP, {}, variantObject);
  if (!view) throw new Error("fixture offer must resolve a buy stage");
  return view;
};

const LocationProbe = () => <span data-testid="location">{useLocation().pathname}</span>;

const renderStage = (offer: object, view: BuyStageView = viewFor(offer)) => {
  const onBack = vi.fn();
  const onClose = vi.fn();
  const onContinue = vi.fn();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BuyStageSheet
          stage={{ offer: offer as SavingsOffer, view }}
          continuing={false}
          blockedMessage={null}
          onBack={onBack}
          onClose={onClose}
          onContinue={onContinue}
        />
        <LocationProbe />
      </MemoryRouter>
    </Provider>
  );
  return { onBack, onClose, onContinue };
};

interface TestState {
  cart: { cartItems: Row[]; repeatItembottomSheet: { isOpen: boolean } };
  menuSelections: { addToCartModal: { isOpen: boolean } };
  makeItAMeal: {
    makeItAMealModal: {
      isOpen: boolean;
      isMakeItAMealSessionActive: boolean;
      tier1CustomizationModal: {
        isOpen: boolean;
        customizations: { selectedEntity?: { id?: string; isBuyStageItem?: boolean } };
      };
    };
  };
}
const state = () => store.getState() as unknown as TestState;
const sauceRows = () => state().cart.cartItems.filter((row) => row.id === SAUCE.id);

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setEntityMap({ entityMap: ENTITY_MAP }));
  store.dispatch(setCartItems([{ ...BURGER_ROW }]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BuyStageSheet — counters, adds and the CONTINUE gate", () => {
  it("the counter reads '0 of 2 added' with an empty progress bar", () => {
    renderStage(BOGO);
    expect(screen.getByTestId("buy-stage-counter")).toHaveTextContent("0 of 2 added");
    const fill = screen.getByTestId("buy-stage-progress");
    expect(fill.style.transform).toBe("scaleX(0)");
    expect(fill.style.transformOrigin).toBe("left");
    expect(screen.queryByTestId("buy-stage-unlocked")).not.toBeInTheDocument();
  });

  it("'+' adds ONE paid row; a second '+' increments that same row — no duplicate, no MIAM, no repeat sheet, no added modal", async () => {
    renderStage(BOGO);

    await userEvent.click(screen.getByTestId(`buy-stage-add-${SAUCE.id}`));
    expect(sauceRows()).toHaveLength(1);
    expect(sauceRows()[0]).toMatchObject({ quantity: 1 });
    expect(sauceRows()[0].isGetItem).toBeFalsy();
    expect(screen.getByTestId(`buy-stage-qty-${SAUCE.id}`)).toHaveTextContent("1");
    expect(screen.getByTestId("buy-stage-counter")).toHaveTextContent("1 of 2 added");
    // The bar tracks the mirror before it unlocks (half way, not empty).
    expect(screen.getByTestId("buy-stage-progress").style.transform).toBe("scaleX(0.5)");

    await userEvent.click(screen.getByTestId(`buy-stage-inc-${SAUCE.id}`));
    expect(sauceRows()).toHaveLength(1);
    expect(sauceRows()[0]).toMatchObject({ quantity: 2 });
    expect(screen.getByTestId("buy-stage-counter")).toHaveTextContent("2 of 2 added");

    const miam = state().makeItAMeal.makeItAMealModal;
    expect(miam.isOpen).toBe(false);
    expect(miam.isMakeItAMealSessionActive).toBe(false);
    expect(state().cart.repeatItembottomSheet.isOpen).toBe(false);
    expect(state().menuSelections.addToCartModal.isOpen).toBe(false);
    expect(screen.getByTestId("location")).toHaveTextContent("/cart");
  });

  it("a plain add of an item WITH recommendations still never pops the added modal over the stage", async () => {
    store.dispatch(
      setEntityMap({
        entityMap: { ...ENTITY_MAP, [SAUCE.id]: { ...SAUCE, recommendedItems: [CAESAR.id] } },
      })
    );
    renderStage(BOGO);

    await userEvent.click(screen.getByTestId(`buy-stage-add-${SAUCE.id}`));

    expect(sauceRows()).toHaveLength(1);
    expect(state().menuSelections.addToCartModal.isOpen).toBe(false);
  });

  it("CONTINUE is inert until the engine predicate passes, and the hint names the remaining count", async () => {
    const { onContinue } = renderStage(BOGO);
    const cont = screen.getByTestId("buy-stage-continue");
    expect(cont).toHaveTextContent("CONTINUE");
    expect(cont).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("buy-stage-hint")).toBeEmptyDOMElement();

    await userEvent.click(cont);
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByTestId("buy-stage-hint")).toHaveTextContent(
      "Add 2 more qualifying items to unlock"
    );

    await userEvent.click(screen.getByTestId(`buy-stage-add-${SAUCE.id}`));
    expect(screen.getByTestId("buy-stage-hint")).toHaveTextContent(
      "Add 1 more qualifying item to unlock"
    );
    await userEvent.click(cont);
    expect(onContinue).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId(`buy-stage-inc-${SAUCE.id}`));
    expect(cont).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByTestId("buy-stage-unlocked")).toHaveTextContent("Reward unlocked!");
    expect(screen.getByTestId("buy-stage-hint")).toBeEmptyDOMElement();
    expect(screen.getByTestId("buy-stage-progress").style.transform).toBe("scaleX(1)");

    await userEvent.click(cont);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("BuyStageSheet — the engine outranks the display mirror", () => {
  it("a qualifying row the stage cannot show (its item left the menu) still unlocks CONTINUE", async () => {
    // "or": a Tortilla Sauce (on the menu) OR a retired item (not on it).
    const OR_WITH_RETIRED = {
      ...BOGO,
      _id: "offer-or-retired",
      applicable: applicable([
        { item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: 1, relation: "or" },
        { item: { baseItemId: "retired-item", name: "Retired" }, quantity: 1, relation: "or" },
      ]),
    };
    const view = viewFor(OR_WITH_RETIRED);
    expect(view.groups.map((group) => group.key)).toEqual([SAUCE.id]); // the mirror sees 0
    store.dispatch(
      setCartItems([{ ...BURGER_ROW }, { ...sauceRow("old-1"), id: "retired-item", name: "Retired" }])
    );
    const { onContinue } = renderStage(OR_WITH_RETIRED, view);

    expect(screen.getByTestId("buy-stage-counter")).toHaveTextContent("1 of 1 added");
    expect(screen.getByTestId("buy-stage-unlocked")).toBeInTheDocument();
    expect(screen.getByTestId("buy-stage-continue")).toHaveAttribute("aria-disabled", "false");
    await userEvent.click(screen.getByTestId("buy-stage-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("BuyStageSheet — decrement guards", () => {
  it("'−' on the LAST paid unit → cartEmptyGuard, and nothing is dispatched", async () => {
    store.dispatch(setCartItems([sauceRow("s-1")]));
    const dispatchSpy = vi.spyOn(store, "dispatch");
    renderStage(BOGO);
    const before = structuredClone(state().cart.cartItems);
    dispatchSpy.mockClear();

    await userEvent.click(screen.getByTestId(`buy-stage-dec-${SAUCE.id}`));

    expect(screen.getByTestId("buy-stage-guard")).toHaveTextContent(
      "Keep at least one item in your order"
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(state().cart.cartItems).toEqual(before);
    dispatchSpy.mockRestore();
  });

  it("'−' on a tile backed only by a LOYALTY row → loyaltyRowGuard, the row stays", async () => {
    const loyaltyRow = sauceRow("loy-1", 1, { isLoyaltyItem: true, total_price: 0 });
    store.dispatch(setCartItems([{ ...BURGER_ROW }, loyaltyRow]));
    renderStage(BOGO);
    expect(screen.getByTestId(`buy-stage-qty-${SAUCE.id}`)).toHaveTextContent("1");

    await userEvent.click(screen.getByTestId(`buy-stage-dec-${SAUCE.id}`));

    expect(screen.getByTestId("buy-stage-guard")).toHaveTextContent(
      "This item was added as a loyalty reward — manage it from your bag"
    );
    expect(state().cart.cartItems).toEqual([BURGER_ROW, loyaltyRow]);
  });
});

describe("BuyStageSheet — tiles and modes", () => {
  it("a customizable tile opens the paid in-place tier session (isBuyStageItem) and the router location never moves", async () => {
    store.dispatch(setCartItems([sauceRow("s-1")]));
    renderStage(BURGER_BOGO);

    await userEvent.click(screen.getByTestId(`buy-stage-add-${BURGER.id}`));

    const tier1 = state().makeItAMeal.makeItAMealModal.tier1CustomizationModal;
    expect(tier1.isOpen).toBe(true);
    expect(tier1.customizations.selectedEntity).toMatchObject({
      id: BURGER.id,
      isBuyStageItem: true,
    });
    expect(state().cart.cartItems).toEqual([sauceRow("s-1")]); // nothing added yet
    expect(screen.getByTestId("location")).toHaveTextContent("/cart");
  });

  it("least mode shows the least note and APPLY REWARD", () => {
    renderStage(LEAST);
    expect(screen.getByTestId("buy-stage-least-note")).toHaveTextContent(
      "Your lowest-priced qualifying item becomes free"
    );
    expect(screen.getByTestId("buy-stage-continue")).toHaveTextContent("APPLY REWARD");
    expect(
      within(screen.getByTestId("buy-stage-sheet")).getByText(
        "Add any 2 from below — your cheapest becomes free"
      )
    ).toBeInTheDocument();
  });

  it("a variant-id buy entry names its variant: 'Fries (Large)'", () => {
    const view = viewFor(LARGE_FRIES_BOGO, {
      "fries-l": { baseItem: FRIES_BASE, variant: { id: "fries-l", name: "Large" } },
    });
    renderStage(LARGE_FRIES_BOGO, view);
    expect(screen.getByTestId("buy-stage-tile-fries")).toHaveTextContent("Fries (Large)");
  });

  it("every control is a ≥44 px target (64 px ADD / stepper, 48 px X with a 44 px floor, 84 px BACK / CONTINUE)", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceRow("s-1")]));
    renderStage(LEAST);

    expect(screen.getByTestId(`buy-stage-add-${CAESAR.id}`).className).toMatch(/\bh-\[64px\]/);
    expect(screen.getByTestId(`buy-stage-dec-${SAUCE.id}`).className).toMatch(/\bw-\[64px\]/);
    expect(screen.getByTestId(`buy-stage-inc-${SAUCE.id}`).className).toMatch(/\bw-\[64px\]/);
    expect(screen.getByTestId(`buy-stage-dec-${SAUCE.id}`).parentElement?.className).toMatch(/\bh-\[64px\]/);
    const close = screen.getByTestId("buy-stage-close").className;
    expect(close).toMatch(/min-h-\[44px\]/);
    expect(close).toMatch(/min-w-\[44px\]/);
    expect(screen.getByTestId("buy-stage-back").className).toMatch(/min-h-\[84px\]/);
    expect(screen.getByTestId("buy-stage-continue").className).toMatch(/min-h-\[84px\]/);
  });
});
