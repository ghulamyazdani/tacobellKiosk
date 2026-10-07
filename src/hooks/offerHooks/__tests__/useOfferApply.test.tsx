/* eslint-disable @typescript-eslint/no-explicit-any --
 * Offer and cart-row fixtures mirror the untyped SDK cart slice / converter
 * output; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import type { SavingsOffer } from "@cx-sdk/ordering/offer/offerSavings";
import { store } from "../../../redux/app/store";
import useOfferApply from "../useOfferApply";
import {
  getCelebratedBarKey,
  resetAppliedBarCelebration,
  setCelebratedBarKey,
} from "../../../utils/offerCelebration";
import "../../../i18n";

const mockCapture = vi.fn();
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

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

  it.each([
    [
      "auto-applied ITEM offer (getItems: {})",
      { ...FREE_SALAD_OFFER, _id: "offer-free-drink", autoApplied: true, getItems: {} },
    ],
    [
      "every freebie 86'd (entities: {})",
      {
        ...FREE_SALAD_OFFER,
        _id: "offer-sold-out",
        getItems: { items: [{ ...SALAD_ENTRY, entities: {} }] },
      },
    ],
  ])(
    "an item offer with nothing to grant is blocked — no £0 swap, no celebration: %s",
    async (_label, offer) => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));

      const verdict = await execApply((api) => api.selectOfferAndCommit(offer));

      expect(verdict).toEqual({ applied: false, blocked: "noGetItems" });
      expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
      expect(cartState().offerModal?.isOpen).toBeFalsy();
      expect(cartState().cartItems).toHaveLength(1);
    }
  );

  it("a least-value offer (empty get side by design) still takes the atomic swap", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    const LEAST_OFFER = {
      ...offerBase,
      _id: "offer-least",
      name: "Cheapest one free",
      type: { name: "item", value: 0 },
      getLeastValueItem: true,
      leastItemValueCount: { buyQuantity: 2, getQuantity: 1 },
      getItems: { items: [], categories: [] },
    };

    const verdict = await execApply((api) => api.selectOfferAndCommit(LEAST_OFFER));

    expect(verdict).toEqual({ applied: true });
    expect(cartState().cartOffer._id).toBe("offer-least");
  });

  it("sameOrLess judges a fixed-size (variant-id) freebie by its OWN size — a cheaper sibling cannot carry it", async () => {
    // Buy the £8 burger; the "and" grant is LARGE fries (£9): over the
    // ceiling although the base's Small (£2) is under it.
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    const SMALL = { id: "fries-s", name: "Small", price: 2, isActive: true };
    const LARGE = { id: "fries-l", name: "Large", price: 9, isActive: true };
    const SOL_FRIES_OFFER = {
      ...offerBase,
      _id: "offer-sol-fries",
      name: "Burger + large fries",
      type: { name: "item", value: 0 },
      sameOrLess: true,
      isAndOffer: true,
      applicable: {
        ...offerBase.applicable,
        rawItems: [
          {
            item: { baseItemId: "cheese-burger", name: "Cheese Burger" },
            quantity: 1,
            relation: "and",
          },
        ],
      },
      getItems: {
        items: [
          {
            _id: "gi-fries-l",
            baseItemId: "fries-l",
            name: "Fries",
            relation: "and",
            discountType: "percent",
            value: 100,
            quantity: 1,
            entities: {
              id: "fries",
              name: "Fries",
              price: 0,
              hasVariant: true,
              type: "VARIANT",
              isVariantSelected: true,
              variants: [SMALL, LARGE],
              selectedVariant: { ...LARGE, isGetItem: true },
              selectedVariantId: "fries-l",
              variantPrice: 9,
              discounted_total_price: 0,
              undiscounted_total_price: 9,
              isGetItem: true,
            },
          },
        ],
      },
    };

    const verdict = await execApply((api) => api.selectOfferAndCommit(SOL_FRIES_OFFER));

    expect(verdict).toEqual({ applied: false, blocked: "sameOrLess" });
    expect(Object.keys(cartState().cartOffer ?? {})).toHaveLength(0);
    expect(getItemRows()).toEqual([]);
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

/* ------------------------------------------------------------------ *
 * Lane "offers": routing gate (G2), sameOrLess ceiling (31b), the
 * celebration trigger (33) and the auto-apply latch / machine apply (34).
 * ------------------------------------------------------------------ */

