import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { makeItAMealIsOpen } from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setAllowMultiplePunch, setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import type { RecommendedEntity } from "@cx-sdk/core/types/recommendation";
import { store } from "../../../redux/app/store";
import { setOutOfStockItems } from "../../../redux/features/menuSelections/menuSelections.slice";
import useAddEntityToCart from "../useAddEntityToCart";

/*
  walk-oos 2 (review oos-2 #1): the add decision counts only the meal combos
  the prompt can offer — active, in stock, and completable (a combo whose
  required group has every option out is dead, SDK markUncompletable). An
  item whose every combo is out is no upsell: a tap adds it (or opens its
  chooser) instead of a "Make it a meal?" prompt with no meal on it.
*/

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

vi.mock("../../cartHooks/useCartIndexedDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cartHooks/useCartIndexedDb")>();
  return {
    ...actual,
    default: () => ({ ...actual.default(), addToIndexedDbCart: () => Promise.resolve() }),
  };
});

const MODS = {
  meal_drink: {
    _id: "meal_drink",
    isActive: true,
    min: 1,
    max: 1,
    constituentItems: [{ id: "cola", isActive: true, outOfStock: true }],
  },
};
const DEAD_BOX = { id: "box-dead", name: "Cravings Box", price: 9, isActive: true, modifiers: ["meal_drink"] };
const LIVE_BOX = { id: "box-live", name: "Dream Box", price: 8, isActive: true };
const SOLD_OUT_BOX = { ...LIVE_BOX, id: "box-sold", outOfStock: true };

const taco = (upsellItems: object[]) =>
  ({ id: "taco", name: "Crunchy Taco", price: 3, isActive: true, upsellItems }) as unknown as RecommendedEntity;
const SIZED = {
  id: "soda",
  name: "Soda",
  price: 2,
  hasVariant: true,
  variants: [{ id: "soda-r", name: "Regular", price: 2, isActive: true }],
  upsellItems: [DEAD_BOX],
} as unknown as RecommendedEntity;

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);

const cartIds = () =>
  (store.getState() as unknown as { cart: { cartItems: Array<{ id: string }> } }).cart.cartItems.map((row) => row.id);

describe("useAddEntityToCart — walk-oos 2: the meal combos it counts are the ones the prompt offers", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setKioskSettings({ enable_combo_upsell: true }));
    store.dispatch(setModifiersMap({ modifiersMap: MODS }));
  });

  it("an item whose only combo is dead is no upsell: the tap adds it — no prompt; a live combo beside it is", () => {
    const { result } = renderHook(() => useAddEntityToCart(), { wrapper });

    expect(result.current.getAddIntent(taco([LIVE_BOX, DEAD_BOX]))).toBe("upsell");
    expect(result.current.getAddIntent(taco([DEAD_BOX]))).toBe("add");
    act(() => {
      result.current.addEntity(taco([DEAD_BOX]), { suppressAddedModal: true });
    });
    expect(makeItAMealIsOpen(store.getState())).toBe(false);
    expect(cartIds()).toEqual(["taco"]);
  });

  it("a sized item whose only combo is dead opens its size chooser; every combo sold out, or switched off, is no upsell either", () => {
    const { result } = renderHook(() => useAddEntityToCart(), { wrapper });

    expect(result.current.getAddIntent(SIZED)).toBe("variant");
    expect(result.current.getAddIntent(taco([SOLD_OUT_BOX]))).toBe("add");
    expect(result.current.getAddIntent(taco([{ ...LIVE_BOX, isActive: false }]))).toBe("add");
  });

  it("re-evaluated live: PAY's map brings the drink back — the combo is offered again, so the tap is the upsell", () => {
    const { result } = renderHook(() => useAddEntityToCart(), { wrapper });
    expect(result.current.getAddIntent(taco([DEAD_BOX]))).toBe("add");

    act(() => {
      store.dispatch(setOutOfStockItems({ cola: { type: "combo", inStock: true } }));
    });
    expect(result.current.getAddIntent(taco([DEAD_BOX]))).toBe("upsell");
  });

  it("multi-punch on: its min decides — the drink group asks for none, so the box is offered", () => {
    const { result } = renderHook(() => useAddEntityToCart(), { wrapper });
    expect(result.current.getAddIntent(taco([DEAD_BOX]))).toBe("add");

    act(() => {
      store.dispatch(setAllowMultiplePunch(true));
    });
    expect(result.current.getAddIntent(taco([DEAD_BOX]))).toBe("upsell");
  });
});
