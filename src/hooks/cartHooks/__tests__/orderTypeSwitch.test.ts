import { createElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  buildLegacyMenuWithChecks,
  buildLegacyModifierMap,
  collectLegacyEntityMaps,
  convertLegacyMenuTree,
} from "@cx-sdk/catalog/menu/legacyMenuConverters";
import {
  resetCategorySelection,
  setEntityMap,
  setModifiersMap,
} from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrentSession, setDpItemsMap } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import { setSelectedPipeline, setTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { setSelectedTabId } from "@cx-sdk/core/auth/authentication.slice";
import { buildDirectAddPayload } from "@cx-sdk/ordering/cart/addIntent";
import { buildCartItemContent } from "@cx-sdk/ordering/cart/cartEngine";
import {
  buildOrderTypeSelectionActions,
  type MenuPriceIndex,
  planOrderTypeSwitchCommit,
  repriceCartForMenu,
  shouldDropOfferOnOrderTypeSwitch,
} from "@cx-sdk/ordering/cart/orderTypeSwitch";
import {
  orderTypeKindOf,
  resolveOrderTypeSwitchTarget,
  type SwitchablePipeline,
} from "@cx-sdk/ordering/cart/orderTypeTarget";
import {
  buildCustomizableCommitPayload,
  buildVariantCommitPayload,
  mergeCustomizations,
} from "@cx-sdk/ordering/customization/commitPayload";
import { buildTier2NewEntity } from "@cx-sdk/ordering/customization/nestedCardLogic";
import { appendTier2SelectionToTier1 } from "@cx-sdk/ordering/customization/tier2Logic";
import { getCalculatedBill } from "@cx-sdk/ordering/order/orderBuilder";
import {
  pushCharges,
  setCartItems,
  setMenuCharges,
} from "@cx-sdk/ordering/state/cart.slice";
import {
  setFilteredOffers,
  setOffersFetchFailed,
  setOffersFetchLoading,
} from "@cx-sdk/ordering/state/offer.slice";
import { store } from "../../../redux/app/store";
import {
  setLanguages,
  setSelectedLanguage,
} from "../../../redux/features/multiLanguage/multiLanguage.slice";
import { IdleHoldContext } from "../../utils/useIdleTimeout";
import useOrderTypeSwitch from "../useOrderTypeSwitch";

/* The executor's seams: the two staged fetchers and the post-commit hooks. */
const net = vi.hoisted(() => ({
  charges: vi.fn(),
  menu: vi.fn(),
  dropOffer: vi.fn(),
  replaceDexie: vi.fn(() => Promise.resolve()),
  capture: vi.fn(),
}));
vi.mock("../../utils/useAppSettings", () => ({
  default: () => ({ getChargesCountryDataApi: net.charges }),
}));
vi.mock("../../menuHooks/useMenuConverters", () => ({
  default: () => ({ fetchMenu: net.menu }),
}));
vi.mock("../../offerHooks/useOfferApply", () => ({
  default: () => ({ handleCartDrivenRemoval: net.dropOffer }),
}));
vi.mock("../useCartIndexedDb", () => ({
  default: () => ({ replaceIndexedDbCart: net.replaceDexie }),
}));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: net.capture,
}));

/*
  Item 19 money check (lane bag-pdp, D1). Every bag row here is built by the
  REAL commit builders from a menu converted exactly like useMenuConverters
  converts it; re-pricing against THAT menu must be the identity — same row
  objects, changed:false, the same bill — and one change per row type must
  move exactly that row's money.
*/

type Obj = Record<string, unknown>;
type Group = { _id: string; constituentItems: Obj[] } & Obj;
type RawMenu = { categories: { subCategories: { id: string; entities: Obj[] }[] }[]; modifiers: Group[] };

const SLIM = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../tests/e2e/fixtures/slim-menu.json"), "utf8"),
) as RawMenu;

const GREEK_SALAD = "5dd1093829754a432f2c32e2";
const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
const LARGE_FRIES = "5dd10938eb1ccee31ca352fa";
const TORTILLA_SAUCE = "5dd109392b29ee1f2a82a49b";
const DREAM_BOX = "68dd79409030ed3064aee28c";
const PICKLES_GROUP = `${CHEESE_BURGER}_1573980469_addons`;
const PICKLES = "5dd1093f188e72ce1b3eb36e";
const CHEESE_GROUP = `${CHEESE_BURGER}_1686482941_addons`;
const ADD_CHEESE = "5dd1093f188e72ce1b3eb36f";
const FRIES_ADDONS = `${LARGE_FRIES}_1573980470_addons`;
const WITHOUT_SALT = "5dff2ea756bc05b83f9e34cd";
const BOX = (slot: number) => `${DREAM_BOX}_${slot}_combo`;
const SODA = "syn-soda";
const SODA_S = "syn-soda-s";
const SODA_L = "syn-soda-l";
const ICE_GROUP = `${SODA_L}_1_addons`;
const ICE = "syn-ice";

