import { beforeEach, describe, expect, it } from "vitest";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import {
  toMenuSellableEntity,
  type ModifierGroupMap,
} from "@cx-sdk/catalog/recommendation/recommendationUtils";
import { setEntityMap, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../redux/app/store";
import { selectMenuSellableEntityMap } from "../hooks/menuHooks/useCartUpsell";

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
