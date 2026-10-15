import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { applyOffer, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency, setDeploymentInfo } from "@cx-sdk/catalog/state/appSettings.slice";
import { getCalculatedBill } from "@cx-sdk/ordering/order/orderBuilder";
import { store } from "../../../redux/app/store";
import i18n from "../../../i18n";
import BagSheet from "../BagSheet";
import { leastValueGrants } from "../leastValueGrants";

/*
  Lane bag-ribbon (user 2026-10-15, "Add it, like posistKiosk"): a paid bag row
  the applied least-value offer covers wears posistKiosk's ribbon wording
  (CartItem.tsx:319-337) on the bag's chip — "Free", "{n} Free", "{v}% off",
  "{v}% off ×{n}" — and its line price struck to what the bill charges for it.
  The money is the bill's (leastValueGrants), so the rows add up to Discounts.
  Untaxed rows, no round off: Total = Sub Total − Discounts.
*/

const row = (id: string, price: number, quantity: number, subCategoryId = "mains") => ({
  id,
  itemId: `row-${id}`,
  name: id,
  quantity,
  type: "ITEM",
  price,
  total_price: price,
  subCategoryId,
});

/** £8 + a £0.60 add-on: the offer frees the item, never its add-on. */
const burger = (quantity: number) => ({
  ...row("burger", 8, quantity),
  type: "CUSTOMIZABLE",
  total_price: 8.6,
  customizations: { sauce_group: [{ id: "onions", name: "Add Onions", price: 0.6, quantity: 1 }] },
  baseItem: { id: "burger", name: "burger", price: 8, modifiers: ["sauce_group"] },
});

/** Buy `buyQuantity` mains, the `getQuantity` cheapest units at getDiscount % off (unset = free). */
const leastValue = (leastItemValueCount: Record<string, number | null>) => ({
  _id: "lv-mains",
  name: "Cheapest mains free",
  type: { name: "item", value: 0 },
  getLeastValueItem: true,
  isAvailable: true,
  applicable: {
    on: "complete",
    categories: [],
    items: [],
    isExclude: false,
    isInclude: false,
    rawItems: [{ category: { _id: "mains" } }],
  },
  buyItems: {},
  getItems: {},
  leastItemValueCount,
});

const openBag = (rows: unknown[], offer?: unknown) => {
  store.dispatch(setCartItems(rows));
  if (offer) store.dispatch(applyOffer({ offer }));
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );
};

const chip = (id: string) => screen.queryByTestId(`bag-least-chip-row-${id}`);
const was = (id: string) => screen.queryByTestId(`bag-was-row-${id}`);
const price = (id: string) => screen.getByTestId(`bag-price-row-${id}`).textContent;
const figure = (text: string | null | undefined) => Number((text ?? "").replace(/[^\d.]/g, ""));
/** Σ (struck − live) over the rows (an unstruck row saves 0): what the rows claim the offer saves. */
const rowSavings = (ids: string[]) =>
  Math.round(
    ids.reduce((sum, id) => sum + figure(was(id)?.textContent ?? price(id)) - figure(price(id)), 0) * 100,
  ) / 100;
const discounts = () => figure(screen.getByTestId("bag-discounts").textContent);

const reset = () => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
};

