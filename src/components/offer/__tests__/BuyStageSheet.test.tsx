/**
 * BuyStageSheet — "unlock this reward" (lane "offers", item 31; no Figma
 * frame, TB design language). The tiles read and write the REAL paid cart;
 * the counters mirror the engine and CONTINUE only reaches onContinue once
 * isBOGOOfferApplicable passes. Nothing here navigates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  resolveBuyStageView,
  type BuyMenuEntity,
  type BuyStageOffer,
  type BuyStageView,
} from "@cx-sdk/ordering/offer/buyStageUtils";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import BuyStageSheet from "../BuyStageSheet";
import i18n from "../../../i18n";

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
/** viewFor over the fixture menu with some entities replaced. */
const viewWith = (offer: object, entities: Record<string, BuyMenuEntity>): BuyStageView => {
  const view = resolveBuyStageView(offer as BuyStageOffer, { ...ENTITY_MAP, ...entities }, {}, {});
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
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setEntityMap({ entityMap: ENTITY_MAP }));
  store.dispatch(setCartItems([{ ...BURGER_ROW }]));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("BuyStageSheet — motion (D-M3)", () => {
  it("the panel rises (tb-sheet-enter), the scrim never animates, no inline keyframes remain", () => {
    renderStage(BOGO);
    const sheet = screen.getByTestId("buy-stage-sheet");
    const [scrim, panel] = Array.from(sheet.children);
    expect(scrim.tagName).toBe("BUTTON");
    expect(scrim).not.toHaveAttribute("style");
    expect(scrim.className).not.toMatch(/(^|\s)(tb-|animate-)/);
    expect(panel).toBe(screen.getByRole("dialog"));
    expect(panel).toHaveClass("tb-sheet-enter");
    expect(panel).not.toHaveAttribute("style");
    expect(sheet.querySelector("style")).toBeNull();
  });
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

  it("a card tap adds ONE paid row; its '+' increments that same row — no duplicate, no MIAM, no repeat sheet, no added modal", async () => {
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

  it("a tile's price line carries the deployment's symbol (UB1 — never a bare amount)", () => {
    renderStage(BOGO);
    expect(screen.getByTestId(`buy-stage-tile-${SAUCE.id}`)).toHaveTextContent("£2 | 50 Cal");
  });

  it("every control is a ≥44 px target (the whole 240×277 card adds, 44 px '−' / '+', 48 px X with a 44 px floor, 84 px BACK / CONTINUE)", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceRow("s-1")]));
    renderStage(LEAST);

    for (const id of [CAESAR.id, SAUCE.id]) {
      const add = screen.getByTestId(`buy-stage-add-${id}`);
      expect(add).toHaveClass("absolute", "inset-0");
      expect(add.parentElement).toHaveClass("h-[277px]", "w-full");
      expect(add.parentElement?.parentElement).toHaveClass("grid-cols-[repeat(auto-fit,240px)]");
    }
    expect(screen.getByTestId(`buy-stage-dec-${SAUCE.id}`)).toHaveClass("h-[44px]", "w-[44px]");
    expect(screen.getByTestId(`buy-stage-inc-${SAUCE.id}`)).toHaveClass("h-[44px]", "w-[44px]");
    expect(screen.getByTestId(`buy-stage-inc-${CAESAR.id}`)).toHaveClass("h-[44px]", "w-[44px]");
    const close = screen.getByTestId("buy-stage-close").className;
    expect(close).toMatch(/min-h-\[44px\]/);
    expect(close).toMatch(/min-w-\[44px\]/);
    expect(screen.getByTestId("buy-stage-back").className).toMatch(/min-h-\[84px\]/);
    expect(screen.getByTestId("buy-stage-continue").className).toMatch(/min-h-\[84px\]/);
  });
});

/* ------------------------------------------------------------------ *
 * Lane offers-parity (U10, F2 / D4): once the buy side is met, any OTHER
 * gap (an item minimum, a bill minimum) is a blocker — named at once, with
 * no CONTINUE tap, and CONTINUE waits for it. Item minimums count paid
 * units (D3), so a stage never applies an offer the next revalidation
 * removes.
 * ------------------------------------------------------------------ */
