import { describe, expect, it } from "vitest";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import {
  collectTenantRecommendations,
  toTenantRecommendationMap,
  type TenantRecommendationMap,
} from "@cx-sdk/catalog/recommendation/tenantRecommendations";

/*
  Post-P9 29a — the pure half of the tenant (S3) cart recommendations.
  toTenantRecommendationMap normalises an untrusted body (the S3 envelope, a
  bare list, or an already-built map — so a Dexie copy is re-validated);
  collectTenantRecommendations ranks it against the live menu for the cart.
*/

const ENTRY = {
  _id: "row-1",
  deployment_id: "dep-1",
  baseItem_id: "burger",
  baseItem_name: "Cheese Burger",
  refers: [
    { refer_baseItem_id: "fries", occurrences: 3, referItem_name: "Large Fries", extra: true },
    { refer_baseItem_id: "  ", occurrences: 9 },
    null,
    { occurrences: 2 },
  ],
};
const BURGER_ONLY: TenantRecommendationMap = {
  burger: { baseItem_id: "burger", refers: [{ refer_baseItem_id: "fries", occurrences: 3 }] },
};

const refer = (refer_baseItem_id: string, occurrences: unknown) => ({ refer_baseItem_id, occurrences });

describe("toTenantRecommendationMap", () => {
  it("builds the map from the S3 envelope {data:[...]}, keeping only baseItem_id and valid refers (extra fields stripped)", () => {
    expect(toTenantRecommendationMap({ data: [ENTRY] })).toEqual(BURGER_ONLY);
  });

  it("accepts a bare list", () => {
    expect(toTenantRecommendationMap([ENTRY])).toEqual(BURGER_ONLY);
  });

  it("accepts an already-built map (a cached copy is re-validated, never trusted)", () => {
    const cached = {
      ...BURGER_ONLY,
      junk: { baseItem_id: "junk", refers: [] },
      bad: { baseItem_id: 7, refers: [refer("x", 1)] },
    };

    expect(toTenantRecommendationMap(cached)).toEqual(BURGER_ONLY);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a string", "x"],
    ["a number", 5],
    ["true", true],
    ["{}", {}],
    ["[]", []],
    ["{data: null}", { data: null }],
    ["{data: 'x'}", { data: "x" }],
    ["a list of junk", [null, 1, "a", []]],
  ])("junk (%s) → {} without throwing", (_label, body) => {
    expect(toTenantRecommendationMap(body)).toEqual({});
  });

  it("an entry with missing, empty or all-invalid refers is dropped; so is a blank or non-string baseItem_id", () => {
    expect(
      toTenantRecommendationMap([
        { baseItem_id: "a" },
        { baseItem_id: "b", refers: [] },
        { baseItem_id: "c", refers: "fries" },
        { baseItem_id: "d", refers: [{ refer_baseItem_id: "" }, { refer_baseItem_id: 5 }] },
        { baseItem_id: " ", refers: [refer("x", 1)] },
        { baseItem_id: 7, refers: [refer("x", 1)] },
        { refers: [refer("x", 1)] },
      ])
    ).toEqual({});
  });

  it("occurrences must be a finite positive number, otherwise 0", () => {
    const map = toTenantRecommendationMap([
      {
        baseItem_id: "b",
        refers: [-1, 0, NaN, Infinity, "5", null, undefined, 2.5, 4].map((o, i) => refer(`r${i}`, o)),
      },
    ]);

    expect(map.b.refers.map((r) => r.occurrences)).toEqual([0, 0, 0, 0, 0, 0, 0, 2.5, 4]);
  });

  it("a duplicate baseItem_id resolves last-wins — but a later INVALID duplicate never erases a good entry", () => {
    const first = { baseItem_id: "b", refers: [refer("r1", 1)] };
    const second = { baseItem_id: "b", refers: [refer("r2", 2)] };

    expect(toTenantRecommendationMap([first, second]).b.refers).toEqual([refer("r2", 2)]);
    expect(toTenantRecommendationMap([first, { baseItem_id: "b", refers: [] }]).b.refers).toEqual([refer("r1", 1)]);
  });

  it("a '__proto__' id is an own key, never the prototype setter", () => {
    const map = toTenantRecommendationMap([{ baseItem_id: "__proto__", refers: [refer("r", 1)] }]);

    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    expect(Object.keys(map)).toEqual(["__proto__"]);
  });
});

const entity = (id: string, extra: Partial<RecommendedEntity> = {}): RecommendedEntity => ({
  id,
  name: id.toUpperCase(),
  price: 1,
  isActive: true,
  isDirectlyAddable: false,
  ...extra,
});

const ENTITY_MAP: Record<string, RecommendedEntity> = {
  burger: entity("burger"),
  taco: entity("taco"),
  fries: entity("fries"),
  salad: entity("salad"),
  combo: entity("combo", { upsellItems: [{ id: "meal" }] }),
  custom: entity("custom", { modifiers: ["g1"] }),
  sized: entity("sized", {
    hasVariant: true,
    price: 9,
    variants: [
      { id: "s-l", isActive: true, price: 4 },
      { id: "s-xs", isActive: false, price: 1 },
      { id: "s-m", isActive: true, price: 6 },
    ],
  }),
  off: entity("off", { isActive: false }),
  oos: entity("oos", { outOfStock: true }),
  liveOos: entity("liveOos"),
  veg: entity("veg", { tags: ["veg"] }),
  meat: entity("meat", { tags: ["non-veg"] }),
  phantom: entity("phantom", { hasVariant: true, variants: [{ id: "p1", isActive: false, price: 2 }] }),
};

