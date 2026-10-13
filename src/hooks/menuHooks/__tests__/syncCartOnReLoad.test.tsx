/**
 * Lane offers 4a — the crash-reload restore (useCartHook.syncCartOnReLoad,
 * run once by AppRoutes; its settling flips CartRehydratedContext). The rows
 * (IndexedDB) and cartOffer (redux-persist) are written separately, so a
 * crash between them can restore freebie rows no applied offer owns — and
 * the bill discounts every isGetItem row by its own stamp. The restore drops
 * them (redux never sees them; IndexedDB loses them) and keeps the applied
 * offer's own rows. Probe: Remove, the two free rows written back, reload →
 * offer null, Discounts −£19.00 before the fix.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { applyOffer } from "@cx-sdk/ordering/state/cart.slice";
import { redeemGetItem } from "@cx-sdk/ordering/cart/cartEngine";
import { setDeploymentInfo } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import useCartHook from "../useCartHook";
import useOrderHook from "../useOrderHook";

const { dexie, deleted } = vi.hoisted(() => {
  const deleted: unknown[] = [];
  return {
    deleted,
    dexie: {
      rows: [] as object[],
      open: () => Promise.resolve(),
    },
  };
});

vi.mock("../../../models/db", () => ({
  db: {
    open: dexie.open,
    cartItems: {
      toArray: () => Promise.resolve(dexie.rows),
      where: () => ({
        equals: (itemId: unknown) => ({
          delete: () => {
            deleted.push(itemId);
            return Promise.resolve(1);
          },
        }),
      }),
    },
  },
}));

const PAID = {
  id: "cheese-burger",
  itemId: "cb-1",
  name: "Cheese Burger",
  quantity: 1,
  type: "ITEM",
  price: 8,
  total_price: 8,
  customizations: {},
};
const entity = (id: string, name: string, price: number) => ({
  id,
  name,
  price,
  type: "ITEM",
  modifiers: [],
  customizations: {},
});
const SALAD = entity("greek-salad", "Greek Salad", 17);
const SAUCE = entity("tortilla-sauce", "Tortilla Sauce", 2);
/** Free rows exactly as the apply paths land them. */
const FREE_SALAD = { ...redeemGetItem(SALAD, "percent", 1, 100, true, false), itemId: "free-salad" };
const FREE_SAUCE = { ...redeemGetItem(SAUCE, "percent", 1, 100, true, false), itemId: "free-sauce" };

const entry = (base: { id: string }) => ({
  _id: `gi-${base.id}`,
  baseItemId: base.id,
  relation: "and",
  discountType: "percent",
  value: 100,
  quantity: 1,
  entities: base,
});
/** The reward that owns both free rows. */
const FREE_SIDES = {
  _id: "offer-free-sides",
  name: "Free salad and sauce",
  type: { name: "item", value: 0 },
  getItemOnly: true,
  getItems: { items: [entry(SALAD), entry(SAUCE)], categories: [] },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter>{children}</MemoryRouter>
  </Provider>
);

/** Run the restore as AppRoutes does, then read redux + the bill. */
const restore = async () => {
  const { result } = renderHook(() => ({ cart: useCartHook(), order: useOrderHook() }), { wrapper });
  await act(async () => {
    await result.current.cart.syncCartOnReLoad();
  });
  const cart = (store.getState() as unknown as { cart: { cartItems: { itemId: string }[] } }).cart;
  const bill = result.current.order.getCalculatedBill(cart) as { getTotalDiscount(): number };
  return { itemIds: cart.cartItems.map((row) => row.itemId), discount: bill.getTotalDiscount() };
};

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
  deleted.length = 0;
  dexie.rows = [PAID, FREE_SALAD, FREE_SAUCE];
});

describe("syncCartOnReLoad — orphaned freebie rows never come back (4a)", () => {
  it("no applied offer (the probe): the free rows are dropped from redux AND IndexedDB — no discount, the paid row stays", async () => {
    const { itemIds, discount } = await restore();
    expect(itemIds).toEqual(["cb-1"]);
    expect(deleted).toEqual(["free-salad", "free-sauce"]);
    expect(discount).toBe(0);
  });

  it("the applied reward that owns them keeps its rows: nothing dropped, Discounts 19.00", async () => {
    store.dispatch(applyOffer({ offer: FREE_SIDES }));
    const { itemIds, discount } = await restore();
    expect(itemIds).toEqual(["cb-1", "free-salad", "free-sauce"]);
    expect(deleted).toEqual([]);
    expect(discount).toBe(19);
  });

  it("a row the applied reward does not own goes, its own stays", async () => {
    const saladOnly = { ...FREE_SIDES, _id: "offer-free-salad", getItems: { items: [entry(SALAD)], categories: [] } };
    store.dispatch(applyOffer({ offer: saladOnly }));
    const { itemIds, discount } = await restore();
    expect(itemIds).toEqual(["cb-1", "free-salad"]);
    expect(deleted).toEqual(["free-sauce"]);
    expect(discount).toBe(17);
  });
});

/**
 * Lane offers-parity (D5, mandatory with F1): a get-CATEGORY freebie belongs
 * to the applied offer when its id is one of the persisted group's entities
 * AND it carries that group's stamp — the commit's own membership rule. The
 * base sweep matched getItems.items only, so every crash-reload deleted the
 * applied offer's category freebies while the offer stayed applied.
 */
describe("syncCartOnReLoad — the applied offer's CATEGORY freebies survive (offers-parity)", () => {
  const CAESAR = entity("caesar-dressing", "Caesar Dressing", 2);
  /** Free rows as the picker lands them: stamped from the GROUP. */
  const FREE_TORTILLA_10 = { ...redeemGetItem(SAUCE, "percent", 1, 100, true, false), itemId: "free-cat-sauce" };
  const FOREIGN_CAESAR = { ...redeemGetItem(CAESAR, "percent", 1, 50, true, false), itemId: "free-foreign" };
  const SAUCES_OFFER = {
    _id: "offer-sauces",
    name: "Any sauce free",
    type: { name: "item", value: 0 },
    getItemOnly: true,
    getItems: {
      items: [],
      categories: [
        {
          _id: "sauces",
          name: "Sauces",
          quantity: 1,
          relation: "and",
          discountType: "percent",
          value: 100,
          entities: [SAUCE, CAESAR],
        },
      ],
    },
  };

  it("the owned category row stays (redux + IndexedDB) and keeps its discount; a foreign-stamped row is dropped", async () => {
    store.dispatch(applyOffer({ offer: SAUCES_OFFER }));
    dexie.rows = [PAID, FREE_TORTILLA_10, FOREIGN_CAESAR];
    const { itemIds, discount } = await restore();
    expect(itemIds).toEqual(["cb-1", "free-cat-sauce"]);
    expect(deleted).toEqual(["free-foreign"]);
    expect(discount).toBe(2);
  });
});
