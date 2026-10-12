import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  selectErrorMessageGlobal,
  selectShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setCurrentSession } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import useCartHook from "../useCartHook";
import i18n from "../../../i18n";

/*
  Lane figma-polish G1 — the dynamic-pricing session cap. A rejected add /
  update / increase raises the GLOBAL error (now visible: GlobalErrorHost)
  with TRANSLATED copy — t("toast.dpMaxQuantity", {count, session}) through
  i18n.t (the hook must not subscribe its dozens of hosts to language
  changes); the SDK's English buildDpMaxQuantityErrorMessage stays for the
  fork. The rejection returns false and writes nothing. `count` is the cap
  as a NUMBER (residual R4), so i18next picks the plural form: EN _one /
  _other, AR zero / one / two / few / many / other.
  Seam: the Dexie cart mirror (no IndexedDB in jsdom).
*/

vi.mock("../../cartHooks/useCartIndexedDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cartHooks/useCartIndexedDb")>();
  return {
    ...actual,
    default: () => ({
      ...actual.default(),
      addToIndexedDbCart: () => Promise.resolve(),
      updateItemIndexedDbCart: () => Promise.resolve(),
      increaseItemQuantityByIdIndexedDb: () => Promise.resolve(),
    }),
  };
});

const LUNCH = { _id: "dp-lunch", sessionName: "Lunch", _extras: { maxQtyItem: "2" } };
/** Two DP units already in the bag — the session cap is full. */
const TACOS = { id: "taco", itemId: "t-1", name: "Taco", quantity: 2, type: "ITEM", isDpItem: true, price: 4, total_price: 4 };
const BURRITO = { id: "burrito", name: "Burrito", quantity: 1, type: "ITEM", isDpItem: true, price: 6, total_price: 6 };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);
const cartItems = () => (store.getState() as unknown as { cart: { cartItems: unknown[] } }).cart.cartItems;
const ENGLISH = "You can add up to 2 items during the Lunch session";

