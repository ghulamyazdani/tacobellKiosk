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
import { store } from "../../../redux/app/store";
import useOrderHook from "../../../hooks/menuHooks/useOrderHook";
import Menu from "../index";
import "../../../i18n";

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
  useNavigate: () => vi.fn(),
}));

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

const MENU = {
  categories: [
    {
      id: "c1",
      name: "Tacos",
      subCategories: [{ id: "s1", name: "Tacos", entities: [TACO] }],
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

    const { result } = renderHook(() => useOrderHook(), { wrapper });
    const bill = result.current.getCalculatedBill(cart);
    const subtotal = Number(bill.getSubtotal());
    const net = Number(bill.getNetAmount());
    expect(Number.isFinite(net)).toBe(true);
    expect(subtotal).toBeCloseTo(6, 2);
    expect(net).toBeCloseTo(6.9, 2); // 6 + 15 % exclusive VAT
  });
});