describe("BuyStageSheet — offers-parity: the blocker after the buy side is met", () => {
  /** Plain-or: buy ONE Tortilla Sauce, get a Caesar — min 4 items. */
  const MIN_FOUR = {
    ...BOGO,
    _id: "offer-min-four",
    name: "Buy a sauce get a Caesar (min 4)",
    minItemCount: 4,
    applicable: applicable([{ item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: 1, relation: "or" }]),
  };

  it("buy side met + a minItems gap: no 'Reward unlocked!'; 'Add 2+ more items…' shows WITHOUT a CONTINUE tap; onContinue never runs", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceRow("s-1")]));
    const { onContinue } = renderStage(MIN_FOUR);

    expect(screen.queryByTestId("buy-stage-unlocked")).toBeNull();
    expect(screen.getByTestId("buy-stage-hint")).toHaveTextContent(
      "Add 2+ more items to your order to be eligible to redeem this reward"
    );
    const cont = screen.getByTestId("buy-stage-continue");
    expect(cont).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(cont);
    expect(onContinue).not.toHaveBeenCalled();
    // The buy side itself reads complete.
    expect(screen.getByTestId("buy-stage-counter")).toHaveTextContent("1 of 1 added");
  });

  it("a freebie row is no paid unit (D3): 3 paid + 1 free still blocks a min of 4", () => {
    const freebie = sauceRow("free-1", 1, { id: CAESAR.id, isGetItem: true, total_price: 0 });
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceRow("s-1", 2), freebie]));
    renderStage(MIN_FOUR);
    expect(screen.getByTestId("buy-stage-hint")).toHaveTextContent(
      "Add 1+ more items to your order to be eligible to redeem this reward"
    );
    expect(screen.queryByTestId("buy-stage-unlocked")).toBeNull();
  });

  it("a minBill gap names the amount (the addNudge copy)", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceRow("s-1")]));
    renderStage({ ...MIN_FOUR, _id: "offer-min-bill", minItemCount: null, minBillAmount: 20 });
    expect(screen.getByTestId("buy-stage-hint")).toHaveTextContent(
      /^Add £\d+\.\d{2}\+ to your order to be eligible to redeem this reward$/
    );
    expect(screen.queryByTestId("buy-stage-unlocked")).toBeNull();
  });

  it("the gap cleared → 'Reward unlocked!' → CONTINUE reaches onContinue", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceRow("s-1")]));
    const { onContinue } = renderStage(MIN_FOUR);

    await userEvent.click(screen.getByTestId(`buy-stage-inc-${SAUCE.id}`));
    expect(screen.getByTestId("buy-stage-hint")).toHaveTextContent(
      "Add 1+ more items to your order to be eligible to redeem this reward"
    );
    await userEvent.click(screen.getByTestId(`buy-stage-inc-${SAUCE.id}`));
    expect(screen.getByTestId("buy-stage-unlocked")).toHaveTextContent("Reward unlocked!");
    expect(screen.getByTestId("buy-stage-hint")).toBeEmptyDOMElement();
    const cont = screen.getByTestId("buy-stage-continue");
    expect(cont).toHaveAttribute("aria-disabled", "false");
    await userEvent.click(cont);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("buy side unmet: the tap-to-hint stays as it was (no blocker line before a tap)", async () => {
    renderStage(MIN_FOUR);
    expect(screen.getByTestId("buy-stage-hint")).toBeEmptyDOMElement();
    await userEvent.click(screen.getByTestId("buy-stage-continue"));
    expect(screen.getByTestId("buy-stage-hint")).toHaveTextContent("Add 1 more qualifying item to unlock");
  });
});

/* ------------------------------------------------------------------ *
 * User report 2026-10-14 ("the item card in get stage in offer doesn't
 * look good make it something like ui in figma"): every buy group was one
 * item under its own name, so each card sat alone under a header that
 * repeated it. The card is now Figma's Menu-Item grid card (1:2609, as
 * MenuItemCard draws it) four across in 1:2595's 16 px grid, picked the
 * product-added way, and a header renders only when it says something the
 * cards don't.
 * ------------------------------------------------------------------ */
const PHOTO = "https://cdn.example.com/kiosk/tortilla-sauce.png";
const headers = () => screen.queryAllByTestId(/^buy-stage-group-/);