describe("BagSheet — the least-value offer on the rows it covers (posistKiosk's ribbon)", () => {
  beforeEach(reset);
  afterEach(async () => {
    await act(() => i18n.changeLanguage("en"));
  });

  it("the whole row free: Free, its line struck to £0.00 — a row the offer does not cover keeps its plain price", () => {
    openBag(
      [row("taco", 5, 1), row("burrito", 8, 1), row("drink", 3, 1, "drinks")],
      leastValue({ buyQuantity: 2, getQuantity: 1 }),
    );

    expect(chip("taco")).toHaveTextContent(/^Free$/);
    expect(was("taco")).toHaveTextContent(/^£5\.00$/);
    expect(price("taco")).toBe("£0.00");
    for (const id of ["burrito", "drink"]) {
      expect(chip(id)).not.toBeInTheDocument();
      expect(was(id)).not.toBeInTheDocument();
    }
    expect(price("burrito")).toBe("£8.00");
    expect(price("drink")).toBe("£3.00");
    expect(discounts()).toBe(5);
  });

  it("some units free: {n} Free on ONE chip (the quantity never splits), the line struck to its paid units", () => {
    openBag([row("taco", 5, 3), row("burrito", 8, 1)], leastValue({ buyQuantity: 2, getQuantity: 2 }));

    expect(chip("taco")).toHaveTextContent(/^2 Free$/);
    expect(was("taco")).toHaveTextContent(/^£15\.00$/);
    expect(price("taco")).toBe("£5.00");
    expect(chip("burrito")).not.toBeInTheDocument();
    expect(discounts()).toBe(10);
  });

  it("a partial discount: {v}% off on a whole row, {v}% off ×{n} on some of its units", () => {
    openBag(
      [row("sauce", 2, 2), row("taco", 5, 2), row("burrito", 8, 1)],
      leastValue({ buyQuantity: 2, getQuantity: 3, getDiscount: 50 }),
    );

    expect(chip("sauce")).toHaveTextContent(/^50% off$/);
    expect(was("sauce")).toHaveTextContent(/^£4\.00$/);
    expect(price("sauce")).toBe("£2.00");
    expect(chip("taco")).toHaveTextContent(/^50% off ×1$/);
    expect(was("taco")).toHaveTextContent(/^£10\.00$/);
    expect(price("taco")).toBe("£7.50");
    expect(chip("burrito")).not.toBeInTheDocument();
    expect(rowSavings(["sauce", "taco", "burrito"])).toBe(4.5);
    expect(discounts()).toBe(4.5);
  });

  it("a fractional-cent saving is the bill's: £2.99 at 50 % books £1.495, the line keeps £1.49 and Discounts reads −£1.50", () => {
    openBag([row("sauce", 2.99, 1), row("burrito", 8, 1)], leastValue({ buyQuantity: 2, getQuantity: 1, getDiscount: 50 }));

    expect(chip("sauce")).toHaveTextContent(/^50% off$/);
    expect(was("sauce")).toHaveTextContent(/^£2\.99$/);
    expect(price("sauce")).toBe("£1.49");
    expect(rowSavings(["sauce", "burrito"])).toBe(1.5);
    expect(discounts()).toBe(1.5);
  });

  it("several covered rows add up to the Discounts line — an add-on is never the offer's", () => {
    openBag(
      [row("sauce", 2, 2), burger(1), row("taco", 9, 2)],
      leastValue({ buyQuantity: 3, getQuantity: 4 }),
    );

    expect(chip("sauce")).toHaveTextContent(/^Free$/);
    expect(chip("burger")).toHaveTextContent(/^Free$/);
    // The £8 item is free; the £0.60 onions are still charged.
    expect(was("burger")).toHaveTextContent(/^£8\.60$/);
    expect(price("burger")).toBe("£0.60");
    expect(chip("taco")).toHaveTextContent(/^1 Free$/);
    expect(price("taco")).toBe("£9.00");
    expect(rowSavings(["sauce", "burger", "taco"])).toBe(21);
    expect(discounts()).toBe(21);
  });

  it("no chip and no strike while the offer is not applied, nor at 0 % off (the bill saves nothing — posistKiosk would read Free)", () => {
    const { unmount } = openBag([row("taco", 5, 1), row("burrito", 8, 1)]);
    expect(screen.queryByTestId(/^bag-least-chip-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^bag-was-/)).not.toBeInTheDocument();
    expect(price("taco")).toBe("£5.00");
    unmount();

    reset();
    openBag([row("taco", 5, 1), row("burrito", 8, 1)], leastValue({ buyQuantity: 2, getQuantity: 1, getDiscount: 0 }));
    expect(screen.queryByTestId(/^bag-least-chip-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^bag-was-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-discounts")).not.toBeInTheDocument();
  });

  it("Arabic: the chips read the Arabic copy", async () => {
    await act(() => i18n.changeLanguage("ar"));

    const { unmount } = openBag(
      [row("sauce", 2, 1), row("taco", 5, 3), row("burrito", 8, 1)],
      leastValue({ buyQuantity: 2, getQuantity: 3 }),
    );
    expect(chip("sauce")?.textContent).toBe(i18n.t("offers.free"));
    expect(chip("taco")?.textContent).toBe(i18n.t("offers.unitsFree", { units: 2 }));
    unmount();

    reset();
    openBag(
      [row("sauce", 2, 2), row("taco", 5, 2), row("burrito", 8, 1)],
      leastValue({ buyQuantity: 2, getQuantity: 3, getDiscount: 50 }),
    );
    expect(chip("sauce")?.textContent).toBe(i18n.t("offers.percentOff", { value: 50 }));
    expect(chip("taco")?.textContent).toBe(i18n.t("offers.percentOffUnits", { value: 50, units: 1 }));
    expect(chip("sauce")?.textContent).not.toMatch(/Free|off/);
  });
});

describe("leastValueGrants — the allocation and the money the bill applies", () => {
  const bill = (cart: unknown) =>
    getCalculatedBill(cart, {
      tabId: "t1",
      deploymentInfo: [],
      discountOnAddon: false,
      cartRdx: cart,
      getAmountBasedItemValue: () => 0,
      getImageUrl: () => "",
    });

  it("follows the bill's lock, not the live distribution: a stale lock still frees the taco", () => {
    // The bag reconciles the lock as it opens; until then the bill prices the lock.
    const cart = {
      cartItems: [row("taco", 5, 1), row("burrito", 8, 1), row("drink", 2, 1)],
      cartOffer: leastValue({ buyQuantity: 2, getQuantity: 1 }),
      lockedFreebieAllocation: { "row-taco": 1 },
    };
    const grants = leastValueGrants(cart, bill(cart));

    expect([...grants.keys()]).toEqual(["row-taco"]);
    expect(grants.get("row-taco")).toEqual({ units: 1, percent: 100, saving: 5 });
  });

  it("never grants a freebie or a reward row, and the rows' savings are the bill's Discounts", () => {
    const cart = {
      cartItems: [
        row("taco", 5, 1),
        row("burrito", 8, 1),
        { ...row("salad", 0, 1), isGetItem: true, discountType: "percent", discountValue: 100 },
        {
          ...row("reward", 0, 1),
          isLoyaltyItem: true,
          discount_type: "percentage",
          discount_value: 100,
          undiscounted_price: 0,
        },
      ],
      cartOffer: leastValue({ buyQuantity: 2, getQuantity: 2 }),
      lockedFreebieAllocation: {},
    };
    const priced = bill(cart);
    const grants = leastValueGrants(cart, priced);

    expect([...grants.keys()].sort()).toEqual(["row-burrito", "row-taco"]);
    const total = [...grants.values()].reduce((sum, grant) => sum + grant.saving, 0);
    expect(total).toBe(13);
    expect(total).toBe(Number(priced.getTotalDiscount()));
  });

  it("nothing without a bill", () => {
    const cart = { cartItems: [row("taco", 5, 2)], cartOffer: leastValue({ buyQuantity: 2, getQuantity: 1 }) };
    expect(leastValueGrants(cart, null).size).toBe(0);
  });
});
