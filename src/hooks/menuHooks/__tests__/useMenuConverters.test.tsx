import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import type { UnknownAction } from "@reduxjs/toolkit";
import { setTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import {
  setDpItemsMap,
  setIsDynamicPricingEnabled,
} from "@cx-sdk/catalog/state/dynamicPricing.slice";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  pushCharges,
  setDeploymentCharges,
  setMenuCharges,
} from "@cx-sdk/ordering/state/cart.slice";
import { setOffersFetchFailed } from "@cx-sdk/ordering/state/offer.slice";
import { setOneCategoryAtATime } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import useMenuConverters from "../useMenuConverters";

/*
  fetchMenu's failure signal (P9b R8). It resolves {} on EVERY failure —
  fork parity, the callers judge the returned categories — and the cause,
  which used to be a console.error nobody reads on an unattended kiosk, is
  now an analytics event. Seams: the three RTK triggers in the fetch's
  Promise.all, offers, dynamic pricing and the Dexie menu cache.

  Lane bag-pdp (item 19): the default-path PIN — the exact dispatch and
  localStorage sequence of a successful fetch, through the REAL offer and
  dynamic-pricing hooks — and the staged (opts) mode the order-type switch
  uses: nothing reaches the store or localStorage, everything reaches
  apply / mirror.
*/

const net = vi.hoisted(() => ({
  menu: (_args?: unknown): Promise<unknown> => Promise.resolve({}),
  outOfStock: (): Promise<unknown> => Promise.resolve([]),
  serverTime: (): Promise<unknown> => Promise.resolve({}),
  mockCapture: vi.fn(),
  /** true = the real useOfferHook / useDynamicPricing over the mocked RTK triggers below. */
  realHooks: false,
  offersBody: (): Promise<unknown> => Promise.resolve([]),
  dpSessions: undefined as unknown,
  dpItems: (): Promise<unknown> => Promise.resolve({ data: undefined }),
  /** The Dexie menu cache (db.menus). */
  dexieGet: (): Promise<unknown> => Promise.resolve(undefined),
  dexiePut: (_row: unknown): Promise<unknown> => Promise.resolve(),
  /** Start order of the fetch's requests and the cache read (perf pass BOOT-2). */
  started: [] as string[],
}));

vi.mock("@cx-sdk/catalog/services/menuApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/menuApi")>()),
  useGetMenuMutation: () => [
    (args: unknown) => {
      net.started.push("getMenu");
      return { unwrap: () => net.menu(args) };
    },
    { isLoading: false },
  ],
}));

vi.mock("@cx-sdk/catalog/services/outOfStockApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/outOfStockApi")>()),
  useGetOutOfStockMutation: () => [
    () => {
      net.started.push("outOfStock");
      return { unwrap: () => net.outOfStock() };
    },
  ],
}));

vi.mock("@cx-sdk/catalog/services/settingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/settingsApi")>()),
  useLazyGetServerTimeQuery: () => [
    () => {
      net.started.push("serverTime");
      return { unwrap: () => net.serverTime() };
    },
  ],
}));

vi.mock("@cx-sdk/ordering/services/kioskOfferApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/ordering/services/kioskOfferApi")>()),
  useGetCxValidOffersMutation: () => [
    () => ({ unwrap: () => net.offersBody() }),
    { isLoading: false },
  ],
}));

vi.mock("@cx-sdk/catalog/services/dynamicPricingApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/dynamicPricingApi")>()),
  useGetDpSessionsMutation: () => [() => Promise.resolve({ data: net.dpSessions })],
  useGetDpItemsMutation: () => [() => net.dpItems()],
}));

vi.mock("../../offerHooks/useOfferHook", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../offerHooks/useOfferHook")>();
  return {
    default: () =>
      net.realHooks
        ? actual.default()
        : {
            getCxOffers: () => {
              net.started.push("offers");
              return Promise.resolve(null);
            },
          },
  };
});

vi.mock("../../dynamicPricingHooks/useDynamicPricing", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../dynamicPricingHooks/useDynamicPricing")
  >();
  return {
    default: () =>
      net.realHooks
        ? actual.default()
        : {
            fetchDpSessions: () => {
              net.started.push("dpSessions");
              return Promise.resolve([]);
            },
            fetchDpItems: () => Promise.resolve({}),
          },
  };
});

