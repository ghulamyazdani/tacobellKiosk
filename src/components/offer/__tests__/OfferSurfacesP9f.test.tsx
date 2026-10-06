/**
 * P9f rules on the offers lane's surfaces (merge of main into lane offers):
 *  - named dialogs: the rewards sheet (aria-modal — nothing stacks over it),
 *    the freebie picker and the buy stage (NOT aria-modal — the in-bag PDP
 *    host stacks over both);
 *  - menu names at RENDER (useLocalized): the rewards rail card, the freebie
 *    rows (+ a fixed size, + the group "−" label) and the buy-stage tiles show
 *    the menu's `ar` alias, FSI…PDI isolated; offer names stay English (no
 *    per-language data) and the cart keeps the raw (primary) names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  resolveBuyStageView,
  type BuyStageOffer,
} from "@cx-sdk/ordering/offer/buyStageUtils";
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import RewardsSheet from "../RewardsSheet";
import FreebiePickerSheet from "../FreebiePickerSheet";
import BuyStageSheet from "../BuyStageSheet";
import i18n from "../../../i18n";

const AR = (value: string) => [{ value, name: "Arabic", code: "ar", dir: "rtl" }];
const iso = (s: string) => `⁨${s}⁩`;
const AR_NACHOS = "ناتشوز";
const AR_SAUCE = "صلصة التورتيلا";
const AR_FRIES = "بطاطس";
const AR_LARGE = "كبير";

const NACHOS = { id: "nachos", name: "Nachos", price: 20, aliases: AR(AR_NACHOS) };

// The rail's source: one plain (add-intent) suggestion with an ar alias.
vi.mock("../../../hooks/menuHooks/useCartUpsell", () => ({
  default: () => ({ items: [NACHOS], shouldShowUpsell: true, getBreakdown: () => ({}) }),
}));

type Row = { id?: string; name?: string; isGetItem?: boolean };
const cartRows = () => (store.getState() as unknown as { cart: { cartItems: Row[] } }).cart.cartItems;

const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  quantity: 1,
  type: "ITEM",
  price: 8,
  total_price: 8,
  customizations: {},
  baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8 },
};

const offerBase = {
  isAvailable: true,
  isComplimentary: false,
  autoApplied: false,
  sameOrLess: false,
  getItemOnly: false,
  getLeastValueItem: false,
  buygetItemOnly: false,
  buygetGroupWiseOffer: false,
  dynamicItemExpressOffer: false,
  minBillAmount: null as number | null,
  minItemCount: null as number | null,
  maxDiscount: null as number | null,
  isAndOffer: true,
  applicable: { on: "complete", categories: [], items: [], isExclude: false, isInclude: false, rawItems: [] },
  buyItems: {},
  getItems: {},
  itemQuantities: [],
  leastItemValueCount: { buyQuantity: null, getQuantity: null },
  buygetGroupWiseOfferValues: { discountType: "percent", value: null, getQuantity: null, buyQuantity: null },
};

/** LOCKED by minBill against the £8 cart — the rail shows under it. */
const MIN_BILL_OFFER = {
  ...offerBase,
  _id: "offer-min-bill",
  name: "25% off over £25",
  type: { name: "percent", value: 25 },
  minBillAmount: 25,
};

const sauceEntity = {
  id: "tortilla-sauce",
  name: "Tortilla Sauce",
  aliases: AR(AR_SAUCE),
  price: 2,
  modifiers: [],
  hasVariant: false,
  isGetItem: true,
  type: "ITEM",
  discounted_total_price: 0,
  undiscounted_total_price: 2,
};
/** A fixed-size grant: the offer gives THIS size (converter isVariantSelected). */
const largeFries = {
  id: "fries",
  name: "Fries",
  aliases: AR(AR_FRIES),
  type: "VARIANT",
  isVariantSelected: true,
  selectedVariant: { id: "fries-l", name: "Large", aliases: AR(AR_LARGE), price: 5, isActive: true },
  price: 5,
  isGetItem: true,
  discounted_total_price: 0,
  undiscounted_total_price: 5,
};
const getEntry = (id: string, entities: object) => ({
  _id: `gi-${id}`,
  baseItemId: id,
  relation: "or",
  discountType: "percent",
  value: 100,
  quantity: 1,
  type: "ITEM",
  entities,
});
const CHOICE_OFFER = {
  ...offerBase,
  _id: "offer-choice",
  name: "Free side",
  type: { name: "item", value: 0 },
  getItemOnly: true,
  isAndOffer: false,
  getItems: { items: [getEntry("tortilla-sauce", sauceEntity), getEntry("fries-l", largeFries)] },
};
const GROUP_OFFER = {
  ...CHOICE_OFFER,
  _id: "offer-group",
  buygetGroupWiseOffer: true,
  buygetGroupWiseOfferValues: { discountType: "percent", value: 100, getQuantity: 2, buyQuantity: 1 },
};

