import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeBillCharges } from "@cx-sdk/catalog/menu/billCharges";
import { getCalculatedBill } from "@cx-sdk/ordering/order/orderBuilder";

/*
  audit-fixes C1b (MONEY) — the SDK composition behind every pushCharges
  (useAppSettings menu-first, useMenuConverters and the order-type switch
  deployment-first). Tested here: the SDK has no runner (H09). The bill
  parity case proves the two orders are money-neutral through the REAL
  engine (orderBuilder → billCalculation) — to the cent: the net amount,
  the charge taxes and the total are equal, while the RAW float sum of the
  charges (charges.amount) can differ in the last ulp (2.4 + 0.48 + 2.5 vs
  2.5 + 2.4 + 0.48). That is why every call site keeps its own order
  (D-C1-2): its order payload stays byte-identical.
*/

const D1 = { _id: "d1", name: "Service" };
const D2 = { _id: "d2", name: "Container" };
const M1 = { id: "m1", name: "Packing" };

describe("composeBillCharges", () => {
  it("deployment first by default; menu first on request", () => {
    expect(composeBillCharges([D1, D2], [M1])).toEqual([D1, D2, M1]);
    expect(composeBillCharges([D1, D2], [M1], false)).toEqual([D1, D2, M1]);
    expect(composeBillCharges([D1, D2], [M1], true)).toEqual([M1, D1, D2]);
  });

  it.each([
    ["{}", {}],
    ["null", null],
    ["undefined", undefined],
    ['"x"', "x"],
    ["a number", 3],
  ])("a non-array side (%s) counts as empty — never a throw", (_label, junk) => {
    expect(composeBillCharges(junk, [M1])).toEqual([M1]);
    expect(composeBillCharges([D1], junk)).toEqual([D1]);
    expect(composeBillCharges(junk, junk, true)).toEqual([]);
  });

  it("returns a new array and never mutates its inputs (redux holds them frozen)", () => {
    const deployment = Object.freeze([Object.freeze({ ...D1 })]);
    const menu = Object.freeze([Object.freeze({ ...M1 })]);
    const out = composeBillCharges(deployment, menu);
    expect(out).not.toBe(deployment);
    expect(out).not.toBe(menu);
    expect(out[0]).toBe(deployment[0]);
    expect(deployment).toEqual([D1]);
    expect(menu).toEqual([M1]);
  });
});

describe("bill parity: [deployment, menu] vs [menu, deployment] through getCalculatedBill", () => {
  const TAB = "t1";
  const VAT = { _id: "tx-vat", name: "VAT", type: "percentage", value: 5 };
  const ECO = { _id: "tx-eco", name: "Eco levy", type: "fixed", value: 0.3 };
  /** A 10 % service charge, VAT on it. */
  const PERCENT = { _id: "c-pct", name: "Service", type: "percentage", value: 10, tabs: [{ _id: TAB, taxes: [VAT] }] };
  /** A fixed packing charge, VAT + a fixed levy on it. */
  const FIXED = { id: "c-fixed", name: "Packing", type: "fixed", value: 2.5, tabs: [{ _id: TAB, taxes: [VAT, ECO] }] };
  /** Applies only from a £50 bill (this one is £24 → 0). */
  const MIN_BILL = { _id: "c-min", name: "Small order", type: "fixed", value: 3, minBillAmount: 50 };
  /** Applies only up to a £10 bill (this one is £24 → 0). */
  const MAX_BILL = { _id: "c-max", name: "Delivery", type: "percentage", value: 4, maxBillAmount: 10 };
  /** A charge whose bounds the bill meets (£20–£100 → applies), taxed on another tab only. */
  const IN_BOUNDS = {
    _id: "c-band",
    name: "Band",
    type: "percentage",
    value: 2,
    minBillAmount: 20,
    maxBillAmount: 100,
    tabs: [{ _id: "other-tab", taxes: [VAT] }],
  };

  const DEPLOYMENT = [PERCENT, MIN_BILL, IN_BOUNDS];
  const MENU = [FIXED, MAX_BILL];

  const ROWS = [
    { id: "burger", itemId: "b-1", name: "Burger", quantity: 2, type: "ITEM", price: 8, total_price: 8, customizations: {} },
    { id: "fries", itemId: "f-1", name: "Fries", quantity: 1, type: "ITEM", price: 8, total_price: 8, customizations: {} },
  ];

  interface Bill {
    getNetAmount: () => number;
    getCharges: () => number;
    getChargesTotalTax: () => number;
    getTotalBill: () => number;
    charges: { detail: { name: string; amount: number }[] };
  }

  const billOf = (charges: unknown[]): Bill => {
    const cart = { cartItems: structuredClone(ROWS), cartOffer: {}, charges: structuredClone(charges) };
    return getCalculatedBill(cart, {
      tabId: TAB,
      deploymentInfo: [],
      discountOnAddon: false,
      cartRdx: cart,
      getAmountBasedItemValue: () => 0,
      getImageUrl: () => "",
    }) as Bill;
  };

  beforeEach(() => {
    // billCalculation still logs on some bill paths (fork parity).
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the same net amount, charges and charge taxes in either order (to the cent); only charges.detail follows it", () => {
    const deploymentFirst = billOf(composeBillCharges(DEPLOYMENT, MENU));
    const menuFirst = billOf(composeBillCharges(DEPLOYMENT, MENU, true));

    const net = deploymentFirst.getNetAmount();
    expect(menuFirst.getNetAmount()).toBe(net);
    expect(menuFirst.getCharges()).toBeCloseTo(deploymentFirst.getCharges(), 10);
    expect(menuFirst.getChargesTotalTax()).toBe(deploymentFirst.getChargesTotalTax());
    expect(menuFirst.getTotalBill()).toBe(deploymentFirst.getTotalBill());

    // Pinned values: £24 of items; Service 2.40 (+VAT 0.12), Packing 2.50
    // (+VAT 0.125, +levy 0.30), Band 0.48 (untaxed on this tab), Small order
    // and Delivery 0 (outside their bill bounds); charge taxes 0.545 → the
    // engine's 0.54 (float); net 24 + 5.38 + 0.54 = 29.92 → rounded 30.
    const amounts = (bill: Bill) =>
      Object.fromEntries(bill.charges.detail.map((charge) => [charge.name, charge.amount]));
    expect(amounts(deploymentFirst)).toEqual({
      Service: 2.4,
      "Small order": 0,
      Band: 0.48,
      Packing: 2.5,
      Delivery: 0,
    });
    expect(amounts(menuFirst)).toEqual(amounts(deploymentFirst));
    expect(deploymentFirst.getCharges()).toBeCloseTo(5.38, 10);
    expect(deploymentFirst.getChargesTotalTax()).toBe(0.54);
    expect(net).toBe(30);

    expect(deploymentFirst.charges.detail.map((charge) => charge.name)).toEqual([
      "Service",
      "Small order",
      "Band",
      "Packing",
      "Delivery",
    ]);
    expect(menuFirst.charges.detail.map((charge) => charge.name)).toEqual([
      "Packing",
      "Delivery",
      "Service",
      "Small order",
      "Band",
    ]);
  });
});
