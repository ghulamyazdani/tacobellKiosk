import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildLegacyMenuWithChecks,
  buildLegacyModifierMap,
  collectLegacyEntityMaps,
  convertLegacyMenuTree,
  resolveLegacyModifierGroups,
} from "@cx-sdk/catalog/menu/legacyMenuConverters";
import { getItemIdsFromCartItems } from "@cx-sdk/catalog/oos/outOfStockEngine";
import {
  runCheckoutStockSweep,
  sameCartRows,
  type CheckoutStockSweep,
  type CheckoutStockSweepDeps,
} from "@cx-sdk/catalog/oos/checkoutStockSweep";
import { buildDirectAddPayload } from "@cx-sdk/ordering/cart/addIntent";
import { buildCartItemContent } from "@cx-sdk/ordering/cart/cartEngine";
import {
  buildCustomizableCommitPayload,
  buildVariantCommitPayload,
  mergeCustomizations,
} from "@cx-sdk/ordering/customization/commitPayload";
import { buildTier2NewEntity } from "@cx-sdk/ordering/customization/nestedCardLogic";
import { appendTier2SelectionToTier1 } from "@cx-sdk/ordering/customization/tier2Logic";
import { getTotalValueWithApplyAddonPrice } from "@cx-sdk/ordering/customization/pricing";
import { getCalculatedBill } from "@cx-sdk/ordering/order/orderBuilder";

/*
  audit-fixes A1 — PAY's stock re-check, the SDK sweep (the SDK has no test
  project of its own, H09). Every bag row is built by the REAL commit
  builders from the slim menu converted exactly like useMenuConverters
  converts it (the orderTypeSwitch.test recipe), so "in stock" must flag
  nothing and move no money, and each feed entry must flag exactly its row.
*/

type Obj = Record<string, unknown>;
type Group = { _id: string; constituentItems: Obj[] } & Obj;
type RawMenu = {
  categories: { subCategories: { id: string; entities: Obj[] }[] }[];
  modifiers: Group[];
};

const ROOT = join(import.meta.dirname, "../..");
const SLIM = JSON.parse(
  readFileSync(join(ROOT, "tests/e2e/fixtures/slim-menu.json"), "utf8"),
) as RawMenu;

const GREEK_SALAD = "5dd1093829754a432f2c32e2";
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa";
const DREAM_BOX = "68dd79409030ed3064aee28c";
const PICKLES_GROUP = `${CHEESE_BURGER}_1573980469_addons`;
const PICKLES = "5dd1093f188e72ce1b3eb36e";
const CHEESE_GROUP = `${CHEESE_BURGER}_1686482941_addons`;
const ADD_CHEESE = "5dd1093f188e72ce1b3eb36f";
const FRIES_ADDONS = `${LARGE_FRIES}_1573980470_addons`;
const WITHOUT_SALT = "5dff2ea756bc05b83f9e34cd";
const SANDWICH = "65d4a2d2003967427ed83616";
const BOX = (slot: number) => `${DREAM_BOX}_${slot}_combo`;
const SODA = "syn-soda";
const SODA_S = "syn-soda-s";
const SODA_L = "syn-soda-l";
const ICE_GROUP = `${SODA_L}_1_addons`;
const ICE = "syn-ice";

/** slim-menu + a synthetic size item (slim-menu has none): sizes 2 / 3, Large with an Ice group. */
const rawMenu = (): RawMenu => {
  const menu = structuredClone(SLIM);
  const side = menu.categories[0].subCategories[0];
  const salad = side.entities.find((entity) => entity.id === GREEK_SALAD) as Obj;
  const size = (id: string, name: string, price: number, modifiers: string[]) => ({
    id, name, price, modifiers, taxes: salad.taxes, isActive: true, subCategoryId: side.id, variants: [], upsellItems: [],
  });
  side.entities.push({
    ...structuredClone(salad),
    id: SODA,
    name: "Soda",
    price: 99,
    hasVariant: true,
    isVariant: false,
    modifiers: [],
    upsellItems: [],
    applyAddonsPrice: true,
    variants: [size(SODA_S, "Small", 2, []), size(SODA_L, "Large", 3, [ICE_GROUP])],
  });
  menu.modifiers.push({
    _id: ICE_GROUP, name: "Ice", isActive: true, type: "addons", min: 0, max: 1, order: 1,
    constituentItems: [{ id: ICE, name: "Extra ice", price: 0.5, taxes: salad.taxes, isActive: true, entityType: "Addon" }],
  });
  return menu;
};