describe("useCartHook — the DP session cap raises translated copy (G1)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrentSession(LUNCH));
    store.dispatch(setCartItems([{ ...TACOS }]));
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it.each([
    ["addItemToCart", (hook: ReturnType<typeof useCartHook>) => hook.addItemToCart({ ...BURRITO }, "ITEM")],
    ["updateItemCart", (hook: ReturnType<typeof useCartHook>) => hook.updateItemCart({ ...TACOS, quantity: 3 })],
    [
      "IncreaseItemQuantityById",
      (hook: ReturnType<typeof useCartHook>) => hook.IncreaseItemQuantityById("t-1", "ITEM", "itemId", { ...TACOS }),
    ],
  ])("%s over the cap: returns false, leaves the cart unchanged, and raises the exact EN copy", (_path, run) => {
    const { result } = renderHook(() => useCartHook(), { wrapper });
    const before = cartItems();

    let outcome: unknown;
    act(() => {
      outcome = run(result.current);
    });

    expect(outcome).toBe(false);
    expect(cartItems()).toBe(before);
    expect(selectShowErrorModalGlobal(store.getState())).toBe(true);
    expect(selectErrorMessageGlobal(store.getState())).toBe(ENGLISH);
    expect(i18n.t("toast.dpMaxQuantity", { count: 2, session: "Lunch" })).toBe(ENGLISH);
  });

  it("Arabic: the copy is i18n.t('toast.dpMaxQuantity') in Arabic — never the SDK's English builder", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    const { result } = renderHook(() => useCartHook(), { wrapper });

    act(() => {
      result.current.addItemToCart({ ...BURRITO }, "ITEM");
    });

    const message = selectErrorMessageGlobal(store.getState());
    expect(message).toBe(i18n.t("toast.dpMaxQuantity", { count: 2, session: "Lunch" }));
    expect(message).not.toBe(ENGLISH);
    expect(message).not.toContain("upto");
    // A cap of two is Arabic's dual ("عنصرين"), never the 3–10 plural ("عناصر").
    expect(message).toContain("عنصرين");
    expect(message).not.toContain("عناصر");
  });

  it("a cap of ONE is singular: 'You can add up to 1 item …' (was '1 items')", () => {
    store.dispatch(setCurrentSession({ ...LUNCH, _extras: { maxQtyItem: "1" } }));
    store.dispatch(setCartItems([{ ...TACOS, quantity: 1 }]));
    const { result } = renderHook(() => useCartHook(), { wrapper });

    act(() => {
      result.current.addItemToCart({ ...BURRITO }, "ITEM");
    });

    expect(selectErrorMessageGlobal(store.getState())).toBe("You can add up to 1 item during the Lunch session");
  });

  it("under the cap the add lands and nothing is raised (the gate is the cap, not the add)", () => {
    store.dispatch(setCartItems([{ ...TACOS, quantity: 1 }]));
    const { result } = renderHook(() => useCartHook(), { wrapper });

    let outcome: unknown;
    act(() => {
      outcome = result.current.addItemToCart({ ...BURRITO }, "ITEM", { suppressAddedModal: true });
    });

    expect(outcome).toBe(true);
    expect(cartItems()).toHaveLength(2);
    expect(selectShowErrorModalGlobal(store.getState())).toBe(false);
  });

  /*
    The product-added modal's ADD TO ORDER writes several rows in ONE
    handler. The check must read the LIVE cart: this render's copy predates
    the first write, so each write would be measured against it and the pair
    would hold one unit over the cap.
  */
  it("checks the LIVE cart: two writes in one handler never pass the cap together — the second sees the first", () => {
    store.dispatch(setCurrentSession({ ...LUNCH, _extras: { maxQtyItem: "3" } }));
    const { result } = renderHook(() => useCartHook(), { wrapper });

    let first: unknown;
    let second: unknown;
    act(() => {
      first = result.current.addItemToCart({ ...BURRITO }, "ITEM", { suppressAddedModal: true });
      second = result.current.addItemToCart({ ...BURRITO, id: "burrito-2" }, "ITEM", { suppressAddedModal: true });
    });

    // 2 tacos + 1 burrito = 3 ≤ 3; a second burrito would make 4.
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(cartItems()).toHaveLength(2);
    expect(selectShowErrorModalGlobal(store.getState())).toBe(true);
  });
});

/*
  Residual R4 — the plural forms themselves. EN has _one / _other; AR has all
  six CLDR forms (drafts, flagged for native review): 0 zero, 1 one, 2 two,
  3–10 few, 11–99 many, 100+ other — each its own copy, none a raw key.
*/
describe("toast.dpMaxQuantity — i18next plurals (residual R4)", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  const copy = (count: number) => i18n.t("toast.dpMaxQuantity", { count, session: "Lunch" });
  const form = (suffix: string, count: number) =>
    i18n.t(`toast.dpMaxQuantity_${suffix}`, { count, session: "Lunch" });

  it("English: 1 → _one ('1 item'), 2 and 5 → _other", () => {
    expect(copy(1)).toBe("You can add up to 1 item during the Lunch session");
    expect(copy(2)).toBe("You can add up to 2 items during the Lunch session");
    expect(copy(5)).toBe(form("other", 5));
  });

  it("Arabic: each CLDR form resolves to its own copy", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    const cases: [number, string][] = [
      [0, "zero"],
      [1, "one"],
      [2, "two"],
      [3, "few"],
      [11, "many"],
      [100, "other"],
    ];

    for (const [count, suffix] of cases) {
      expect(copy(count), `${count} → _${suffix}`).toBe(form(suffix, count));
      expect(copy(count)).not.toContain("toast.");
      expect(copy(count)).toContain("Lunch");
    }
    // Six different TEMPLATES: the rendered copy of 3 / 11 / 100 differs by the number alone.
    const templates = cases.map(([, suffix]) => i18n.getResource("ar", "translation", `toast.dpMaxQuantity_${suffix}`));
    expect(new Set(templates).size).toBe(cases.length);
  });
});
