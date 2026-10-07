/**
 * Lane loyalty-visual on the offers RewardsSheet:
 *  - D3 (fork parity — CartRewardsCard blockedByLoyalty): a XENO reward row
 *    in the bag with no offer applied locks the sheet — a pink line says
 *    why (never "remove the reward": a XENO row is removable only when out
 *    of stock), every row is inert, no radio / nudge / ADD ITEMS / rail,
 *    SAVE disabled. An offer applied BEFORE the reward keeps today's sheet
 *    (the fork's asymmetry).
 *  - D2: the Figma 1:3842 geometry (1480 sheet, 48/44 title, 24/24
 *    subtitle, 152 plates, 32/36 titles, 24/24 lines, hairline-top rows).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { applyOffer, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import RewardsSheet from "../RewardsSheet";
import i18n from "../../../i18n";

// The suggested rail's source: one plain (add-intent) item, so the rail
// renders whenever a minBill offer tops the locked rows.
vi.mock("../../../hooks/menuHooks/useCartUpsell", () => ({
  default: () => ({
    items: [{ id: "nachos", name: "Nachos", price: 20 }],
    shouldShowUpsell: true,
    getBreakdown: () => ({}),
  }),
}));

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
};

/** Redeemed XENO reward row (redeemItem + addLoyaltyItemToCart output). */
const REWARD_ROW = {
  id: "5dd1093829754a432f2c32e2",
  itemId: "lr-1",
  uniqueItemId: "lr-1-u",
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
  customizations: {},
};

const SAUCE = {
  id: "tortilla-sauce",
  name: "Tortilla Sauce",
  price: 2,
  subCategoryId: "sauces",
  modifiers: [] as string[],
  hasVariant: false,
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
  applicable: {
    on: "complete",
    categories: [] as unknown[],
    items: [] as unknown[],
    isExclude: false,
    isInclude: false,
    rawItems: [] as unknown[],
  },
  buyItems: {},
  getItems: {},
  itemQuantities: [] as unknown[],
  leastItemValueCount: { buyQuantity: null, getQuantity: null },
  buygetGroupWiseOfferValues: { discountType: "percent", value: null, getQuantity: null, buyQuantity: null },
};

/** Eligible on the £8 bag. */
const FLAT_OFFER = { ...offerBase, _id: "offer-flat-2", name: "£2 off your order", type: { name: "amount", value: 2 } };
const FLAT_3_OFFER = { ...FLAT_OFFER, _id: "offer-flat-3", name: "£3 off your order", type: { name: "amount", value: 3 } };
/** Locked by minBill (£17 short) — the nudge, and the rail under it. */
const MIN_BILL_OFFER = {
  ...offerBase,
  _id: "offer-min-bill",
  name: "25% off over £25",
  type: { name: "percent", value: 25 },
  minBillAmount: 25,
};
/** Gone — isAvailable:false. */
const GONE_OFFER = { ...offerBase, _id: "offer-gone", name: "Expired offer", type: { name: "amount", value: 1 }, isAvailable: false };
/** Locked bogoBuySide with a resolvable buy stage — ADD ITEMS. */
const BOGO_OFFER = {
  ...offerBase,
  _id: "offer-bogo",
  name: "Buy 2 sauces get a Caesar free",
  type: { name: "item", value: 0 },
  applicable: {
    ...offerBase.applicable,
    rawItems: [{ item: { baseItemId: SAUCE.id, name: "Tortilla Sauce" }, quantity: 2, relation: "and" }],
  },
  getItems: {
    items: [
      {
        _id: "gi-caesar",
        baseItemId: "caesar-dressing",
        name: "Caesar Dressing",
        relation: "and",
        discountType: "percent",
        value: 100,
        quantity: 1,
        entities: {
          id: "caesar-dressing",
          name: "Caesar Dressing",
          price: 2,
          modifiers: [] as string[],
          hasVariant: false,
          discountType: "percent",
          discountValue: 100,
          isGetItem: true,
          type: "ITEM",
          discounted_total_price: 0,
          undiscounted_total_price: 2,
        },
      },
    ],
    categories: [] as unknown[],
  },
};

