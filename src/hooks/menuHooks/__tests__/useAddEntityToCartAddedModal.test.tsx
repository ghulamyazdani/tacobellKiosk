import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCurrentSession } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { store } from "../../../redux/app/store";
import {
  mutateAddToCartModal,
  selectAddToCartItem,
  selectAddToCartModal,
} from "../../../redux/features/menuSelections/menuSelections.slice";
import useAddEntityToCart from "../useAddEntityToCart";

/*
  User 2026-10-14: "item added modal should also come when normal item
  without customization is added". A menu add of a plain item confirms with
  the product-added modal whether it punches a new row or bumps the row the
  bag already has (+1); a caller that confirms by itself passes
  suppressAddedModal (the bag's Complete Your Meal, the PDP and rewards
  rails) and gets no modal on either path.
  Seams: navigation, and the Dexie cart mirror (no IndexedDB in jsdom).
*/

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

vi.mock("../../cartHooks/useCartIndexedDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cartHooks/useCartIndexedDb")>();
  return {
    ...actual,
    default: () => ({
      ...actual.default(),
      addToIndexedDbCart: () => Promise.resolve(),
      increaseItemQuantityByIdIndexedDb: () => Promise.resolve(),
    }),
  };
});

/** Plain, no recommendations → the one-tap "add" intent. */
const SAUCE = { id: "sauce", name: "Tortilla Sauce", price: 2 } as unknown as RecommendedEntity;

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);
const rows = () =>
  (store.getState() as unknown as { cart: { cartItems: { id: string; quantity: number }[] } }).cart.cartItems;
const modalOpen = () => selectAddToCartModal(store.getState());

const add = (options?: { suppressAddedModal?: boolean }) => {
  const { result } = renderHook(() => useAddEntityToCart(), { wrapper });
  let landed: unknown;
  act(() => {
    landed = result.current.addEntity(SAUCE, options);
  });
  return landed;
};

describe("useAddEntityToCart — a plain add confirms with the added modal (user 2026-10-14)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("a new row: lands, and the modal opens on it", () => {
    expect(add()).toBe(true);

    expect(rows()).toEqual([expect.objectContaining({ id: SAUCE.id, quantity: 1 })]);
    expect(modalOpen()).toBe(true);
    expect(selectAddToCartItem(store.getState())).toMatchObject({ id: SAUCE.id });
  });

  it("+1 on the row the bag already has: the same row bumps to 2, and the modal opens on the item", () => {
    expect(add()).toBe(true);
    act(() => {
      store.dispatch(mutateAddToCartModal(false)); // GOT IT
    });
    expect(modalOpen()).toBe(false);

    expect(add()).toBe(true);

    expect(rows()).toEqual([expect.objectContaining({ id: SAUCE.id, quantity: 2 })]);
    expect(modalOpen()).toBe(true);
    expect(selectAddToCartItem(store.getState())).toMatchObject({ id: SAUCE.id });
  });

  it("suppressAddedModal (a surface that confirms by itself): neither the new row nor the +1 opens it", () => {
    expect(add({ suppressAddedModal: true })).toBe(true);
    expect(modalOpen()).toBe(false);

    expect(add({ suppressAddedModal: true })).toBe(true);

    expect(rows()).toEqual([expect.objectContaining({ id: SAUCE.id, quantity: 2 })]);
    expect(modalOpen()).toBe(false);
  });

  it("a +1 the DP session cap refuses opens nothing (nothing landed)", () => {
    store.dispatch(setCurrentSession({ _id: "dp-lunch", sessionName: "Lunch", _extras: { maxQtyItem: "1" } }));
    store.dispatch(setCartItems([{ ...SAUCE, itemId: "1_sauce", quantity: 1, type: "ITEM", isDpItem: true }]));

    expect(add()).toBe(false);

    expect(rows()).toEqual([expect.objectContaining({ id: SAUCE.id, quantity: 1 })]);
    expect(modalOpen()).toBe(false);
  });
});
