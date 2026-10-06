import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getMediaUrl } from "@cx-sdk/catalog/settings/settingsEngine";
import {
  buildLegacyMenuWithChecks,
  collectLegacyEntityMaps,
  convertLegacyMenuTree,
  mergeLegacyMediaItemMap,
} from "@cx-sdk/catalog/menu/legacyMenuConverters";
import appSettingsReducer, {
  clearMediaDataConvertedItems,
  setMediaDataConverted,
} from "@cx-sdk/catalog/state/appSettings.slice";

/*
  Post-P9 25a (user D1, 2026-10-06: guard only, no banner UI). A stored
  `media.banner_image_*` slot of the wrong shape used to throw inside the menu
  conversion and blank /menu, and — once conversion survives — inside the
  reducer every /start reset dispatches. The guards must be additive: a valid
  banner still resolves exactly as before (fork parity).
*/

const SLIM_MENU = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../tests/e2e/fixtures/slim-menu.json"), "utf8"),
) as { categories: unknown[] };

const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
const FRIES = "5dd10938eb1ccee31ca352fa";

interface Tree {
  categories: { id: string; subCategories: { id: string; entities: { id: string }[] }[] }[];
}

/** TB useMenuConverters' convertMenuData, end to end: caller loop + walk + merge. */
function convert(parsedMediaItems: unknown, languageType = "primary_language") {
  const menu = structuredClone(SLIM_MENU);
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
  const mediaItemMapLocal: Record<string, { id: string }[]> = {};
  getMediaUrl(
    languageType === "secondary_language" ? "secondary" : "primary",
    parsedMediaItems,
  )?.forEach((entry) => {
    const { uniqueId } = entry as { uniqueId: string };
    if (!mediaItemMapLocal[uniqueId]) mediaItemMapLocal[uniqueId] = [];
  });
  const tree = convertLegacyMenuTree({
    menuItems: { ...menuWithChecks, categories: structuredClone(menuWithChecks.categories) },
    entpShowCategory: undefined,
    showNoImageItem: true,
    parsedMediaItems,
    languageType,
    outOfStockItems: [],
    availableItems: [],
    availableItemsMap: new Set(),
    deepCopyMediaItemsMapRdx: {},
    newParsedMediaItems: [],
    mediaItemMapLocal,
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
  }) as Tree;
  const merged = mergeLegacyMediaItemMap(parsedMediaItems, languageType, mediaItemMapLocal);
  return { tree, mediaItemMapLocal, merged };
}

const ids = ({ categories }: Tree) =>
  categories.map((c) => [
    c.id,
    c.subCategories.map((s) => [s.id, s.entities.map((e) => e.id)]),
  ]);

describe("getMediaUrl — only a list of entry objects reaches the banner walk", () => {
  it("a missing, object or string slot is undefined", () => {
    for (const slot of [undefined, null, {}, { length: 1 }, "abc", 5]) {
      expect(getMediaUrl("primary", { media: { banner_image_primary: slot } })).toBeUndefined();
    }
    expect(getMediaUrl("primary", undefined)).toBeUndefined();
    expect(getMediaUrl("primary", { media: null })).toBeUndefined();
    expect(getMediaUrl("other", { media: { banner_image_primary: [{ uniqueId: "a" }] } })).toBeUndefined();
  });

  it("filters null and number entries and keeps every entry's identity (a new array)", () => {
    const a = { uniqueId: "a" };
    const b = { uniqueId: "b", items: [] };
    const slot = [null, a, 5, b, 0];

    const list = getMediaUrl("primary", { media: { banner_image_primary: slot } });

    expect(list).toEqual([a, b]);
    expect(list?.[0]).toBe(a);
    expect(list?.[1]).toBe(b);
    expect(list).not.toBe(slot);
  });

  it("reads the slot of the language: primary ↔ banner_image_primary, secondary ↔ banner_image_secondary", () => {
    const p = { uniqueId: "p" };
    const s = { uniqueId: "s" };
    const data = { media: { banner_image_primary: [p], banner_image_secondary: [s] } };

    expect(getMediaUrl("primary", data)?.[0]).toBe(p);
    expect(getMediaUrl("secondary", data)?.[0]).toBe(s);
  });
});