/** useMenuConverters.fetchMenu's conversion: the cards the builders take + the modifiers map. */
const convert = (menu: RawMenu) => {
  const categoryMap = new Map();
  const menuWithChecks = buildLegacyMenuWithChecks({
    menu,
    outOfStock: [],
    showNoImageItem: true,
    dpItemsMapToUse: {},
    currentServerDateWithTime: undefined,
    isValidAsPerSchedulers: () => true,
  });
  const { entityMap, activeVariantEntityMap } = collectLegacyEntityMaps(
    menuWithChecks,
    categoryMap,
    new Map(),
    new Map(),
  );
  const tree = convertLegacyMenuTree({
    menuItems: { ...menuWithChecks, categories: structuredClone(menuWithChecks.categories) },
    entpShowCategory: undefined,
    showNoImageItem: true,
    parsedMediaItems: undefined,
    languageType: "primary_language",
    outOfStockItems: [],
    availableItems: [],
    availableItemsMap: new Set(),
    deepCopyMediaItemsMapRdx: {},
    newParsedMediaItems: [],
    mediaItemMapLocal: {},
    entityMap,
    dpItemsMap: {},
    currentServerDateWithTime: undefined,
    schedulerMap: new Map(),
    taxesMap: new Map(),
    tags: new Set(),
    categoryMap,
    mappedUpsellIds: {},
    activeVariantMap: activeVariantEntityMap,
    hideVegNonVeg: undefined,
    deepClone: <T,>(value: T): T => structuredClone(value),
  }) as { categories: { subCategories: { entities: Obj[] }[] }[]; modifiers: Group[] };
  const modifiersMap = buildLegacyModifierMap(tree.modifiers) as Record<string, Group>;
  const card = (id: string) =>
    structuredClone(
      tree.categories
        .flatMap((category) => category.subCategories.flatMap((sub) => sub.entities))
        .find((entity) => entity.id === id) as Obj,
    );
  return { entityMap: Object.fromEntries(entityMap) as Record<string, Obj>, modifiersMap, card };
};

const MENU = convert(rawMenu());
const option = (groupId: string, id: string) =>
  structuredClone(MENU.modifiersMap[groupId].constituentItems.find((item) => item.id === id) as Obj);
const pick = (groupId: string, id: string) => ({ ...option(groupId, id), quantity: 1 });
const direct = (entity: Obj) =>
  buildDirectAddPayload(entity as unknown as Parameters<typeof buildDirectAddPayload>[0]);

