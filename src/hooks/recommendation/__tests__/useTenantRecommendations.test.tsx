import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { setReccomendationCategoryMap } from "@cx-sdk/catalog/state/recommendation.slice";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setFilters } from "@cx-sdk/catalog/state/filter.slice";
import { store } from "../../../redux/app/store";
import { setOutOfStockItems } from "../../../redux/features/menuSelections/menuSelections.slice";
import useTenantRecommendations, {
  tenantRecommendationsUrl,
  useTenantRailItems,
} from "../useTenantRecommendations";

/*
  Post-P9 29a/29b — the app half of the tenant (S3) recommendations: the URL
  (VITE_TENANT_RECOMMENDATIONS_URL, empty = off, plus the DEV-only
  window.__TB_RECS_URL__ seam), a RAW bounded fetch that never goes through
  the RTK transport (it would send the kiosk's auth headers to S3), the map in
  redux memory + Dexie (never redux-persist), and the bag-rail selector.
  fake-indexeddb is not installed: Dexie is an in-memory stub.
*/

const { dexie, mockCapture } = vi.hoisted(() => ({
  dexie: {
    rows: new Map<string, unknown>(),
    put: vi.fn(),
    get: vi.fn(),
  },
  mockCapture: vi.fn(),
}));

vi.mock("../../../models/db", () => ({
  db: {
    recommendations: {
      put: (row: unknown) => dexie.put(row),
      get: (key: string) => dexie.get(key),
    },
  },
  resetDatabase: () => Promise.resolve(),
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

const URL_A = "https://recommendations.e2e.test/a.json";
const URL_B = "https://recommendations.e2e.test/b.json";
const BODY = {
  data: [
    {
      _id: "row",
      deployment_id: "dep",
      baseItem_id: "burger",
      refers: [{ refer_baseItem_id: "fries", occurrences: 5, referItem_name: "Large Fries" }],
    },
  ],
};
const MAP = { burger: { baseItem_id: "burger", refers: [{ refer_baseItem_id: "fries", occurrences: 5 }] } };
const LIVE_MAP = { taco: { baseItem_id: "taco", refers: [{ refer_baseItem_id: "salad", occurrences: 1 }] } };

type Seam = { __TB_RECS_URL__?: unknown };
const seam = window as unknown as Seam;

const fetchMock = vi.fn();
const answer = (status: number, body: unknown = BODY) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
const hook = () => renderHook(() => useTenantRecommendations(), { wrapper }).result.current;
const mapNow = () =>
  (store.getState() as { recommendation: { recommendCategoryMap: unknown } }).recommendation.recommendCategoryMap;
const events = () => mockCapture.mock.calls.map(([name, props]) => ({ name, ...(props as object) }));
const fetchInit = (call = 0) => fetchMock.mock.calls[call][1] as RequestInit;

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  dexie.rows.clear();
  dexie.put.mockReset();
  dexie.put.mockImplementation((row: { key: string }) => {
    dexie.rows.set(row.key, row);
    return Promise.resolve(row.key);
  });
  dexie.get.mockReset();
  dexie.get.mockImplementation((key: string) => Promise.resolve(dexie.rows.get(key)));
  mockCapture.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", "");
  delete seam.__TB_RECS_URL__;
});

afterEach(() => {
  delete seam.__TB_RECS_URL__;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("tenantRecommendationsUrl", () => {
  it("empty = off: no env value and no seam", () => {
    expect(tenantRecommendationsUrl()).toBe("");
  });

  it("reads VITE_TENANT_RECOMMENDATIONS_URL, trimmed", () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", `  ${URL_A} `);

    expect(tenantRecommendationsUrl()).toBe(URL_A);
  });

  it("the DEV seam window.__TB_RECS_URL__ is read first; '' forces off; a non-string is off", () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);

    seam.__TB_RECS_URL__ = ` ${URL_B} `;
    expect(tenantRecommendationsUrl()).toBe(URL_B);
    seam.__TB_RECS_URL__ = "";
    expect(tenantRecommendationsUrl()).toBe("");
    seam.__TB_RECS_URL__ = 5;
    expect(tenantRecommendationsUrl()).toBe("");
  });
});

