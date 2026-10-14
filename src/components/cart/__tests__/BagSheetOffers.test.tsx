/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart-row and offer fixtures mirror the untyped legacy cart slice /
 * converter output; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setCartItems,
  applyOffer,
  openOfferRemovalModal,
} from "@cx-sdk/ordering/state/cart.slice";
import { setFilteredOffers } from "@cx-sdk/ordering/state/offer.slice";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  setCurrency,
  setDeploymentInfo,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { CartRehydratedContext } from "../../../hooks/utils/useCartRehydrated";
import BagSheet from "../BagSheet";
import "../../../i18n";

/** Paid CUSTOMIZABLE row, £8.60 line (P7a BagSheet fixture parity). */
const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 8.6,
  customizations: {
    sauce_group: [{ id: "onions", name: "Add Onions", price: 0.6, quantity: 1 }],
  },
  baseItem: {
    id: "cheese-burger",
    name: "Cheese Burger",
    price: 8,
    modifiers: ["sauce_group"],
  },
};

/** Second paid row (£3 × 2) so the cart survives removing the burger. */
const DRINK_ROW = {
  id: "pepsi",
  itemId: "pep-1",
  uniqueItemId: "pep-1-u",
  name: "Pepsi",
  quantity: 2,
  type: "VARIANT",
  price: 0,
  variantPrice: 3,
  baseItemPrice: 0,
  total_price: 3,
  selectedVariant: { id: "pepsi-l", name: "Large", price: 3 },
  customizations: {},
  baseItem: { id: "pepsi", name: "Pepsi", hasVariant: true },
};

/** COMMITTED freebie row — the shape redeemGetItem stamps (scenario 5). */
const SALAD_FREEBIE_ROW = {
  id: "greek-salad",
  itemId: "gs-1",
  uniqueItemId: "gs-1",
  name: "Greek Salad",
  quantity: 1,
  type: "ITEM",
  price: 17,
  total_price: 17,
  undiscounted_total_price: 17,
  discounted_total_price: 0,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  customizations: {},
};

const saladEntity = {
  id: "greek-salad",
  name: "Greek Salad",
  price: 17,
  modifiers: [] as any[],
  hasVariant: false,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  type: "ITEM",
  discounted_total_price: 0,
  undiscounted_total_price: 17,
};

const SALAD_ENTRY = {
  _id: "gi-salad",
  baseItemId: "greek-salad",
  name: "Greek Salad",
  relation: "and",
  discountType: "percent",
  value: 100,
  quantity: 1,
  type: "ITEM",
  entities: saladEntity,
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
    categories: [] as any[],
    items: [] as any[],
    isExclude: false,
    isInclude: false,
    rawItems: [] as any[],
  },
  buyItems: {},
  getItems: {},
  itemQuantities: [] as any[],
  leastItemValueCount: { buyQuantity: null, getQuantity: null },
  buygetGroupWiseOfferValues: {
    discountType: "percent",
    value: null,
    getQuantity: null,
    buyQuantity: null,
  },
};

const FLAT_OFFER = {
  ...offerBase,
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
};

const FREE_SALAD_OFFER = {
  ...offerBase,
  _id: "offer-free-salad",
  name: "Free Greek Salad",
  type: { name: "item", value: 0 },
  getItemOnly: true,
  getItems: { items: [SALAD_ENTRY] },
};

/**
 * BOGO-shaped offer whose buy side is the Cheese Burger — removing the
 * burger row must break check 6 (isBOGOOfferApplicable) and auto-remove it.
 */
const BOGO_OFFER = {
  ...offerBase,
  _id: "offer-bogo-burger",
  name: "Burger BOGO",
  type: { name: "item", value: 0 },
  applicable: {
    on: "complete",
    categories: [] as any[],
    items: [] as any[],
    isExclude: false,
    isInclude: false,
    rawItems: [
      {
        relation: "and",
        quantity: 1,
        item: { baseItemId: "cheese-burger", name: "Cheese Burger" },
      },
    ],
  },
  getItems: { items: [SALAD_ENTRY] },
};