const SAUCE = { id: "tortilla-sauce", name: "Tortilla Sauce", aliases: AR(AR_SAUCE), price: 2, subCategoryId: "sauces", modifiers: [], hasVariant: false };
const BOGO = {
  ...offerBase,
  _id: "offer-bogo",
  name: "Buy 2 sauces get a Caesar free",
  type: { name: "item", value: 0 },
  applicable: {
    on: "complete",
    isExclude: false,
    isInclude: false,
    rawItems: [{ item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: 2, relation: "and" }],
  },
  getItems: { items: [] },
};

const wrap = (ui: ReactNode) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>{ui}</MemoryRouter>
    </Provider>
  );
const renderRewards = () => wrap(<RewardsSheet open onClose={vi.fn()} />);
const renderPicker = (offer: object) => {
  const onClose = vi.fn();
  wrap(<FreebiePickerSheet open offer={offer} onClose={onClose} />);
  return onClose;
};
const renderStage = (offer: object = BOGO) => {
  const view = resolveBuyStageView(offer as BuyStageOffer, { [SAUCE.id]: SAUCE }, {}, {});
  if (!view) throw new Error("fixture offer must resolve a buy stage");
  wrap(
    <BuyStageSheet
      stage={{ offer: offer as SavingsOffer, view }}
      continuing={false}
      blockedMessage={null}
      onBack={vi.fn()}
      onClose={vi.fn()}
      onContinue={vi.fn()}
    />
  );
};

const arabicSession = async () => {
  store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
  await act(async () => {
    await i18n.changeLanguage("ar");
  });
};

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setEntityMap({ entityMap: { [SAUCE.id]: SAUCE } }));
  store.dispatch(setCartItems([{ ...BURGER_ROW }]));
  store.dispatch(setFilteredOffers([MIN_BILL_OFFER]));
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("named dialogs", () => {
  it("the rewards sheet is a named modal dialog", () => {
    renderRewards();
    expect(screen.getByRole("dialog", { name: "Rewards" })).toHaveAttribute("aria-modal", "true");
  });

  it("the freebie picker is named, NOT aria-modal (the in-bag PDP stacks over it)", () => {
    renderPicker(CHOICE_OFFER);
    expect(screen.getByRole("dialog", { name: "Choose Your Free Item" })).not.toHaveAttribute("aria-modal");
  });

  it("the buy stage is named by its offer heading, NOT aria-modal (same reason)", () => {
    renderStage();
    expect(screen.getByRole("dialog", { name: BOGO.name })).not.toHaveAttribute("aria-modal");
  });
});

describe("menu names at render (Arabic session)", () => {
  it("rewards rail: the card shows and is named by the alias; the offer name stays English", async () => {
    await arabicSession();
    renderRewards();
    const card = screen.getByTestId("offer-suggested-item-nachos");
    expect(card).toHaveAccessibleName(iso(AR_NACHOS));
    expect(card).toHaveTextContent(iso(AR_NACHOS), { normalizeWhitespace: false });
    expect(card).not.toHaveTextContent("Nachos");
    expect(screen.getByTestId("offer-row-offer-min-bill")).toHaveTextContent(MIN_BILL_OFFER.name);
  });

  it("freebie rows show the alias and the fixed size's alias; CONFIRM commits the raw names", async () => {
    await arabicSession();
    const onClose = renderPicker(CHOICE_OFFER);
    expect(screen.getByTestId("freebie-option-tortilla-sauce")).toHaveTextContent(iso(AR_SAUCE), {
      normalizeWhitespace: false,
    });
    const fries = screen.getByTestId("freebie-option-fries");
    expect(fries).toHaveTextContent(iso(AR_FRIES), { normalizeWhitespace: false });
    expect(fries).toHaveTextContent(iso(AR_LARGE), { normalizeWhitespace: false });
    expect(fries).not.toHaveTextContent("Large");

    await userEvent.click(screen.getByTestId("freebie-option-tortilla-sauce"));
    await userEvent.click(screen.getByTestId("freebie-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(cartRows().filter((row) => row.isGetItem).map((row) => row.name)).toEqual(["Tortilla Sauce"]);
  });

  it("group mode: the '−' is named with the alias", async () => {
    await arabicSession();
    renderPicker(GROUP_OFFER);
    await userEvent.click(screen.getByTestId("freebie-option-tortilla-sauce"));
    expect(screen.getByTestId("freebie-dec-tortilla-sauce")).toHaveAccessibleName(
      i18n.t("offers.buyStage.decrease", { name: iso(AR_SAUCE) })
    );
  });

  it("buy-stage tiles show the alias; '+' adds the raw entity", async () => {
    await arabicSession();
    renderStage();
    const tile = screen.getByTestId(`buy-stage-tile-${SAUCE.id}`);
    expect(tile).toHaveTextContent(iso(AR_SAUCE), { normalizeWhitespace: false });
    expect(tile).not.toHaveTextContent("Tortilla Sauce");

    await userEvent.click(screen.getByTestId(`buy-stage-add-${SAUCE.id}`));
    expect(cartRows().find((row) => row.id === SAUCE.id)?.name).toBe("Tortilla Sauce");
  });
});