vi.mock("../../../models/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../models/db")>()),
  db: {
    menus: {
      get: () => {
        net.started.push("dexieGet");
        return net.dexieGet();
      },
      put: (row: unknown) => net.dexiePut(row),
    },
  },
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => net.mockCapture(...args),
}));

const PIPELINE = { _id: "p-take", tab_id: "t2", tab_type: "take_away" };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

const menuInStore = () =>
  (store.getState() as { menu: { menu: Record<string, unknown> } }).menu.menu;

const menuFetchEvents = () =>
  net.mockCapture.mock.calls
    .map(([, props]) => props as Record<string, unknown> | undefined)
    .filter((props) => props?.error_source === "menu_fetch");

describe("useMenuConverters.fetchMenu — failures resolve {} and are reported (P9b R8)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    net.realHooks = false;
    net.serverTime = () => Promise.resolve({});
    net.menu = () => Promise.resolve({});
    net.outOfStock = () => Promise.resolve([]);
    net.mockCapture.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fetchOnce = async () => {
    const { result } = renderHook(() => useMenuConverters(), { wrapper });
    let menu: unknown;
    await act(async () => {
      menu = await result.current.fetchMenu("t2", false, false, PIPELINE);
    });
    return menu;
  };

  it.each([
    [
      "the 30 s menu download ran out mid-body (RTK 2.12 PARSING_ERROR)",
      () =>
        (net.menu = () =>
          Promise.reject({
            status: "PARSING_ERROR",
            originalStatus: 200,
            data: "",
            error: "TimeoutError: signal timed out",
          })),
      "PARSING_ERROR",
      "TimeoutError: signal timed out",
    ],
    [
      "a 10 s side call (out of stock) timed out",
      () =>
        (net.outOfStock = () =>
          Promise.reject({ status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" })),
      "TIMEOUT_ERROR",
      "TimeoutError: signal timed out",
    ],
    [
      "the backend answered 500",
      () => (net.menu = () => Promise.reject({ status: 500, data: {} })),
      "500",
      "",
    ],
  ])("%s → {} + menu_fetch {status, detail}", async (_label, arrange, status, detail) => {
    arrange();

    const menu = await fetchOnce();

    expect(menu).toEqual({});
    expect(menuInStore()).toEqual({});
    expect(menuFetchEvents()).toEqual([
      { error_source: "menu_fetch", error_status: status, error_detail: detail },
    ]);
    // The old silent console.error is gone from this path.
    expect(console.error).not.toHaveBeenCalled();
  });

  it("a converter bug (a thrown Error) reports its name and message", async () => {
    net.menu = () => Promise.resolve(null);

    const menu = await fetchOnce();

    expect(menu).toEqual({});
    expect(menuFetchEvents()).toEqual([
      expect.objectContaining({ error_source: "menu_fetch", error_status: "TypeError" }),
    ]);
  });

  it("P9a late-result guard kept: a menu answered after the caller unmounted is dropped like a failure", async () => {
    let answer!: (menu: unknown) => void;
    const late = new Promise((resolve) => {
      answer = resolve;
    });
    net.menu = () => late;
    const dispatch = vi.spyOn(store, "dispatch");
    const { result, unmount } = renderHook(() => useMenuConverters(), { wrapper });

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.fetchMenu("t2", false, false, PIPELINE);
    });
    unmount();
    dispatch.mockClear();
    await act(async () => {
      answer({ settings: { send_categories: true }, categories: [] });
    });

    await expect(pending).resolves.toEqual({});
    // Nothing from the late body reached the store (the next customer's).
    expect(dispatch).not.toHaveBeenCalled();
    expect(menuFetchEvents()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Lane bag-pdp — the default path pin and the staged (opts) mode.
 * ------------------------------------------------------------------ */

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "../../../../tests/e2e/fixtures", name), "utf8"),
  );

const CHEESE_BURGER = "5dd10936712f5b622a66aab7";
/** A customizable freebie: the offer converter resolves its modifier groups. */
const FREE_BURGER_OFFER = {
  _id: "offer-free-burger",
  name: "Free burger",
  type: { name: "item" },
  applicable: { rawItems: [] },
  getItems: {
    items: [{ _id: CHEESE_BURGER, discountType: "percent", value: 100, quantity: 1 }],
  },
};
const MENU_CHARGE = {
  _id: "mc-pack",
  name: "Packing",
  partners: ["Kiosk"],
  value: { isActive: true, type: "Fixed", amount: 10, chargeNature: "FIXED" },
};
/**
 * slim-menu as its tenant serves it: send_categories ON, as the pins below
 * were taken (the e2e copy turns it off — the category view).
 */
const tenantMenu = () => {
  const menu = fixture("slim-menu.json") as { settings?: object };
  return { ...menu, settings: { ...menu.settings, send_categories: true }, charges: [MENU_CHARGE] };
};
const DEPLOYMENT_CHARGE = { _id: "dc-service", name: "Service", value: 5, type: "fixed" };
const DP_SESSION = { _id: "dp-lunch", sessionName: "Lunch", _extras: { maxQtyItem: "5" } };
const DP_ITEMS = [{ baseItemId: CHEESE_BURGER, session: { status: "active", modifiedRate: 7 } }];

/** FNV-1a 32-bit — a strict, short digest for inline payload pins. */
const digest = (value: unknown): string => {
  const text = JSON.stringify(value) ?? "undefined";
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

type Write = [string, string];

describe("fetchMenu — lane bag-pdp pins (real offer + dynamic-pricing hooks)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    window.localStorage.clear();
    window.localStorage.setItem("deploymentCharges", JSON.stringify([DEPLOYMENT_CHARGE]));
    // C1b: fetchMenu reads the deployment charges back from REDUX (the app
    // writes both together); the pinned payloads below are unchanged.
    store.dispatch(setDeploymentCharges([DEPLOYMENT_CHARGE]));
    store.dispatch(setTabType("dine_in"));
    net.realHooks = true;
    net.serverTime = () => Promise.resolve({ serverTime: "2026-10-07T12:00:00.000Z" });
    net.menu = () =>
      Promise.resolve(tenantMenu());
    net.outOfStock = () => Promise.resolve([]);
    net.offersBody = () =>
      Promise.resolve([...(fixture("offers.json") as unknown[]), FREE_BURGER_OFFER]);
    net.dpSessions = [DP_SESSION];
    net.dpItems = () => Promise.resolve({ data: DP_ITEMS });
    net.mockCapture.mockReset();
  });

  afterEach(() => {
    net.realHooks = false;
    vi.restoreAllMocks();
  });

  /** One fetch; returns what reached the STORE and LOCALSTORAGE (persist:* excluded). */
  const record = async (run: (fetchMenu: ReturnType<typeof useMenuConverters>["fetchMenu"]) => Promise<unknown>) => {
    const dispatch = vi.spyOn(store, "dispatch");
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const { result } = renderHook(() => useMenuConverters(), { wrapper });
    dispatch.mockClear();
    setItem.mockClear();
    let menu: unknown;
    await act(async () => {
      menu = await run(result.current.fetchMenu);
    });
    const actions = dispatch.mock.calls.map(([action]) => action as UnknownAction);
    const writes = setItem.mock.calls
      .map(([key, value]) => [String(key), String(value)] as Write)
      .filter(([key]) => !key.startsWith("persist:"));
    return { menu: menu as { categories?: unknown[] }, actions, writes };
  };

  const DEFAULT_TYPES_DP_OFF: string[] = [
    "dynamicPricing/setDpItemsMap",
    "offer/setOffersFetchLoading",
    "offer/setOffers",
    "dynamicPricing/setCurrentSession",
    "dynamicPricing/setDpItemsMap",
    "appSettings/setAllowMultiplePunch",
    "menu/setEntpShowCategory",
    "menu/setEntityMap",
    "appSettings/setBannerAvailableItems",
    "makeItAMeal/setMappedUpsellIds",
    "menu/setTags",
    "appSettings/setMediaDataConverted",
    "menu/setModifiersMap",
    "menu/setMenuBasedOnCategory",
    "menu/setEntityModifierMap",
    "menu/setCategoryMap",
    "menu/setSubCategoryMap",
    "menu/setSubCategoryMapWhichContainsTopLevelCategoryIdAndName",
    "menu/setAllMenuWithoutChecks",
    "menu/setEntityMenuObject",
    "menu/setVariantObject",
    "cart/pushCharges",
    "cart/setMenuCharges",
    "offer/setFilteredOffers",
    "menu/setMenuData",
  ];
  const DEFAULT_DIGESTS_DP_OFF: string[] = [
    "5465b825",
    "9b61ad43",
    "f5e06d73",
    "9b61ad43",
    "5465b825",
    "0b069958",
    "537ae88d",
    "7a229a1b",
    "741638a5",
    "90507120",
    "e63661da",
    "5465b825",
    "2b496ae3",
    "d36165bd",
    "44b3af13",
    "0cc321e4",
    "c0103d7f",
    "0e8c9579",
    "bc92fe21",
    "c8b1d18f",
    "57ae4f9d",
    "b7c99d9d",
    "529b1598",
    "01667282",
    "07087677",
  ];
  const DEFAULT_WRITES_DP_OFF: Write[] = [
    ["dpItemsMap", "{}"],
    ["currentSession", "undefined"],
    ["entpShowCategory", "true"],
    ["menuCharges", "[{\"id\":\"mc-pack\",\"name\":\"Packing\",\"value\":10,\"type\":\"fixed\"}]"],
    ["charges", "[{\"_id\":\"dc-service\",\"name\":\"Service\",\"value\":5,\"type\":\"fixed\"},{\"id\":\"mc-pack\",\"name\":\"Packing\",\"value\":10,\"type\":\"fixed\"}]"],
  ];
  const DEFAULT_TYPES_DP_ON: string[] = [
    "offer/setOffersFetchLoading",
    "dynamicPricing/setValidDpSessions",
    "offer/setOffers",
    "dynamicPricing/setCurrentSession",
    "dynamicPricing/setDpItemsMap",
    "appSettings/setAllowMultiplePunch",
    "menu/setEntpShowCategory",
    "menu/setEntityMap",
    "appSettings/setBannerAvailableItems",
    "makeItAMeal/setMappedUpsellIds",
    "menu/setTags",
    "appSettings/setMediaDataConverted",
    "menu/setModifiersMap",
    "menu/setMenuBasedOnCategory",
    "menu/setEntityModifierMap",
    "menu/setCategoryMap",
    "menu/setSubCategoryMap",
    "menu/setSubCategoryMapWhichContainsTopLevelCategoryIdAndName",
    "menu/setAllMenuWithoutChecks",
    "menu/setEntityMenuObject",
    "menu/setVariantObject",
    "cart/pushCharges",
    "cart/setMenuCharges",
    "offer/setFilteredOffers",
    "menu/setMenuData",
  ];
  const DEFAULT_DIGESTS_DP_ON: string[] = [
    "9b61ad43",
    "72d01661",
    "f5e06d73",
    "00018843",
    "dcb9aadc",
    "0b069958",
    "537ae88d",
    "caa93671",
    "741638a5",
    "90507120",
    "e63661da",
    "5465b825",
    "2b496ae3",
    "d36165bd",
    "44b3af13",
    "321b4c7c",
    "a9ffe99b",
    "a904adc5",
    "bc92fe21",
    "90d8f33d",
    "57ae4f9d",
    "b7c99d9d",
    "529b1598",
    "8cf3e221",
    "5d784d2b",
  ];
  const DEFAULT_WRITES_DP_ON: Write[] = [
    ["validDpSessions", "[{\"_id\":\"dp-lunch\",\"sessionName\":\"Lunch\",\"_extras\":{\"maxQtyItem\":\"5\"}}]"],
    ["currentSession", "{\"_id\":\"dp-lunch\",\"sessionName\":\"Lunch\",\"_extras\":{\"maxQtyItem\":\"5\"}}"],
    ["entpShowCategory", "true"],
    ["menuCharges", "[{\"id\":\"mc-pack\",\"name\":\"Packing\",\"value\":10,\"type\":\"fixed\"}]"],
    ["charges", "[{\"_id\":\"dc-service\",\"name\":\"Service\",\"value\":5,\"type\":\"fixed\"},{\"id\":\"mc-pack\",\"name\":\"Packing\",\"value\":10,\"type\":\"fixed\"}]"],
  ];

  it("default path, dynamic pricing OFF — the exact dispatch + localStorage sequence", async () => {
    const { menu, actions, writes } = await record((fetchMenu) =>
      fetchMenu("t2", false, false, PIPELINE),
    );
    expect(menu.categories?.length).toBeGreaterThan(0);
    expect(actions.map((action) => action.type)).toEqual(DEFAULT_TYPES_DP_OFF);
    expect(actions.map((action) => digest(action.payload))).toEqual(DEFAULT_DIGESTS_DP_OFF);
    expect(writes).toEqual(DEFAULT_WRITES_DP_OFF);
  });

  it("default path, dynamic pricing ON — the exact dispatch + localStorage sequence", async () => {
    store.dispatch(setIsDynamicPricingEnabled(true));
    const { menu, actions, writes } = await record((fetchMenu) =>
      fetchMenu("t2", false, false, PIPELINE),
    );
    expect(menu.categories?.length).toBeGreaterThan(0);
    expect(actions.map((action) => action.type)).toEqual(DEFAULT_TYPES_DP_ON);
    expect(actions.map((action) => digest(action.payload))).toEqual(DEFAULT_DIGESTS_DP_ON);
    expect(writes).toEqual(DEFAULT_WRITES_DP_ON);
  });

  it("C1b: a stale localStorage mirror over an empty store (a logout purge) — redux wins, only the menu charge", async () => {
    store.dispatch(setDeploymentCharges([]));
    expect(window.localStorage.getItem("deploymentCharges")).toBe(JSON.stringify([DEPLOYMENT_CHARGE]));

    const { actions, writes } = await record((fetchMenu) =>
      fetchMenu("t2", false, false, PIPELINE),
    );

    const packing = { id: "mc-pack", name: "Packing", value: 10, type: "fixed" };
    expect(actions.find(pushCharges.match)?.payload).toEqual([packing]);
    expect(writes).toContainEqual(["charges", JSON.stringify([packing])]);
  });

  /** A staged fetch: what reached apply / mirror, and what leaked to the store / localStorage. */
  const stagedFetch = async (
    opts: { deploymentCharges?: unknown[]; requireOffers?: boolean } = {},
  ) => {
    const staged: UnknownAction[] = [];
    const mirrored: Write[] = [];
    const leaked = await record((fetchMenu) =>
      fetchMenu("t2", false, false, PIPELINE, {
        apply: (action) => staged.push(action),
        mirror: (key, value) => mirrored.push([key, value]),
        ...opts,
      }),
    );
    return { ...leaked, staged, mirrored };
  };

  it("staged: NOTHING reaches the store or localStorage; apply/mirror get the default sequence", async () => {
    const { menu, actions, writes, staged, mirrored } = await stagedFetch({
      deploymentCharges: [DEPLOYMENT_CHARGE],
      requireOffers: true,
    });

    expect(menu.categories?.length).toBeGreaterThan(0);
    expect(actions).toEqual([]);
    expect(writes).toEqual([]);
    expect(staged.map((action) => action.type)).toEqual(DEFAULT_TYPES_DP_OFF);
    expect(staged.map((action) => digest(action.payload))).toEqual(DEFAULT_DIGESTS_DP_OFF);
    // The listener-middleware write (currentSession) happens at commit time.
    expect(mirrored).toEqual(DEFAULT_WRITES_DP_OFF.filter(([key]) => key !== "currentSession"));
  });

  it("staged: deployment charges from opts (never localStorage), menu charges by the TARGET's tab type", async () => {
    // The render-time tab type is the stale "table" (no menu charges).
    store.dispatch(setTabType("table"));
    const { staged, mirrored, writes } = await stagedFetch({ deploymentCharges: [] });

    const packing = { id: "mc-pack", name: "Packing", value: 10, type: "fixed" };
    expect(staged.find(pushCharges.match)?.payload).toEqual([packing]);
    expect(mirrored).toContainEqual(["charges", JSON.stringify([packing])]);
    expect(writes).toEqual([]);
  });

  it("staged + requireOffers: an offers failure resolves {} and stages nothing past the offers fetch (D1b)", async () => {
    net.offersBody = () => Promise.reject({ status: 400 });
    const { menu, actions, staged, mirrored } = await stagedFetch({
      deploymentCharges: [],
      requireOffers: true,
    });

    expect(menu).toEqual({});
    expect(actions).toEqual([]);
    expect(staged.some(setOffersFetchFailed.match)).toBe(true);
    expect(staged.some(setEntityMap.match)).toBe(false);
    expect(mirrored.map(([key]) => key)).toEqual(["dpItemsMap"]);
  });

  it("staged: a dynamic-pricing failure prices regular (D1c), never the current pipeline's map", async () => {
    store.dispatch(setIsDynamicPricingEnabled(true));
    // The CURRENT pipeline's DP map (what the render-time selector holds).
    store.dispatch(setDpItemsMap({ [CHEESE_BURGER]: { status: "active", modifiedRate: 3 } }));
    // The items call blows up inside fetchDpItems (caught there → undefined).
    net.dpItems = () => Promise.reject(new Error("dp items down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { menu, staged } = await stagedFetch({ deploymentCharges: [] });

    expect(menu.categories?.length).toBeGreaterThan(0);
    const priceIn = (actions: UnknownAction[]) =>
      (actions.find(setEntityMap.match)?.payload as { entityMap: Record<string, { price: number }> })
        .entityMap[CHEESE_BURGER].price;
    expect(priceIn(staged)).toBe(8);
    // The default path keeps its fork-parity fallback to the stored map.
    const unstaged = await record((fetchMenu) => fetchMenu("t2", false, false, PIPELINE));
    expect(priceIn(unstaged.actions)).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * Lane figma-polish S3 (MONEY) — the menu charges follow the tab type of
 * the pipeline being FETCHED. /second dispatches setTabType and calls
 * fetchMenu in the same tick, so the render-time getter still held the
 * PREVIOUS session's type: a guest after a "table" session got no menu
 * charges, and the reverse applied charges a table order must not carry.
 * Only a caller with no pipeline row (BagSheet's fetchMenu(tab, true,
 * false, true)) still falls back to the stored tab type.
 * ------------------------------------------------------------------ */

describe("fetchMenu — menu charges follow the FETCHED pipeline's tab_type (S3 MONEY)", () => {
  const PACKING = { id: "mc-pack", name: "Packing", value: 10, type: "fixed" };
  const TAKE_AWAY = { _id: "p-take", tab_id: "t2", tab_type: "take_away" };
  const TABLE = { _id: "p-table", tab_id: "t1", tab_type: "table" };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    window.localStorage.clear();
    net.realHooks = false;
    net.serverTime = () => Promise.resolve({ serverTime: "2026-10-07T12:00:00.000Z" });
    net.menu = () =>
      Promise.resolve(tenantMenu());
    net.outOfStock = () => Promise.resolve([]);
    net.mockCapture.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** One fetch with `stored` as the store's (previous session's) tab type. */
  const chargesAfter = async (
    stored: string,
    run: (fetchMenu: ReturnType<typeof useMenuConverters>["fetchMenu"]) => Promise<unknown>,
  ) => {
    store.dispatch(setTabType(stored));
    const dispatch = vi.spyOn(store, "dispatch");
    const { result } = renderHook(() => useMenuConverters(), { wrapper });
    dispatch.mockClear();
    let menu: unknown;
    await act(async () => {
      menu = await run(result.current.fetchMenu);
    });
    const actions = dispatch.mock.calls.map(([action]) => action as UnknownAction);
    return {
      menu: menu as { categories?: unknown[] },
      menuCharges: (actions.find(setMenuCharges.match)?.payload as { menuCharges?: unknown } | undefined)
        ?.menuCharges,
      pushed: actions.find(pushCharges.match)?.payload,
    };
  };

  it("store still 'table' (the previous session), /second fetches a take_away pipeline → the menu charges are applied", async () => {
    const { menu, menuCharges, pushed } = await chargesAfter("table", (fetchMenu) =>
      fetchMenu("t2", false, false, TAKE_AWAY),
    );

    expect(menu.categories?.length).toBeGreaterThan(0);
    expect(menuCharges).toEqual([PACKING]);
    expect(pushed).toEqual([PACKING]);
    expect(window.localStorage.getItem("menuCharges")).toBe(JSON.stringify([PACKING]));
  });

  it("store 'take_away' (the previous session), a 'table' pipeline fetched → NO menu charges", async () => {
    const { menu, menuCharges, pushed } = await chargesAfter("take_away", (fetchMenu) =>
      fetchMenu("t1", false, false, TABLE),
    );

    expect(menu.categories?.length).toBeGreaterThan(0);
    expect(menuCharges).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it.each([
    ["table", []],
    ["take_away", [PACKING]],
  ])("BagSheet's fetchMenu(tab, true, false, true) — no pipeline row — still uses the STORED tab type (%s)", async (stored, expected) => {
    const { menuCharges } = await chargesAfter(stored, (fetchMenu) => fetchMenu("t2", true, false, true));

    expect(menuCharges).toEqual(expected);
  });

  it("the staged (opts) path is unchanged: the TARGET's 'table' wins over a stored take_away, and nothing reaches the store", async () => {
    const staged: UnknownAction[] = [];
    const { menuCharges, pushed } = await chargesAfter("take_away", (fetchMenu) =>
      fetchMenu("t1", false, false, TABLE, {
        apply: (action) => staged.push(action),
        mirror: () => {},
        deploymentCharges: [],
      }),
    );

    expect(menuCharges).toBeUndefined();
    expect(pushed).toBeUndefined();
    expect((staged.find(setMenuCharges.match)?.payload as { menuCharges?: unknown }).menuCharges).toEqual([]);
    expect(staged.find(pushCharges.match)?.payload).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Low-end perf pass (2026-10-16). BOOT-1: in production every
 * menu-scale payload reaches the store frozen at its ROOT, so Immer's
 * autoFreeze stops there instead of walking the whole menu; DEV keeps the
 * deep freeze. BOOT-2: the requests that need no cached menu id start
 * before the Dexie read. BOOT-4: the Dexie cache write is not awaited.
 * ------------------------------------------------------------------ */

describe("fetchMenu — low-end perf pass (BOOT-1, BOOT-2, BOOT-4)", () => {
  /** Every menu-scale state.menu key fetchMenu writes. */
  const MENU_ROOTS = [
    "entityMap",
    "modifiersMap",
    "menuBasedOnCategory",
    "entityModifierMap",
    "categoryMap",
    "subCategoryMap",
    "subCategoryMapWhichContainsTopLevelCategoryIdAndName",
    "inActiveEntities",
    "inaActiveVariants",
    "menuEntityObject",
    "variantObject",
    "menu",
  ];

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    window.localStorage.clear();
    net.realHooks = false;
    net.serverTime = () => Promise.resolve({ serverTime: "2026-10-07T12:00:00.000Z" });
    net.menu = () => Promise.resolve(tenantMenu());
    net.outOfStock = () => Promise.resolve([]);
    net.dexieGet = () => Promise.resolve(undefined);
    net.dexiePut = () => Promise.resolve();
    net.started.length = 0;
    net.mockCapture.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    net.dexieGet = () => Promise.resolve(undefined);
    net.dexiePut = () => Promise.resolve();
  });

  const fetchOnce = async () => {
    const { result } = renderHook(() => useMenuConverters(), { wrapper });
    let menu: unknown;
    await act(async () => {
      menu = await result.current.fetchMenu("t2", false, false, PIPELINE);
    });
    return menu as { categories?: unknown[] };
  };

  /** Per root: is it frozen, and how many of the objects directly inside it are. */
  const freezeShape = () => {
    const menuState = (store.getState() as unknown as { menu: Record<string, object> }).menu;
    return MENU_ROOTS.map((key) => {
      const inside = Object.values(menuState[key] ?? {}).filter(
        (value): value is object => typeof value === "object" && value !== null,
      );
      return {
        key,
        frozen: Object.isFrozen(menuState[key]),
        inside: inside.length,
        frozenInside: inside.filter((value) => Object.isFrozen(value)).length,
      };
    });
  };

  it.each([true, false])(
    "BOOT-1 (one category at a time %s): production freezes every root and nothing inside it; DEV keeps the deep freeze",
    async (oneAtATime) => {
      store.dispatch(setOneCategoryAtATime(oneAtATime));
      vi.stubEnv("DEV", false);
      expect((await fetchOnce()).categories?.length).toBeGreaterThan(0);

      const production = freezeShape();
      expect(production.filter((root) => !root.frozen)).toEqual([]);
      expect(production.reduce((sum, root) => sum + root.inside, 0)).toBeGreaterThan(0);
      // Any frozen object here means Immer walked into that root — the
      // root itself, or one sharing its objects, reached the store unfrozen.
      // The slim fixture has no variants and no inactive entities, so the
      // variant and inactive roots are empty here: their frozenRoot wraps are
      // pinned by review, not by this assertion (a miss costs speed only).
      expect(production.filter((root) => root.frozenInside > 0)).toEqual([]);

      // DEV (unit tests, the e2e dev server): today's deep freeze, unchanged.
      vi.unstubAllEnvs();
      store.dispatch({ type: "RESET_STATE" });
      store.dispatch(setOneCategoryAtATime(oneAtATime));
      await fetchOnce();
      expect(freezeShape().filter((root) => !root.frozen || root.frozenInside !== root.inside)).toEqual([]);
    },
  );

  it("BOOT-2: out of stock, server time, offers and DP sessions start before the Dexie read; getMenu waits for the cached id", async () => {
    store.dispatch(setIsDynamicPricingEnabled(true));
    let readCache!: (row: unknown) => void;
    net.dexieGet = () =>
      new Promise((resolve) => {
        readCache = resolve;
      });
    const menuArgs: unknown[] = [];
    net.menu = (args) => {
      menuArgs.push(args);
      return Promise.resolve({ status: 304 });
    };
    const { result } = renderHook(() => useMenuConverters(), { wrapper });

    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.fetchMenu("t2", false, false, PIPELINE);
    });
    // The cache read is still pending: only getMenu has not started.
    expect(net.started).toEqual(["outOfStock", "serverTime", "offers", "dpSessions", "dexieGet"]);

    await act(async () => {
      readCache({ tabId: "t2", menuId: "menu-7", menu: tenantMenu() });
      await pending;
    });
    expect(net.started.at(-1)).toBe("getMenu");
    expect(menuArgs).toEqual([expect.objectContaining({ tab_id: "t2", MENU_ID: "menu-7" })]);
    // 304 → the cached menu is converted.
    await expect(pending).resolves.toEqual(expect.objectContaining({ categories: expect.any(Array) }));
  });

  it("BOOT-2: a request failing while the Dexie read is pending is no unhandled rejection — the fetch still resolves {} and reports it", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let readCache!: (row: unknown) => void;
      net.dexieGet = () =>
        new Promise((resolve) => {
          readCache = resolve;
        });
      net.outOfStock = () =>
        Promise.reject({ status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" });
      const { result } = renderHook(() => useMenuConverters(), { wrapper });

      let pending!: Promise<unknown>;
      await act(async () => {
        pending = result.current.fetchMenu("t2", false, false, PIPELINE);
        // A macrotask: Node reports a rejection nobody handles by now.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => {
        readCache(undefined);
        await pending;
      });

      await expect(pending).resolves.toEqual({});
      expect(unhandled).not.toHaveBeenCalled();
      expect(menuFetchEvents()).toEqual([
        { error_source: "menu_fetch", error_status: "TIMEOUT_ERROR", error_detail: "TimeoutError: signal timed out" },
      ]);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("BOOT-4: a changed menu (200) resolves without waiting for the Dexie cache write; a failed write stays silent", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const rows: unknown[] = [];
      let failWrite!: (error: unknown) => void;
      net.dexiePut = (row) => {
        rows.push(row);
        return new Promise((_resolve, reject) => {
          failWrite = reject;
        });
      };
      const served = { ...tenantMenu(), MENU_ID: "menu-8" };
      net.menu = () => Promise.resolve(served);
      const { result } = renderHook(() => useMenuConverters(), { wrapper });

      let menu: unknown = "pending";
      await act(async () => {
        void result.current.fetchMenu("t2", false, false, PIPELINE).then((value) => {
          menu = value;
        });
        // The write never commits here: an awaited put would hold the menu.
        await vi.waitFor(() => expect(menu).not.toBe("pending"));
      });
      expect(menu).toEqual(expect.objectContaining({ categories: expect.any(Array) }));
      expect(rows).toEqual([{ tabId: "t2", menuId: "menu-8", menu: served }]);

      await act(async () => {
        failWrite(new Error("QuotaExceededError"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(unhandled).not.toHaveBeenCalled();
      expect(menuFetchEvents()).toEqual([]);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
