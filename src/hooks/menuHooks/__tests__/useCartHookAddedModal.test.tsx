import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setEntityMap, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import {
  mutateAddToCartModal,
  selectAddToCartItem,
  selectAddToCartModal,
  selectRecommendationDetour,
  setRecommendationDetour,
} from "../../../redux/features/menuSelections/menuSelections.slice";
import useCartHook from "../useCartHook";

/*
  Lane added-modal — the added modal's open decision.
  F5: a plain add opens the modal only when the strip will have a card, so the
  open check reads the SAME map the strip resolves over: the menu-sellable
  entityMap (selectMenuSellableEntityMap), never the raw one — a pack whose
  groups are all dead is not sold, so it must not open the modal onto an empty
  strip.
  RC4: the next modal open CONSUMES recommendationDetour (that confirmation
  shows no strip — one hop); an add that opens no modal leaves it alone.
  Seam: the Dexie cart mirror (no IndexedDB in jsdom).
*/

vi.mock("../../cartHooks/useCartIndexedDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cartHooks/useCartIndexedDb")>();
  return {
    ...actual,
    default: () => ({
      ...actual.default(),
      addToIndexedDbCart: () => Promise.resolve(),
    }),
  };
});

const PACK_GROUP = "snacks_combo";
/** A pack: the converter drops it when every one of its groups is dead. */
const PACK = { id: "dream-box", name: "Dream box", price: 25, modifiers: [PACK_GROUP] };
/** Plain (one-tap) item whose only suggestion is the pack. */
const FRIES = { id: "fries", name: "Fries", price: 3, recommendedItems: [PACK.id] };
/** Customizable item (always confirms with the modal). */
const BURRITO = { id: "burrito", name: "Burrito", price: 8, modifiers: ["sauce_addons"], recommendedItems: [PACK.id] };

const seedMenu = (packGroupActive: boolean) => {
  store.dispatch(setEntityMap({ entityMap: { [PACK.id]: PACK, [FRIES.id]: FRIES, [BURRITO.id]: BURRITO } }));
  store.dispatch(
    setModifiersMap({ modifiersMap: { [PACK_GROUP]: { _id: PACK_GROUP, name: "Snacks", isActive: packGroupActive } } })
  );
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);
const cartItems = () => (store.getState() as unknown as { cart: { cartItems: unknown[] } }).cart.cartItems;
const modalOpen = () => selectAddToCartModal(store.getState());
const detour = () => selectRecommendationDetour(store.getState());

describe("useCartHook — the added modal opens only onto a strip it can fill (added-modal F5 / RC4)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("T8: a plain add whose only suggestion is a dead pack opens NO modal (the row still lands)", () => {
    seedMenu(false);
    const { result } = renderHook(() => useCartHook(), { wrapper });

    let outcome: unknown;
    act(() => {
      outcome = result.current.addItemToCart({ ...FRIES }, "ITEM");
    });

    expect(outcome).toBe(true);
    expect(cartItems()).toHaveLength(1);
    expect(modalOpen()).toBe(false);
  });

  it("guard: the same pack with its group live opens the modal", () => {
    seedMenu(true);
    const { result } = renderHook(() => useCartHook(), { wrapper });

    act(() => {
      result.current.addItemToCart({ ...FRIES }, "ITEM");
    });

    expect(modalOpen()).toBe(true);
    expect(selectAddToCartItem(store.getState())).toMatchObject({ id: FRIES.id });
    expect(selectAddToCartItem(store.getState())).not.toHaveProperty("suppressRecommendations");
  });

  it("T9 (guard): a CUSTOMIZABLE add with the flag set opens the modal WITHOUT a strip and consumes the flag", () => {
    seedMenu(true);
    store.dispatch(setRecommendationDetour(true));
    const { result } = renderHook(() => useCartHook(), { wrapper });

    act(() => {
      result.current.addItemToCart({ ...BURRITO }, "CUSTOMIZABLE");
    });

    expect(modalOpen()).toBe(true);
    expect(selectAddToCartItem(store.getState())).toMatchObject({ id: BURRITO.id, suppressRecommendations: true });
    expect(detour()).toBe(false);
  });

  it("guard: a plain add with suppressAddedModal (the strip / PDP rail) opens nothing and leaves a set flag set", () => {
    seedMenu(true);
    store.dispatch(setRecommendationDetour(true));
    const { result } = renderHook(() => useCartHook(), { wrapper });

    act(() => {
      result.current.addItemToCart({ ...FRIES }, "ITEM", { suppressAddedModal: true });
    });

    expect(cartItems()).toHaveLength(1);
    expect(modalOpen()).toBe(false);
    expect(detour()).toBe(true);
  });
});

/*
  posistKiosk parity (user report 2026-10-12) — the product-added modal
  STAGES. A suggestion that needs a choice keeps the modal open (hidden)
  with the detour set; the add its chooser ends in (Select a Size's
  CONTINUE, the PDP's ADD TO BAG) is the guest's pick, not a purchase:
  it is PARKED whole with the modal's other picks, and only ADD TO ORDER
  writes it.
*/
describe("useCartHook — a suggestion chooser's add is parked in the open modal (posistKiosk staging)", () => {
  const parked = () =>
    (store.getState() as unknown as { menuSelections: { upsellStaging: { pendingCustom: Record<string, unknown>[] } } })
      .menuSelections.upsellStaging.pendingCustom;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    seedMenu(true);
  });

  it("modal open + detour live: the finished row is parked — not in the bag, the same modal still open, true returned", () => {
    store.dispatch(mutateAddToCartModal({ isOpen: true, item: { id: "salad", name: "Greek Salad" } }));
    store.dispatch(setRecommendationDetour(true));
    const { result } = renderHook(() => useCartHook(), { wrapper });

    let outcome: unknown;
    act(() => {
      outcome = result.current.addItemToCart({ ...BURRITO, total_price: 9 }, "CUSTOMIZABLE");
    });

    expect(outcome).toBe(true);
    expect(cartItems()).toEqual([]);
    expect(parked()).toHaveLength(1);
    // The row the bag would have got: stamped, typed, quantity defaulted.
    expect(parked()[0]).toMatchObject({ id: BURRITO.id, type: "CUSTOMIZABLE", quantity: 1, total_price: 9 });
    expect(parked()[0].itemId).toMatch(/^\d+_burrito$/);
    expect(modalOpen()).toBe(true);
    expect(selectAddToCartItem(store.getState())).toEqual({ id: "salad", name: "Greek Salad" });
    // Ending the detour is the chooser's exit, not the add's.
    expect(detour()).toBe(true);
  });

  it("the modal open but no detour (ADD TO ORDER's own writes): the row lands in the bag, nothing parked", () => {
    store.dispatch(mutateAddToCartModal({ isOpen: true, item: { id: "salad", name: "Greek Salad" } }));
    const { result } = renderHook(() => useCartHook(), { wrapper });

    act(() => {
      result.current.addItemToCart({ ...BURRITO }, "CUSTOMIZABLE", { suppressAddedModal: true });
    });

    expect(cartItems()).toEqual([expect.objectContaining({ id: BURRITO.id })]);
    expect(parked()).toEqual([]);
  });
});