/** Paid Tortilla Sauce (£2) — the buy side of the sameOrLess BOGOs below. */
const SAUCE_ROW = {
  id: "tortilla-sauce",
  itemId: "ts-1",
  uniqueItemId: "ts-1",
  name: "Tortilla Sauce",
  quantity: 1,
  type: "ITEM",
  price: 2,
  total_price: 2,
  customizations: {},
};

/** Plain BOGO with sameOrLess ON: buy one £2 sauce. */
const SOL_BASE = {
  ...offerBase,
  name: "Buy a sauce, get a side",
  type: { name: "item", value: 0 },
  sameOrLess: true,
  applicable: {
    ...offerBase.applicable,
    rawItems: [
      { item: { baseItemId: "tortilla-sauce", name: "Tortilla Sauce" }, quantity: 1, relation: "or" },
    ],
  },
};

/** "or": the £17 salad is over the £2 ceiling, the £2 Caesar is not. */
const SOL_OR_OFFER = {
  ...SOL_BASE,
  _id: "offer-sol-or",
  isAndOffer: false,
  getItems: { items: [{ ...SALAD_ENTRY, relation: "or" }, CAESAR_ENTRY] },
};

/** "and": the salad would be dropped → the whole offer is not applicable. */
const SOL_AND_OFFER = {
  ...SOL_BASE,
  _id: "offer-sol-and",
  isAndOffer: true,
  getItems: { items: [SALAD_ENTRY, { ...CAESAR_ENTRY, relation: "and" }] },
};

/** Converter CUSTOMIZABLE branch: no price stamps (the G2 trap). */
const CUSTOMIZABLE_FREEBIE_OFFER = {
  ...FREE_SALAD_OFFER,
  _id: "offer-free-burger",
  name: "Free burger",
  getItems: {
    items: [
      {
        _id: "gi-burger",
        baseItemId: "cheese-burger",
        name: "Cheese Burger",
        relation: "and",
        discountType: "percent",
        value: 100,
        quantity: 1,
        entities: {
          id: "cheese-burger",
          name: "Cheese Burger",
          price: 8,
          modifiers: ["sauce_group"],
          hasVariant: false,
          discountType: "percent",
          discountValue: 100,
          isGetItem: true,
          type: "CUSTOMIZABLE",
          customizations: { sauce_group: [] },
          baseItem: { id: "cheese-burger", name: "Cheese Burger", price: 8 },
          baseItemPrice: 8,
        },
      },
    ],
  },
};

const VARIANT_FREEBIE_OFFER = {
  ...FREE_SALAD_OFFER,
  _id: "offer-free-fries",
  name: "Free fries",
  getItems: {
    items: [
      {
        _id: "gi-fries",
        baseItemId: "fries",
        name: "Fries",
        relation: "and",
        discountType: "percent",
        value: 100,
        quantity: 1,
        entities: {
          id: "fries",
          name: "Fries",
          price: 3,
          hasVariant: true,
          discountType: "percent",
          discountValue: 100,
          isGetItem: true,
          type: "VARIANT",
          discounted_total_price: 0,
          undiscounted_total_price: 3,
          variants: [{ id: "fries-m", name: "Medium", price: 3, isActive: true }],
        },
      },
    ],
  },
};

const sessionState = () =>
  (store.getState() as any).offerSession as {
    autoApplyOptOut: boolean;
    autoAppliedOfferId: string | null;
  };
const slotIsEmpty = () => Object.keys(cartState().cartOffer ?? {}).length === 0;