/** The bag, built by the real builders (the PDP / card paths). */
const buildBag = () => {
  const salad = buildCartItemContent(direct(MENU.card(GREEK_SALAD)), "ITEM");
  const burger = buildCartItemContent(
    buildCustomizableCommitPayload({
      selectedEntity: { ...MENU.card(CHEESE_BURGER), quantity: 1 },
      mergedCustomizations: mergeCustomizations(
        { [PICKLES_GROUP]: [pick(PICKLES_GROUP, PICKLES)], [CHEESE_GROUP]: [pick(CHEESE_GROUP, ADD_CHEESE)] },
        {},
      ),
      quantity: 1,
      isMakeItAMealItem: false,
      makeItAMealSelectedItem: {},
    }),
    "CUSTOMIZABLE",
  );
  const soda = MENU.card(SODA);
  const size = buildCartItemContent(
    buildVariantCommitPayload({
      selectedEntity: { ...soda, quantity: 1 },
      selectedVariant: (soda.variants as Obj[])[1],
      mergedCustomizations: { [ICE_GROUP]: [pick(ICE_GROUP, ICE)] },
      quantity: 1,
      isMakeItAMealItem: false,
      makeItAMealSelectedItem: {},
    }),
    "VARIANT",
  );
  // The Dream box with a tier-2 pick (Large Fries, "Without Salt") — the PDP's own path.
  const tier2Fries = buildTier2NewEntity({
    variant: MENU.entityMap[LARGE_FRIES],
    entity: option(BOX(2), LARGE_FRIES),
    group: MENU.modifiersMap[BOX(2)],
  });
  const { customizations: boxPicks } = appendTier2SelectionToTier1({
    baseCustomizations: {
      [BOX(1)]: [pick(BOX(1), SANDWICH)],
      [BOX(2)]: [],
      [BOX(3)]: [pick(BOX(3), "5dd27b527973647b693e428b")],
      [BOX(5)]: [pick(BOX(5), "66e952596dd4d13b6564a528")],
      [BOX(6)]: [pick(BOX(6), "696df06f5a77225b771e978a")],
    },
    groupId: BOX(2),
    tier1Min: 1,
    tier1Max: 1,
    selectedEntity: tier2Fries,
    selectedCustomizations: { [FRIES_ADDONS]: [pick(FRIES_ADDONS, WITHOUT_SALT)] },
    uniqueId: "fries-1",
  });
  const pack = buildCartItemContent(
    buildCustomizableCommitPayload({
      selectedEntity: { ...MENU.card(DREAM_BOX), quantity: 1 },
      mergedCustomizations: mergeCustomizations(boxPicks, {}),
      quantity: 1,
      isMakeItAMealItem: false,
      makeItAMealSelectedItem: {},
    }),
    "CUSTOMIZABLE",
  );
  return { salad, burger, size, pack } as Record<"salad" | "burger" | "size" | "pack", Obj>;
};

const BAG = buildBag();
/** The scheduler hands the sweep structuredClone'd rows — so does every test. */
const cart = () => structuredClone(Object.values(BAG));

const DEPS: CheckoutStockSweepDeps = {
  getTotalValueWithApplyAddonPrice,
  isAllowMultiplePunch: () => false,
  fetchModifierProperties: (ids) =>
    resolveLegacyModifierGroups(MENU.modifiersMap, ids, structuredClone),
};

/** A Kiosk out-of-stock feed entry (the backend's shape: one partner object); `null` = no partner name. */
const oos = (item_id: string, type: string, partner_name: string | null = "Kiosk") => ({
  item_id,
  type,
  partners: partner_name === null ? { inStock: false } : { partner_name, inStock: false },
});

const sweepWith = (feed: unknown, rows: unknown[] = cart()) =>
  runCheckoutStockSweep(rows, () => Promise.resolve(feed), DEPS);

const rowOf = (sweep: CheckoutStockSweep | null, key: keyof typeof BAG) =>
  (sweep?.updatedCart as Obj[]).find((row) => row.itemId === BAG[key].itemId) as Obj;

/** The real bill engine (no round-off, no charges, no offer). */
const billOf = (cartItems: unknown[]) => {
  const bill = getCalculatedBill(
    { cartItems, charges: [], cartOffer: {} },
    {
      tabId: "t1",
      deploymentInfo: [{ name: "disable_roundoff", selected: true }],
      discountOnAddon: false,
      cartRdx: { cartOffer: {} },
      getAmountBasedItemValue: () => 0,
      getImageUrl: () => "",
    },
  );
  return [Number(bill.getSubtotal()), Number(bill.getTotalTax()), Number(bill.getNetAmount())];
};