describe("BuyStageSheet — Figma's Menu-Item card", () => {
  it("the menu grid's card (1:2609): 240×277 grey-6 r8, four across with 1:2595's 16 px gaps; the Md 20/24 name clamped at 2; the price line led by the veg mark; the 172 photo band object-cover × multiply; the 36 px Quick Add on a 44 px hit area", () => {
    renderStage(LEAST, viewWith(LEAST, { [SAUCE.id]: { ...SAUCE, image_url: PHOTO, tags: ["veg"] } }));

    const card = screen.getByTestId(`buy-stage-tile-${SAUCE.id}`);
    expect(card).toHaveClass(
      "tb-press-card",
      "relative",
      "flex",
      "h-[277px]",
      "w-full",
      "flex-col",
      "justify-between",
      "overflow-hidden",
      "rounded-[8px]",
      "bg-tb-grey-6"
    );
    expect(card.parentElement).toHaveClass("grid", "grid-cols-[repeat(auto-fit,240px)]", "justify-center", "gap-[16px]");

    const name = within(card).getByText(SAUCE.name);
    expect(name).toHaveClass(
      "line-clamp-2",
      "text-[20px]",
      "font-medium",
      "capitalize",
      "leading-[24px]",
      "tracking-[-0.5px]",
      "text-black"
    );
    expect(name.parentElement).toHaveClass("gap-[4px]", "ps-[24px]", "pe-[64px]", "pt-[24px]");
    const price = name.nextElementSibling as HTMLElement;
    expect(price).toHaveTextContent(/^£2 \| 50 Cal$/);
    expect(price).toHaveClass("text-[18px]", "leading-[20px]", "text-tb-ink-purple");
    expect(price.firstElementChild).toBe(within(price).getByTestId("veg-mark-veg"));

    const photo = card.querySelector(`img[src="${PHOTO}"]`);
    expect(photo).toHaveClass("h-[172px]", "min-h-0", "w-full", "object-cover", "mix-blend-multiply");
    expect(photo).not.toHaveClass("object-contain");

    // Figma Quick Add: a 36 px white circle at 192 / 12 (end 12), 16 px plus,
    // white → lilac while pressed; centred in a 44 px hit area.
    const plus = screen.getByTestId(`buy-stage-inc-${SAUCE.id}`);
    expect(plus).toHaveClass("group", "absolute", "end-[8px]", "top-[8px]", "z-10", "h-[44px]", "w-[44px]");
    expect(plus.firstElementChild).toHaveClass(
      "h-[36px]",
      "w-[36px]",
      "rounded-full",
      "bg-tb-surface",
      "shadow-[0px_2px_12px_0px_rgba(0,0,0,0.15)]",
      "group-active:bg-tb-lilac"
    );
    expect(plus.querySelector("img")).toHaveClass("h-[16px]", "w-[16px]");
  });

  it("the WHOLE card adds: an empty overlay (a direct child — the card presses) named 'Quick add <name>', the add target at every quantity; the '+' is its aria-hidden twin that never takes focus", async () => {
    renderStage(BOGO);
    const card = screen.getByTestId(`buy-stage-tile-${SAUCE.id}`);
    const overlay = within(card).getByRole("button", { name: "Quick add Tortilla Sauce" });
    expect(overlay).toHaveAttribute("data-testid", `buy-stage-add-${SAUCE.id}`);
    expect(overlay.parentElement).toBe(card);
    expect(overlay).toBeEmptyDOMElement();
    expect(overlay).toHaveClass("absolute", "inset-0");
    const plus = screen.getByTestId(`buy-stage-inc-${SAUCE.id}`);
    expect(plus).toHaveAttribute("aria-hidden", "true");
    expect(plus).toHaveAttribute("tabindex", "-1");
    // ONE accessible control per card until it is picked.
    expect(within(card).getAllByRole("button")).toEqual([overlay]);
    expect(within(card).getAllByRole("button", { hidden: true })).toEqual([overlay, plus]);
    // fireEvent answers false when the handler called preventDefault().
    expect(fireEvent.mouseDown(plus)).toBe(false);

    await userEvent.click(overlay);
    expect(sauceRows()).toEqual([expect.objectContaining({ quantity: 1 })]);
    await userEvent.click(plus);
    expect(sauceRows()).toEqual([expect.objectContaining({ quantity: 2 })]);
    await userEvent.click(screen.getByTestId(`buy-stage-add-${SAUCE.id}`));
    expect(sauceRows()).toEqual([expect.objectContaining({ quantity: 3 })]);
    expect(sauceRows()).toHaveLength(1);
  });

  it("a card whose tap opens the tier session is named 'Customize <name>' (a customizable item); a one-tap card 'Quick add <name>' — the add path's own split, nothing opened to find out", () => {
    const BURGER_OR_SAUCE = {
      ...BOGO,
      _id: "offer-burger-or-sauce",
      applicable: applicable([
        { item: { baseItemId: BURGER.id, name: "Cheese Burger" }, quantity: 1, relation: "or" },
        { item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: 1, relation: "or" },
      ]),
    };
    renderStage(BURGER_OR_SAUCE);

    expect(screen.getByTestId(`buy-stage-add-${BURGER.id}`)).toHaveAccessibleName(
      `${i18n.t("pack.customize")} Cheese Burger`
    );
    expect(screen.getByTestId(`buy-stage-add-${SAUCE.id}`)).toHaveAccessibleName(
      `${i18n.t("menu.quickAdd")} Tortilla Sauce`
    );
    expect(state().makeItAMeal.makeItAMealModal.tier1CustomizationModal.isOpen).toBe(false);
  });

  it("a variant-id entry is 'Customize <name> (<size>)' (the size sheet opens), its size within the 2-line clamp", () => {
    const view = viewFor(LARGE_FRIES_BOGO, {
      "fries-l": { baseItem: FRIES_BASE, variant: { id: "fries-l", name: "Large" } },
    });
    renderStage(LARGE_FRIES_BOGO, view);
    expect(screen.getByTestId("buy-stage-add-fries")).toHaveAccessibleName("Customize Fries (Large)");
    expect(within(screen.getByTestId("buy-stage-tile-fries")).getByText("Fries (Large)")).toHaveClass("line-clamp-2");
  });

  it("picked: the purple ring; the count pill (aria-hidden) at the photo band's bottom-start pops in and re-keys its number (bump) on each change; an always-mounted status speaks 'N selected' (EN, AR); at 0 none of it", async () => {
    renderStage(BOGO);
    const card = screen.getByTestId(`buy-stage-tile-${SAUCE.id}`);
    const status = within(card).getByRole("status");
    expect(status).toHaveClass("absolute", "bottom-[12px]", "start-[12px]");
    expect(status).toBeEmptyDOMElement();
    expect(card).not.toHaveClass("ring-[3px]");
    expect(screen.queryByTestId(`buy-stage-qty-${SAUCE.id}`)).toBeNull();
    expect(screen.queryByTestId(`buy-stage-dec-${SAUCE.id}`)).toBeNull();

    await userEvent.click(screen.getByTestId(`buy-stage-add-${SAUCE.id}`));
    expect(card).toHaveClass("ring-[3px]", "ring-tb-purple");
    const pill = screen.getByTestId(`buy-stage-qty-${SAUCE.id}`);
    expect(pill).toHaveTextContent(/^1$/);
    expect(pill).toHaveAttribute("aria-hidden", "true");
    expect(pill).toHaveClass(
      "tb-pop-in",
      "h-[36px]",
      "min-w-[36px]",
      "rounded-full",
      "bg-tb-purple",
      "px-[8px]",
      "text-[18px]",
      "font-bold",
      "text-tb-surface"
    );
    const number = pill.firstElementChild;
    expect(number).toHaveClass("tb-bump");
    expect(status).toContainElement(pill);
    const spoken = () => status.querySelector(".sr-only")?.textContent;
    expect(spoken()).toBe("1 selected");
    // Before the overlay: a tap on the pill lands on the card's add.
    const children = Array.from(card.children);
    expect(children.indexOf(status)).toBeLessThan(children.indexOf(screen.getByTestId(`buy-stage-add-${SAUCE.id}`)));

    await userEvent.click(screen.getByTestId(`buy-stage-inc-${SAUCE.id}`));
    expect(screen.getByTestId(`buy-stage-qty-${SAUCE.id}`)).toBe(pill);
    expect(pill).toHaveTextContent(/^2$/);
    expect(pill.firstElementChild).not.toBe(number);
    expect(pill.firstElementChild).toHaveClass("tb-bump");
    expect(spoken()).toBe("2 selected");

    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    expect(spoken()).toBe(i18n.t("added.selected", { value: 2 }));
    expect(spoken()).not.toBe("2 selected");
  });

  it("'−' only while picked: a 36 px white circle on a 44 px hit area at the photo band's bottom-end, named 'Remove one <name>' — the trash glyph at 1, '−' from 2", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceRow("s-1", 2)]));
    renderStage(BOGO);
    const dec = screen.getByRole("button", { name: "Remove one Tortilla Sauce" });
    expect(dec).toHaveAttribute("data-testid", `buy-stage-dec-${SAUCE.id}`);
    expect(dec).toHaveClass("group", "absolute", "bottom-[8px]", "end-[8px]", "z-10", "h-[44px]", "w-[44px]");
    expect(dec.firstElementChild).toHaveClass(
      "h-[36px]",
      "w-[36px]",
      "rounded-full",
      "bg-tb-surface",
      "group-active:bg-tb-lilac"
    );
    const glyph = () =>
      screen.getByTestId(`buy-stage-dec-${SAUCE.id}`).querySelector("img")?.getAttribute("src") ?? "";
    expect(glyph()).toContain("qty-minus");
    expect(glyph()).not.toContain("trash");

    await userEvent.click(dec);
    await waitFor(() => expect(sauceRows()).toEqual([expect.objectContaining({ quantity: 1 })]));
    expect(screen.getByTestId(`buy-stage-qty-${SAUCE.id}`)).toHaveTextContent(/^1$/);
    expect(glyph()).toContain("trash");
    expect(glyph()).not.toContain("qty-minus");
  });

  it("an unavailable card (out of stock) has MenuItemCard's look — content at 40 %, a grayscale photo, the Unavailable chip — and NO add target: no overlay, no '+', a tap adds nothing", async () => {
    renderStage(LEAST, viewWith(LEAST, { [CAESAR.id]: { ...CAESAR, image_url: PHOTO, outOfStock: true } }));
    const card = screen.getByTestId(`buy-stage-tile-${CAESAR.id}`);
    expect(within(card).getByText("Unavailable")).toHaveClass(
      "absolute",
      "bottom-[16px]",
      "left-1/2",
      "-translate-x-1/2",
      "bg-tb-ink-purple/80"
    );
    expect(within(card).getByText(CAESAR.name).parentElement).toHaveClass("opacity-40");
    expect(card.querySelector("img")).toHaveClass("opacity-40", "grayscale");
    expect(screen.queryByTestId(`buy-stage-add-${CAESAR.id}`)).toBeNull();
    expect(screen.queryByTestId(`buy-stage-inc-${CAESAR.id}`)).toBeNull();
    expect(within(card).queryAllByRole("button", { hidden: true })).toEqual([]);

    await userEvent.click(card);
    expect(state().cart.cartItems).toEqual([BURGER_ROW]);
    // Its neighbour is still a live card.
    expect(screen.getByTestId(`buy-stage-add-${SAUCE.id}`)).toBeEnabled();
  });

  it("an unavailable card still in the order (it went out of stock once picked): the chip rises above the count pill and the '−' (36 px, 12 px up: their tops at 48 px) and the '−' is its one control", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceRow("c-1", 1, { id: CAESAR.id, name: CAESAR.name })]));
    renderStage(LEAST, viewWith(LEAST, { [CAESAR.id]: { ...CAESAR, outOfStock: true } }));
    const card = screen.getByTestId(`buy-stage-tile-${CAESAR.id}`);
    expect(screen.getByTestId(`buy-stage-qty-${CAESAR.id}`)).toHaveTextContent(/^1$/);
    const chip = within(card).getByText("Unavailable");
    expect(chip).toHaveClass("bottom-[56px]");
    expect(chip).not.toHaveClass("bottom-[16px]");
    expect(within(card).getAllByRole("button", { hidden: true })).toEqual([
      screen.getByRole("button", { name: "Remove one Caesar Dressing" }),
    ]);
  });

  it("logical insets (a mirrored layout flips them): '+' top-end, the pill bottom-start, the '−' bottom-end, the text block ps / pe — no physical left / right on the card's corners", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceRow("s-1")]));
    renderStage(BOGO);
    const card = screen.getByTestId(`buy-stage-tile-${SAUCE.id}`);
    const plus = screen.getByTestId(`buy-stage-inc-${SAUCE.id}`);
    const dec = screen.getByTestId(`buy-stage-dec-${SAUCE.id}`);
    const status = within(card).getByRole("status");
    const text = within(card).getByText(SAUCE.name).parentElement as HTMLElement;

    expect(plus).toHaveClass("end-[8px]", "top-[8px]");
    expect(dec).toHaveClass("end-[8px]", "bottom-[8px]");
    expect(status).toHaveClass("start-[12px]", "bottom-[12px]");
    expect(text).toHaveClass("ps-[24px]", "pe-[64px]");
    for (const el of [plus, dec, status, text]) {
      expect(el.className).not.toMatch(/(^|\s)-?(left|right|pl|pr)-/);
    }
  });
});