describe("refresh", () => {
  it("no URL → no fetch, nothing dispatched or stored", async () => {
    await hook().refresh();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mapNow()).toEqual({});
    expect(dexie.put).not.toHaveBeenCalled();
  });

  it("the DEV seam alone turns it on", async () => {
    seam.__TB_RECS_URL__ = URL_B;
    fetchMock.mockImplementation(() => answer(200));

    await hook().refresh();

    expect(fetchMock).toHaveBeenCalledWith(URL_B, expect.any(Object));
  });

  it("200 → the normalised map is dispatched and put in Dexie with its source url", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_700_000_000_000);
    fetchMock.mockImplementation(() => answer(200));

    await hook().refresh();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mapNow()).toEqual(MAP);
    expect(dexie.put).toHaveBeenCalledTimes(1);
    expect(dexie.put).toHaveBeenCalledWith({ key: "latest", map: MAP, url: URL_A, fetchedAt: 1_700_000_000_000 });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("the request is a raw, credential-less fetch: credentials 'omit', no auth headers, bounded by a signal", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    fetchMock.mockImplementation(() => answer(200));

    await hook().refresh();

    const [url, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect(url).toBe(URL_A);
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-cache");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toBeUndefined();
    const headers = new Headers(init.headers);
    for (const name of ["authorization", "x-access-token", "login_code"]) {
      expect(headers.has(name)).toBe(false);
    }
  });

  it("a 5xx is retried once, then reported; nothing is dispatched", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    store.dispatch(setReccomendationCategoryMap(LIVE_MAP));
    fetchMock.mockImplementation(() => answer(503));

    await hook().refresh();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchInit(1).signal).not.toBe(fetchInit(0).signal); // a fresh attempt
    expect(events()).toEqual([
      { name: "error_occurred", error_source: "recommendations_fetch", error_status: "503", timed_out: false },
    ]);
    expect(mapNow()).toEqual(LIVE_MAP);
    expect(dexie.put).not.toHaveBeenCalled();
  });

  it("a 404 is not retried", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    fetchMock.mockImplementation(() => answer(404));

    await hook().refresh();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([
      { name: "error_occurred", error_source: "recommendations_fetch", error_status: "404", timed_out: false },
    ]);
    expect(mapNow()).toEqual({});
  });

  it("a timeout (10 s × 2 attempts) emits ErrorOccurred {recommendations_fetch, timed_out: true} and dispatches nothing", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {})); // the network never answers
    const dispatch = vi.spyOn(store, "dispatch");

    let settled = false;
    const run = hook().refresh().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10_000 + 400 + 10_000 - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events()).toEqual([
      {
        name: "error_occurred",
        error_source: "recommendations_fetch",
        error_status: "TimeoutError",
        timed_out: true,
      },
    ]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(dexie.put).not.toHaveBeenCalled();
  });

  it("a network failure or bad JSON is reported and never rejects", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("bad json")) })
    );

    await expect(hook().refresh()).resolves.toBeUndefined();
    expect(events()).toEqual([
      { name: "error_occurred", error_source: "recommendations_fetch", error_status: "SyntaxError", timed_out: false },
    ]);
  });

  it.each<[string, unknown]>([
    ["an empty list", { data: [] }],
    ["a reshaped body", { recommendations: BODY.data }],
    ["junk", "x"],
  ])("%s keeps the old map (memory and Dexie) and is reported as empty_body", async (_label, body) => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    store.dispatch(setReccomendationCategoryMap(LIVE_MAP));
    fetchMock.mockImplementation(() => answer(200, body));

    await hook().refresh();

    expect(mapNow()).toEqual(LIVE_MAP);
    expect(dexie.put).not.toHaveBeenCalled();
    expect(events()).toEqual([
      { name: "error_occurred", error_source: "recommendations_fetch", error_status: "empty_body", timed_out: false },
    ]);
  });

  it("a db.put failure emits a recommendations_cache event — but the map is still dispatched", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    fetchMock.mockImplementation(() => answer(200));
    dexie.put.mockImplementation(() => Promise.reject(new DOMException("quota", "QuotaExceededError")));

    await expect(hook().refresh()).resolves.toBeUndefined();

    expect(mapNow()).toEqual(MAP);
    expect(events()).toEqual([
      {
        name: "error_occurred",
        error_source: "recommendations_cache",
        error_status: "QuotaExceededError",
        timed_out: false,
      },
    ]);
  });
});