const ids = (list: RecommendedEntity[]) => list.map((e) => e.id);

describe("collectTenantRecommendations", () => {
  const MAP = toTenantRecommendationMap([
    {
      baseItem_id: "burger",
      refers: [refer("fries", 2), refer("combo", 5), refer("taco", 9), refer("salad", 1)],
    },
    { baseItem_id: "taco", refers: [refer("fries", 4), refer("salad", 1), refer("sized", 1)] },
  ]);
  const CART = [{ id: "burger" }, { id: "taco" }];

  it("sums occurrences across cart rows and sorts descending; in-cart ids are excluded", () => {
    // fries 2+4 = 6, combo 5, salad 1+1 = 2, sized 1; taco is in the cart.
    expect(ids(collectTenantRecommendations(MAP, CART, ENTITY_MAP, {}, [], false))).toEqual([
      "fries",
      "combo",
      "salad",
      "sized",
    ]);
  });

  it("ties keep first-seen order (a stable sort)", () => {
    const tie = toTenantRecommendationMap([
      { baseItem_id: "burger", refers: [refer("salad", 3), refer("fries", 3)] },
      { baseItem_id: "taco", refers: [refer("combo", 3)] },
    ]);

    expect(ids(collectTenantRecommendations(tie, CART, ENTITY_MAP, {}, [], false))).toEqual([
      "salad",
      "fries",
      "combo",
    ]);
  });

  it("drops unknown ids (incl. prototype names), inactive, outOfStock, live inStock:false, tag-filtered and phantom parents", () => {
    const map = toTenantRecommendationMap([
      {
        baseItem_id: "burger",
        refers: ["ghost", "constructor", "__proto__", "toString", "off", "oos", "liveOos", "phantom", "veg", "meat", "fries"].map(
          (id) => refer(id, 1)
        ),
      },
    ]);
    const outOfStock = { liveOos: { inStock: false }, fries: { inStock: true } };

    expect(ids(collectTenantRecommendations(map, [{ id: "burger" }], ENTITY_MAP, outOfStock, [], false))).toEqual([
      "veg",
      "meat",
      "fries",
    ]);
    expect(ids(collectTenantRecommendations(map, [{ id: "burger" }], ENTITY_MAP, outOfStock, ["veg"], false))).toEqual([
      "veg",
    ]);
  });

  it("only an explicit isActive:false drops an entity — one without the flag is offered (the flagged engine's rule)", () => {
    const bare: RecommendedEntity = { id: "bare", name: "BARE", price: 1, isDirectlyAddable: false };
    const map = toTenantRecommendationMap([{ baseItem_id: "burger", refers: [refer("bare", 2), refer("off", 1)] }]);

    expect(ids(collectTenantRecommendations(map, [{ id: "burger" }], { ...ENTITY_MAP, bare }, {}, [], false))).toEqual([
      "bare",
    ]);
  });

  it("stamps isDirectlyAddable via isOneTapAddable — combo upsell on makes a combo-upsell item NOT one-tap", () => {
    const map = toTenantRecommendationMap([
      { baseItem_id: "burger", refers: [refer("fries", 4), refer("combo", 3), refer("custom", 2), refer("sized", 1)] },
    ]);
    const stamp = (comboUpsell: boolean) =>
      Object.fromEntries(
        collectTenantRecommendations(map, [{ id: "burger" }], ENTITY_MAP, {}, [], comboUpsell).map((e) => [
          e.id,
          e.isDirectlyAddable,
        ])
      );

    expect(stamp(true)).toEqual({ fries: true, combo: false, custom: false, sized: false });
    expect(stamp(false)).toEqual({ fries: true, combo: true, custom: false, sized: false });
  });

  it("prices a variant parent with resolvePrice (its lowest ACTIVE variant) and never mutates the entity map", () => {
    const [sized] = collectTenantRecommendations(
      toTenantRecommendationMap([{ baseItem_id: "burger", refers: [refer("sized", 1)] }]),
      [{ id: "burger" }],
      ENTITY_MAP,
      {},
      [],
      false
    );

    expect(sized.price).toBe(4);
    expect(sized).not.toBe(ENTITY_MAP.sized);
    expect(ENTITY_MAP.sized.price).toBe(9);
    expect(ENTITY_MAP.sized.isDirectlyAddable).toBe(false);
  });

  it.each<[string, Parameters<typeof collectTenantRecommendations>]>([
    ["no map", [null, CART, ENTITY_MAP, {}, [], false]],
    ["an undefined map", [undefined, CART, ENTITY_MAP, {}, [], false]],
    ["an empty map", [{}, CART, ENTITY_MAP, {}, [], false]],
    ["an empty cart", [MAP, [], ENTITY_MAP, {}, [], false]],
    ["no cart", [MAP, null, ENTITY_MAP, {}, [], false]],
    ["no menu yet", [MAP, CART, null, {}, [], false]],
    ["rows without ids", [MAP, [{}, { id: undefined }], ENTITY_MAP, {}, [], false]],
  ])("empty inputs return []: %s", (_label, args) => {
    expect(collectTenantRecommendations(...args)).toEqual([]);
  });

  it("a missing out-of-stock map or tag list is tolerated", () => {
    expect(ids(collectTenantRecommendations(BURGER_ONLY, [{ id: "burger" }], ENTITY_MAP, null, undefined, undefined))).toEqual([
      "fries",
    ]);
  });
});