describe("BuyStageSheet — a header only says what the cards don't", () => {
  /** Plain-and: ANY sauce (a category of two) AND a Cheese Burger. */
  const CAT_AND_BURGER = {
    ...BOGO,
    _id: "offer-cat-burger",
    name: "Any sauce and a burger",
    applicable: applicable([
      { category: { _id: "sauces", categoryName: "Sauces" }, quantity: 1, relation: "and" },
      { item: { baseItemId: BURGER.id, name: "Cheese Burger" }, quantity: 1, relation: "and" },
    ]),
  };
  /** `need` Tortilla Sauces AND / OR a Caesar (per-group needs `need` and 1). */
  const SAUCES_AND_ONE = (relation: "and" | "or", need: number) => ({
    ...BOGO,
    _id: `offer-${need}-${relation}-one`,
    applicable: applicable([
      { item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: need, relation },
      { item: { baseItemId: CAESAR.id, name: "Caesar Dressing" }, quantity: 1, relation },
    ]),
  });
  /** Plain-or: Large Fries (a variant-id entry: its card reads "Fries (Large)", its raw name "Fries") OR a Tortilla Sauce. */
  const FRIES_OR_SAUCE = (friesLabel: string) => ({
    ...BOGO,
    _id: "offer-fries-or-sauce",
    applicable: applicable([
      { item: { baseItemId: "fries-l", name: friesLabel }, quantity: 1, relation: "or" },
      { item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: 1, relation: "or" },
    ]),
  });
  const LARGE = { "fries-l": { baseItem: FRIES_BASE, variant: { id: "fries-l", name: "Large" } } };
  /** A group's header is followed by its own first card. */
  const headerOver = (key: string, tileId: string) =>
    expect(screen.getByTestId(`buy-stage-group-${key}`).nextElementSibling).toBe(
      screen.getByTestId(`buy-stage-tile-${tileId}`)
    );

  it("each group one item under its own name (the reported tenant shape): no headers, and the cards flow together in one row", () => {
    renderStage(LEAST);
    expect(headers()).toEqual([]);
    const sauce = screen.getByTestId(`buy-stage-tile-${SAUCE.id}`);
    const caesar = screen.getByTestId(`buy-stage-tile-${CAESAR.id}`);
    expect(sauce.parentElement).toBe(caesar.parentElement);
    expect(sauce.nextElementSibling).toBe(caesar);
  });

  it("the label matches the card's name trimmed and case-insensitively: no header", () => {
    const view = viewFor(LEAST);
    renderStage(LEAST, {
      ...view,
      groups: [
        { ...view.groups[0], label: "  tortilla SAUCE " },
        { ...view.groups[1], label: "CAESAR dressing\t" },
      ],
    });
    expect(headers()).toEqual([]);
  });

  it("a label the card does not show earns a header — and then every group has one, over its own cards (a heading groups every card below it)", () => {
    const view = viewFor(LEAST);
    renderStage(LEAST, { ...view, groups: [view.groups[0], { ...view.groups[1], label: "Dressings" }] });
    expect(headers().map((header) => header.textContent)).toEqual(["Tortilla Sauce", "Dressings"]);
    for (const header of headers()) expect(header).toHaveClass("col-span-full");
    headerOver(SAUCE.id, SAUCE.id);
    headerOver(CAESAR.id, CAESAR.id);
  });

  it("a variant-id entry: a label equal to its card's '<name> (<size>)', trimmed, any case, says nothing more (the raw name is only 'Fries'); a label the card does not show heads the stage", () => {
    renderStage(FRIES_OR_SAUCE(" fries (LARGE) "), viewFor(FRIES_OR_SAUCE(" fries (LARGE) "), LARGE));
    expect(screen.getByTestId("buy-stage-tile-fries")).toHaveTextContent("Fries (Large)");
    expect(headers()).toEqual([]);

    cleanup();
    renderStage(FRIES_OR_SAUCE("Large Fries Deal"), viewFor(FRIES_OR_SAUCE("Large Fries Deal"), LARGE));
    expect(headers().map((header) => header.textContent)).toEqual([
      "Any 1 from Large Fries Deal",
      "Any 1 from Tortilla Sauce",
    ]);
    headerOver("fries-l", "fries");
  });

  it("an empty label on a lone item: no header", () => {
    const view = viewFor(LEAST);
    renderStage(LEAST, { ...view, groups: view.groups.map((group) => ({ ...group, label: " " })) });
    expect(headers()).toEqual([]);
  });

  it("a category group (several items) heads the stage, and the lone item after it gets its own header — never read as a third sauce", () => {
    renderStage(CAT_AND_BURGER);
    expect(headers().map((header) => header.textContent)).toEqual([
      "Any 1 from Sauces",
      "Any 1 from Cheese Burger",
    ]);
    headerOver("sauces", SAUCE.id);
    expect(screen.getByTestId(`buy-stage-tile-${CAESAR.id}`).nextElementSibling).toBe(
      screen.getByTestId(`buy-stage-group-${BURGER.id}`)
    );
    headerOver(BURGER.id, BURGER.id);
    for (const header of headers()) expect(header).toHaveClass("col-span-full");
  });

  it("a category group with an empty label still says 'these items'", () => {
    const view = viewFor(CAT_AND_BURGER);
    renderStage(CAT_AND_BURGER, {
      ...view,
      groups: view.groups.map((group) => (group.kind === "category" ? { ...group, label: "" } : group)),
    });
    expect(headers().map((header) => header.textContent)).toEqual([
      "Any 1 from these items",
      "Any 1 from Cheese Burger",
    ]);
  });

  it.each(["and", "or"] as const)(
    "plain-%s: a per-group need above 1 is something the card does not say — 'Any 2 from Tortilla Sauce' heads the stage, its need-1 sibling with it; every need at 1, no header",
    (relation) => {
      renderStage(SAUCES_AND_ONE(relation, 2));
      expect(headers().map((header) => header.textContent)).toEqual([
        "Any 2 from Tortilla Sauce",
        "Any 1 from Caesar Dressing",
      ]);

      cleanup();
      renderStage(SAUCES_AND_ONE(relation, 1));
      expect(headers()).toEqual([]);
    }
  );

  it("least: the threshold is shared, so a group's own count never earns it a header", () => {
    const view = viewFor(LEAST);
    renderStage(LEAST, { ...view, groups: view.groups.map((group) => ({ ...group, requiredQuantity: 2 })) });
    expect(headers()).toEqual([]);
  });

  it("one group: never a header, whatever its label", () => {
    const view = viewFor(BOGO);
    renderStage(BOGO, { ...view, groups: [{ ...view.groups[0], label: "Sauces of the day" }] });
    expect(headers()).toEqual([]);
  });

  it("Arabic session: the English label is the item's raw name, so the Arabic cards go without headers; a label the card does not show heads the stage", async () => {
    const AR_SAUCE = "صلصة التورتيلا";
    const view = viewWith(LEAST, {
      [SAUCE.id]: { ...SAUCE, aliases: [{ value: AR_SAUCE, name: "Arabic", code: "ar", dir: "rtl" }] },
    });
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderStage(LEAST, view);

    expect(screen.getByTestId(`buy-stage-tile-${SAUCE.id}`)).toHaveTextContent(AR_SAUCE);
    expect(screen.getByTestId(`buy-stage-tile-${SAUCE.id}`)).not.toHaveTextContent("Tortilla Sauce");
    expect(headers()).toEqual([]);

    cleanup();
    renderStage(LEAST, { ...view, groups: [view.groups[0], { ...view.groups[1], label: "Dressings" }] });
    expect(headers().map((header) => header.getAttribute("data-testid"))).toEqual([
      `buy-stage-group-${SAUCE.id}`,
      `buy-stage-group-${CAESAR.id}`,
    ]);
  });
});