describe("runCheckoutStockSweep (A1)", () => {
  it("in stock: nothing is flagged, no row moves its money, the bill is identical", async () => {
    const before = cart();
    const sweep = await sweepWith([]);

    expect(sweep).not.toBeNull();
    expect(sweep?.updatedBaseItems).toEqual([]);
    expect(sweep?.minMaxErroredBaseItems).toEqual([]);
    expect(sweep?.feedMap).toEqual({});
    const rows = sweep?.updatedCart as Obj[];
    expect(rows.map((row) => row.itemId)).toEqual(before.map((row) => row.itemId));
    expect(rows.map((row) => row.total_price)).toEqual(before.map((row) => row.total_price));
    expect(rows.map((row) => row.outOfStock)).toEqual([false, false, false, false]);
    expect((rowOf(sweep, "size").selectedVariant as Obj).outOfStock).toBe(false);
    // The money: 17 + 10 + 3.50 + 25 (+ the pack's priced snack) at 15 % VAT.
    expect(billOf(rows)).toEqual(billOf(before));
    expect(billOf(rows)[0]).toBeGreaterThan(0);
  });

  it("asks the feed for exactly getItemIdsFromCartItems' ids (base, size, picks, tier-2 picks)", async () => {
    const fetchFeed = vi.fn((ids: string[]) => Promise.resolve(ids.length ? [] : [{}]));
    await runCheckoutStockSweep(cart(), fetchFeed, DEPS);

    expect(fetchFeed).toHaveBeenCalledTimes(1);
    const ids = fetchFeed.mock.calls[0][0];
    expect(ids).toEqual(getItemIdsFromCartItems(cart()));
    expect(ids).toEqual(
      expect.arrayContaining([GREEK_SALAD, CHEESE_BURGER, PICKLES, ADD_CHEESE, SODA, SODA_L, ICE, DREAM_BOX, SANDWICH, LARGE_FRIES, WITHOUT_SALT]),
    );
  });

  it("the base item out of stock for Kiosk flags its row; another partner's or a partner-less entry is ignored", async () => {
    const flagged = await sweepWith([oos(CHEESE_BURGER, "item")]);
    expect(flagged?.updatedBaseItems).toEqual([BAG.burger.itemId]);
    expect(rowOf(flagged, "burger").outOfStock).toBe(true);
    expect(rowOf(flagged, "salad").outOfStock).toBe(false);
    expect(flagged?.feedMap).toEqual({
      [CHEESE_BURGER]: expect.objectContaining({ _id: CHEESE_BURGER, type: "item", inStock: false, partner_name: "Kiosk" }),
    });

    const ignored = await sweepWith([oos(CHEESE_BURGER, "item", "Zomato"), oos(GREEK_SALAD, "item", null)]);
    expect(ignored?.updatedBaseItems).toEqual([]);
    expect((ignored?.updatedCart as Obj[]).every((row) => row.outOfStock === false)).toBe(true);
  });

  it("the match is exact: a Kiosk entry still IN stock, or a 'kiosk' (lower-case) partner, flags nothing and moves no money", async () => {
    const before = cart();
    const sweep = await sweepWith([
      { item_id: CHEESE_BURGER, type: "item", partners: { partner_name: "Kiosk", inStock: true } },
      oos(PICKLES, "addon", "kiosk"),
      oos(SODA_L, "variant", "KIOSK"),
    ]);

    expect(sweep?.updatedBaseItems).toEqual([]);
    expect(sweep?.minMaxErroredBaseItems).toEqual([]);
    const rows = sweep?.updatedCart as Obj[];
    expect(rows.map((row) => row.outOfStock)).toEqual([false, false, false, false]);
    expect((rowOf(sweep, "burger").customizations as Record<string, Obj[]>)[PICKLES_GROUP]).toHaveLength(1);
    expect((rowOf(sweep, "size").selectedVariant as Obj).outOfStock).toBe(false);
    expect(rows.map((row) => row.total_price)).toEqual(before.map((row) => row.total_price));
  });

  it("a size out of stock flags selectedVariant (and the size in baseItem.variants), not the row itself", async () => {
    const sweep = await sweepWith([oos(SODA_L, "variant")]);
    const size = rowOf(sweep, "size");

    expect(sweep?.updatedBaseItems).toEqual([BAG.size.itemId]);
    expect((size.selectedVariant as Obj).outOfStock).toBe(true);
    expect(
      ((size.baseItem as Obj).variants as Obj[]).find((variant) => variant.id === SODA_L)?.outOfStock,
    ).toBe(true);
    expect(size.outOfStock).toBe(false);
  });

  it("an out-of-stock add-on is dropped from its row and total_price is recomputed (the row stays available)", async () => {
    const sweep = await sweepWith([oos(PICKLES, "addon")]);
    const burger = rowOf(sweep, "burger");
    const customizations = burger.customizations as Record<string, Obj[]>;

    expect(sweep?.updatedBaseItems).toEqual([BAG.burger.itemId]);
    expect(customizations[PICKLES_GROUP]).toEqual([]);
    expect(customizations[CHEESE_GROUP].map((item) => item.id)).toEqual([ADD_CHEESE]);
    expect(BAG.burger.total_price).toBe(10);
    expect(burger.total_price).toBe(9);
    expect(burger.outOfStock).toBe(false);
    expect(sweep?.minMaxErroredBaseItems).toEqual([]);
  });

  it("an out-of-stock pick that empties a required slot → minMaxErroredBaseItems (and updatedBaseItems)", async () => {
    const sweep = await sweepWith([oos(SANDWICH, "combo")]);

    expect(((rowOf(sweep, "pack").customizations as Record<string, Obj[]>)[BOX(1)])).toEqual([]);
    expect(sweep?.minMaxErroredBaseItems).toEqual([BAG.pack.itemId]);
    expect(sweep?.updatedBaseItems).toEqual([BAG.pack.itemId]);
  });

  it("an out-of-stock tier-2 pick is dropped inside its slot pick", async () => {
    const sweep = await sweepWith([oos(WITHOUT_SALT, "addon")]);
    const [fries] = (rowOf(sweep, "pack").customizations as Record<string, Obj[]>)[BOX(2)];

    expect(fries.id).toBe(LARGE_FRIES);
    expect((fries.customizations as Record<string, Obj[]>)[FRIES_ADDONS]).toEqual([]);
    expect(sweep?.updatedBaseItems).toEqual([BAG.pack.itemId]);
  });

  it("min / max runs on the SWEPT rows: a dropped tier-2 pick that empties a required tier-2 group is an error", async () => {
    // The fries' addon group made required (min 1) for this case.
    const required: CheckoutStockSweepDeps = {
      ...DEPS,
      fetchModifierProperties: (ids) =>
        DEPS.fetchModifierProperties(ids).map((group: Group | undefined) =>
          group?._id === FRIES_ADDONS ? { ...group, min: 1 } : group,
        ),
    };
    const inStock = await runCheckoutStockSweep(cart(), () => Promise.resolve([]), required);
    expect(inStock?.minMaxErroredBaseItems).toEqual([]);

    // The engine drops the tier-2 pick WITHOUT flagging it on its input, so
    // only the swept rows show the empty group.
    const dropped = await runCheckoutStockSweep(
      cart(),
      () => Promise.resolve([oos(WITHOUT_SALT, "addon")]),
      required,
    );
    expect(dropped?.minMaxErroredBaseItems).toEqual([BAG.pack.itemId]);
  });

  it("fails OPEN (null): a non-array feed, a failed fetch, a row the engine cannot read", async () => {
    expect(await sweepWith({})).toBeNull();
    expect(await sweepWith(null)).toBeNull();
    // The engine alone reads a missing feed as "everything out of stock"
    // (`undefined?.findIndex(…) !== -1`): a plain bag must still fail OPEN.
    const plain = [structuredClone(BAG.salad)];
    expect(await sweepWith(null, plain)).toBeNull();
    expect(await sweepWith(undefined, plain)).toBeNull();
    expect(await sweepWith("error", plain)).toBeNull();
    expect(await runCheckoutStockSweep(cart(), () => Promise.reject(new Error("504")), DEPS)).toBeNull();

    // A hand-built size-only row (no baseItem / customizations) throws in
    // getItemIdsFromCartItems — before any request.
    const fetchFeed = vi.fn(() => Promise.resolve([]));
    const handBuilt = { id: SODA, itemId: "hb-1", type: "VARIANT", quantity: 1, selectedVariant: { id: SODA_S }, variantPrice: 2 };
    expect(await runCheckoutStockSweep([handBuilt], fetchFeed, DEPS)).toBeNull();
    expect(fetchFeed).not.toHaveBeenCalled();

    // A throwing min / max dependency.
    const broken = { ...DEPS, fetchModifierProperties: () => { throw new Error("no menu"); } };
    expect(await runCheckoutStockSweep(cart(), () => Promise.resolve([]), broken)).toBeNull();
  });

  it("the engine writes onto its input: frozen (redux) rows with an out-of-stock pick fail open — PAY feeds it the scheduler's clones", async () => {
    const deepFreeze = <T,>(value: T): T => {
      if (value && typeof value === "object") {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };

    expect(await sweepWith([oos(PICKLES, "addon")], deepFreeze(cart()))).toBeNull();
    expect(await sweepWith([oos(PICKLES, "addon")], cart())).not.toBeNull();
  });
});

describe("sameCartRows (the write-back's compare-and-set)", () => {
  const A = { itemId: "a", quantity: 1, total_price: 9 };
  const B = { itemId: "b", quantity: 2 };

  it("same rows, same order, same quantities → true (other fields ignored)", () => {
    expect(sameCartRows([A, B], [{ ...A, total_price: 1, outOfStock: true }, { ...B }])).toBe(true);
    expect(sameCartRows([], [])).toBe(true);
  });

  it("a quantity, an id, the length or the order differs → false; non-arrays never match", () => {
    expect(sameCartRows([A, B], [A, { ...B, quantity: 3 }])).toBe(false);
    expect(sameCartRows([A, B], [A, { ...B, itemId: "c" }])).toBe(false);
    expect(sameCartRows([A, B], [A])).toBe(false);
    // …and the other way round — BagSheet passes (live, checked): a row the
    // guest REMOVED mid-check must not match, or the swept rows bring it back.
    expect(sameCartRows([A], [A, B])).toBe(false);
    expect(sameCartRows([A, B], [B, A])).toBe(false);
    expect(sameCartRows(undefined, undefined)).toBe(false);
    expect(sameCartRows([A], null)).toBe(false);
  });
});

/*
  The sweep and its 838-line engine ride in the ONE lazy UI chunk: a static
  value import anywhere but bagLazyParts would put them on the boot path
  (type-only imports are erased).
*/
describe("the stock sweep stays in the lazy UI chunk", () => {
  const SRC = join(ROOT, "src");
  const app = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/(^|\/)__tests__\/|\.test\.tsx?$/.test(file))
    .map((file) => ({ file, source: readFileSync(join(SRC, file), "utf8") }));
  const staticImporters = (spec: string) => {
    const statement = new RegExp(
      `(?:^|\\n)\\s*(import|export)\\b([^;]*?)\\bfrom\\s*["']${spec}["']`,
      "g",
    );
    return app
      .filter(({ source }) =>
        [...source.matchAll(statement)].some(([, , clause]) => !/^\s*type\b/.test(clause ?? "")),
      )
      .map(({ file }) => file);
  };

  it("only bagLazyParts imports @cx-sdk/catalog/oos/checkoutStockSweep; nothing imports the engine", () => {
    expect(app.length).toBeGreaterThan(100);
    expect(staticImporters("@cx-sdk/catalog/oos/checkoutStockSweep")).toEqual([
      "components/cart/bagLazyParts.ts",
    ]);
    expect(staticImporters("@cx-sdk/catalog/oos/outOfStockEngine")).toEqual([]);
    expect(staticImporters("@cx-sdk/catalog")).toEqual([]);
  });
});