const renderSheet = (open = true, onClose = vi.fn()) => {
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagSheet open={open} onClose={onClose} />
      </MemoryRouter>
    </Provider>
  );
  return { ...utils, onClose };
};

const cartState = () => (store.getState() as any).cart;

describe("BagSheet offers vertical (Figma 1:3137 — Rewards in MY BAG)", () => {
  beforeAll(async () => {
    // The ONE lazy chunk, once: a cold transform under load outlasted
    // findByTestId's 1 s (the rewards-sheet tests flaked in a full chunk run).
    await import("../bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    // GBP-style deployment: keep pence out of the round-off so every asserted
    // figure is exact (P7a bill-line test precedent).
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
  });

  it("no offers and none applied: no Rewards section at all", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    renderSheet();
    expect(screen.queryByTestId("bag-rewards-entry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-rewards-applied")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-discounts")).not.toBeInTheDocument();
  });

  it("unapplied entry row (decision 5): Rewards & Offers + top-ranked offer name; tap opens the RewardsSheet", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(setFilteredOffers([FLAT_OFFER]));
    renderSheet();

    const entry = screen.getByTestId("bag-rewards-entry");
    expect(entry).toHaveTextContent("Rewards & Offers");
    expect(entry).toHaveTextContent("£2 off your order"); // best ranked name
    expect(screen.queryByTestId("rewards-sheet")).not.toBeInTheDocument();

    await userEvent.click(entry);
    // Lazy (bagLazyParts): the sheet mounts once its chunk resolves.
    expect(await screen.findByTestId("rewards-sheet")).toBeInTheDocument();
  });

  it("walk 2026-10-14: the entry row's offer name takes the rows' casing (CSS capitalize), never the raw 'amount ic'", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(setFilteredOffers([{ ...FLAT_OFFER, name: "amount ic" }]));
    renderSheet();
    const teaser = within(screen.getByTestId("bag-rewards-entry")).getByText("amount ic");
    expect(teaser).toHaveClass("capitalize");
  });

  it("offers-parity (review 1 F-5): the entry row never names a 'Not available right now' offer — a sold-out buy side", () => {
    // The Caesar is on the menu but sold out: the offer ranks as the gone row.
    const soldOut = {
      ...BOGO_OFFER,
      _id: "offer-sold-out-caesar",
      name: "Buy a Caesar, get a salad",
      applicable: {
        ...BOGO_OFFER.applicable,
        rawItems: [{ relation: "and", quantity: 1, item: { baseItemId: "caesar", name: "Caesar" }, isRawItemAvailable: false }],
      },
    };
    store.dispatch(setEntityMap({ entityMap: { caesar: { id: "caesar", name: "Caesar Dressing", price: 2, outOfStock: true } } }));
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(setFilteredOffers([soldOut]));
    renderSheet();

    const entry = screen.getByTestId("bag-rewards-entry");
    expect(entry).toHaveTextContent("Rewards & Offers");
    expect(entry).not.toHaveTextContent(soldOut.name);
  });

  it("ghost-tap guard: closing a sheet that sits over PAY covers the CTA bar briefly, then clears", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(setFilteredOffers([FLAT_OFFER]));
    renderSheet();
    expect(screen.queryByTestId("bag-cta-tap-guard")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("bag-rewards-entry"));
    await userEvent.click(await screen.findByTestId("rewards-close"));
    expect(screen.queryByTestId("rewards-sheet")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-cta-tap-guard")).toBeInTheDocument();
    await waitFor(
      () => expect(screen.queryByTestId("bag-cta-tap-guard")).not.toBeInTheDocument(),
      { timeout: 1500 }
    );
  });

  it("ghost-tap guard: the bag OPENING (the menu's VIEW MY BAG overlaps PAY) covers the CTA bar briefly, then clears", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    const { rerender, onClose } = renderSheet(false);
    rerender(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <BagSheet open onClose={onClose} />
        </MemoryRouter>
      </Provider>
    );
    expect(screen.getByTestId("bag-cta-tap-guard")).toBeInTheDocument();
    await waitFor(
      () => expect(screen.queryByTestId("bag-cta-tap-guard")).not.toBeInTheDocument(),
      { timeout: 1500 }
    );
  });

  it("applied offer: applied row with Save line and −£X, Discounts bill line, and the ORDER & PAY CTA (real bill figures)", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    renderSheet();

    const applied = screen.getByTestId("bag-rewards-applied");
    expect(applied).toHaveTextContent("£2 off your order");
    expect(applied).toHaveTextContent("Save £2.00");
    expect(applied).toHaveTextContent("−£2.00"); // U+2212 minus (brief literal)
    expect(screen.getByTestId("bag-rewards-remove")).toBeInTheDocument();
    expect(screen.queryByTestId("bag-rewards-entry")).not.toBeInTheDocument();

    // Bill block: 8.60 − 2.00 = 6.60, discount line between Sub Total & Total.
    expect(screen.getByTestId("bag-subtotal")).toHaveTextContent("£8.60");
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£2.00");
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£6.60");
    const pay = screen.getByTestId("bag-pay");
    expect(pay).toHaveTextContent("Order & Pay");
    expect(pay).toHaveTextContent("£6.60");
  });

  it("motion §3.1: the applied row squeezes through its DIRECT empty overlay (tb-press-card), never through Remove", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    renderSheet();

    const applied = screen.getByTestId("bag-rewards-applied");
    expect(applied).toHaveClass("tb-press-card");
    const overlays = applied.querySelectorAll(":scope > button:empty");
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toHaveAttribute("aria-label");
    expect(applied.querySelector(":scope > button:empty")).not.toBe(screen.getByTestId("bag-rewards-remove"));
  });

  it("applied row: its named overlay (LAST child) reopens the RewardsSheet — the only path to a swap", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    renderSheet();

    const overlay = screen.getByRole("button", { name: "Rewards & Offers" });
    // Last in the row so it paints over the bell's opacity/mask layer; Remove sits above it.
    expect(screen.getByTestId("bag-rewards-applied").lastElementChild).toBe(overlay);
    expect(screen.getByTestId("bag-rewards-remove")).toHaveClass("relative", "z-10");
    expect(screen.queryByTestId("rewards-sheet")).not.toBeInTheDocument();

    await userEvent.click(overlay);
    expect(await screen.findByTestId("rewards-sheet")).toBeInTheDocument();
  });

  it("Remove (direct removal): clears the slot with NO notice; discounts line and CTA flip back", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    renderSheet();

    await userEvent.click(screen.getByTestId("bag-rewards-remove"));

    await waitFor(() =>
      expect(screen.queryByTestId("bag-rewards-applied")).not.toBeInTheDocument()
    );
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(screen.queryByTestId("bag-discounts")).not.toBeInTheDocument();
    const pay = screen.getByTestId("bag-pay");
    expect(pay).not.toHaveTextContent("Order & Pay");
    expect(pay).toHaveTextContent("Pay");
    expect(pay).toHaveTextContent("£8.60");
    // Direct removal is notice-free (fork parity — scenario 4).
    expect(cartState().offerRemovalModal.isOpen).toBe(false);
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();
    // Remove never opens the sheet — nor its loading scrim (a cold chunk).
    expect(screen.queryByTestId("rewards-sheet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rewards-loading")).not.toBeInTheDocument();
  });

  it("committed freebie row (scenario 5): Free chip, struck £17.00 over £0.00, no stepper; bill reflects the row-stamp discount", () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...SALAD_FREEBIE_ROW }]));
    store.dispatch(applyOffer({ offer: FREE_SALAD_OFFER }));
    renderSheet();

    // The freebie survives revalidation (checks count PAID rows only).
    const row = screen.getByTestId("bag-row-gs-1");
    expect(screen.getByTestId("bag-free-chip-gs-1")).toHaveTextContent("Free");
    expect(row).toHaveTextContent("£17.00"); // struck undiscounted line
    expect(row).toHaveTextContent("£0.00"); // discounted price shown
    // isGetItem rows never get a stepper (isPaidRow excludes them).
    expect(screen.queryByTestId("bag-dec-gs-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-inc-gs-1")).not.toBeInTheDocument();

    // Bill: subtotal 8.60 + 17.00 = 25.60; discount 17.00 → total 8.60.
    expect(screen.getByTestId("bag-subtotal")).toHaveTextContent("£25.60");
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£17.00");
    expect(screen.getByTestId("bag-total")).toHaveTextContent("£8.60");
    expect(screen.getByTestId("bag-rewards-applied")).toHaveTextContent(
      "Save £17.00"
    );
  });

  // Review of the walk fixes: the bag read "Save £5.40" while the reopened
  // sheet's APPLIED row read "Save up to £6.20". The sheet's applied row now
  // restates the bag's own figure.
  it("the reopened sheet's APPLIED row reads the bag's 'Save £X', never the offer's 'up to' ceiling", async () => {
    // "A salad (£17) or a sauce (£2)", the guest took the sauce.
    const sauceEntry = {
      ...SALAD_ENTRY,
      _id: "gi-sauce",
      baseItemId: "tortilla-sauce",
      name: "Tortilla Sauce",
      relation: "or",
      entities: { ...saladEntity, id: "tortilla-sauce", name: "Tortilla Sauce", price: 2, undiscounted_total_price: 2 },
    };
    const SALAD_OR_SAUCE = {
      ...FREE_SALAD_OFFER,
      _id: "offer-salad-or-sauce",
      name: "A salad or a sauce",
      isAndOffer: false,
      getItems: { items: [{ ...SALAD_ENTRY, relation: "or" }, sauceEntry] },
    };
    const sauceReward = {
      ...SALAD_FREEBIE_ROW,
      id: "tortilla-sauce",
      itemId: "ts-1",
      uniqueItemId: "ts-1",
      name: "Tortilla Sauce",
      price: 2,
      total_price: 2,
      undiscounted_total_price: 2,
    };
    store.dispatch(setCartItems([{ ...BURGER_ROW }, sauceReward]));
    store.dispatch(setFilteredOffers([SALAD_OR_SAUCE]));
    store.dispatch(applyOffer({ offer: SALAD_OR_SAUCE }));
    renderSheet();
    expect(screen.getByTestId("bag-rewards-applied")).toHaveTextContent("Save £2.00");

    await userEvent.click(screen.getByRole("button", { name: "Rewards & Offers" }));
    const applied = await screen.findByTestId("offer-row-body-offer-salad-or-sauce");
    expect(applied).toHaveTextContent("Applied");
    expect(applied).toHaveTextContent("Save £2.00");
    expect(applied).not.toHaveTextContent("Save up to £17.00");
  });

  it("REVALIDATION: removing the BOGO's buy-side row auto-removes the offer and opens the removal notice; GOT IT closes it", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...DRINK_ROW }]));
    store.dispatch(applyOffer({ offer: BOGO_OFFER }));
    const { onClose } = renderSheet();

    // Sanity: buy side satisfied on open — the offer survives the first pass.
    expect(cartState().cartOffer._id).toBe("offer-bogo-burger");
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();

    // Remove the qualifying burger (qty 1 → REMOVE ITEM confirm, P7a flow).
    await userEvent.click(screen.getByTestId("bag-dec-cb-1"));
    await userEvent.click(screen.getByTestId("remove-item-confirm"));

    await waitFor(() =>
      expect(cartState().offerRemovalModal.isOpen).toBe(true)
    );
    expect(cartState().offerRemovalModal.data._id).toBe("offer-bogo-burger");
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);

    // The notice restates the offer, the WHY (bogo buy side), and the new total.
    const notice = screen.getByTestId("offer-removal-notice");
    expect(notice).toHaveTextContent("Reward Removed");
    expect(notice).toHaveTextContent(
      "Burger BOGO no longer applies to your order."
    );
    expect(notice).toHaveTextContent(
      "Add the qualifying items to unlock this reward"
    );
    expect(notice).toHaveTextContent("Your total is now £6.00"); // 2 × £3 left

    await userEvent.click(screen.getByTestId("offer-removal-gotit"));
    expect(cartState().offerRemovalModal.isOpen).toBe(false);
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();
    // The bag stays up — the drink row still holds the cart open.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("bag-row-pep-1")).toBeInTheDocument();
  });

  /*
    Walk 2026-10-14 + user decision: a min-bill reward the bag dropped under
    stayed applied at "−£0.00" (the engine refused its discount) with no
    notice. Revalidation check 8 removes it the way the min-items and BOGO
    checks do, judged on posistKiosk's money (Cart.tsx offerQualifyingBill):
    the guest's own spend — freebie and loyalty rows filtered out — as one
    bill; onGrossTotal offers its net payable, the rest its item subtotal.
  */
  const MIN_BILL_OFFER = {
    ...offerBase,
    _id: "offer-25-over-10",
    name: "25% off orders over £10",
    type: { name: "percent", value: 25 },
    maxDiscount: 150,
    minBillAmount: 10,
  };

  it("REVALIDATION (walk repro): deleting a line takes the bag under a min-bill reward's minimum — the reward goes WITH the notice, which says how much more to add; no −£0.00 row stays", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...DRINK_ROW }]));
    store.dispatch(applyOffer({ offer: MIN_BILL_OFFER }));
    const { onClose } = renderSheet();

    // £14.60 clears the £10 minimum: applied, 25 % off.
    expect(cartState().cartOffer._id).toBe("offer-25-over-10");
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£3.65");
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("bag-dec-cb-1"));
    await userEvent.click(screen.getByTestId("remove-item-confirm"));

    // £6.00 left: under the minimum.
    await waitFor(() => expect(cartState().offerRemovalModal.isOpen).toBe(true));
    expect(cartState().offerRemovalModal.data._id).toBe("offer-25-over-10");
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    const notice = screen.getByTestId("offer-removal-notice");
    expect(notice).toHaveTextContent("25% off orders over £10 no longer applies to your order.");
    expect(notice).toHaveTextContent("Add £4.00+ to your order to be eligible to redeem this reward");
    expect(notice).toHaveTextContent("Your total is now £6.00");
    expect(screen.queryByTestId("bag-rewards-applied")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-discounts")).not.toBeInTheDocument();
    // The drink still holds the bag open.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("bag-row-pep-1")).toBeInTheDocument();
  });

  it("REVALIDATION: a bag AT the minimum keeps the reward; one unit under, it goes with the notice", async () => {
    // 2 × £3 = £6.00 against a £6 minimum.
    store.dispatch(setCartItems([{ ...DRINK_ROW }]));
    store.dispatch(applyOffer({ offer: { ...MIN_BILL_OFFER, minBillAmount: 6 } }));
    renderSheet();
    expect(cartState().cartOffer._id).toBe("offer-25-over-10");
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£1.50");
    expect(cartState().offerRemovalModal.isOpen).toBe(false);

    await userEvent.click(screen.getByTestId("bag-dec-pep-1"));
    await waitFor(() => expect(cartState().offerRemovalModal.isOpen).toBe(true));
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(screen.getByTestId("offer-removal-notice")).toHaveTextContent(
      "Add £3.00+ to your order to be eligible to redeem this reward"
    );
  });

  it("REVALIDATION: the minimum is the guest's OWN spend — a freebie row never holds a min-bill reward up (it goes, and its freebie with it)", () => {
    // £8.60 paid + the £17 free salad: £25.60 in the bag, £8.60 of it the guest's.
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...SALAD_FREEBIE_ROW }]));
    store.dispatch(applyOffer({ offer: { ...FREE_SALAD_OFFER, minBillAmount: 10 } }));
    renderSheet();

    expect(cartState().offerRemovalModal.isOpen).toBe(true);
    expect(cartState().offerRemovalModal.data._id).toBe("offer-free-salad");
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(cartState().cartItems.map(({ itemId }: { itemId: string }) => itemId)).toEqual(["cb-1"]);
    expect(screen.getByTestId("offer-removal-notice")).toHaveTextContent(
      "Add £1.40+ to your order to be eligible to redeem this reward"
    );
  });

  it("REVALIDATION: …nor does a XENO reward row — its £17 is the loyalty programme's, not the guest's spend", () => {
    const REWARD_ROW = {
      id: "greek-salad",
      itemId: "lr-1",
      uniqueItemId: "lr-1-u",
      name: "Greek Salad",
      quantity: 1,
      type: "ITEM",
      isLoyaltyItem: true,
      isRedeemed: true,
      discount_type: "percentage",
      discount_value: 100,
      price: 0,
      total_price: 0,
      undiscounted_price: 17,
      undiscounted_total_price: 17,
      extra_fields: [{ name: "Points Value", value: 3000 }],
      customizations: {},
    };
    store.dispatch(setCartItems([{ ...BURGER_ROW }, REWARD_ROW]));
    store.dispatch(applyOffer({ offer: { ...FLAT_OFFER, minBillAmount: 10 } }));
    renderSheet();

    expect(cartState().offerRemovalModal.isOpen).toBe(true);
    expect(cartState().offerRemovalModal.data._id).toBe("offer-flat-2");
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    // The reward row is the loyalty flow's: it stays.
    expect(cartState().cartItems.map(({ itemId }: { itemId: string }) => itemId)).toEqual(["cb-1", "lr-1"]);
  });

  it("REVALIDATION (posistKiosk parity): an onGrossTotal reward is measured on the NET payable — this bill's own discount included — the rest on the item subtotal", () => {
    // £14.60 of items, £5 off, £10 minimum: net £9.60, subtotal £14.60.
    const GROSS_FIVE = {
      ...FLAT_OFFER,
      _id: "offer-gross-5",
      type: { name: "amount", value: 5 },
      minBillAmount: 10,
      onGrossTotal: true,
    };
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...DRINK_ROW }]));
    store.dispatch(applyOffer({ offer: { ...GROSS_FIVE, onGrossTotal: false } }));
    const { unmount } = renderSheet();
    expect(cartState().cartOffer._id).toBe("offer-gross-5");
    expect(cartState().offerRemovalModal.isOpen).toBe(false);
    unmount();

    store.dispatch(applyOffer({ offer: GROSS_FIVE }));
    renderSheet();
    expect(cartState().offerRemovalModal.isOpen).toBe(true);
    expect(cartState().offerRemovalModal.data._id).toBe("offer-gross-5");
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
  });

  it("crash-reload on /cart under a min-bill reward: never judged on the empty first render (no notice, no exit); the restored rows clear the minimum, so it stays", () => {
    store.dispatch(applyOffer({ offer: MIN_BILL_OFFER }));
    const { onClose } = renderSheet();
    expect(onClose).not.toHaveBeenCalled();
    expect(cartState().cartOffer._id).toBe("offer-25-over-10");
    expect(cartState().offerRemovalModal.isOpen).toBe(false);

    act(() => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...DRINK_ROW }]));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(cartState().cartOffer._id).toBe("offer-25-over-10");
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£3.65");
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();
  });

  it("scenario 7: a freebie-only cart auto-removes the offer, empty-exits, and the notice SURVIVES emptyCart", async () => {
    store.dispatch(setCartItems([{ ...SALAD_FREEBIE_ROW }]));
    store.dispatch(applyOffer({ offer: FREE_SALAD_OFFER }));
    const { onClose } = renderSheet();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Cart fully emptied, offer gone…
    expect(cartState().cartItems).toEqual([]);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    // …but the removal notice was snapshotted across emptyCart's modal reset.
    expect(cartState().offerRemovalModal.isOpen).toBe(true);
    expect(cartState().offerRemovalModal.data._id).toBe("offer-free-salad");
  });

  it("crash-reload on /cart: the persisted reward survives the first render before the Dexie rows land — no notice, no exit, and the rows then show it applied", () => {
    // The store as redux-persist hands it back: the reward is there, the
    // cart rows are not (AppRoutes' Dexie rehydrate lands them later).
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    const { onClose } = renderSheet();

    expect(onClose).not.toHaveBeenCalled();
    expect(cartState().cartOffer._id).toBe("offer-flat-2");
    expect(cartState().offerRemovalModal.isOpen).toBe(false);

    act(() => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(cartState().cartOffer._id).toBe("offer-flat-2");
    expect(screen.getByTestId("bag-rewards-applied")).toHaveTextContent("£2 off your order");
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("£2.00");
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();
  });

  it("crash-reload on /cart whose rehydrate restores NOTHING (Dexie lost under the persisted reward): once it settles the bag exits and the stale reward goes WITH its notice", () => {
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    const onClose = vi.fn();
    const sheet = (rehydrated: boolean) => (
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <CartRehydratedContext.Provider value={rehydrated}>
            <BagSheet open onClose={onClose} />
          </CartRehydratedContext.Provider>
        </MemoryRouter>
      </Provider>
    );
    const { rerender } = render(sheet(false));
    expect(onClose).not.toHaveBeenCalled();
    expect(cartState().cartOffer._id).toBe("offer-flat-2");

    rerender(sheet(true));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(cartState().offerRemovalModal.isOpen).toBe(true);
    expect(cartState().offerRemovalModal.data._id).toBe("offer-flat-2");
  });

  it("crash-reload on /cart under a group-wise 'pick 2' reward: the bag waits for the rows, keeps the reward at its picks' discount once the rehydrate settles, and a REAL empty (the guest removes the paid burger) still exits — the reward going with its notice", async () => {
    // G3 commit as it persists: the burger buys, the two picks are free rows.
    const GW_PICK_2_OFFER = {
      ...offerBase,
      _id: "offer-gw-pick-2",
      name: "Buy a burger, pick 2 free sides",
      type: { name: "item", value: 0 },
      isAndOffer: false,
      buygetGroupWiseOffer: true,
      buygetGroupWiseOfferValues: { discountType: "percent", value: 100, getQuantity: 2, buyQuantity: 1 },
      applicable: {
        ...offerBase.applicable,
        rawItems: [{ item: { baseItemId: "cheese-burger", name: "Cheese Burger" } }],
      },
      getItems: { items: [{ ...SALAD_ENTRY, relation: "or", quantity: null }] },
    };
    const SAUCE_FREEBIE_ROW = {
      ...SALAD_FREEBIE_ROW,
      id: "tortilla-sauce",
      itemId: "ts-1",
      uniqueItemId: "ts-1",
      name: "Tortilla Sauce",
      price: 2,
      total_price: 2,
      undiscounted_total_price: 2,
    };
    store.dispatch(applyOffer({ offer: GW_PICK_2_OFFER }));
    const onClose = vi.fn();
    const sheet = (rehydrated: boolean) => (
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <CartRehydratedContext.Provider value={rehydrated}>
            <BagSheet open onClose={onClose} />
          </CartRehydratedContext.Provider>
        </MemoryRouter>
      </Provider>
    );
    const { rerender } = render(sheet(false));
    expect(onClose).not.toHaveBeenCalled();
    expect(cartState().offerRemovalModal.isOpen).toBe(false);

    // syncCartOnReLoad lands the rows, then AppRoutes flags it settled.
    act(() => {
      store.dispatch(
        setCartItems([{ ...BURGER_ROW }, { ...SALAD_FREEBIE_ROW }, { ...SAUCE_FREEBIE_ROW }])
      );
    });
    rerender(sheet(true));
    expect(onClose).not.toHaveBeenCalled();
    expect(cartState().cartOffer._id).toBe("offer-gw-pick-2");
    expect(screen.getByTestId("bag-discounts")).toHaveTextContent("−£19.00");
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("bag-dec-cb-1"));
    await userEvent.click(screen.getByTestId("remove-item-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(cartState().cartItems).toEqual([]);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(cartState().offerRemovalModal.isOpen).toBe(true);
    expect(cartState().offerRemovalModal.data._id).toBe("offer-gw-pick-2");
  });

  it("while closed the bag still renders the redux-driven removal notice (menu persistence, scenario 7 tail)", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(openOfferRemovalModal(FLAT_OFFER));
    renderSheet(false);

    expect(screen.queryByTestId("bag-sheet")).not.toBeInTheDocument();
    const notice = screen.getByTestId("offer-removal-notice");
    expect(notice).toHaveTextContent("Reward Removed");
    // No bag bill here — the notice recomputes the total from the live cart.
    expect(notice).toHaveTextContent("Your total is now £8.60");

    await userEvent.click(screen.getByTestId("offer-removal-gotit"));
    expect(screen.queryByTestId("offer-removal-notice")).not.toBeInTheDocument();
    expect(cartState().offerRemovalModal.isOpen).toBe(false);
  });
});
