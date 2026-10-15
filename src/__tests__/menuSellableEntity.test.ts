import { beforeEach, describe, expect, it } from "vitest";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import {
  toMenuSellableEntity,
  type ModifierGroupMap,
} from "@cx-sdk/catalog/recommendation/recommendationUtils";
import {
  selectMenu,
  selectVariantObject,
  setEntityMap,
  setMenuData,
  setModifiersMap,
  setVariantObject,
} from "@cx-sdk/catalog/state/Menu.slice";
import { setAllowMultiplePunch, setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../redux/app/store";
import { setOutOfStockItems } from "../redux/features/menuSelections/menuSelections.slice";
import {
  selectMenuSellableEntityMap,
  selectSellableMenu,
  selectSellableVariantObject,
} from "../hooks/menuHooks/useCartUpsell";

/*
  UB6 Fix B — the entity as the MENU sells it. entityMap is published BEFORE
  the menu converter runs, so it still lists dead groups (inactive, or missing
  from the menu's modifiers). The converter sells a plain item whose groups
  are ALL dead as a one-tap item (`modifiers: []`) and drops such a pack (any
  id ending "_combo"); every suggestion surface reads the same shape through
  selectMenuSellableEntityMap. The pure half lives in the SDK
  (tenantRecommendations.test.ts precedent).
*/

const MAP: ModifierGroupMap = {
  live_addons: { isActive: true },
  off_addons: { isActive: false },
  live_combo: { isActive: true },
  off_combo: { isActive: false },
};
const entity = (modifiers?: string[], extra: Partial<RecommendedEntity> = {}): RecommendedEntity => ({
  id: "x",
  name: "X",
  isDirectlyAddable: false,
  modifiers,
  ...extra,
});

describe("toMenuSellableEntity", () => {
  it.each<[string, RecommendedEntity]>([
    ["no modifiers field", entity(undefined)],
    ["an empty modifiers list", entity([])],
    ["a variant parent whose ids are all dead", entity(["gone_addons", "off_addons"], { hasVariant: true })],
    ["a variant whose ids are all dead", entity(["gone_addons"], { isVariant: true })],
    ["a live group plus a dangling id", entity(["live_addons", "gone_addons"])],
    ["a pack with one live group", entity(["live_combo", "gone_combo", "off_combo"])],
  ])("%s → the SAME object", (_label, input) => {
    expect(toMenuSellableEntity(input, MAP)).toBe(input);
  });

  it.each<[string, string[]]>([
    ["every id dangling", ["gone_addons", "gone_2_addons"]],
    ["every group inactive", ["off_addons"]],
    ["inactive plus dangling", ["off_addons", "gone_addons"]],
  ])("a plain item, %s → a one-tap copy (modifiers []); the input is not mutated", (_label, modifiers) => {
    const input = entity(modifiers, { price: 9 });
    const before = structuredClone(input);

    const out = toMenuSellableEntity(input, MAP);

    expect(out).toEqual({ ...before, modifiers: [] });
    expect(out).not.toBe(input);
    expect(input).toEqual(before);
  });

  it.each<[string, string[]]>([
    ["every id dangling", ["gone_1_combo", "gone_2_combo"]],
    ["every group inactive", ["off_combo"]],
    ["inactive plus dangling", ["off_combo", "gone_combo"]],
    // The converter's `find`: ANY "_combo" id makes the item a pack.
    ["one dead combo id beside dead plain ids", ["gone_addons", "off_addons", "gone_combo"]],
  ])("a pack, %s → null (the menu drops it)", (_label, modifiers) => {
    expect(toMenuSellableEntity(entity(modifiers), MAP)).toBeNull();
  });

  it.each<[string, ModifierGroupMap]>([
    ["null", null],
    ["undefined", undefined],
  ])("a %s modifierMap (no menu groups): a plain item gets [], a pack gets null", (_label, map) => {
    expect(toMenuSellableEntity(entity(["live_addons"]), map)?.modifiers).toEqual([]);
    expect(toMenuSellableEntity(entity(["live_combo"]), map)).toBeNull();
  });
});

describe("selectMenuSellableEntityMap (real store)", () => {
  const LIVE = { id: "burger", name: "Cheese Burger", price: 8, modifiers: ["burger_addons", "gone_addons"] };
  const PLAIN = { id: "salad", name: "Greek Salad", price: 17 };
  const DEAD_PLAIN = { id: "fries", name: "Large Fries", price: 9, modifiers: ["gone_addons"] };
  const DEAD_PACK = { id: "box", name: "Dream box", price: 25, modifiers: ["box_1_combo", "gone_combo"] };

  type MenuRoot = { menu: { entityMap: Record<string, RecommendedEntity> | null } };
  const rawMap = () => (store.getState() as unknown as MenuRoot).menu.entityMap;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  const seedMenu = () => {
    store.dispatch(
      setModifiersMap({
        modifiersMap: {
          burger_addons: { _id: "burger_addons", isActive: true },
          box_1_combo: { _id: "box_1_combo", isActive: false },
        },
      })
    );
    store.dispatch(setEntityMap({ entityMap: { burger: LIVE, salad: PLAIN, fries: DEAD_PLAIN, box: DEAD_PACK } }));
  };

  it("drops the dead pack and reshapes the dead plain item; unchanged entities come back by identity", () => {
    seedMenu();
    const raw = rawMap();

    const sellable = selectMenuSellableEntityMap(store.getState());

    expect(Object.keys(sellable ?? {})).toEqual(["burger", "salad", "fries"]);
    expect(sellable?.fries).toEqual({ ...DEAD_PLAIN, modifiers: [] });
    expect(sellable?.burger).toBe(raw?.burger);
    expect(sellable?.salad).toBe(raw?.salad);
  });

  it("leaves state.menu.entityMap raw: its entries still list the dead ids", () => {
    seedMenu();

    selectMenuSellableEntityMap(store.getState());

    expect(rawMap()?.fries?.modifiers).toEqual(["gone_addons"]);
    expect(rawMap()?.box?.modifiers).toEqual(["box_1_combo", "gone_combo"]);
  });

  it("is memoized: the same reference on a repeat call and after an unrelated dispatch", () => {
    seedMenu();
    const first = selectMenuSellableEntityMap(store.getState());

    expect(selectMenuSellableEntityMap(store.getState())).toBe(first);
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    expect(selectMenuSellableEntityMap(store.getState())).toBe(first);
  });

  it("a null entityMap (no menu yet) → null", () => {
    expect(rawMap()).toBeNull();
    expect(selectMenuSellableEntityMap(store.getState())).toBeNull();
  });
});

/*
  walk-oos 2 (user 2026-10-14, "Show it Unavailable"): an item — or one size
  of it — whose REQUIRED group has nothing in stock can never be completed,
  so both shared selectors hand it out of stock: the entity map (every rail,
  strip, tile, Select a Size from a suggestion) and the menu tree (the
  cards, their "+", Select a Size, the loyalty rewards). One SDK rule
  (markUncompletable), re-run whenever the stock data moves.
*/
describe("walk-oos 2 — an item no guest can complete reads out of stock (real store)", () => {
  const opt = (id: string, outOfStock = false) => ({ id, name: id, isActive: true, outOfStock });
  const MODS = {
    sauce: { _id: "sauce", isActive: true, min: 1, max: 1, multiplePunchMin: 1, constituentItems: [opt("hot", true), opt("mild")] },
    drink: { _id: "drink", isActive: true, min: 1, max: 1, multiplePunchMin: 0, constituentItems: [opt("cola", true), opt("lime", true)] },
    extras: { _id: "extras", isActive: true, min: 0, max: 3, multiplePunchMin: 0, constituentItems: [opt("egg", true)] },
  };
  const BURRITO = { id: "burrito", name: "Burrito", price: 5, modifiers: ["sauce"] };
  const MEAL = { id: "meal", name: "Taco Meal", price: 9, modifiers: ["extras", "drink"] };
  const NACHOS = { id: "nachos", name: "Nachos", price: 4, modifiers: ["extras"] };
  const REGULAR = { id: "soda-r", name: "Regular", price: 2, isActive: true, modifiers: [] };
  const LARGE = { id: "soda-l", name: "Large", price: 3, isActive: true, modifiers: ["drink"] };
  const SODA = { id: "soda", name: "Soda", price: 2, hasVariant: true, isVariant: false, variants: [REGULAR, LARGE] };
  const TREE = { categories: [{ id: "c1", name: "Mains", subCategories: [{ id: "s1", name: "Mains", entities: [BURRITO, MEAL, NACHOS, SODA] }] }] };

  type Entity = { id?: string; outOfStock?: boolean; variants?: Entity[] };
  type Tree = { categories: { subCategories: { entities: Entity[] }[] }[] };
  const sellable = () => selectMenuSellableEntityMap(store.getState()) as Record<string, Entity>;
  const cards = () => (selectSellableMenu(store.getState()) as Tree).categories[0].subCategories[0].entities;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setModifiersMap({ modifiersMap: MODS }));
    store.dispatch(setEntityMap({ entityMap: { burrito: BURRITO, meal: MEAL, nachos: NACHOS, soda: SODA } }));
    store.dispatch(setMenuData({ menu: TREE }));
  });

  it("the meal (its drink: every option out) reads out of stock in both; a live required group or a min-0 group all out never kills; the raw state is untouched", () => {
    expect(sellable().meal).toEqual({ ...MEAL, outOfStock: true });
    expect(sellable().burrito).toBe(BURRITO);
    expect(sellable().nachos).toBe(NACHOS);
    expect(cards().map((entity) => entity.outOfStock === true)).toEqual([false, true, false, false]);
    expect((store.getState() as unknown as { menu: { entityMap: Record<string, Entity> } }).menu.entityMap.meal).toBe(MEAL);
    expect(MEAL).not.toHaveProperty("outOfStock");
  });

  it("a size whose own required group is out reads out of stock; the other size and the item stay available", () => {
    for (const soda of [sellable().soda, cards()[3]]) {
      expect(soda.outOfStock).toBeUndefined();
      expect(soda.variants).toEqual([REGULAR, { ...LARGE, outOfStock: true }]);
      expect(soda.variants?.[0]).toBe(REGULAR);
    }
  });

  it("re-evaluated when the stock data moves: PAY's map takes the burrito's last sauce — out; it brings a drink back — the meal and the Large are back", () => {
    store.dispatch(setOutOfStockItems({ mild: { type: "addon", inStock: false } }));
    expect(sellable().burrito).toEqual({ ...BURRITO, outOfStock: true });
    expect(cards()[0].outOfStock).toBe(true);

    store.dispatch(setOutOfStockItems({ lime: { type: "addon", inStock: true } }));
    expect(sellable().burrito).toBe(BURRITO);
    expect(sellable().meal).toBe(MEAL);
    expect(sellable().soda).toBe(SODA);
    // Nothing dead: the store's own menu, by identity.
    expect(selectSellableMenu(store.getState())).toBe(selectMenu(store.getState()));
  });

  it("the size index (the buy stage's size-keyed tiles) under the same rule: both of the soda's entries hand the Large out of stock; nothing dead → the store's own index", () => {
    store.dispatch(
      setVariantObject({
        variantObject: { "soda-r": { baseItem: SODA, variant: REGULAR }, "soda-l": { baseItem: SODA, variant: LARGE } },
      }),
    );
    type Sizes = Record<string, { baseItem: Entity; variant: unknown }>;
    const sizes = () => selectSellableVariantObject(store.getState()) as Sizes;

    for (const id of ["soda-r", "soda-l"]) {
      expect(sizes()[id].baseItem.variants).toEqual([REGULAR, { ...LARGE, outOfStock: true }]);
      expect(sizes()[id].baseItem.variants?.[0]).toBe(REGULAR);
    }
    expect(sizes()["soda-l"].variant).toBe(LARGE);
    expect((selectVariantObject(store.getState()) as Sizes)["soda-l"].baseItem).toBe(SODA);

    // PAY's map brings a drink back: nothing dead — the store's own index.
    store.dispatch(setOutOfStockItems({ lime: { type: "addon", inStock: true } }));
    expect(selectSellableVariantObject(store.getState())).toBe(selectVariantObject(store.getState()));
  });

  it("the multi-punch setting is an input: its min (0 for the drink) decides", () => {
    store.dispatch(setAllowMultiplePunch(true));
    expect(sellable().meal).toBe(MEAL);
    expect(cards()[1]).toBe(MEAL);
  });

  it("memoized: an unrelated dispatch hands back the same references", () => {
    const map = selectMenuSellableEntityMap(store.getState());
    const menu = selectSellableMenu(store.getState());
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    expect(selectMenuSellableEntityMap(store.getState())).toBe(map);
    expect(selectSellableMenu(store.getState())).toBe(menu);
  });

  it("no menu yet: the tree selector hands back what the store holds", () => {
    store.dispatch({ type: "RESET_STATE" });
    expect(selectSellableMenu(store.getState())).toBe(selectMenu(store.getState()));
  });
});
