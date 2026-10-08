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
  with TRANSLATED copy — t("toast.dpMaxQuantity", {max, session}) through
  i18n.t (the hook must not subscribe its dozens of hosts to language
  changes); the SDK's English buildDpMaxQuantityErrorMessage stays for the
  fork. The rejection returns false and writes nothing.
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
    expect(i18n.t("toast.dpMaxQuantity", { max: "2", session: "Lunch" })).toBe(ENGLISH);
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
    expect(message).toBe(i18n.t("toast.dpMaxQuantity", { max: "2", session: "Lunch" }));
    expect(message).not.toBe(ENGLISH);
    expect(message).not.toContain("upto");
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
});