const ROW_IDS = ["offer-flat-2", "offer-min-bill", "offer-gone", "offer-bogo"];

const renderSheet = () => {
  const onClose = vi.fn();
  const onNeedsPicker = vi.fn();
  const onAddItems = vi.fn();
  const { unmount } = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <RewardsSheet open onClose={onClose} onNeedsPicker={onNeedsPicker} onAddItems={onAddItems} />
      </MemoryRouter>
    </Provider>
  );
  return { onClose, onNeedsPicker, onAddItems, unmount };
};

const cartOfferId = () =>
  (store.getState() as unknown as { cart: { cartOffer?: { _id?: string } } }).cart.cartOffer?._id;
const byTestIdPrefix = (prefix: string) => document.querySelectorAll(`[data-testid^="${prefix}"]`);
const lockLine = () => screen.queryByTestId("rewards-loyalty-lock");
const dialog = () => screen.getByRole("dialog", { name: i18n.t("offers.title") });

describe("RewardsSheet — D3: a XENO reward in the bag locks offers (lane loyalty-visual)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setEntityMap({ entityMap: { [SAUCE.id]: SAUCE } }));
    store.dispatch(setFilteredOffers([FLAT_OFFER, MIN_BILL_OFFER, GONE_OFFER, BOGO_OFFER]));
  });

  it("control — no reward: today's sheet (radio, radiogroup, live SAVE, no lock line)", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    renderSheet();

    expect(lockLine()).toBeNull();
    expect(dialog()).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-label", i18n.t("offers.subtitle"));
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveAttribute("role", "radio");
    expect(screen.getByTestId("offer-radio-offer-flat-2")).toBeInTheDocument();
    expect(screen.getByTestId("rewards-save")).toBeEnabled();
  });

  // Each locked-row affordance, shown without the reward and gone with it
  // (the rail needs a minBill offer on top of the locked rows, so the two
  // affordances get their own offer lists).
  it.each([
    ["the minBill nudge and the suggested rail", [FLAT_OFFER, MIN_BILL_OFFER, GONE_OFFER], ["offer-row-nudge-offer-min-bill", "offer-suggested-rail"]],
    ["ADD ITEMS on a bogoBuySide row", [FLAT_OFFER, BOGO_OFFER], ["offer-row-add-items-offer-bogo"]],
  ])("%s: shown without the reward, gone under the lock", (_label, offers, testIds) => {
    store.dispatch(setFilteredOffers(offers));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    const view = renderSheet();
    for (const testId of testIds) expect(screen.getByTestId(testId)).toBeInTheDocument();
    view.unmount();

    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    renderSheet();
    expect(lockLine()).toBeInTheDocument();
    for (const testId of testIds) expect(screen.queryByTestId(testId)).toBeNull();
  });

  it("locked: the pink line describes the dialog; every row is inert — no radio, nudge, ADD ITEMS or rail — and SAVE is disabled", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    renderSheet();

    const line = screen.getByTestId("rewards-loyalty-lock");
    expect(line).toHaveTextContent("Offers can't be combined with a redeemed reward");
    expect(line).toHaveAttribute("id", "rewards-loyalty-lock");
    // Never a "remove the reward" instruction (XENO rows are removable only when out of stock).
    expect(line).not.toHaveTextContent(/remove/i);
    expect(dialog()).toHaveAttribute("aria-describedby", "rewards-loyalty-lock");
    expect(dialog()).toHaveAccessibleDescription("Offers can't be combined with a redeemed reward");

    for (const id of ROW_IDS) {
      const row = screen.getByTestId(`offer-row-${id}`);
      expect(row.tagName, id).toBe("DIV");
      expect(row, id).toHaveAttribute("aria-disabled", "true");
      expect(row.querySelector("button"), id).toBeNull();
    }
    expect(screen.queryAllByRole("radio")).toEqual([]);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    // The role-less list carries no name either (ARIA 1.2: a generic div prohibits aria-label).
    expect(screen.getByTestId("offer-row-offer-flat-2").parentElement).not.toHaveAttribute("aria-label");
    expect(byTestIdPrefix("offer-radio-")).toHaveLength(0);
    expect(byTestIdPrefix("offer-row-add-items-")).toHaveLength(0);
    expect(byTestIdPrefix("offer-row-nudge-")).toHaveLength(0);
    expect(screen.queryByTestId("offer-suggested-rail")).toBeNull();
    expect(screen.getByTestId("rewards-save")).toBeDisabled();
    // The rows stay informational: the offer and its saving still read.
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveTextContent("Save £2.00");
  });

  it("locked: tapping a row and SAVE commits nothing and keeps the sheet open", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    const { onClose, onNeedsPicker } = renderSheet();

    await userEvent.click(screen.getByTestId("offer-row-offer-flat-2"));
    await userEvent.click(screen.getByTestId("rewards-save"));

    expect(cartOfferId()).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
    expect(onNeedsPicker).not.toHaveBeenCalled();
    expect(screen.getByTestId("rewards-sheet")).toBeInTheDocument();
  });

  it("an OUT-OF-STOCK reward row locks too", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW, outOfStock: true }]));
    renderSheet();

    expect(lockLine()).toBeInTheDocument();
    expect(screen.getByTestId("rewards-save")).toBeDisabled();
  });

  it("the lock follows the live bag: the reward leaving an open sheet brings the radios back", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    renderSheet();
    expect(lockLine()).toBeInTheDocument();

    act(() => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    });

    expect(lockLine()).toBeNull();
    expect(dialog()).not.toHaveAttribute("aria-describedby");
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveAttribute("role", "radio");
    expect(screen.getByTestId("rewards-save")).toBeEnabled();
  });

  it("asymmetry: an offer applied BEFORE the reward keeps today's sheet — preselected, swappable", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    store.dispatch(setFilteredOffers([FLAT_OFFER, FLAT_3_OFFER]));
    const { onClose } = renderSheet();

    expect(lockLine()).toBeNull();
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByTestId("offer-row-offer-flat-2")).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByTestId("offer-row-offer-flat-3"));
    await userEvent.click(screen.getByTestId("rewards-save"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cartOfferId()).toBe("offer-flat-3");
  });
});

