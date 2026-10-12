/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart rows and the bill object flow through untyped from the legacy cart
 * slice / bill engine (BagSheet test precedent). Do not add NEW anys.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { selectMenu, setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { buildVariantCommitPayload } from "@cx-sdk/ordering/customization/commitPayload";
import { buildVariantTierPayload } from "@cx-sdk/ordering/cart/addIntent";
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
import useCartHook from "../../../hooks/menuHooks/useCartHook";
import Menu from "../index";
import "../../../i18n";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), addEntity: vi.fn(), capture: vi.fn() }));

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
// B3: analytics asserted per event.
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mocks.capture(...args),
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

/** The menu's own copy of TACO — the entity the card hands the fast lane. */
const tacoInStore = () => selectMenu(store.getState()).categories[0].subCategories[0].entities[0];

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);

describe("Select-a-Size fast lane (money: VARIANT rows carry variantPrice)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setMenuData({ menu: MENU }));
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    // Keep the pence: no whole-unit round-off on the net amount.
    store.dispatch(
      setDeploymentInfo([{ name: "disable_roundoff", selected: true }]),
    );
    mocks.navigate.mockReset();
    mocks.addEntity.mockReset();
    mocks.capture.mockReset();
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
  it("CONTINUE on a size with modifiers calls addEntity(parent, {preselectedVariantId, forceNewCustomization}) — no bare navigate, nothing in the cart", () => {
    render(<Menu />, { wrapper });

    fireEvent.click(screen.getByTestId("quick-add-e-box"));
    fireEvent.click(screen.getByTestId("size-b-large"));
    fireEvent.click(screen.getByTestId("size-continue"));

    expect(mocks.addEntity).toHaveBeenCalledTimes(1);
    // The size is chosen: never the repeat sheet (it would drop the size).
    expect(mocks.addEntity).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e-box", hasVariant: true }),
      { preselectedVariantId: "b-large", forceNewCustomization: true }
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
    // The sheet stays up as the cover until the PDP's route replaces this page
    // (navigate is a spy here, so it never does); a second CONTINUE does nothing.
    expect(screen.getByTestId("select-size-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("size-continue"));
    expect(mocks.addEntity).toHaveBeenCalledTimes(1);
    // B3: the PDP opens from the menu; nothing landed yet.
    expect(mocks.capture).toHaveBeenCalledWith("customization_opened", {
      item_id: "e-box",
      item_name: "Cravings Box",
      source: "menu",
    });
    expect(mocks.capture).not.toHaveBeenCalledWith("item_added_to_cart", expect.anything());
  });

  /*
    B5 (CX-07): the size-only branch commits through the PDP's own builder —
    buildVariantCommitPayload over buildVariantTierPayload(parent)
    .selectedEntity, no modifiers — so the row carries baseItem (a bag Edit
    reads it), baseItemPrice, variantPrice and empty customizations. MIAM
    flags off (a plain paid row). One money shape: the bill and the order
    item equal a PDP-built row's.
  */
  it("B5: the fast-lane row IS the PDP's commit payload (baseItem, prices, {} customizations, MIAM off)", () => {
    render(<Menu />, { wrapper });

    fireEvent.click(screen.getByTestId("quick-add-e-taco"));
    fireEvent.click(screen.getByTestId("size-v-large"));
    fireEvent.click(screen.getByTestId("size-continue"));

    const row = (store.getState() as any).cart.cartItems[0];
    expect(row).toMatchObject(
      buildVariantCommitPayload({
        selectedEntity: buildVariantTierPayload(tacoInStore()).selectedEntity,
        selectedVariant: TACO.variants[1],
        mergedCustomizations: {},
        quantity: 1,
        isMakeItAMealItem: false,
        makeItAMealSelectedItem: {},
      })
    );
    expect(row.baseItem).toMatchObject({
      id: "e-taco",
      selectedVariantId: "v-large",
      selectedVariantName: "Large",
    });
    expect(row).toMatchObject({
      type: "VARIANT",
      baseItemPrice: 0,
      variantPrice: 6,
      customizations: {},
      total_price: 6,
      quantity: 1,
      hasSecondTier: false,
      isMakeItAMealItem: false,
      makeItAMealSelectedItem: {},
    });
    expect(row.selectedVariant).toMatchObject({ id: "v-large", price: 6 });
  });

  it("B5 parity: the bill and the converted order item equal those of a PDP-built row of the same size", () => {
    render(<Menu />, { wrapper });
    fireEvent.click(screen.getByTestId("quick-add-e-taco"));
    fireEvent.click(screen.getByTestId("size-v-large"));
    fireEvent.click(screen.getByTestId("size-continue"));
    const fastLane = structuredClone((store.getState() as any).cart);

    // The PDP's commit for the same pick: the card tap's session latches the
    // MIAM flags on (useCustomization) — the only difference, and neither the
    // bill nor the order push reads them.
    store.dispatch(setCartItems([]));
    const cartHook = renderHook(() => useCartHook(), { wrapper });
    act(() => {
      cartHook.result.current.addItemToCart(
        buildVariantCommitPayload({
          selectedEntity: buildVariantTierPayload(tacoInStore()).selectedEntity,
          selectedVariant: TACO.variants[1],
          mergedCustomizations: {},
          quantity: 1,
          isMakeItAMealItem: true,
          makeItAMealSelectedItem: TACO,
        }),
        "VARIANT"
      );
    });
    const pdp = structuredClone((store.getState() as any).cart);
    expect(pdp.cartItems).toHaveLength(1);

    const { result } = renderHook(() => useOrderHook(), { wrapper });
    const fastBill = result.current.getCalculatedBill(fastLane);
    const pdpBill = result.current.getCalculatedBill(pdp);
    expect(Number(fastBill.getSubtotal())).toBeCloseTo(6, 2);
    expect(Number(fastBill.getNetAmount())).toBeCloseTo(6.9, 2);
    expect(Number(fastBill.getSubtotal())).toBe(Number(pdpBill.getSubtotal()));
    expect(Number(fastBill.getNetAmount())).toBe(Number(pdpBill.getNetAmount()));

    const fastItems = result.current.convertCart(fastLane)._items;
    expect(fastItems).toEqual(result.current.convertCart(pdp)._items);
    expect(fastItems[0]).toMatchObject({ _id: "v-large", name: "Large", quantity: 1, rate: 6 });
    expect(fastItems[0].taxes).toEqual([expect.objectContaining({ _id: "vat-15", value: 15 })]);
  });

  it("B3: a size-only add that landed reports ItemAddedToCart as a VARIANT at the size's price", () => {
    render(<Menu />, { wrapper });

    fireEvent.click(screen.getByTestId("quick-add-e-taco"));
    fireEvent.click(screen.getByTestId("size-v-large"));
    fireEvent.click(screen.getByTestId("size-continue"));

    expect(mocks.capture).toHaveBeenCalledWith("item_added_to_cart", {
      item_id: "e-taco",
      item_name: "Crunchy Taco",
      item_price: 6,
      quantity: 1,
      item_type: "VARIANT",
    });
    // The "+" is not a card tap.
    expect(mocks.capture).not.toHaveBeenCalledWith("item_clicked", expect.anything());
  });
});
