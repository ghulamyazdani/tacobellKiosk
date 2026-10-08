import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { applyOffer, pushCharges, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency, setDeploymentInfo } from "@cx-sdk/catalog/state/appSettings.slice";
import { setSelectedTabId } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../BagSheet";
import i18n from "../../../i18n";

/*
  audit-fixes U4 — the bill block explains its Total: Sub Total, Discounts,
  "Taxes & charges" (item tax + charges + the charges' tax) and "Round off"
  (what the engine's rounding added, signed), each hidden at zero. Every
  figure is the SAME bill's, so the column adds up to the Total to the cent.
  Real store, real bill engine (useOrderHook.getCalculatedBill).
*/

const VAT15 = {
  _id: "vat15",
  name: "VAT@ 15%",
  type: "percentage",
  value: 15,
  isGSTOSC: false,
  cascadingTaxes: [],
};
/** £8.60, VAT 15 % exclusive (the reference menu's tax on every item). */
const BURRITO = {
  id: "burrito",
  itemId: "r-1",
  name: "Burrito",
  quantity: 1,
  type: "ITEM",
  price: 8.6,
  total_price: 8.6,
  taxes: [VAT15],
};
/** A 5 % service charge on the t1 tab, itself taxed at 15 %. */
const SERVICE_5 = {
  _id: "c-5",
  name: "Service",
  type: "percentage",
  value: 5,
  tabs: [{ _id: "t1", taxes: [VAT15] }],
};
const FLAT_TWO = {
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
  isAvailable: true,
  applicable: { on: "complete", categories: [], items: [], isExclude: false, isInclude: false, rawItems: [] },
  buyItems: {},
  getItems: {},
};
/** A redeemed 100 % XENO reward (redeemItem's shape): £17 down to £0, VAT like every item. */
const REWARD = {
  id: "salad",
  itemId: "lr-1",
  name: "Greek Salad",
  quantity: 1,
  type: "ITEM",
  isLoyaltyItem: true,
  isRedeemed: true,
  coupon_code: "static6562",
  discount_type: "percentage",
  discount_value: 100,
  price: 0,
  total_price: 0,
  undiscounted_price: 17,
  undiscounted_total_price: 17,
  extra_fields: [{ name: "Points Value", value: 3000 }],
  customizations: {},
  taxes: [VAT15],
};
/** A free £2 sauce (redeemGetItem's stamps) under its item offer. */
const SAUCE_FREE = {
  id: "sauce",
  itemId: "sauce-free",
  name: "Tortilla Sauce",
  quantity: 1,
  type: "ITEM",
  price: 2,
  total_price: 2,
  undiscounted_total_price: 2,
  discounted_total_price: 0,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  customizations: {},
  taxes: [VAT15],
};
/** Its get-only item offer (BagSheetOffers' committed-freebie shape). */
const FREE_SAUCE_OFFER = {
  ...FLAT_TWO,
  _id: "offer-free-sauce",
  name: "A free sauce",
  type: { name: "item", value: 0 },
  isAndOffer: true,
  getItemOnly: true,
  getItems: {
    items: [
      {
        _id: "gi-sauce",
        baseItemId: "sauce",
        name: "Tortilla Sauce",
        relation: "and",
        discountType: "percent",
        value: 100,
        quantity: 1,
        type: "ITEM",
        entities: { ...SAUCE_FREE, itemId: undefined },
      },
    ],
  },
};

const renderBag = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open onClose={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );

const text = (testId: string) => screen.getByTestId(testId).textContent ?? "";
/** A bill line as a signed number ("−£0.20" → −0.2; "+£1.29" → 1.29). */
const amount = (testId: string) => {
  const raw = screen.queryByTestId(testId)?.textContent;
  if (!raw) return 0;
  const value = Number(raw.replace(/[^\d.]/g, ""));
  return raw.trim().startsWith("−") ? -value : value;
};
/** Sub Total − Discounts + Taxes & charges ± Round off, in pence. */
const columnPence = () =>
  Math.round(
    (amount("bag-subtotal") +
      amount("bag-discounts") +
      amount("bag-taxes-charges") +
      amount("bag-round-off")) *
      100,
  );