describe("RewardsSheet — D2 geometry (Figma 1:3842, lane loyalty-visual)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(setFilteredOffers([FLAT_OFFER, MIN_BILL_OFFER]));
  });

  it("1480 sheet, H3 48/44 title, Rg 24/24 subtitle, the list 64 below the heading with no container rule", () => {
    renderSheet();

    expect(dialog().className).toContain("h-[min(1480px,calc(100%_-_96px))]");
    const title = document.getElementById("rewards-sheet-title");
    expect(title).toHaveTextContent(i18n.t("offers.title"));
    expect(title).toHaveClass("text-[48px]", "leading-[44px]");
    const subtitle = screen.getByText(i18n.t("offers.subtitle"), { selector: "p" });
    expect(subtitle).toHaveClass("text-[24px]", "leading-[24px]", "text-tb-ink-purple");
    expect(subtitle.parentElement).toHaveClass("pb-[64px]");
    const list = screen.getByRole("radiogroup");
    expect(list).not.toHaveClass("border-t");
  });

  it("rows: a hairline ABOVE each row inside the 24 gap (200 pitch), 152 plate, 32/36 title, 24/24 second line", () => {
    renderSheet();

    for (const id of ["offer-flat-2", "offer-min-bill"]) {
      const row = screen.getByTestId(`offer-row-${id}`);
      expect(row, id).toHaveClass("border-t", "border-tb-grey-4", "pt-[23px]", "pb-[24px]");
      expect(row, id).not.toHaveClass("border-b");
      expect(row.querySelector(".h-\\[152px\\].w-\\[152px\\]"), id).not.toBeNull();
    }
    expect(screen.getByText("£2 off your order")).toHaveClass("text-[32px]", "leading-[36px]", "font-medium");
    expect(screen.getByText("Save £2.00")).toHaveClass("text-[24px]", "leading-[24px]");
  });
});