describe("convertLegacyMenuTree — a malformed banner slot never changes /menu", () => {
  const baseline = convert({});

  it("the no-banner baseline is the whole slim menu", () => {
    expect(ids(baseline.tree)).toHaveLength(2);
    expect(ids(baseline.tree).flat(4)).toContain(CHEESE_BURGER);
  });

  it.each<[string, unknown]>([
    ["an object", {}],
    ["[null]", [null]],
    ["an entry without items", [{ uniqueId: "a" }]],
    ["items as a string", [{ uniqueId: "a", items: "x" }]],
    ["a null linked item", [{ uniqueId: "a", items: [null] }]],
  ])("banner_image_primary = %s → the same category and entity ids as {}, no throw", (_label, slot) => {
    const parsed = { media: { banner_image_primary: slot } };

    let result: ReturnType<typeof convert> | undefined;
    expect(() => {
      result = convert(parsed);
    }).not.toThrow();
    expect(ids(result!.tree)).toEqual(ids(baseline.tree));
  });

  it("the same shapes in the secondary slot of a secondary-language session do not throw either", () => {
    for (const slot of [{}, [null], [{ uniqueId: "a" }], [{ uniqueId: "a", items: "x" }], [{ uniqueId: "a", items: [null] }]]) {
      const result = convert({ media: { banner_image_secondary: slot } }, "secondary_language");
      expect(ids(result.tree)).toEqual(ids(baseline.tree));
    }
  });

  it("parity pin: a valid banner still fills mediaItemMapLocal.primary_0 with the burger and merges it", () => {
    const parsed = {
      media: { banner_image_primary: [{ uniqueId: "primary_0", items: [{ _id: CHEESE_BURGER }] }] },
    };

    const { tree, mediaItemMapLocal, merged } = convert(parsed);

    expect(mediaItemMapLocal.primary_0.map((e) => e.id)).toEqual([CHEESE_BURGER]);
    expect(
      (merged as { media: { banner_image_primary: { items: { id: string }[] }[] } }).media
        .banner_image_primary[0].items.map((e) => e.id),
    ).toEqual([CHEESE_BURGER]);
    expect(ids(tree)).toEqual(ids(baseline.tree));
  });

  it("the secondary slot follows languageType 'secondary_language' (and only then)", () => {
    const parsed = {
      media: {
        banner_image_primary: [{ uniqueId: "primary_0", items: [{ _id: CHEESE_BURGER }] }],
        banner_image_secondary: [{ uniqueId: "secondary_0", items: [{ _id: FRIES }] }],
      },
    };

    const secondary = convert(parsed, "secondary_language").mediaItemMapLocal;
    expect(Object.keys(secondary)).toEqual(["secondary_0"]);
    expect(secondary.secondary_0.map((e) => e.id)).toEqual([FRIES]);

    const primary = convert(parsed, "primary_language").mediaItemMapLocal;
    expect(Object.keys(primary)).toEqual(["primary_0"]);
    expect(primary.primary_0.map((e) => e.id)).toEqual([CHEESE_BURGER]);
  });
});

describe("mergeLegacyMediaItemMap", () => {
  it("undefined or null media → {}", () => {
    expect(mergeLegacyMediaItemMap(undefined, "primary_language", {})).toEqual({});
    expect(mergeLegacyMediaItemMap(null, "secondary_language", { a: [] })).toEqual({});
  });

  it("a malformed slot (not a list, or non-object entries) is returned untouched", () => {
    expect(
      mergeLegacyMediaItemMap({ media: { banner_image_primary: { k: 1 } } }, "primary_language", { a: [{ id: 1 }] }),
    ).toEqual({ media: { banner_image_primary: { k: 1 } } });
    expect(
      mergeLegacyMediaItemMap({ media: { banner_image_secondary: "x" } }, "secondary_language", { a: [{ id: 1 }] }),
    ).toEqual({ media: { banner_image_secondary: "x" } });
    expect(
      mergeLegacyMediaItemMap({ media: { banner_image_primary: [null, 5] } }, "primary_language", { a: [{ id: 1 }] }),
    ).toEqual({ media: { banner_image_primary: [null, 5] } });
  });

  it("a valid slot gets its items (by uniqueId); a copy, never the caller's object", () => {
    const parsed = { media: { banner_image_primary: [null, { uniqueId: "a" }, { uniqueId: "b" }] } };

    const merged = mergeLegacyMediaItemMap(parsed, "primary_language", { a: [{ id: 1 }] });

    expect(merged).toEqual({
      media: { banner_image_primary: [null, { uniqueId: "a", items: [{ id: 1 }] }, { uniqueId: "b" }] },
    });
    expect(parsed.media.banner_image_primary[1]).toEqual({ uniqueId: "a" });
  });
});

describe("clearMediaDataConvertedItems — the reducer every session reset dispatches", () => {
  const cleared = (mediaDataConverted: unknown) => {
    let state = appSettingsReducer(undefined, { type: "@@INIT" });
    state = appSettingsReducer(state, setMediaDataConverted(mediaDataConverted));
    return appSettingsReducer(state, clearMediaDataConvertedItems()).mediaDataConverted as unknown;
  };

  it.each<[string, unknown]>([
    ["[null]", [null]],
    ["'abc'", "abc"],
    ["{}", {}],
  ])("does not throw on a %s slot (left as it is)", (_label, slot) => {
    expect(() => cleared({ media: { banner_image_primary: slot, banner_image_secondary: slot } })).not.toThrow();
    expect(cleared({ media: { banner_image_primary: slot } })).toEqual({ media: { banner_image_primary: slot } });
  });

  it("still empties the items of every valid entry, beside a malformed one", () => {
    expect(
      cleared({
        media: {
          home_screen: [{ url: "x" }],
          banner_image_primary: [null, { uniqueId: "a", items: [{ id: 1 }] }],
          banner_image_secondary: [{ uniqueId: "s", items: [{ id: 2 }] }, 7],
        },
      }),
    ).toEqual({
      media: {
        home_screen: [{ url: "x" }],
        banner_image_primary: [null, { uniqueId: "a", items: [] }],
        banner_image_secondary: [{ uniqueId: "s", items: [] }, 7],
      },
    });
  });
});
