/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offer and cart-row fixtures mirror the untyped SDK cart slice / converter
 * output; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setCartItems,
  applyOffer,
  addGetItemsRdx,
} from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import useOfferApply from "../useOfferApply";
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

/**
 * A COMMITTED freebie cart row — the shape redeemGetItem + addGetItemToCart
 * stamp (isGetItem:true, discounted/undiscounted prices). Belongs to the
 * "previous" offer in the swap tests; the sweep must delete it by itemId.
 */
const COMMITTED_SALAD_ROW = {
  id: "greek-salad",
  itemId: "gs-committed-1",
  uniqueItemId: "gs-committed-1",
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

/**
 * Converter-resolved getItems entities (useOfferConverters output shape:
 * entity spread + discountType/discountValue/isGetItem/type stamps, and the
 * discounted_/undiscounted_total_price pair for plain entities).
 */
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

const sauceEntity = (id: string, name: string) => ({
  id,
  name,
  price: 2,
  modifiers: [] as any[],
  hasVariant: false,
  discountType: "percent",
  discountValue: 100,
  isGetItem: true,
  type: "ITEM",
  discounted_total_price: 0,
  undiscounted_total_price: 2,
});

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

const TORTILLA_ENTRY = {
  _id: "gi-tortilla",
  baseItemId: "tortilla-sauce",
  name: "Tortilla Sauce",
  relation: "or",
  discountType: "percent",
  value: 100,
  quantity: 1,
  type: "ITEM",
  entities: sauceEntity("tortilla-sauce", "Tortilla Sauce"),
};

const CAESAR_ENTRY = {
  _id: "gi-caesar",
  baseItemId: "caesar-dressing",
  name: "Caesar Dressing",
  relation: "or",
  discountType: "percent",
  value: 100,
  quantity: 1,
  type: "ITEM",
  entities: sauceEntity("caesar-dressing", "Caesar Dressing"),
};

/** Contract mock-offer base (converter passthrough fields included). */
const offerBase = {
  isAvailable: true,
  isComplimentary: false,
  autoApplied: false,
  autoReapply: false,
  sameOrLess: false,
  onGrossTotal: false,
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

/** Single fixed "and" grant — requiresChoice:false, directly applicable. */
const FREE_SALAD_OFFER = {
  ...offerBase,
  _id: "offer-free-salad",
  name: "Free Greek Salad",
  type: { name: "item", value: 0 },
  getItemOnly: true,
  getItems: { items: [SALAD_ENTRY] },
};

/** Two-way "or" choice — must reach the picker, never auto-apply. */
const CHOICE_OFFER = {
  ...offerBase,
  _id: "offer-free-sauce-choice",
  name: "Free Sauce",
  type: { name: "item", value: 0 },
  getItemOnly: true,
  isAndOffer: false,
  getItems: { items: [TORTILLA_ENTRY, CAESAR_ENTRY] },
};

type OfferApplyApi = ReturnType<typeof useOfferApply>;

/**
 * Minimal harness (useSessionReset house pattern): the hook mounts against
 * the real store and each test fires its call from a click handler — the one
 * legal side-effect site — capturing the async verdict via onDone.
 */
function Harness({
  run,
  onDone,
}: {
  run: (api: OfferApplyApi) => Promise<unknown> | unknown;
  onDone: (result: unknown) => void;
}) {
  const api = useOfferApply();
  return (
    <button
      type="button"
      data-testid="run-apply"
      onClick={async () => onDone(await run(api))}
    >
      run
    </button>
  );
}

/** Mount, click, and wait the call out; resolves with what `run` returned. */
const execApply = async (
  run: (api: OfferApplyApi) => Promise<unknown> | unknown
): Promise<any> => {
  let result: unknown;
  let done = false;
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <Harness
          run={run}
          onDone={(r) => {
            result = r;
            done = true;
          }}
        />
      </MemoryRouter>
    </Provider>
  );
  await userEvent.click(screen.getByTestId("run-apply"));
  await waitFor(() => expect(done).toBe(true));
  return result;
};

const cartState = () => (store.getState() as any).cart;
const getItemRows = () =>
  cartState().cartItems.filter((row: any) => row?.isGetItem);

describe("useOfferApply (P7b apply/remove core — contract recipes)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
  });

  it("atomic swap: commits via swapCartOffer and sweeps the previous offer's freebies (staged + committed)", async () => {
    // Previous offer applied WITH a committed freebie row and a staged row.
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...COMMITTED_SALAD_ROW }]));
    store.dispatch(applyOffer({ offer: FREE_SALAD_OFFER }));
    store.dispatch(
      addGetItemsRdx({ id: "greek-salad", itemId: "stage-1", quantity: 1 })
    );

    const verdict = await execApply((api) => api.selectOfferAndCommit(FLAT_OFFER));

    expect(verdict).toEqual({ applied: true });
    expect(cartState().cartOffer._id).toBe("offer-flat-2");
    expect(cartState().cartOfferSource).toBe("offer");
    // Trap 3: the outgoing offer's freebie rows never survive the swap.
    expect(getItemRows()).toEqual([]);
    expect(cartState().getItems).toEqual([]);
    // The paid row is untouched.
    expect(cartState().cartItems).toHaveLength(1);
    expect(cartState().cartItems[0].itemId).toBe("cb-1");
  });

  it("direct-apply: a single fixed 'and' freebie lands as a REAL isGetItem cart row and takes the slot (scenario 5 core)", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));

    const verdict = await execApply((api) =>
      api.selectOfferAndCommit(FREE_SALAD_OFFER)
    );

    expect(verdict).toEqual({ applied: true });
    expect(verdict.needsPicker).toBeUndefined();
    const freebies = getItemRows();
    expect(freebies).toHaveLength(1);
    expect(freebies[0].id).toBe("greek-salad");
    expect(freebies[0].isGetItem).toBe(true);
    expect(freebies[0].discounted_total_price).toBe(0);
    expect(freebies[0].undiscounted_total_price).toBe(17);
    expect(freebies[0].discountType).toBe("percent");
    expect(Number(freebies[0].discountValue)).toBe(100);
    expect(cartState().cartOffer._id).toBe("offer-free-salad");
    expect(cartState().cartOfferSource).toBe("offer");
  });

  it("OR-choice: returns the needsPicker verdict without touching the slot or the cart", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));

    const verdict = await execApply((api) => api.selectOfferAndCommit(CHOICE_OFFER));

    expect(verdict).toEqual({ applied: false, needsPicker: true });
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(getItemRows()).toEqual([]);
    expect(cartState().cartItems).toHaveLength(1);
  });

  it("refuses to commit over a loyalty-owned slot (applied:false, slot intact)", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(
      applyOffer({
        offer: { _id: "loyalty-redeem", name: "Loyalty offer" },
        source: "loyalty",
      })
    );

    const verdict = await execApply((api) => api.selectOfferAndCommit(FLAT_OFFER));

    expect(verdict).toEqual({ applied: false });
    expect(cartState().cartOffer._id).toBe("loyalty-redeem");
    expect(cartState().cartOfferSource).toBe("loyalty");
  });

  it("removeAppliedOffer clears the slot and both freebie surfaces, and opens NO removal notice", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...COMMITTED_SALAD_ROW }]));
    store.dispatch(applyOffer({ offer: FREE_SALAD_OFFER }));
    store.dispatch(
      addGetItemsRdx({ id: "greek-salad", itemId: "stage-1", quantity: 1 })
    );

    await execApply((api) => api.removeAppliedOffer());

    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(cartState().cartOfferSource).toBeUndefined();
    expect(getItemRows()).toEqual([]);
    expect(cartState().getItems).toEqual([]);
    // Direct removal is notice-free (the notice is cart-driven only).
    expect(cartState().offerRemovalModal.isOpen).toBe(false);
  });

  it("handleCartDrivenRemoval(false) opens offerRemovalModal with the removed offer and clears the slot", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...COMMITTED_SALAD_ROW }]));
    store.dispatch(applyOffer({ offer: FREE_SALAD_OFFER }));

    await execApply((api) => api.handleCartDrivenRemoval(false));

    expect(cartState().offerRemovalModal.isOpen).toBe(true);
    expect(cartState().offerRemovalModal.data._id).toBe("offer-free-salad");
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(getItemRows()).toEqual([]);
  });

  it("handleCartDrivenRemoval(true) removes silently — slot cleared, no modal", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));

    await execApply((api) => api.handleCartDrivenRemoval(true));

    expect(cartState().offerRemovalModal.isOpen).toBe(false);
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
  });

  it("handleCartDrivenRemoval no-ops entirely when no offer is applied", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));

    await execApply((api) => api.handleCartDrivenRemoval(false));

    expect(cartState().offerRemovalModal.isOpen).toBe(false);
    expect(cartState().cartItems).toHaveLength(1);
  });

  it("commitPickedFreebies: picker recipe lands the picked entry as a committed row, then applies the offer", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));

    await execApply((api) =>
      api.commitPickedFreebies({ offer: CHOICE_OFFER, picks: [TORTILLA_ENTRY] })
    );

    const freebies = getItemRows();
    expect(freebies).toHaveLength(1);
    expect(freebies[0].id).toBe("tortilla-sauce");
    expect(freebies[0].isGetItem).toBe(true);
    expect(freebies[0].discounted_total_price).toBe(0);
    expect(freebies[0].undiscounted_total_price).toBe(2);
    expect(cartState().cartOffer._id).toBe("offer-free-sauce-choice");
    // Staging list is left empty — rows were COMMITTED, not staged.
    expect(cartState().getItems).toEqual([]);
  });
});