/** One call per mount — unlike execApply, several may run in one test. */
const runOnce = async (
  run: (api: OfferApplyApi) => Promise<unknown> | unknown
): Promise<any> => {
  let result: unknown;
  let done = false;
  const view = render(
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
  view.unmount();
  return result;
};

/** Dispatched action types (thunks have none) while `fn` runs. */
const typesDispatchedDuring = async (fn: () => Promise<unknown>): Promise<string[]> => {
  const spy = vi.spyOn(store, "dispatch");
  try {
    await fn();
    return spy.mock.calls
      .map(([action]) => (action as { type?: string })?.type)
      .filter((type): type is string => typeof type === "string");
  } finally {
    spy.mockRestore();
  }
};

describe("useOfferApply — lane offers (routing, sameOrLess, celebration, auto-apply latch)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    resetAppliedBarCelebration();
    mockCapture.mockClear();
  });

  it.each([
    ["atomic swap", FLAT_OFFER],
    ["direct apply", FREE_SALAD_OFFER],
  ])("applied (%s) → the celebration opens with {id, name} and the latch is set", async (_label, offer) => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));

    const verdict = await runOnce((api) => api.selectOfferAndCommit(offer));

    expect(verdict).toEqual({ applied: true });
    expect(cartState().offerModal).toEqual({
      isOpen: true,
      data: { id: offer._id, name: offer.name },
    });
    expect(sessionState().autoApplyOptOut).toBe(true);
  });

  it("needsPicker → no celebration, and `offer` is OMITTED when the ceiling filtered nothing", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));

    const verdict = await runOnce((api) => api.selectOfferAndCommit(CHOICE_OFFER));

    expect(verdict).toEqual({ applied: false, needsPicker: true });
    expect("offer" in verdict).toBe(false);
    expect(cartState().offerModal.isOpen).toBe(false);
  });

  it("a sameOrLess-filtered picker verdict carries the FILTERED offer (the £17 salad gone), never the input", async () => {
    store.dispatch(setCartItems([{ ...SAUCE_ROW }]));

    const verdict = await runOnce((api) => api.selectOfferAndCommit(SOL_OR_OFFER));

    expect(verdict.applied).toBe(false);
    expect(verdict.needsPicker).toBe(true);
    expect(verdict.offer).not.toBe(SOL_OR_OFFER);
    expect(verdict.offer._id).toBe("offer-sol-or");
    expect(verdict.offer.getItems.items.map((e: any) => e.baseItemId)).toEqual(["caesar-dressing"]);
    expect(SOL_OR_OFFER.getItems.items).toHaveLength(2); // input untouched
    expect(slotIsEmpty()).toBe(true);
    expect(cartState().offerModal.isOpen).toBe(false);
  });

  it("sameOrLess-blocked → {applied:false, blocked:'sameOrLess'} with NO cart or slot write (only the latch)", async () => {
    store.dispatch(setCartItems([{ ...SAUCE_ROW }]));
    const before = structuredClone(cartState().cartItems);

    let verdict: unknown;
    const types = await typesDispatchedDuring(async () => {
      verdict = await runOnce((api) => api.selectOfferAndCommit(SOL_AND_OFFER));
    });

    expect(verdict).toEqual({ applied: false, blocked: "sameOrLess" });
    expect(types).toEqual(["offerSession/optOutOfAutoApply"]);
    expect(cartState().cartItems).toEqual(before);
    expect(slotIsEmpty()).toBe(true);
    expect(cartState().offerModal.isOpen).toBe(false);
  });

  it.each([
    ["CUSTOMIZABLE", CUSTOMIZABLE_FREEBIE_OFFER],
    ["VARIANT", VARIANT_FREEBIE_OFFER],
  ])("G2: a single 'and' %s freebie → exactly needsPicker, cart and slot untouched (no £0 swap)", async (_label, offer) => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));

    const verdict = await runOnce((api) => api.selectOfferAndCommit(offer));

    expect(verdict).toEqual({ applied: false, needsPicker: true });
    expect(slotIsEmpty()).toBe(true);
    expect(cartState().cartItems).toHaveLength(1);
    expect(getItemRows()).toEqual([]);
    expect(cartState().getItems).toEqual([]);
  });

  it.each([
    ["a needsPicker", CHOICE_OFFER, BURGER_ROW],
    ["a sameOrLess-blocked", SOL_AND_OFFER, SAUCE_ROW],
  ])("%s attempt still latches auto-apply off (decision 4: any customer offer action)", async (_label, offer, row) => {
    store.dispatch(setCartItems([{ ...row }]));
    expect(sessionState().autoApplyOptOut).toBe(false);

    const verdict = await runOnce((api) => api.selectOfferAndCommit(offer));

    expect(verdict.applied).toBe(false);
    expect(sessionState().autoApplyOptOut).toBe(true);
  });

  it("commitPickedFreebies resolves true on success, celebrates and latches", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));

    const ok = await runOnce((api) =>
      api.commitPickedFreebies({ offer: CHOICE_OFFER, picks: [TORTILLA_ENTRY] })
    );

    expect(ok).toBe(true);
    expect(cartState().cartOffer._id).toBe("offer-free-sauce-choice");
    expect(cartState().offerModal).toEqual({
      isOpen: true,
      data: { id: "offer-free-sauce-choice", name: "Free Sauce" },
    });
    expect(sessionState().autoApplyOptOut).toBe(true);
  });

  it("commitPickedFreebies: a throwing applyOfferByItem rolls the landed rows back and resolves false", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    // An entity redeemGetItem cannot read: applyOfferByItem rejects.
    const poisoned = new Proxy(
      { id: "poison" },
      {
        get() {
          throw new Error("unreadable freebie entity");
        },
      }
    );
    const picks = [TORTILLA_ENTRY, { ...CAESAR_ENTRY, entities: poisoned }];

    let ok: unknown;
    const types = await typesDispatchedDuring(async () => {
      ok = await runOnce((api) => api.commitPickedFreebies({ offer: CHOICE_OFFER, picks }));
    });

    expect(ok).toBe(false);
    // The good pick DID land, then the rollback swept it.
    expect(types).toContain("cart/addItemToCartRdx");
    expect(types).toContain("cart/deleteItemFromCart");
    expect(types).not.toContain("cart/applyOffer");
    expect(getItemRows()).toEqual([]);
    expect(cartState().getItems).toEqual([]);
    expect(slotIsEmpty()).toBe(true);
    expect(cartState().offerModal.isOpen).toBe(false);
  });

  it("autoApplyOffer → ONE swapCartOffer + markOfferAutoApplied + an OfferAutoApplied event; no celebration, no latch", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));

    let landed: unknown;
    const types = await typesDispatchedDuring(async () => {
      landed = await runOnce((api) => api.autoApplyOffer(FLAT_OFFER as unknown as SavingsOffer));
    });

    expect(landed).toBe(true);
    expect(types.filter((t) => t === "cart/swapCartOffer")).toHaveLength(1);
    expect(types).toContain("offerSession/markOfferAutoApplied");
    expect(types).not.toContain("cart/openOfferModal");
    expect(types).not.toContain("offerSession/optOutOfAutoApply");
    expect(cartState().cartOffer._id).toBe("offer-flat-2");
    expect(cartState().offerModal.isOpen).toBe(false);
    expect(sessionState()).toEqual({ autoApplyOptOut: false, autoAppliedOfferId: "offer-flat-2" });
    expect(mockCapture).toHaveBeenCalledWith("offer_auto_applied", {
      offer_id: "offer-flat-2",
      saving: 2,
      certainty: "exact",
    });
  });

  it("autoApplyOffer never replaces an occupied slot", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FREE_SALAD_OFFER }));

    const landed = await runOnce((api) => api.autoApplyOffer(FLAT_OFFER as unknown as SavingsOffer));

    expect(landed).toBe(false);
    expect(cartState().cartOffer._id).toBe("offer-free-salad");
    expect(sessionState().autoAppliedOfferId).toBeNull();
  });

  it("removeAppliedOffer latches AND resets the celebration spent key", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    setCelebratedBarKey("offer-flat-2:2.00");

    await runOnce((api) => api.removeAppliedOffer());

    expect(sessionState().autoApplyOptOut).toBe(true);
    expect(getCelebratedBarKey()).toBeNull();
    expect(slotIsEmpty()).toBe(true);
  });

  it("handleCartDrivenRemoval resets the spent key but does NOT latch (a machine path)", async () => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    store.dispatch(applyOffer({ offer: FLAT_OFFER }));
    setCelebratedBarKey("offer-flat-2:2.00");

    await runOnce((api) => api.handleCartDrivenRemoval(false));

    expect(getCelebratedBarKey()).toBeNull();
    expect(sessionState().autoApplyOptOut).toBe(false);
    expect(cartState().offerRemovalModal.isOpen).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Lane loyalty-visual (D3, fork parity — CartRewardsCard
 * blockedByLoyalty): a XENO reward row in the bag locks offers while none
 * is applied. The apply core refuses on the LIVE cart before any write,
 * event or celebration — only the auto-apply latch (a customer offer
 * action) still fires. An offer applied BEFORE the reward is not locked:
 * it stays and can still be swapped (the fork's asymmetry, kept).
 * ------------------------------------------------------------------ */

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

const FLAT_3_OFFER = {
  ...FLAT_OFFER,
  _id: "offer-flat-3",
  name: "£3 off your order",
  type: { name: "amount", value: 3 },
};

const rewardRows = () => cartState().cartItems.filter((row: any) => row?.isLoyaltyItem);

describe("useOfferApply — D3: a XENO reward in the bag locks offers (lane loyalty-visual)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    resetAppliedBarCelebration();
    mockCapture.mockClear();
  });

  /** Bag = a paid burger + the reward + a staged picker row a sweep would clear. */
  const seedRewardBag = (reward: object = REWARD_ROW) => {
    store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...reward }]));
    store.dispatch(addGetItemsRdx({ id: "tortilla-sauce", itemId: "stage-1", quantity: 1 }));
  };

  it.each([
    ["swap (bill-wise)", FLAT_OFFER],
    ["direct (a fixed freebie)", FREE_SALAD_OFFER],
    ["picker (an OR choice)", CHOICE_OFFER],
  ])(
    "selectOfferAndCommit, %s route → {applied:false, blocked:'loyaltyReward'} with ZERO cart writes; the latch still fires",
    async (_label, offer) => {
      seedRewardBag();
      const before = structuredClone(cartState());

      let verdict: unknown;
      const types = await typesDispatchedDuring(async () => {
        verdict = await runOnce((api) => api.selectOfferAndCommit(offer));
      });

      expect(verdict).toEqual({ applied: false, blocked: "loyaltyReward" });
      // The latch is the ONLY dispatch: no get-item sweep (deleteItemFromCart /
      // emptyGetItems), no swapCartOffer / applyOffer, no openOfferModal.
      expect(types).toEqual(["offerSession/optOutOfAutoApply"]);
      expect(cartState()).toEqual(before);
      expect(mockCapture).not.toHaveBeenCalled(); // no OfferSwapped
      expect(sessionState().autoApplyOptOut).toBe(true);
    }
  );

  it("an OUT-OF-STOCK reward row (still in the bag) locks too", async () => {
    seedRewardBag({ ...REWARD_ROW, outOfStock: true });

    const verdict = await runOnce((api) => api.selectOfferAndCommit(FLAT_OFFER));

    expect(verdict).toEqual({ applied: false, blocked: "loyaltyReward" });
    expect(slotIsEmpty()).toBe(true);
  });

  it("commitPickedFreebies (picker CONFIRM) → false; no row lands, only the latch fires", async () => {
    seedRewardBag();
    const before = structuredClone(cartState());

    let ok: unknown;
    const types = await typesDispatchedDuring(async () => {
      ok = await runOnce((api) =>
        api.commitPickedFreebies({ offer: CHOICE_OFFER, picks: [TORTILLA_ENTRY] })
      );
    });

    expect(ok).toBe(false);
    expect(types).toEqual(["offerSession/optOutOfAutoApply"]);
    expect(cartState()).toEqual(before);
    expect(getItemRows()).toEqual([]);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("autoApplyOffer → false: nothing dispatched, no OfferAutoApplied event, the session untouched", async () => {
    seedRewardBag();

    let landed: unknown;
    const types = await typesDispatchedDuring(async () => {
      landed = await runOnce((api) => api.autoApplyOffer(FLAT_OFFER as unknown as SavingsOffer));
    });

    expect(landed).toBe(false);
    expect(types).toEqual([]);
    expect(slotIsEmpty()).toBe(true);
    expect(sessionState()).toEqual({ autoApplyOptOut: false, autoAppliedOfferId: null });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  describe("an offer applied BEFORE the reward is not locked (the fork's asymmetry)", () => {
    beforeEach(() => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      store.dispatch(applyOffer({ offer: FLAT_OFFER }));
      store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
    });

    it("swap: a SAVE of another offer replaces it, celebrates, and the reward stays", async () => {
      const verdict = await runOnce((api) => api.selectOfferAndCommit(FLAT_3_OFFER));

      expect(verdict).toEqual({ applied: true });
      expect(cartState().cartOffer._id).toBe("offer-flat-3");
      expect(cartState().offerModal.isOpen).toBe(true);
      expect(mockCapture).toHaveBeenCalledWith("offer_swapped", expect.objectContaining({ to: "offer-flat-3" }));
      expect(rewardRows()).toHaveLength(1);
    });

    it("direct: a fixed freebie lands as a row and takes the slot; the reward stays", async () => {
      const verdict = await runOnce((api) => api.selectOfferAndCommit(FREE_SALAD_OFFER));

      expect(verdict).toEqual({ applied: true });
      expect(cartState().cartOffer._id).toBe("offer-free-salad");
      expect(getItemRows().map((row: any) => row.id)).toEqual(["greek-salad"]);
      expect(rewardRows()).toHaveLength(1);
    });

    it("picker: an OR choice still reaches the picker", async () => {
      const verdict = await runOnce((api) => api.selectOfferAndCommit(CHOICE_OFFER));

      expect(verdict).toEqual({ applied: false, needsPicker: true });
    });

    it("picker CONFIRM commits the pick", async () => {
      const ok = await runOnce((api) =>
        api.commitPickedFreebies({ offer: CHOICE_OFFER, picks: [TORTILLA_ENTRY] })
      );

      expect(ok).toBe(true);
      expect(cartState().cartOffer._id).toBe("offer-free-sauce-choice");
      expect(getItemRows().map((row: any) => row.id)).toEqual(["tortilla-sauce"]);
      expect(rewardRows()).toHaveLength(1);
    });

    it("auto-apply still answers that the slot holds the applied offer", async () => {
      const landed = await runOnce((api) => api.autoApplyOffer(FLAT_OFFER as unknown as SavingsOffer));

      expect(landed).toBe(true);
      expect(cartState().cartOffer._id).toBe("offer-flat-2");
    });
  });

  it("once the reward row leaves the bag, SAVE and auto-apply work again", async () => {
    seedRewardBag();
    expect(await runOnce((api) => api.selectOfferAndCommit(FLAT_OFFER))).toEqual({
      applied: false,
      blocked: "loyaltyReward",
    });

    store.dispatch(setCartItems([{ ...BURGER_ROW }]));
    expect(await runOnce((api) => api.autoApplyOffer(FLAT_3_OFFER as unknown as SavingsOffer))).toBe(true);
    expect(cartState().cartOffer._id).toBe("offer-flat-3");

    expect(await runOnce((api) => api.selectOfferAndCommit(FLAT_OFFER))).toEqual({ applied: true });
    expect(cartState().cartOffer._id).toBe("offer-flat-2");
  });
});