describe("BagSheet bill block — Taxes & charges and Round off (U4)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setSelectedTabId("t1"));
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("15 % on £8.60: Taxes & charges +£1.29, Round off +£0.11, Total £10.00 — the column adds up", () => {
    store.dispatch(setCartItems([{ ...BURRITO }]));
    renderBag();

    expect(text("bag-subtotal")).toBe("£8.60");
    expect(text("bag-taxes-charges")).toBe("+£1.29");
    expect(text("bag-round-off")).toBe("+£0.11");
    expect(text("bag-total")).toBe("£10.00");
    expect(columnPence()).toBe(1000);
    // Between Sub Total and Total, labelled, in the Discounts row's style.
    const taxes = screen.getByTestId("bag-taxes-charges").parentElement as HTMLElement;
    expect(taxes).toHaveTextContent("Taxes & charges");
    expect(taxes).toHaveClass("flex", "w-full", "justify-between", "pb-[16px]", "text-[28px]", "leading-[32px]");
    expect(screen.getByTestId("bag-round-off").parentElement).toHaveTextContent("Round off");
    expect(
      screen.getByTestId("bag-subtotal").compareDocumentPosition(taxes) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByTestId("bag-round-off").compareDocumentPosition(screen.getByTestId("bag-total")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("a negative round off is signed with U+2212: 5 × £8.60 = £43.00 + £6.45 = £49.45 → Total £49.00, Round off −£0.45", () => {
    store.dispatch(setCartItems([{ ...BURRITO, quantity: 5 }]));
    renderBag();

    expect(text("bag-subtotal")).toBe("£43.00");
    expect(text("bag-taxes-charges")).toBe("+£6.45");
    expect(text("bag-round-off")).toBe("−£0.45");
    expect(text("bag-total")).toBe("£49.00");
    expect(columnPence()).toBe(4900);
  });

  it("disable_roundoff: the Total keeps its pence, so there is no Round off row", () => {
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
    store.dispatch(setCartItems([{ ...BURRITO }]));
    renderBag();

    expect(text("bag-taxes-charges")).toBe("+£1.29");
    expect(screen.queryByTestId("bag-round-off")).not.toBeInTheDocument();
    expect(text("bag-total")).toBe("£9.89");
    expect(columnPence()).toBe(989);
  });

  it("a 5 % charge counts with its own tax: 1.29 + 0.43 + 0.06 = +£1.78, Round off −£0.38, Total £10.00", () => {
    store.dispatch(setCartItems([{ ...BURRITO }]));
    store.dispatch(pushCharges([SERVICE_5]));
    renderBag();

    expect(text("bag-taxes-charges")).toBe("+£1.78");
    expect(text("bag-round-off")).toBe("−£0.38");
    expect(text("bag-total")).toBe("£10.00");
    expect(columnPence()).toBe(1000);
  });

  it("inclusive_tax without charges: the engine attaches no item tax, so the Taxes & charges line is hidden", () => {
    store.dispatch(setDeploymentInfo([{ name: "inclusive_tax", selected: true }]));
    store.dispatch(setCartItems([{ ...BURRITO }]));
    renderBag();

    expect(screen.queryByTestId("bag-taxes-charges")).not.toBeInTheDocument();
    expect(text("bag-round-off")).toBe("+£0.40");
    expect(text("bag-total")).toBe("£9.00");
    expect(columnPence()).toBe(900);
  });

  it("no taxes and a whole Total: neither row renders", () => {
    store.dispatch(setCartItems([{ ...BURRITO, price: 8, total_price: 8, taxes: [] }]));
    renderBag();

    expect(screen.queryByTestId("bag-taxes-charges")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-round-off")).not.toBeInTheDocument();
    expect(text("bag-subtotal")).toBe("£8.00");
    expect(text("bag-total")).toBe("£8.00");
  });

  it("with an applied discount the column still adds up to the Total, to the cent", () => {
    store.dispatch(setCartItems([{ ...BURRITO }]));
    store.dispatch(applyOffer({ offer: FLAT_TWO }));
    renderBag();

    expect(text("bag-discounts")).toBe("−£2.00");
    expect(screen.getByTestId("bag-taxes-charges")).toBeInTheDocument();
    expect(columnPence()).toBe(Math.round(amount("bag-total") * 100));
  });

  /*
    The identity holds by construction (Round off is the residual), so the
    money check is that Round off stays a ROUNDING: a discount one line
    counts and another misses (a reward's £17 in Discounts but not in Sub
    Total, a freebie's tax counted twice…) would surface as a Round off of
    pounds. Under disable_roundoff the Total keeps its pence, so a Round off
    row there IS such a miscount.
  */
  it.each([
    // £25.60 − £17 reward; VAT on the £8.60 still paid = 1.29; 9.89 → 10.
    ["a 100 % XENO reward beside a paid row", [{ ...BURRITO }, { ...REWARD }], null, ["£25.60", "−£17.00", "+£1.29", "+£0.11", "£10.00"]],
    // £10.60 − the £2 free sauce; VAT on £8.60 only (the free item carries none).
    ["a 100 % offer freebie beside its buy row", [{ ...BURRITO }, { ...SAUCE_FREE }], FREE_SAUCE_OFFER, ["£10.60", "−£2.00", "+£1.29", "+£0.11", "£10.00"]],
    // £17.20 − £2; VAT on the discounted £15.20 = 2.28; 17.48 → 17.
    ["a £2 order offer on two rows", [{ ...BURRITO }, { ...BURRITO, itemId: "r-2" }], FLAT_TWO, ["£17.20", "−£2.00", "+£2.28", "−£0.48", "£17.00"]],
  ])("%s: every discount is counted once — Round off stays a rounding, and none at all under disable_roundoff", (_label, rows, offer, column) => {
    const mount = (disableRoundoff: boolean) => {
      cleanup();
      store.dispatch(
        setDeploymentInfo(disableRoundoff ? [{ name: "disable_roundoff", selected: true }] : []),
      );
      store.dispatch(setCartItems(rows.map((row) => ({ ...row }))));
      if (offer) store.dispatch(applyOffer({ offer }));
      renderBag();
    };

    mount(false);
    expect(
      ["bag-subtotal", "bag-discounts", "bag-taxes-charges", "bag-round-off", "bag-total"].map(text),
    ).toEqual(column);
    expect(columnPence()).toBe(Math.round(amount("bag-total") * 100));
    expect(Math.abs(amount("bag-round-off"))).toBeLessThanOrEqual(0.5);
    expect(Number.isInteger(amount("bag-total"))).toBe(true);

    mount(true);
    expect(screen.queryByTestId("bag-round-off")).not.toBeInTheDocument();
    expect(columnPence()).toBe(Math.round(amount("bag-total") * 100));
  });

  it("D-U4-2 — inclusive_tax WITH a 5 % charge: Taxes & charges is the charge and its own tax only; the column adds up", () => {
    store.dispatch(setDeploymentInfo([{ name: "inclusive_tax", selected: true }]));
    store.dispatch(setCartItems([{ ...BURRITO }]));
    store.dispatch(pushCharges([SERVICE_5]));
    renderBag();

    // £8.60 carries its VAT inside; 5 % service = 0.43, its 15 % = 0.06.
    expect(text("bag-subtotal")).toBe("£8.60");
    expect(text("bag-taxes-charges")).toBe("+£0.49");
    expect(text("bag-total")).toBe("£9.00");
    expect(text("bag-round-off")).toBe("−£0.09");
    expect(columnPence()).toBe(900);
  });

  it("Arabic: the two labels read the Arabic copy; the amounts stay LTR figures", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    store.dispatch(setCartItems([{ ...BURRITO }]));
    renderBag();

    expect(screen.getByTestId("bag-taxes-charges").parentElement).toHaveTextContent(i18n.t("bag.taxesAndCharges"));
    expect(screen.getByTestId("bag-round-off").parentElement).toHaveTextContent(i18n.t("bag.roundOff"));
    expect(text("bag-taxes-charges")).toBe("+£1.29");
  });
});
