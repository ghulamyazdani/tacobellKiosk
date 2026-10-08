/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart rows and the bill object flow through untyped from the legacy cart
 * slice / bill engine (BagSheet test precedent). Do not add NEW anys.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import {
  setCurrency,
  setDeploymentInfo,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  makeItAMealIsSessionOpen,
  makeItAMealTier1BottomSheet,
  tier1CustomizationSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { store } from "../../../redux/app/store";
import useOrderHook from "../../../hooks/menuHooks/useOrderHook";
import Menu from "../index";
import "../../../i18n";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), addEntity: vi.fn() }));

// Same seams as Menu.test: the mount's fetchMenu stays pending, navigation is
// a spy.
vi.mock(
  "../../../hooks/menuHooks/useMenuConverters",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../hooks/menuHooks/useMenuConverters")
      >();
    return {
      default: () => ({
        ...actual.default(),
        fetchMenu: () => new Promise(() => {}),
      }),
    };
  },
);
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));
// S1: the REAL executor, its calls recorded.
vi.mock("../../../hooks/menuHooks/useAddEntityToCart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/menuHooks/useAddEntityToCart")>();
  return {
    ...actual,
    default: () => {
      const hook = actual.default();
      return {
        ...hook,
        addEntity: (...args: Parameters<typeof hook.addEntity>) => {
          mocks.addEntity(...args);
          return hook.addEntity(...args);
        },
      };
    },
  };
});

/** Exclusive VAT 15 % (the e2e fixture menu's tax shape). */
const VAT_15 = [
  {
    _id: "vat-15",
    name: "VAT@ 15%",
    type: "percentage",
    value: 15,
    isGSTOSC: false,
    cascadingTaxes: [],
  },
];

/** A sized item with no modifiers → the Select-a-Size fast lane commits it. */
const TACO = {
  id: "e-taco",
  name: "Crunchy Taco",
  price: 0,
  hasVariant: true,
  isVariant: false,
  outOfStock: false,
  taxes: VAT_15,
  variants: [
    { id: "v-regular", name: "Regular", price: 4, taxes: VAT_15 },
    { id: "v-large", name: "Large", price: 6, taxes: VAT_15 },
  ],
};

/** S1: a sized item whose LARGE size carries modifier groups → the PDP. */
const BOX = {
  id: "e-box",
  name: "Cravings Box",
  price: 0,
  hasVariant: true,
  isVariant: false,
  outOfStock: false,
  taxes: VAT_15,
  variants: [
    { id: "b-regular", name: "Regular", price: 7, taxes: VAT_15 },
    { id: "b-large", name: "Large", price: 9, taxes: VAT_15, modifiers: ["box_addons"] },
  ],
};

const MENU = {
  categories: [
    {
      id: "c1",
      name: "Tacos",
      subCategories: [{ id: "s1", name: "Tacos", entities: [TACO, BOX] }],
    },
  ],
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);

describe("Select-a-Size fast lane (money: VARIANT rows carry variantPrice)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setMenuData({ menu: MENU }));
    store.dispatch(setCurrency({ symbol: "£" }));
    // Keep the pence: no whole-unit round-off on the net amount.
    store.dispatch(
      setDeploymentInfo([{ name: "disable_roundoff", selected: true }]),
    );
    mocks.navigate.mockReset();
    mocks.addEntity.mockReset();
  });

  it("the committed row carries the size's variantPrice, so the bill is the size price plus its tax (was NaN)", () => {
    render(<Menu />, { wrapper });

    fireEvent.click(screen.getByTestId("quick-add-e-taco"));
    fireEvent.click(screen.getByTestId("size-v-large"));
    fireEvent.click(screen.getByTestId("size-continue"));

    const cart = (store.getState() as any).cart;
    expect(cart.cartItems).toHaveLength(1);
    const row = cart.cartItems[0];
    expect(row.type).toBe("VARIANT");
    expect(row.selectedVariant.id).toBe("v-large");
    expect(row.variantPrice).toBe(6);
    // S1: a size WITHOUT groups is the VARIANT add exactly as before —
    // no addEntity, no tier-1 session, no navigation.
    expect(row).toMatchObject({ id: "e-taco", total_price: 6, quantity: 1 });
    expect(mocks.addEntity).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(makeItAMealIsSessionOpen(store.getState())).toBeFalsy();

    const { result } = renderHook(() => useOrderHook(), { wrapper });
    const bill = result.current.getCalculatedBill(cart);
    const subtotal = Number(bill.getSubtotal());
    const net = Number(bill.getNetAmount());
    expect(Number.isFinite(net)).toBe(true);
    expect(subtotal).toBeCloseTo(6, 2);
    expect(net).toBeCloseTo(6.9, 2); // 6 + 15 % exclusive VAT
  });

  /*
    S1: a size WITH modifier groups goes to the PDP through addEntity — the
    card tap's own tier-1 VARIANT session (the old bare navigate had none, so
    the PDP's no-session guard bounced straight back) — with the chosen size
    carried as preselectedVariantId.
  */
  it("CONTINUE on a size with modifiers calls addEntity(parent, {preselectedVariantId}) — no bare navigate, nothing in the cart", () => {
    render(<Menu />, { wrapper });

    fireEvent.click(screen.getByTestId("quick-add-e-box"));
    fireEvent.click(screen.getByTestId("size-b-large"));
    fireEvent.click(screen.getByTestId("size-continue"));

    expect(mocks.addEntity).toHaveBeenCalledTimes(1);
    expect(mocks.addEntity).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e-box", hasVariant: true }),
      { preselectedVariantId: "b-large" }
    );
    // The ONE navigation is addEntity's own (path + its state slot), never a
    // bare navigate("/customization") without a session.
    expect(mocks.navigate.mock.calls).toStrictEqual([["/customization", undefined]]);
    expect(makeItAMealIsSessionOpen(store.getState())).toBe(true);
    expect(makeItAMealTier1BottomSheet(store.getState())).toEqual({
      isOpen: true,
      type: "variant",
      openType: "new",
      preselectedVariantId: "b-large",
    });
    expect(tier1CustomizationSelectedEntity(store.getState())).toMatchObject({ id: "e-box" });
    expect((store.getState() as any).cart.cartItems).toEqual([]);
    expect(screen.queryByTestId("select-size-modal")).not.toBeInTheDocument();
  });
});
