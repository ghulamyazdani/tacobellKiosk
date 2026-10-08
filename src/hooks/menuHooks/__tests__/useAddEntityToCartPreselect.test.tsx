import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { UnknownAction } from "@reduxjs/toolkit";
import { buildVariantTierPayload } from "@cx-sdk/ordering/cart/addIntent";
import {
  makeItAMealTier1BottomSheet,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { store } from "../../../redux/app/store";
import useAddEntityToCart from "../useAddEntityToCart";

/*
  Lane figma-polish S1 — Select-a-Size CONTINUE on a size with modifier groups
  opens the PDP through addEntity's own tier-1 VARIANT session, carrying the
  chosen size as `bottomSheet.preselectedVariantId` (TB-local option). The
  field rides ONLY when given, ONLY on the variant branch; without it the
  dispatched payload is exactly the SDK's buildVariantTierPayload (fork
  parity). Seams: navigation, and the Dexie cart mirror (the add branch).
*/

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../cartHooks/useCartIndexedDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cartHooks/useCartIndexedDb")>();
  return {
    ...actual,
    default: () => ({ ...actual.default(), addToIndexedDbCart: () => Promise.resolve() }),
  };
});

/** Sized, its large size carries modifier groups → the "variant" intent. */
const TACO = {
  id: "taco",
  name: "Crunchy Taco",
  price: 0,
  hasVariant: true,
  variants: [
    { id: "taco-r", name: "Regular", price: 4, isActive: true },
    { id: "taco-l", name: "Large", price: 6, isActive: true, modifiers: ["taco_addons"] },
  ],
} as unknown as RecommendedEntity;

/** Plain item → the one-tap "add" intent. */
const FRIES = { id: "fries", name: "Large Fries", price: 2.5 } as unknown as RecommendedEntity;

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);

describe("useAddEntityToCart — preselectedVariantId (S1)", () => {
  let dispatched: ReturnType<typeof vi.spyOn>;
  const tierPayloads = () =>
    (dispatched.mock.calls as Array<[UnknownAction]>)
      .map(([action]) => action)
      .filter(setTier1BottomSheetAndSelectedEntity.match)
      .map((action) => action.payload as unknown);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mocks.navigate.mockReset();
    dispatched = vi.spyOn(store, "dispatch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("variant branch WITH the id: the SDK payload plus bottomSheet.preselectedVariantId, then the PDP", () => {
    const { result } = renderHook(() => useAddEntityToCart(), { wrapper });
    expect(result.current.getAddIntent(TACO)).toBe("variant");

    let added: unknown;
    act(() => {
      added = result.current.addEntity(TACO, { preselectedVariantId: "taco-l" });
    });

    const base = buildVariantTierPayload(TACO) as { bottomSheet: object };
    expect(tierPayloads()).toEqual([
      { ...base, bottomSheet: { ...base.bottomSheet, preselectedVariantId: "taco-l" } },
    ]);
    expect(makeItAMealTier1BottomSheet(store.getState())).toEqual({
      isOpen: true,
      type: "variant",
      openType: "new",
      preselectedVariantId: "taco-l",
    });
    expect(added).toBe(false);
    expect(mocks.navigate.mock.calls).toEqual([["/customization", undefined]]);
  });

  it("variant branch WITHOUT it: the payload deep-equals buildVariantTierPayload — no preselectedVariantId key at all", () => {
    const { result } = renderHook(() => useAddEntityToCart(), { wrapper });

    act(() => {
      result.current.addEntity(TACO);
    });
    act(() => {
      result.current.addEntity(TACO, {});
    });

    const [plain, empty] = tierPayloads() as Array<{ bottomSheet: Record<string, unknown> }>;
    expect(plain).toEqual(buildVariantTierPayload(TACO));
    expect(empty).toEqual(buildVariantTierPayload(TACO));
    expect(plain.bottomSheet).not.toHaveProperty("preselectedVariantId");
    expect(makeItAMealTier1BottomSheet(store.getState())).not.toHaveProperty("preselectedVariantId");
  });

  it("other intents ignore it: a one-tap add just lands in the cart, no tier-1 session", () => {
    const { result } = renderHook(() => useAddEntityToCart(), { wrapper });
    expect(result.current.getAddIntent(FRIES)).toBe("add");

    let added: unknown;
    act(() => {
      added = result.current.addEntity(FRIES, { preselectedVariantId: "taco-l", suppressAddedModal: true });
    });

    expect(added).toBe(true);
    expect(tierPayloads()).toEqual([]);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(
      (store.getState() as unknown as { cart: { cartItems: Array<{ id: string }> } }).cart.cartItems.map((row) => row.id)
    ).toEqual(["fries"]);
  });
});