/** slim-menu + a synthetic size item (slim-menu has none): raw base price 99, sizes 2 / 3. */
const rawMenu = (edit: (menu: RawMenu) => void = () => {}): RawMenu => {
  const menu = structuredClone(SLIM);
  const side = menu.categories[0].subCategories[0];
  const salad = side.entities.find((entity) => entity.id === GREEK_SALAD) as Obj;
  const taxes = salad.taxes;
  const size = (id: string, name: string, price: number, modifiers: string[]) => ({
    id, name, price, modifiers, taxes, isActive: true, subCategoryId: side.id, variants: [], upsellItems: [],
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
  // MIAM upsells resolve to variant ids — every reference-menu upsell does.
  salad.upsellItems = [SODA_L, SODA_S];
  menu.modifiers.push({
    _id: ICE_GROUP, name: "Ice", isActive: true, type: "addons", min: 0, max: 1, order: 1,
    constituentItems: [{ id: ICE, name: "Extra ice", price: 0.5, taxes, isActive: true }],
  });
  edit(menu);
  return menu;
};

/** useMenuConverters.fetchMenu's conversion: the TREE (what cards / the PDP hand the builders) and the index the switch re-prices from. */
const convert = (menu: RawMenu, outOfStock: Obj[] = [], dpItemsMap: Obj = {}) => {
  const categoryMap = new Map();
  const menuWithChecks = buildLegacyMenuWithChecks({
    menu,
    outOfStock,
    showNoImageItem: true,
    dpItemsMapToUse: dpItemsMap,
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
    outOfStockItems: outOfStock,
    availableItems: [],
    availableItemsMap: new Set(),
    deepCopyMediaItemsMapRdx: {},
    newParsedMediaItems: [],
    mediaItemMapLocal: {},
    entityMap,
    dpItemsMap,
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
  const index: MenuPriceIndex = {
    entityMap: Object.fromEntries(entityMap),
    modifiersMap: buildLegacyModifierMap(tree.modifiers),
  };
  const card = (id: string) =>
    structuredClone(
      tree.categories
        .flatMap((category) => category.subCategories.flatMap((sub) => sub.entities))
        .find((entity) => entity.id === id) as Obj,
    );
  return { index, card };
};

/** buildDirectAddPayload takes the typed recommendation entity; menu cards are plain objects. */
const direct = (entity: Obj) =>
  buildDirectAddPayload(entity as unknown as Parameters<typeof buildDirectAddPayload>[0]);

const option = (index: MenuPriceIndex, groupId: string, id: string) =>
  structuredClone(
    ((index.modifiersMap as Record<string, Group>)[groupId].constituentItems.find(
      (item) => item.id === id,
    ) as Obj),
  );

/** The bag, built by the real builders against `menu`. */
const buildBag = ({ index, card }: ReturnType<typeof convert>) => {
  const pick = (groupId: string, id: string) => ({ ...option(index, groupId, id), quantity: 1 });
  const salad = card(GREEK_SALAD);
  const soda = card(SODA);
  const [mealLarge, plainSmall] = salad.upsellItems as Obj[];

  const item = buildCartItemContent(direct(salad), "ITEM");
  const burger = buildCartItemContent(
    buildCustomizableCommitPayload({
      selectedEntity: { ...card(CHEESE_BURGER), quantity: 1 },
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
  // MIAM meal: the upsell is a variantItem pseudo-entity (id = the size's id).
  const meal = buildCartItemContent(
    buildCustomizableCommitPayload({
      selectedEntity: { ...mealLarge, quantity: 1, subCategoryId: mealLarge.subCategoryId, hasSecondTier: false },
      mergedCustomizations: mergeCustomizations({ [ICE_GROUP]: [pick(ICE_GROUP, ICE)] }, {}),
      quantity: 1,
      isMakeItAMealItem: true,
      makeItAMealSelectedItem: salad,
    }),
    "CUSTOMIZABLE",
  );
  const mealPlain = buildCartItemContent(direct(plainSmall), "ITEM");
  // Pack with a tier-2 pick (Large Fries, "Without Salt") — the PDP's own path.
  const tier2Fries = buildTier2NewEntity({
    variant: (index.entityMap as Record<string, Obj>)[LARGE_FRIES],
    entity: option(index, BOX(2), LARGE_FRIES),
    group: (index.modifiersMap as Record<string, Group>)[BOX(2)],
  });
  const { customizations: boxPicks } = appendTier2SelectionToTier1({
    baseCustomizations: {
      [BOX(1)]: [pick(BOX(1), "65d4a2d2003967427ed83616")],
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
      selectedEntity: { ...card(DREAM_BOX), quantity: 1 },
      mergedCustomizations: mergeCustomizations(boxPicks, {}),
      quantity: 1,
      isMakeItAMealItem: false,
      makeItAMealSelectedItem: {},
    }),
    "CUSTOMIZABLE",
  );
  const loyalty = buildCartItemContent(
    { ...direct(card(LARGE_FRIES)), isLoyaltyItem: true, undiscounted_price: 9, discount_type: "percentage", discount_value: 100 },
    "ITEM",
  );
  const freebie = buildCartItemContent(
    { ...direct(card(TORTILLA_SAUCE)), isGetItem: true, discountType: "percent", discountValue: 100 },
    "ITEM",
  );
  return { item, burger, size, meal, mealPlain, pack, loyalty, freebie };
};

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
  return {
    subtotal: Number(bill.getSubtotal()),
    tax: Number(bill.getTotalTax()),
    net: Number(bill.getNetAmount()),
    json: JSON.stringify(bill),
  };
};

const SAME = convert(rawMenu());
const BAG = buildBag(SAME);
const ROWS: Obj[] = Object.values(BAG);

describe("repriceCartForMenu — the switch's money (item 19)", () => {
  it("a no-op switch is the IDENTITY: the same row objects, changed:false, the same bill", () => {
    const before = billOf(ROWS);
    expect(before.subtotal).toBeGreaterThan(0);

    const plan = repriceCartForMenu(ROWS, convert(rawMenu()).index);

    expect(plan).toMatchObject({ changed: false, repriced: 0, removed: [], removedLoyalty: [] });
    expect(plan.rows).toHaveLength(ROWS.length);
    plan.rows.forEach((row, at) => expect(row).toBe(ROWS[at]));
    expect(billOf(plan.rows)).toEqual(before);
  });

  it("one price change per row type moves exactly that row's money", () => {
    const changed = convert(
      rawMenu((menu) => {
        const side = menu.categories[0].subCategories[0].entities;
        (side.find((entity) => entity.id === GREEK_SALAD) as Obj).price = 19;
        const sizes = (side.find((entity) => entity.id === SODA) as Obj).variants as Obj[];
        sizes[0].price = 2.5;
        sizes[1].price = 4;
        const groups = new Map(menu.modifiers.map((group) => [group._id, group]));
        (groups.get(PICKLES_GROUP)?.constituentItems.find((item) => item.id === PICKLES) as Obj).price = 1.5;
        (groups.get(FRIES_ADDONS)?.constituentItems[0] as Obj).price = 0.25;
      }),
    );

    const plan = repriceCartForMenu(ROWS, changed.index);
    const [item, burger, size, meal, mealPlain, pack, loyalty, freebie] = plan.rows as Obj[];

    expect(plan).toMatchObject({ changed: true, repriced: 6, removed: [] });
    expect(item).toMatchObject({ price: 19, total_price: 19 }); // ITEM
    expect(burger.total_price).toBe(1.5 + 1 + 8); // CUSTOMIZABLE: addon
    expect((burger.customizations as Record<string, Obj[]>)[PICKLES_GROUP][0].price).toBe(1.5);
    // VARIANT: the size's price; `price` (the tree's cheapest size) never feeds a VARIANT line.
    expect(size).toMatchObject({ variantPrice: 4, total_price: 0.5 + 4, price: 2 });
    expect((size.selectedVariant as Obj).price).toBe(4);
    expect(meal).toMatchObject({ price: 4, total_price: 0.5 + 4, applyAddonsPrice: false }); // MIAM (variant id)
    expect(mealPlain).toMatchObject({ price: 2.5, total_price: 2.5 }); // MIAM plain (variant id)
    expect(pack.total_price).toBe(25 + 5 + 0.25); // pack: nested tier-2 pick
    expect(loyalty).toBe(BAG.loyalty);
    expect(freebie).toBe(BAG.freebie);
    expect(billOf(plan.rows).subtotal - billOf(ROWS).subtotal).toBeCloseTo(2 + 0.5 + 1 + 1 + 0.5 + 0.25);
  });

  it("removes each unavailable row with its reason; loyalty rows are listed, freebies untouched", () => {
    const gone = convert(
      rawMenu((menu) => {
        const side = menu.categories[0].subCategories[0];
        side.entities = side.entities.filter(
          (entity) => entity.id !== GREEK_SALAD && entity.id !== LARGE_FRIES,
        );
        const fries = menu.modifiers.find((group) => group._id === FRIES_ADDONS) as Group;
        fries.constituentItems = [];
      }),
      [
        { item_id: CHEESE_BURGER, type: "item", partners: { inStock: false } },
        { item_id: SODA_L, type: "variant", partners: { inStock: false } },
      ],
    );

    const plan = repriceCartForMenu(ROWS, gone.index);

    expect(plan.removed).toEqual([
      { row: BAG.item, reason: "missingItem" },
      { row: BAG.burger, reason: "unavailable" },
      { row: BAG.size, reason: "missingVariant" },
      { row: BAG.meal, reason: "unavailable" },
      { row: BAG.pack, reason: "missingCustomization" },
    ]);
    expect(plan.rows).toEqual([BAG.mealPlain, BAG.loyalty, BAG.freebie]);
    expect(plan.removedLoyalty).toEqual([BAG.loyalty]);
    expect(plan.changed).toBe(true);
  });

  it("D1: a reward the new tab cannot serve is reversed like its paid twin — item or size out of stock there, or a pick gone", () => {
    const paidFries = buildCartItemContent(direct(SAME.card(LARGE_FRIES)), "ITEM");
    const sizeReward = { ...BAG.size, isLoyaltyItem: true };
    const burgerReward = { ...BAG.burger, isLoyaltyItem: true };
    const bag = [paidFries, BAG.loyalty, sizeReward, burgerReward, BAG.item];
    // Out of stock is fetched per tab_id: EAT IN serves all of it, TAKE OUT does not.
    const takeOut = convert(
      rawMenu((menu) => {
        const pickles = menu.modifiers.find((group) => group._id === PICKLES_GROUP) as Group;
        pickles.constituentItems = pickles.constituentItems.filter((item) => item.id !== PICKLES);
      }),
      [
        { item_id: LARGE_FRIES, type: "item", partners: { inStock: false } },
        { item_id: SODA_L, type: "variant", partners: { inStock: false } },
      ],
    );

    const plan = repriceCartForMenu(bag, takeOut.index);

    expect(plan.removed).toEqual([{ row: paidFries, reason: "unavailable" }]);
    expect(plan.removedLoyalty).toEqual([BAG.loyalty, sizeReward, burgerReward]);
    expect(plan.rows).toEqual([BAG.loyalty, sizeReward, burgerReward, BAG.item]);
    // Servable rewards stay untouched (never re-priced).
    expect(repriceCartForMenu(bag, SAME.index)).toMatchObject({ removedLoyalty: [], changed: false });
  });

  it("repairs a fast-lane VARIANT row committed without variantPrice", () => {
    const soda = SAME.card(SODA);
    const fastLane = buildCartItemContent(
      { ...soda, selectedVariant: (soda.variants as Obj[])[0], total_price: 2, quantity: 1 },
      "VARIANT",
    );
    const plan = repriceCartForMenu([fastLane], SAME.index);
    expect(plan.repriced).toBe(1);
    expect(plan.rows[0]).toMatchObject({ variantPrice: 2, total_price: 2 });
    expect(Number.isNaN(billOf(plan.rows).subtotal)).toBe(false);
  });

  it("is total on null inputs", () => {
    expect(repriceCartForMenu(null, null)).toEqual({
      rows: [], removed: [], removedLoyalty: [], repriced: 0, changed: false,
    });
    expect(repriceCartForMenu([BAG.item], { entityMap: undefined, modifiersMap: null }).removed).toEqual([
      { row: BAG.item, reason: "missingItem" },
    ]);
  });

  /* ---- test-author additions (lane bag-pdp, item 19) ---- */

  const entities = () => SAME.index.entityMap as Record<string, Obj>;
  const groups = () => SAME.index.modifiersMap as Record<string, Group>;
  const FLAGS: Obj[] = [{ outOfStock: true }, { isActive: false }, { isAvailable: false }];

  it("'unavailable' is any of out of stock / isActive false / isAvailable false on the item", () => {
    for (const flag of FLAGS) {
      const menu: MenuPriceIndex = {
        entityMap: { ...entities(), [GREEK_SALAD]: { ...entities()[GREEK_SALAD], ...flag } },
        modifiersMap: groups(),
      };
      const plan = repriceCartForMenu([BAG.item, BAG.burger], menu);
      expect(plan.removed, JSON.stringify(flag)).toEqual([{ row: BAG.item, reason: "unavailable" }]);
      expect(plan.rows).toEqual([BAG.burger]);
      expect(plan.rows[0]).toBe(BAG.burger);
      expect(plan.changed).toBe(true);
    }
  });

  it("a flagged size is 'missingVariant'; a flagged pick or an inactive group is 'missingCustomization'", () => {
    const soda = entities()[SODA];
    for (const flag of FLAGS) {
      const variants = (soda.variants as Obj[]).map((v) => (v.id === SODA_L ? { ...v, ...flag } : v));
      const plan = repriceCartForMenu([BAG.size], {
        entityMap: { ...entities(), [SODA]: { ...soda, variants } },
        modifiersMap: groups(),
      });
      expect(plan.removed, JSON.stringify(flag)).toEqual([{ row: BAG.size, reason: "missingVariant" }]);
    }
    const pickles = groups()[PICKLES_GROUP];
    for (const flag of FLAGS) {
      const group = {
        ...pickles,
        constituentItems: pickles.constituentItems.map((ci) => (ci.id === PICKLES ? { ...ci, ...flag } : ci)),
      };
      const plan = repriceCartForMenu([BAG.burger], {
        entityMap: entities(),
        modifiersMap: { ...groups(), [PICKLES_GROUP]: group },
      });
      expect(plan.removed, JSON.stringify(flag)).toEqual([{ row: BAG.burger, reason: "missingCustomization" }]);
    }
    const inactive = repriceCartForMenu([BAG.burger, BAG.pack], {
      entityMap: entities(),
      modifiersMap: { ...groups(), [CHEESE_GROUP]: { ...groups()[CHEESE_GROUP], isActive: false } },
    });
    expect(inactive.removed).toEqual([{ row: BAG.burger, reason: "missingCustomization" }]);
    // A nested (tier-2) pick that left the menu takes the pack row with it.
    const fries = groups()[FRIES_ADDONS];
    const nested = repriceCartForMenu([BAG.pack], {
      entityMap: entities(),
      modifiersMap: { ...groups(), [FRIES_ADDONS]: { ...fries, constituentItems: [] } },
    });
    expect(nested.removed).toEqual([{ row: BAG.pack, reason: "missingCustomization" }]);
  });

  it("a size row whose variant id is gone from its base item is 'missingVariant'", () => {
    const soda = entities()[SODA];
    const plan = repriceCartForMenu([BAG.size], {
      entityMap: { ...entities(), [SODA]: { ...soda, variants: (soda.variants as Obj[]).filter((v) => v.id !== SODA_L) } },
      modifiersMap: groups(),
    });
    expect(plan.removed).toEqual([{ row: BAG.size, reason: "missingVariant" }]);
  });

  it("is total on undefined inputs and non-object rows (passed through untouched)", () => {
    expect(repriceCartForMenu(undefined, undefined)).toEqual({
      rows: [], removed: [], removedLoyalty: [], repriced: 0, changed: false,
    });
    const junk = [null, "row", 7];
    const plan = repriceCartForMenu([...junk, BAG.item], SAME.index);
    expect(plan.rows).toEqual([...junk, BAG.item]);
    expect(plan.rows[3]).toBe(BAG.item);
    expect(plan.changed).toBe(false);
  });

  it("re-pricing never mutates the bag it reads (the live cart rows stay as committed)", () => {
    const before = JSON.stringify(ROWS);
    const changed = convert(
      rawMenu((menu) => {
        (menu.categories[0].subCategories[0].entities.find((e) => e.id === GREEK_SALAD) as Obj).price = 19;
      }),
    );
    repriceCartForMenu(ROWS, changed.index);
    expect(JSON.stringify(ROWS)).toBe(before);
  });

  /* ---- mutation-verifier additions (lane bag-pdp, item 19) ---- */

  const vat20 = (taxes: unknown) =>
    (taxes as Obj[]).map((tax) => ({ ...tax, name: "VAT@ 20%", value: 20 }));
  const taxValues = (taxes: unknown) => (taxes as Obj[]).map((tax) => tax.value);

  it("re-reads TAXES from the target tab — a paid row's own and a leaf pick's: the bill's tax moves, its prices do not", () => {
    const rows = [BAG.item, BAG.burger];
    const taxed = convert(
      rawMenu((menu) => {
        const salad = menu.categories[0].subCategories[0].entities.find((e) => e.id === GREEK_SALAD) as Obj;
        salad.taxes = vat20(salad.taxes);
        const pickles = menu.modifiers
          .find((group) => group._id === PICKLES_GROUP)
          ?.constituentItems.find((item) => item.id === PICKLES) as Obj;
        pickles.taxes = vat20(pickles.taxes);
      }),
    );

    const plan = repriceCartForMenu(rows, taxed.index);
    const [item, burger] = plan.rows as Obj[];

    expect(plan).toMatchObject({ changed: true, repriced: 2, removed: [] });
    expect(taxValues(item.taxes)).toEqual([20]);
    expect(item).toMatchObject({ price: BAG.item.price, total_price: BAG.item.total_price });
    const pick = (burger.customizations as Record<string, Obj[]>)[PICKLES_GROUP][0];
    expect(taxValues(pick.taxes)).toEqual([20]);
    expect(burger.taxes).toEqual(BAG.burger.taxes);
    expect(burger.total_price).toBe(BAG.burger.total_price);
    const before = billOf(rows);
    const after = billOf(plan.rows);
    expect(after.subtotal).toBeCloseTo(before.subtotal, 2);
    expect(after.tax).toBeGreaterThan(before.tax);
  });

  it("re-prices a tier-2 (nested) pick from its slot option: the pack's money follows the new menu", () => {
    const upcharged = convert(
      rawMenu((menu) => {
        const slot = menu.modifiers.find((group) => group._id === BOX(2)) as Group;
        (slot.constituentItems.find((item) => item.id === LARGE_FRIES) as Obj).price = 1.5;
      }),
    );

    const plan = repriceCartForMenu([BAG.pack], upcharged.index);
    const [pack] = plan.rows as Obj[];

    expect(plan).toMatchObject({ changed: true, repriced: 1, removed: [] });
    const fries = (pack.customizations as Record<string, Obj[]>)[BOX(2)][0];
    expect(fries).toMatchObject({ id: LARGE_FRIES, price: 1.5 });
    expect((fries.customizations as Record<string, Obj[]>)[FRIES_ADDONS].map((p) => p.id)).toEqual([WITHOUT_SALT]);
    expect(pack.total_price).toBeCloseTo(Number(BAG.pack.total_price) + 1.5, 2);
    expect(billOf(plan.rows).subtotal - billOf([BAG.pack]).subtotal).toBeCloseTo(1.5, 2);
  });

  it("dynamic pricing: a size the target prices under DP carries the stamps; a row whose DP price ended loses them", () => {
    // TAKE OUT runs a DP session on the Large soda (3 → 3.5).
    const takeOutDp = convert(rawMenu(), [], { [SODA_L]: { modifiedRate: 3.5, status: "active" } });
    const [size] = repriceCartForMenu([BAG.size], takeOutDp.index).rows as Obj[];
    expect(size).toMatchObject({ variantPrice: 3.5, total_price: 0.5 + 3.5 });
    expect(size.selectedVariant).toMatchObject({ id: SODA_L, price: 3.5, isDpItem: true, originalPrice: 3 });

    // Rows committed under EAT IN's DP session go back to the regular menu.
    const eatInDp = convert(rawMenu(), [], {
      [GREEK_SALAD]: { modifiedRate: 12, status: "active" },
      [SODA_L]: { modifiedRate: 3.5, status: "active" },
    });
    const dpSalad = buildCartItemContent(direct(eatInDp.card(GREEK_SALAD)), "ITEM") as Obj;
    expect(dpSalad).toMatchObject({ isDpItem: true, price: 12 }); // precondition
    const [salad, soda] = repriceCartForMenu([dpSalad, size], SAME.index).rows as Obj[];
    expect(salad).toMatchObject({ price: BAG.item.price, total_price: BAG.item.total_price });
    expect(salad.isDpItem).toBeUndefined();
    expect(salad.originalPrice).toBeUndefined();
    expect(soda).toMatchObject({ variantPrice: 3, total_price: 0.5 + 3 });
    expect((soda.selectedVariant as Obj).price).toBe(3);
    expect((soda.selectedVariant as Obj).isDpItem).toBeUndefined();
    expect((soda.selectedVariant as Obj).originalPrice).toBeUndefined();
  });
});

describe("the switch's other decisions", () => {
  const offer = { _id: "offer-flat-2", name: "£2 off" };

  it("D1a: drops an applied offer with committed freebie rows, or one the new pipeline does not offer", () => {
    const drop = (cartOffer: unknown, cartItems: unknown[], offeredOfferIds: unknown[]) =>
      shouldDropOfferOnOrderTypeSwitch({ cartOffer, cartItems, offeredOfferIds });
    expect(drop({}, [BAG.freebie], [])).toBe(false);
    expect(drop(null, [], [])).toBe(false);
    expect(drop(offer, [BAG.item], ["offer-flat-2"])).toBe(false);
    expect(drop(offer, [BAG.item, BAG.freebie], ["offer-flat-2"])).toBe(true);
    expect(drop(offer, [BAG.item], ["other"])).toBe(true);
  });

  it("replays /second's four selection actions", () => {
    const pipeline = { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take out" };
    expect(buildOrderTypeSelectionActions(pipeline, { primaryCode: "en", secondaryCode: "ar" })).toEqual([
      setSelectedPipeline({ ...pipeline, primaryCode: "en", secondaryCode: "ar" }),
      setSelectedTabId("t2"),
      setTabType("take_away"),
      resetCategorySelection(),
    ]);
  });

  it("classifies tab types and resolves the target in list order", () => {
    expect(["dine_in", "take_away", "takeaway", "TAKE OUT", "table", "", undefined].map(orderTypeKindOf)).toEqual([
      "eatIn", "takeOut", "takeOut", "takeOut", "eatIn", "eatIn", "eatIn",
    ]);
    const pipelines: SwitchablePipeline[] = [
      { _id: "p1", tab_id: "t1", tab_type: "dine_in" },
      { _id: "p2", tab_id: "t2", tab_type: "take_away" },
      { _id: "p3", tab_id: "t3", tab_type: "take_away" },
      { _id: "p4", tab_type: "take_away" },
      { _id: "p5", tab_id: "t5", tab_type: "takeaway" },
      { _id: "p6", tab_id: "t6", tab_type: "take_away" },
    ];
    const resolve = (over: Partial<Parameters<typeof resolveOrderTypeSwitchTarget>[0]>) =>
      resolveOrderTypeSwitchTarget({
        pipelines,
        currentPipelineId: "p1",
        targetKind: "takeOut",
        deactivatedPipelineIds: ["p2"],
        isPipelineOpen: (id) => id !== "p3",
        ...over,
      })?._id ?? null;
    expect(resolve({})).toBe("p5");
    expect(resolve({ targetKind: "eatIn" })).toBe(null);
    expect(resolve({ targetKind: "eatIn", currentPipelineId: "p5" })).toBe("p1");
    expect(resolve({ pipelines: null })).toBe(null);
    expect(resolve({ isPipelineOpen: () => false })).toBe(null);
  });

  /* ---- test-author additions (lane bag-pdp, item 19) ---- */

  it("orderTypeKindOf: null / non-string tab types are eat in", () => {
    expect([null, 0, {}, "TABLE", "Dine In"].map(orderTypeKindOf)).toEqual([
      "eatIn", "eatIn", "eatIn", "eatIn", "eatIn",
    ]);
  });

  it("the target resolver skips the CURRENT pipeline even of the target kind, and is null-safe on every input", () => {
    type Input = Parameters<typeof resolveOrderTypeSwitchTarget>[0];
    const takeOut: SwitchablePipeline = { _id: "p2", tab_id: "t2", tab_type: "take_away" };
    const base: Input = {
      pipelines: [takeOut],
      currentPipelineId: undefined,
      targetKind: "takeOut",
      deactivatedPipelineIds: [],
      isPipelineOpen: () => true,
    };
    const id = (over: Partial<Input>) => resolveOrderTypeSwitchTarget({ ...base, ...over })?._id ?? null;
    expect(id({})).toBe("p2");
    expect(id({ currentPipelineId: "p2" })).toBe(null);
    expect(id({ pipelines: undefined })).toBe(null);
    expect(id({ pipelines: [] })).toBe(null);
    // Junk rows (no row, no _id) are skipped, never thrown on.
    expect(
      id({ pipelines: [null as unknown as SwitchablePipeline, { tab_id: "t9", tab_type: "take_away" } as SwitchablePipeline, takeOut] }),
    ).toBe("p2");
    expect(id({ deactivatedPipelineIds: null as unknown as string[] })).toBe("p2");
    // Only an explicit false is closed: no callback / no answer = open.
    expect(id({ isPipelineOpen: undefined as unknown as Input["isPipelineOpen"] })).toBe("p2");
    expect(id({ isPipelineOpen: () => undefined as unknown as boolean })).toBe("p2");
    expect(resolveOrderTypeSwitchTarget(undefined as unknown as Input)).toBe(null);
  });

  it("D1a is null-safe: a missing offer list means 'not offered'; no offer never drops", () => {
    expect(
      shouldDropOfferOnOrderTypeSwitch({ cartOffer: offer, cartItems: null, offeredOfferIds: undefined }),
    ).toBe(true);
    expect(
      shouldDropOfferOnOrderTypeSwitch({ cartOffer: undefined, cartItems: [BAG.freebie], offeredOfferIds: null }),
    ).toBe(false);
    expect(
      shouldDropOfferOnOrderTypeSwitch(undefined as unknown as Parameters<typeof shouldDropOfferOnOrderTypeSwitch>[0]),
    ).toBe(false);
  });

  it("planOrderTypeSwitchCommit composes the parts: /second's actions, the re-price, D1a and the DP cap", () => {
    const pipeline = { _id: "p2", tab_id: "t2", tab_type: "take_away" };
    const languages = { primaryCode: "en", secondaryCode: "ar" };
    const plan = planOrderTypeSwitchCommit({
      pipeline,
      languages,
      cartItems: ROWS,
      cartOffer: offer,
      menu: SAME.index,
      offeredOfferIds: ["other"],
    });
    expect(plan.selectionActions).toEqual(buildOrderTypeSelectionActions(pipeline, languages));
    expect(plan.reprice).toEqual(repriceCartForMenu(ROWS, SAME.index));
    expect(plan.dropOffer).toBe(true);
    expect(plan.dpMaxExceeded).toBe(false);
  });

  /* ---- mutation-verifier additions (lane bag-pdp, item 19 / D6) ---- */

  const capOf = (cartItems: unknown[], menu: MenuPriceIndex, maxQtyItem: string) =>
    planOrderTypeSwitchCommit({
      pipeline: { _id: "p2", tab_id: "t2", tab_type: "take_away" },
      languages: { primaryCode: "en", secondaryCode: "ar" },
      cartItems,
      cartOffer: {},
      menu,
      offeredOfferIds: [],
      currentSession: { _id: "s-take-out", _extras: { maxQtyItem } },
    }).dpMaxExceeded;

  it("D6 counts DP units as the target prices them: a size it DP-prices counts; a row whose DP price ended does not", () => {
    const takeOutDp = convert(rawMenu(), [], { [SODA_L]: { modifiedRate: 3.5, status: "active" } }).index;
    const threeSodas = { ...BAG.size, quantity: 3 };
    expect(capOf([threeSodas], takeOutDp, "2")).toBe(true);
    expect(capOf([threeSodas], takeOutDp, "3")).toBe(false);

    // 4 salads were DP-priced in EAT IN; TAKE OUT's DP session covers other items.
    const eatInDp = convert(rawMenu(), [], { [GREEK_SALAD]: { modifiedRate: 12, status: "active" } });
    const dpSalads = { ...buildCartItemContent(direct(eatInDp.card(GREEK_SALAD)), "ITEM"), quantity: 4 };
    expect(capOf([dpSalads], SAME.index, "2")).toBe(false);
  });

  it("D6 counts only the bag the commit leaves: a reward the switch reverses, and freebie rows, never count", () => {
    const friesGone = [{ item_id: LARGE_FRIES, type: "item", partners: { inStock: false } }];
    const takeOut = (outOfStock: Obj[]) =>
      convert(rawMenu(), outOfStock, { [GREEK_SALAD]: { modifiedRate: 12, status: "active" } }).index;
    const salads = { ...BAG.item, quantity: 2 }; // 2 DP units in TAKE OUT: AT a cap of 2
    const reward = { ...BAG.loyalty, isDpItem: true };
    const freebie = { ...BAG.freebie, isDpItem: true };

    // TAKE OUT cannot serve the reward, so it is reversed and never counts.
    expect(repriceCartForMenu([salads, reward], takeOut(friesGone)).removedLoyalty).toEqual([reward]);
    expect(capOf([salads, reward], takeOut(friesGone), "2")).toBe(false);
    // Control: a reward TAKE OUT serves stays in the bag and counts (2 + 1 > 2).
    expect(capOf([salads, reward], takeOut([]), "2")).toBe(true);
    // A DP freebie row is neither probed nor counted (cartEngine skips get items).
    expect(capOf([salads, freebie], takeOut([]), "2")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The executor (useOrderTypeSwitch): stage, then ONE commit burst.
 * ------------------------------------------------------------------ */

type Staging = { apply: (action: UnknownAction) => unknown; mirror: (key: string, value: string) => void };

const TARGET = { _id: "p2", tab_id: "t2", tab_type: "take_away", primary_name: "Take out" };
const SERVICE = { _id: "dc-service", name: "Service", value: 5, type: "fixed" };
const PACKING = { id: "mc-pack", name: "Packing", value: 10, type: "fixed" };

describe("useOrderTypeSwitch — the executor", () => {
  const holds: number[] = [];
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, {
      store,
      children: createElement(
        IdleHoldContext.Provider,
        { value: (delta: 1 | -1) => holds.push(delta) },
        children,
      ),
    });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setLanguages({ primary_language: { code: "en" }, secondary_language: { code: "ar" } }));
    store.dispatch(setSelectedLanguage({ name: "English", code: "en" }));
    store.dispatch(setCartItems([BAG.item, BAG.burger]));
    window.localStorage.clear();
    holds.length = 0;
    net.capture.mockReset();
    net.dropOffer.mockReset();
    net.replaceDexie.mockClear();
    net.charges.mockReset().mockImplementation(async (_tab: string, opts: Staging) => {
      opts.apply(pushCharges([SERVICE]));
      opts.mirror("deploymentCharges", JSON.stringify([SERVICE]));
      return { ok: true, deploymentCharges: [SERVICE] };
    });
    // The new pipeline: Greek Salad at 19 (re-priced), everything else the same.
    const next = convert(
      rawMenu((menu) => {
        (menu.categories[0].subCategories[0].entities.find((e) => e.id === GREEK_SALAD) as Obj).price = 19;
      }),
    ).index;
    net.menu.mockReset().mockImplementation(async (_tab: string, _r: boolean, _c: boolean, _p: unknown, opts: Staging) => {
      opts.apply(setEntityMap({ entityMap: next.entityMap }));
      opts.apply(setModifiersMap({ modifiersMap: next.modifiersMap }));
      opts.apply(pushCharges([PACKING]));
      opts.apply(setMenuCharges({ menuCharges: [PACKING] }));
      opts.apply(setFilteredOffers([]));
      opts.mirror("menuCharges", JSON.stringify([PACKING]));
      return { categories: [{}] };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mount = () => {
    const dispatch = vi.spyOn(store, "dispatch");
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const onRemoveLoyaltyRow = vi.fn();
    const hook = renderHook(() => useOrderTypeSwitch({ onRemoveLoyaltyRow }), { wrapper });
    dispatch.mockClear();
    return { hook, dispatch, setItem, onRemoveLoyaltyRow };
  };

  it("success: nothing lands mid-flight, then ONE burst in order, then the mirrors", async () => {
    const { hook, dispatch, setItem } = mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.switchTo(TARGET);
    });

    const types = dispatch.mock.calls.map(([action]) => (action as UnknownAction).type);
    expect(types).toEqual([
      "pipeline/setSelectedPipeline",
      "auth/setSelectedTabId",
      "pipeline/setTabType",
      "menu/resetCategorySelection",
      "cart/pushCharges", // staged charges leg
      "menu/setEntityMap", // staged menu leg
      "menu/setModifiersMap",
      "cart/pushCharges",
      "cart/setMenuCharges",
      "offer/setFilteredOffers",
      "cart/pushCharges", // the final, deterministic composition
      "cart/setCartItems",
    ]);
    expect(dispatch.mock.calls[0][0]).toEqual(
      setSelectedPipeline({ ...TARGET, primaryCode: "en", secondaryCode: "ar" }),
    );
    expect(dispatch.mock.calls[10][0]).toEqual(pushCharges([SERVICE, PACKING]));
    const state = store.getState() as unknown as { cart: { cartItems: Obj[]; charges: unknown[] } };
    expect(state.cart.cartItems[0]).toMatchObject({ id: GREEK_SALAD, price: 19, total_price: 19 });
    expect(state.cart.cartItems[1]).toBe(BAG.burger);
    expect(net.replaceDexie).toHaveBeenCalledWith(state.cart.cartItems);
    expect(setItem.mock.calls.map(([key]) => key)).toEqual(["deploymentCharges", "menuCharges", "charges"]);
    expect(window.localStorage.getItem("charges")).toBe(JSON.stringify([SERVICE, PACKING]));
    expect(outcome).toEqual({ ok: true, removedRows: [], offerDropped: false });
    expect(hook.result.current.status).toBe("idle");
    expect(net.capture).toHaveBeenCalledWith(
      "order_type_selected",
      { source: "bag", tab_type: "take_away", pipeline_id: "p2", repriced: 1, removed: 0 },
    );
  });

  it("a failed leg writes NOTHING and reports its stage", async () => {
    net.charges.mockImplementation(async (_tab: string, opts: Staging) => {
      opts.apply(pushCharges([SERVICE]));
      return { ok: false, deploymentCharges: [] };
    });
    const { hook, dispatch, setItem } = mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.switchTo(TARGET);
    });

    expect(outcome).toEqual({ ok: false, removedRows: [], offerDropped: false });
    expect(dispatch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("failed");
    expect(net.capture).toHaveBeenCalledWith("error_occurred", {
      error_source: "order_type_switch",
      stage: "charges",
    });
  });

  it("latched while in flight; an unmount mid-flight aborts with nothing written", async () => {
    let release!: () => void;
    net.charges.mockImplementation(
      (_tab: string) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, deploymentCharges: [] });
        }),
    );
    const { hook, dispatch, setItem } = mount();
    let first!: Promise<unknown>;
    let second: unknown;
    await act(async () => {
      first = hook.result.current.switchTo(TARGET);
      second = await hook.result.current.switchTo(TARGET);
    });
    expect(second).toEqual({ ok: false, aborted: true, removedRows: [], offerDropped: false });
    expect(net.charges).toHaveBeenCalledTimes(1);
    expect(holds).toEqual([1]);

    hook.unmount();
    await act(async () => {
      release();
      await first;
    });
    await expect(first).resolves.toEqual({ ok: false, aborted: true, removedRows: [], offerDropped: false });
    expect(dispatch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(holds).toEqual([1, -1]);
  });

  it("reverses loyalty rows whose item left and drops a freebie-bearing offer (D1a)", async () => {
    store.dispatch(setCartItems([BAG.item, BAG.loyalty, BAG.freebie]));
    store.dispatch({ type: "cart/applyOffer", payload: { offer: { _id: "offer-free-salad", name: "Free salad" } } });
    const next = convert(
      rawMenu((menu) => {
        const side = menu.categories[0].subCategories[0];
        side.entities = side.entities.filter((entity) => entity.id !== LARGE_FRIES);
      }),
    ).index;
    net.menu.mockImplementation(async (_tab: string, _r: boolean, _c: boolean, _p: unknown, opts: Staging) => {
      opts.apply(setEntityMap({ entityMap: next.entityMap }));
      opts.apply(setModifiersMap({ modifiersMap: next.modifiersMap }));
      opts.apply(setFilteredOffers([{ _id: "offer-free-salad" }]));
      return { categories: [{}] };
    });
    const { hook, onRemoveLoyaltyRow } = mount();
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.switchTo(TARGET);
    });

    expect(onRemoveLoyaltyRow).toHaveBeenCalledWith(BAG.loyalty);
    expect(net.dropOffer).toHaveBeenCalledWith(false);
    expect(outcome).toEqual({ ok: true, removedRows: [BAG.loyalty], offerDropped: true });
  });

  it("D6: a bag over the new session's DP cap is refused with nothing written; within the cap it commits", async () => {
    // 4 × Greek Salad at the regular price; TAKE OUT's DP session prices it at 12.
    store.dispatch(setCartItems([{ ...BAG.item, quantity: 4 }]));
    const dp = convert(rawMenu(), [], { [GREEK_SALAD]: { modifiedRate: 12, status: "active" } }).index;
    const stageTakeOut = (maxQtyItem: string) =>
      net.menu.mockImplementation(async (_tab: string, _r: boolean, _c: boolean, _p: unknown, opts: Staging) => {
        opts.apply(setCurrentSession({ _id: "s-happy", sessionName: "Happy hour", _extras: { maxQtyItem } }));
        opts.apply(setEntityMap({ entityMap: dp.entityMap }));
        opts.apply(setModifiersMap({ modifiersMap: dp.modifiersMap }));
        opts.apply(setFilteredOffers([]));
        return { categories: [{}] };
      });
    const { hook, dispatch, setItem } = mount();
    let outcome: unknown;

    stageTakeOut("2");
    await act(async () => {
      outcome = await hook.result.current.switchTo(TARGET);
    });
    expect(outcome).toEqual({ ok: false, removedRows: [], offerDropped: false });
    expect(dispatch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(net.capture).toHaveBeenCalledWith("error_occurred", {
      error_source: "order_type_switch",
      stage: "dpMax",
    });

    stageTakeOut("4");
    await act(async () => {
      outcome = await hook.result.current.switchTo(TARGET);
    });
    expect(outcome).toMatchObject({ ok: true });
    const state = store.getState() as unknown as {
      cart: { cartItems: Obj[] };
      dynamicPricing: { currentSession: unknown };
    };
    expect(state.cart.cartItems[0]).toMatchObject({ isDpItem: true, price: 12, quantity: 4 });
    expect(state.dynamicPricing.currentSession).toMatchObject({ _extras: { maxQtyItem: "4" } });
  });

  /* ---- test-author additions (lane bag-pdp, item 19) ---- */

  type MenuLeg = (tab: string, checkRedux: boolean, rerun: boolean, pipeline: unknown, opts: Staging) => Promise<unknown>;
  const stageMenu = (leg: MenuLeg) => net.menu.mockImplementation(leg);
  const salad19 = () =>
    convert(
      rawMenu((menu) => {
        (menu.categories[0].subCategories[0].entities.find((e) => e.id === GREEK_SALAD) as Obj).price = 19;
      }),
    ).index;
  const stageIndex = (opts: Staging, index: MenuPriceIndex) => {
    opts.apply(setEntityMap({ entityMap: index.entityMap }));
    opts.apply(setModifiersMap({ modifiersMap: index.modifiersMap }));
    opts.apply(setFilteredOffers([]));
  };
  const cartOf = () => (store.getState() as unknown as { cart: { cartItems: unknown[] } }).cart.cartItems;
  const run = async (hook: ReturnType<typeof mount>["hook"], pipeline: SwitchablePipeline = TARGET) => {
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.switchTo(pipeline);
    });
    return outcome;
  };
  const failedAt = (stage: string) =>
    expect(net.capture).toHaveBeenCalledWith("error_occurred", { error_source: "order_type_switch", stage });
  const NOTHING = { ok: false, removedRows: [], offerDropped: false };

  it("in flight: both legs stage, yet NOTHING reaches the store or localStorage; idle is held only while switching", async () => {
    const charges = net.charges.getMockImplementation();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    net.charges.mockImplementation(async (tab: string, opts: Staging) => {
      const leg: unknown = await charges?.(tab, opts);
      await gate;
      return leg;
    });
    const { hook, dispatch, setItem } = mount();
    expect(holds).toEqual([]);

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = hook.result.current.switchTo(TARGET);
    });
    expect(net.charges).toHaveBeenCalledTimes(1);
    expect(net.menu).toHaveBeenCalledTimes(1); // the legs run in parallel
    expect(hook.result.current.status).toBe("switching");
    expect(holds).toEqual([1]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    await act(async () => {
      release();
      await pending;
    });
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(dispatch).toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
    expect(holds).toEqual([1, -1]);
  });

  it("a menu leg that resolves {} — or without a staged menu index — writes NOTHING (stage 'menu')", async () => {
    const legs: MenuLeg[] = [
      async (_t, _r, _c, _p, opts) => {
        opts.mirror("dpItemsMap", "{}");
        return {};
      },
      async (_t, _r, _c, _p, opts) => {
        opts.apply(setFilteredOffers([]));
        return { categories: [{}] };
      },
    ];
    for (const leg of legs) {
      net.capture.mockReset();
      holds.length = 0;
      stageMenu(leg);
      const { hook, dispatch, setItem } = mount();
      expect(await run(hook)).toEqual(NOTHING);
      expect(dispatch).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
      expect(hook.result.current.status).toBe("failed");
      failedAt("menu");
      // Both legs settled in one batch, so "switching" may never render; a
      // hold is never left behind either way.
      expect(holds.reduce((sum, delta) => sum + delta, 0)).toBe(0);
      hook.unmount();
      vi.restoreAllMocks();
    }
  });

  it("D1b: an offers-fetch failure aborts the switch with NOTHING written (stage 'offers')", async () => {
    stageMenu(async (_t, _r, _c, _p, opts) => {
      opts.apply(setOffersFetchLoading());
      opts.apply(setOffersFetchFailed({ attempts: 3 }));
      opts.mirror("dpItemsMap", "{}");
      return {};
    });
    const { hook, dispatch, setItem } = mount();
    expect(await run(hook)).toEqual(NOTHING);
    expect(dispatch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("failed");
    failedAt("offers");
    expect((store.getState() as unknown as { offer: { fetchStatus?: unknown } }).offer.fetchStatus).not.toBe("failed");
  });

  it("D1c: a dynamic-pricing failure is tolerated — the switch commits at regular prices", async () => {
    // The CURRENT pipeline runs a tight DP session; the target's DP fetch failed
    // (fetchDpItems staged no session and an empty map).
    store.dispatch(setCurrentSession({ _id: "s-old", _extras: { maxQtyItem: "1" } }));
    store.dispatch(setCartItems([{ ...BAG.item, quantity: 4 }]));
    const regular = salad19();
    stageMenu(async (_t, _r, _c, _p, opts) => {
      opts.apply(setCurrentSession(undefined));
      opts.apply(setDpItemsMap({}));
      stageIndex(opts, regular);
      return { categories: [{}] };
    });
    const { hook, dispatch } = mount();
    expect(await run(hook)).toEqual({ ok: true, removedRows: [], offerDropped: false });
    const types = dispatch.mock.calls.map(([action]) => (action as UnknownAction).type);
    expect(types).toContain("dynamicPricing/setCurrentSession");
    expect(types).toContain("dynamicPricing/setDpItemsMap");
    const [row] = cartOf() as Obj[];
    expect(row).toMatchObject({ id: GREEK_SALAD, price: 19, total_price: 19, quantity: 4 });
    expect(row.isDpItem).toBeFalsy();
  });

  it("a no-op switch commits the selection and the staged data but writes no cart row and no Dexie", async () => {
    const before = cartOf();
    stageMenu(async (_t, _r, _c, _p, opts) => {
      stageIndex(opts, convert(rawMenu()).index);
      return { categories: [{}] };
    });
    const { hook, dispatch } = mount();
    expect(await run(hook)).toEqual({ ok: true, removedRows: [], offerDropped: false });
    const types = dispatch.mock.calls.map(([action]) => (action as UnknownAction).type);
    expect(types.slice(0, 4)).toEqual([
      "pipeline/setSelectedPipeline",
      "auth/setSelectedTabId",
      "pipeline/setTabType",
      "menu/resetCategorySelection",
    ]);
    expect(types).not.toContain("cart/setCartItems");
    expect(cartOf()).toBe(before);
    expect(net.replaceDexie).not.toHaveBeenCalled();
    expect(net.capture).toHaveBeenCalledWith("order_type_selected", {
      source: "bag", tab_type: "take_away", pipeline_id: "p2", repriced: 0, removed: 0,
    });
  });

  it("order: the redux burst, THEN Dexie with the committed rows, THEN the mirrors, THEN analytics (PipelineSelected, OrderTypeSelected)", async () => {
    const { hook, dispatch, setItem } = mount();
    expect(await run(hook)).toMatchObject({ ok: true });

    const lastDispatch = Math.max(...dispatch.mock.invocationCallOrder);
    const dexieAt = net.replaceDexie.mock.invocationCallOrder[0];
    expect(dexieAt).toBeGreaterThan(lastDispatch);
    expect(net.replaceDexie).toHaveBeenCalledWith(cartOf());
    expect(Math.min(...setItem.mock.invocationCallOrder)).toBeGreaterThan(dexieAt);
    const props = { source: "bag", tab_type: "take_away", pipeline_id: "p2", repriced: 1, removed: 0 };
    expect(net.capture.mock.calls).toEqual([
      ["pipeline_selected", props],
      ["order_type_selected", props],
    ]);
    expect(Math.min(...net.capture.mock.invocationCallOrder)).toBeGreaterThan(
      Math.max(...setItem.mock.invocationCallOrder),
    );
  });

  it("removedRows lists the removed PAID rows first, then the reversed rewards (the notice's payload)", async () => {
    store.dispatch(setCartItems([BAG.loyalty, BAG.item, BAG.burger]));
    const gone = convert(
      rawMenu((menu) => {
        const side = menu.categories[0].subCategories[0];
        side.entities = side.entities.filter((e) => e.id !== GREEK_SALAD && e.id !== LARGE_FRIES);
      }),
    ).index;
    stageMenu(async (_t, _r, _c, _p, opts) => {
      stageIndex(opts, gone);
      return { categories: [{}] };
    });
    const { hook, onRemoveLoyaltyRow } = mount();
    expect(await run(hook)).toEqual({ ok: true, removedRows: [BAG.item, BAG.loyalty], offerDropped: false });
    expect(onRemoveLoyaltyRow).toHaveBeenCalledTimes(1);
    expect(onRemoveLoyaltyRow).toHaveBeenCalledWith(BAG.loyalty);
    // The reward stays in the committed rows: BagSheet's reversal removes it.
    expect(cartOf()).toEqual([BAG.loyalty, BAG.burger]);
    expect(net.capture).toHaveBeenCalledWith("order_type_selected", {
      source: "bag", tab_type: "take_away", pipeline_id: "p2", repriced: 0, removed: 2,
    });
  });

  it("a target without a tab is refused before any request (stage 'target')", async () => {
    const { hook, dispatch, setItem } = mount();
    expect(await run(hook, { _id: "p9", tab_type: "take_away" })).toEqual(NOTHING);
    expect(net.charges).not.toHaveBeenCalled();
    expect(net.menu).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("failed");
    failedAt("target");
  });

  it("a leg that throws fails 'exception' with nothing written — and the latch lets TRY AGAIN commit", async () => {
    const charges = net.charges.getMockImplementation();
    net.charges.mockImplementationOnce(async () => {
      throw new Error("transport");
    });
    const { hook, dispatch, setItem } = mount();
    expect(await run(hook)).toEqual(NOTHING);
    expect(dispatch).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    failedAt("exception");
    expect(hook.result.current.status).toBe("failed");

    net.charges.mockImplementation(charges ?? (async () => ({ ok: true, deploymentCharges: [] })));
    expect(await run(hook)).toMatchObject({ ok: true });
    expect(net.charges).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status).toBe("idle");
    expect((store.getState() as unknown as { pipeline: { selectedPipeline: { _id: string } } }).pipeline.selectedPipeline._id).toBe("p2");
  });

  it("post-commit side steps are best effort: a throwing reward reversal, offer drop, Dexie or localStorage never un-commits the switch", async () => {
    store.dispatch(setCartItems([BAG.item, BAG.loyalty, BAG.freebie]));
    store.dispatch({ type: "cart/applyOffer", payload: { offer: { _id: "offer-free-salad", name: "Free salad" } } });
    const next = convert(
      rawMenu((menu) => {
        const side = menu.categories[0].subCategories[0];
        (side.entities.find((e) => e.id === GREEK_SALAD) as Obj).price = 19;
        side.entities = side.entities.filter((e) => e.id !== LARGE_FRIES);
      }),
    ).index;
    stageMenu(async (_t, _r, _c, _p, opts) => {
      opts.apply(setEntityMap({ entityMap: next.entityMap }));
      opts.apply(setModifiersMap({ modifiersMap: next.modifiersMap }));
      opts.apply(setFilteredOffers([{ _id: "offer-free-salad" }]));
      opts.mirror("menuCharges", "[]");
      return { categories: [{}] };
    });
    net.dropOffer.mockImplementation(() => {
      throw new Error("offer removal");
    });
    net.replaceDexie.mockImplementationOnce(() => {
      throw new Error("IndexedDB unavailable");
    });
    const { hook, setItem, onRemoveLoyaltyRow } = mount();
    onRemoveLoyaltyRow.mockImplementation(() => {
      throw new Error("revoke");
    });
    setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const outcome = await run(hook);
    setItem.mockRestore();

    expect(outcome).toEqual({ ok: true, removedRows: [BAG.loyalty], offerDropped: true });
    expect(hook.result.current.status).toBe("idle");
    expect(net.dropOffer).toHaveBeenCalledWith(false);
    expect((cartOf()[0] as Obj).price).toBe(19);
    expect((store.getState() as unknown as { pipeline: { tabType: string } }).pipeline.tabType).toBe("take_away");
    expect(net.capture).toHaveBeenCalledWith("order_type_selected", expect.objectContaining({ pipeline_id: "p2" }));
  });

  it("StrictMode: the replayed mount effect re-arms the mounted guard, so a switch still commits", async () => {
    const hook = renderHook(() => useOrderTypeSwitch({ onRemoveLoyaltyRow: vi.fn() }), {
      wrapper,
      reactStrictMode: true,
    });
    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.switchTo(TARGET);
    });
    expect(outcome).toMatchObject({ ok: true });
    expect((cartOf()[0] as Obj).price).toBe(19);
    expect(holds.reduce((sum, delta) => sum + delta, 0)).toBe(0);
  });

  /* ---- mutation-verifier additions (lane bag-pdp, item 19 / D1a) ---- */

  it("D1a: an applied offer the target ALSO offers (no freebie rows) is kept — the removal never runs; one it does not offer is dropped", async () => {
    store.dispatch({ type: "cart/applyOffer", payload: { offer: { _id: "offer-flat-2", name: "£2 off" } } });
    const menu = salad19();
    const offering = (offers: { _id: string }[]) =>
      stageMenu(async (_t, _r, _c, _p, opts) => {
        opts.apply(setEntityMap({ entityMap: menu.entityMap }));
        opts.apply(setModifiersMap({ modifiersMap: menu.modifiersMap }));
        opts.apply(setFilteredOffers(offers));
        return { categories: [{}] };
      });
    const { hook } = mount();

    offering([{ _id: "other" }, { _id: "offer-flat-2" }]);
    expect(await run(hook)).toEqual({ ok: true, removedRows: [], offerDropped: false });
    expect(net.dropOffer).not.toHaveBeenCalled();

    offering([{ _id: "other" }]);
    expect(await run(hook)).toEqual({ ok: true, removedRows: [], offerDropped: true });
    expect(net.dropOffer).toHaveBeenCalledTimes(1);
    expect(net.dropOffer).toHaveBeenCalledWith(false);
  });
});