describe("loadCached", () => {
  const cache = (row: object) => dexie.rows.set("latest", { key: "latest", fetchedAt: 1, ...row });

  it("loads a valid cached map of the current URL, re-validated", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    cache({ url: URL_A, map: { ...MAP, junk: { baseItem_id: "junk", refers: [] } } });

    await hook().loadCached();

    expect(dexie.get).toHaveBeenCalledWith("latest");
    expect(mapNow()).toEqual(MAP);
  });

  it("skips when a live map is already in the store", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    store.dispatch(setReccomendationCategoryMap(LIVE_MAP));
    cache({ url: URL_A, map: MAP });

    await hook().loadCached();

    expect(mapNow()).toEqual(LIVE_MAP);
  });

  it("skips when the live map lands DURING the Dexie await (the boot's fresh map wins)", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    cache({ url: URL_A, map: MAP });
    let release!: () => void;
    dexie.get.mockImplementation(
      (key: string) =>
        new Promise((resolve) => {
          release = () => resolve(dexie.rows.get(key));
        })
    );

    const loading = hook().loadCached();
    store.dispatch(setReccomendationCategoryMap(LIVE_MAP)); // the boot's refresh lands first
    release();
    await loading;

    expect(mapNow()).toEqual(LIVE_MAP);
  });

  it.each<[string, object]>([
    ["a copy of another URL", { url: URL_B, map: MAP }],
    ["a copy without a url (an older shape)", { map: MAP }],
    ["an empty or junk copy", { url: URL_A, map: { junk: { baseItem_id: "junk", refers: [] } } }],
  ])("ignores %s", async (_label, row) => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    cache(row);

    await hook().loadCached();

    expect(mapNow()).toEqual({});
  });

  it("with the URL off it never reads Dexie", async () => {
    cache({ url: "", map: MAP });

    await hook().loadCached();

    expect(dexie.get).not.toHaveBeenCalled();
    expect(mapNow()).toEqual({});
  });

  it("never throws: a Dexie failure is reported", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    dexie.get.mockImplementation(() => Promise.reject(new Error("idb gone")));

    await expect(hook().loadCached()).resolves.toBeUndefined();

    expect(events()).toEqual([
      { name: "error_occurred", error_source: "recommendations_cache", error_status: "Error", timed_out: false },
    ]);
    expect(mapNow()).toEqual({});
  });

  it("round trip: what refresh stored, a relaunch's loadCached replays", async () => {
    vi.stubEnv("VITE_TENANT_RECOMMENDATIONS_URL", URL_A);
    fetchMock.mockImplementation(() => answer(200));
    await hook().refresh();
    store.dispatch(setReccomendationCategoryMap({})); // the relaunch: memory is empty

    await hook().loadCached();

    expect(mapNow()).toEqual(MAP);
  });
});

describe("the hook's callbacks", () => {
  it("refresh and loadCached are referentially stable across renders", () => {
    const { result, rerender } = renderHook(() => useTenantRecommendations(), { wrapper });
    const first = result.current;

    rerender();
    act(() => {
      store.dispatch({ type: "unrelated/write" });
    });

    expect(result.current.refresh).toBe(first.refresh);
    expect(result.current.loadCached).toBe(first.loadCached);
  });
});

describe("useTenantRailItems", () => {
  const seed = () => {
    store.dispatch(
      setEntityMap({
        entityMap: {
          burger: { id: "burger", name: "Cheese Burger", price: 8, isActive: true },
          fries: { id: "fries", name: "Large Fries", price: 2.5, isActive: true },
        },
      })
    );
    store.dispatch(
      setCartItems([{ id: "burger", itemId: "b-1", name: "Cheese Burger", quantity: 1, type: "ITEM", total_price: 8 }])
    );
    store.dispatch(setReccomendationCategoryMap(MAP));
  };

  it("ranks the tenant map against the cart", () => {
    seed();
    const { result } = renderHook(() => useTenantRailItems(), { wrapper });

    expect(result.current.map((e) => e.id)).toEqual(["fries"]);
    expect(result.current[0].isDirectlyAddable).toBe(true);
  });

  it("returns [] (one shared array) when enable_cart_upsell_screen is false (D7)", () => {
    seed();
    store.dispatch(setKioskSettings({ enable_cart_upsell_screen: false }));
    const { result, rerender } = renderHook(() => useTenantRailItems(), { wrapper });
    const first = result.current;

    rerender();

    expect(first).toEqual([]);
    expect(result.current).toBe(first);
  });

  // The selector's wiring: the store's live inputs reach the ranking (the SDK
  // suite covers the rules themselves).
  it("drops an item the store's live out-of-stock map marks inStock:false", () => {
    seed();
    store.dispatch(setOutOfStockItems({ fries: { inStock: false } }));
    const { result } = renderHook(() => useTenantRailItems(), { wrapper });

    expect(result.current).toEqual([]);
  });

  it("drops an item the store's active tag filter hides", () => {
    seed();
    store.dispatch(setFilters(["veg"]));
    const { result } = renderHook(() => useTenantRailItems(), { wrapper });

    expect(result.current).toEqual([]);
  });

  it("enable_combo_upsell from the store makes a combo-upsell item NOT one-tap", () => {
    seed();
    store.dispatch(
      setEntityMap({
        entityMap: {
          burger: { id: "burger", name: "Cheese Burger", price: 8, isActive: true },
          fries: { id: "fries", name: "Large Fries", price: 2.5, isActive: true, upsellItems: [{ id: "meal" }] },
        },
      })
    );
    store.dispatch(setKioskSettings({ enable_combo_upsell: true }));
    const { result } = renderHook(() => useTenantRailItems(), { wrapper });

    expect(result.current.map((e) => [e.id, e.isDirectlyAddable])).toEqual([["fries", false]]);
  });
});
