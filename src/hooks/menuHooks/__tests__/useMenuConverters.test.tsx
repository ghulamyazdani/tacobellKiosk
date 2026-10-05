import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../../redux/app/store";
import useMenuConverters from "../useMenuConverters";

/*
  fetchMenu's failure signal (P9b R8). It resolves {} on EVERY failure —
  fork parity, the callers judge the returned categories — and the cause,
  which used to be a console.error nobody reads on an unattended kiosk, is
  now an analytics event. Seams: the three RTK triggers in the fetch's
  Promise.all, offers, dynamic pricing and the Dexie menu cache.
*/

const net = vi.hoisted(() => ({
  menu: (): Promise<unknown> => Promise.resolve({}),
  outOfStock: (): Promise<unknown> => Promise.resolve([]),
  mockCapture: vi.fn(),
}));

vi.mock("@cx-sdk/catalog/services/menuApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/menuApi")>()),
  useGetMenuMutation: () => [() => ({ unwrap: () => net.menu() }), { isLoading: false }],
}));

vi.mock("@cx-sdk/catalog/services/outOfStockApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/outOfStockApi")>()),
  useGetOutOfStockMutation: () => [() => ({ unwrap: () => net.outOfStock() })],
}));

vi.mock("@cx-sdk/catalog/services/settingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cx-sdk/catalog/services/settingsApi")>()),
  useLazyGetServerTimeQuery: () => [() => ({ unwrap: () => Promise.resolve({}) })],
}));

vi.mock("../../offerHooks/useOfferHook", () => ({
  default: () => ({ getCxOffers: () => Promise.resolve(null) }),
}));

vi.mock("../../dynamicPricingHooks/useDynamicPricing", () => ({
  default: () => ({
    fetchDpSessions: () => Promise.resolve([]),
    fetchDpItems: () => Promise.resolve({}),
  }),
}));

vi.mock("../../../models/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../models/db")>()),
  db: { menus: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() } },
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
