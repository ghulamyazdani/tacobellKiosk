import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  MIAMTier2Open,
  openMakeItAMealModal,
  openMakeItAMealSession,
  openTier1Modal,
  setIsForceOpenMakeItAMealModal,
  setTeir1SelectedEntity,
  setTier1BottomSheet,
  setTier1BottomSheetAndSelectedEntity,
  setTier1SelectedCustomization,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  setEntityMenuObject,
  setModifiersMap,
} from "@cx-sdk/catalog/state/Menu.slice";
import { setAllowMultiplePunch, setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { getTotalValueWithApplyAddonPrice } from "@cx-sdk/ordering/customization/pricing";
import { store } from "../../../redux/app/store";
import { setSelectedEntity } from "../../../redux/features/menuSelections/menuSelections.slice";
import useOrderHook from "../../../hooks/menuHooks/useOrderHook";
import Customization from "../index";
import i18n from "../../../i18n";

// ---- Pack fixtures (brief: `_combo` min1/max1 → slot card; everything else
// keeps the classic renderGroup path) --------------------------------------

const BURRITO_GROUP = {
  _id: "pack1_1_combo",
  name: "Burrito",
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    {
      id: "b-beef",
      name: "Beefy Burrito",
      price: 0,
      calorieCount: 170,
      isActive: true,
      isDefault: true,
    },
    {
      id: "b-bean",
      name: "Bean Burrito",
      price: 0,
      calorieCount: 150,
      isActive: true,
      isDefault: false,
    },
  ],
};

const DRINK_GROUP = {
  _id: "pack1_2_combo",
  name: "Drink",
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 2,
  isActive: true,
  constituentItems: [
    {
      id: "d-cola",
      name: "Cola",
      price: 0,
      calorieCount: 170,
      isActive: true,
      isDefault: false,
    },
    {
      id: "d-large",
      name: "Large Cola",
      price: 0.75,
      calorieCount: 360,
      isActive: true,
      isDefault: false,
    },
  ],
};

/** BYO-shaped combo (min!==1) — must stay on the classic path (brief rule). */
const SNACKS_GROUP = {
  _id: "pack1_6_combo",
  name: "Snacks",
  type: "Combo",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 4,
  multiplePunchMaxItem: 1,
  order: 3,
  isActive: true,
  constituentItems: [
    { id: "s-churros", name: "Churros", price: 5, isActive: true },
  ],
};

const ADDON_GROUP = {
  _id: "pack1_addons",
  name: "Add Ons",
  min: 0,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 4,
  isActive: true,
  constituentItems: [
    { id: "a-salsa", name: "Salsa", price: 0.5, isActive: true },
  ],
};

/** REQUIRED nested group on Large Cola (drives the tier-2 SAVE gate). */
const ICE_GROUP = {
  _id: "dl_addons",
  name: "Ice Level",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "ice", name: "Regular Ice", price: 0, isActive: true },
    { id: "no-ice", name: "No Ice", price: 0, isActive: true },
  ],
};

const MODIFIERS_MAP = {
  [BURRITO_GROUP._id]: BURRITO_GROUP,
  [DRINK_GROUP._id]: DRINK_GROUP,
  [SNACKS_GROUP._id]: SNACKS_GROUP,
  [ADDON_GROUP._id]: ADDON_GROUP,
  [ICE_GROUP._id]: ICE_GROUP,
};

const PACK = {
  id: "pack1",
  name: "Cravings Burrito Pack",
  price: 9.99,
  applyAddonsPrice: true,
  description: "Four burritos, a drink and a side",
  modifiers: [
    BURRITO_GROUP._id,
    DRINK_GROUP._id,
    SNACKS_GROUP._id,
    ADDON_GROUP._id,
  ],
};

const seedSession = (entity: Record<string, unknown> = PACK) => {
  store.dispatch(setModifiersMap({ modifiersMap: MODIFIERS_MAP }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: {
        isOpen: true,
        status: "",
        type: "customizableItem",
        openType: "new",
        editCustomizationContent: {},
      },
      selectedEntity: entity,
    })
  );
};

const renderPage = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
      </MemoryRouter>
    </Provider>
  );

describe("Customization page — pack partition (P6c)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the hook's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("renders slot cards for `_combo` min1/max1 groups and the classic grid for the rest", () => {
    seedSession();
    renderPage();

    expect(screen.getByText("Cravings Burrito Pack")).toBeInTheDocument();

    // slot presentation for the two true slot groups
    expect(screen.getByTestId("pack-slot-grid")).toBeInTheDocument();
    expect(screen.getByTestId("pack-slot-pack1_1_combo")).toBeInTheDocument();
    expect(screen.getByTestId("pack-slot-pack1_2_combo")).toBeInTheDocument();
    // ...and NOT the classic section for them
    expect(
      screen.queryByTestId("pdp-group-pack1_1_combo")
    ).not.toBeInTheDocument();

    // BYO-shaped combo (min 0/max 2) and the addons group keep the classic path
    expect(screen.getByTestId("pdp-group-pack1_6_combo")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-option-s-churros")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-group-pack1_addons")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-option-a-salsa")).toBeInTheDocument();
    // ...and no slot card for the BYO group
    expect(
      screen.queryByTestId("pack-slot-pack1_6_combo")
    ).not.toBeInTheDocument();
  });

  it("seeds defaults: a defaulted slot shows SWAP, an empty slot shows SELECT {group}", () => {
    seedSession();
    renderPage();

    const burrito = screen.getByTestId("pack-slot-pack1_1_combo");
    expect(burrito).toHaveTextContent("Beefy Burrito");
    expect(burrito).toHaveTextContent("Swap");

    const drink = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(drink).toHaveTextContent("Select Drink");
    expect(drink).not.toHaveTextContent("Swap");

    // redux seed: default pre-selected for burrito, drink empty
    const tier1 = tier1SelectedCustomization(store.getState());
    expect(tier1[BURRITO_GROUP._id]).toHaveLength(1);
    expect(tier1[BURRITO_GROUP._id][0].id).toBe("b-beef");
    expect(tier1[DRINK_GROUP._id]).toEqual([]);
  });

  it("a non-pack entity renders no slot grid at all (zero change)", () => {
    seedSession({
      id: "single1",
      name: "Loaded Fries",
      price: 3.99,
      modifiers: [ADDON_GROUP._id],
    });
    renderPage();

    expect(screen.queryByTestId("pack-slot-grid")).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-group-pack1_addons")).toBeInTheDocument();
  });

  it("slot sheet: open → pick → SAVE writes the pick into the tier-1 selections (plain path)", async () => {
    seedSession();
    renderPage();

    await userEvent.click(screen.getByTestId("pack-slot-open-pack1_2_combo"));
    const sheet = screen.getByTestId("slot-sheet");
    expect(sheet).toHaveTextContent("Select Drink");
    // included (free) vs upgrades (priced) partition
    expect(sheet).toHaveTextContent("Included");
    expect(sheet).toHaveTextContent("Upgrades");
    // no entity/variant map seeded → nothing is tier-2 capable → no Customize
    expect(screen.queryByTestId("slot-customize-d-cola")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("slot-customize-d-large")
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("slot-option-d-large"));
    await userEvent.click(screen.getByTestId("slot-sheet-save"));

    // sheet closed, pick landed in redux, card flipped to SWAP + price
    expect(screen.queryByTestId("slot-sheet")).not.toBeInTheDocument();
    const tier1 = tier1SelectedCustomization(store.getState());
    expect(tier1[DRINK_GROUP._id]).toHaveLength(1);
    expect(tier1[DRINK_GROUP._id][0]).toMatchObject({
      id: "d-large",
      quantity: 1,
    });
    const drink = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(drink).toHaveTextContent("Large Cola");
    expect(drink).toHaveTextContent("Swap");
    // default store has no currency symbol configured → bare "+0.75"
    expect(drink).toHaveTextContent("+0.75");
    // tier-2 never opened on the plain path
    expect(MIAMTier2Open(store.getState())).toBe(false);
  });

  it("SAVE on a pick with a REQUIRED nested group routes to tier-2 NEW instead of a plain save", async () => {
    seedSession();
    // Large Cola exists as an entity with a required (min 1) addon group →
    // tier-2 capable AND not all-optional → SAVE must open the tier-2 sheet.
    store.dispatch(
      setEntityMenuObject({
        menuEntityObject: {
          "d-large": {
            id: "d-large",
            name: "Large Cola",
            price: 0.75,
            isActive: true,
            outOfStock: false,
            min: 1,
            max: 1,
            modifiers: [ICE_GROUP._id],
          },
        },
      })
    );
    renderPage();

    await userEvent.click(screen.getByTestId("pack-slot-open-pack1_2_combo"));
    // tier-2 capable row now offers the Customize link; the plain one doesn't
    expect(screen.getByTestId("slot-customize-d-large")).toBeInTheDocument();
    expect(screen.queryByTestId("slot-customize-d-cola")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("slot-option-d-large"));
    await userEvent.click(screen.getByTestId("slot-sheet-save"));

    // slot sheet closed, tier-2 sheet opened on the nested group — the pick
    // was NOT committed as a plain save
    expect(screen.queryByTestId("slot-sheet")).not.toBeInTheDocument();
    expect(MIAMTier2Open(store.getState())).toBe(true);
    // The tier-2 page is lazy (bagLazyParts, warmed at PDP mount): wait for
    // its seeded group, not just its root.
    expect(await screen.findByTestId("tier2-group-dl_addons")).toBeInTheDocument();
    expect(screen.getByTestId("tier2-sheet")).toBeInTheDocument();
    expect(
      tier1SelectedCustomization(store.getState())[DRINK_GROUP._id]
    ).toEqual([]);

    // completing tier-2 lands the customized row back into the slot
    await userEvent.click(screen.getByTestId("tier2-option-ice"));
    await userEvent.click(screen.getByTestId("tier2-sheet-save"));

    expect(screen.queryByTestId("tier2-sheet")).not.toBeInTheDocument();
    const tier1 = tier1SelectedCustomization(store.getState());
    expect(tier1[DRINK_GROUP._id]).toHaveLength(1);
    expect(tier1[DRINK_GROUP._id][0]).toMatchObject({ id: "d-large" });
    expect(tier1[DRINK_GROUP._id][0].customizations.dl_addons[0].id).toBe(
      "ice"
    );
    const drink = screen.getByTestId("pack-slot-pack1_2_combo");
    expect(drink).toHaveTextContent("Large Cola");
    expect(drink).toHaveTextContent("Swap");
  });

  it("BYO card (a multi-pick `_combo`): CHOOSE adds, then the CTA says REMOVE — what its next tap does", async () => {
    seedSession();
    renderPage();
    const cta = () => screen.getByTestId("pdp-option-cta-s-churros");
    const snacks = () => tier1SelectedCustomization(store.getState())[SNACKS_GROUP._id] ?? [];

    expect(cta()).toHaveTextContent("Choose");
    await userEvent.click(cta());
    expect(snacks()).toHaveLength(1);
    expect(cta()).toHaveTextContent("Remove");
    expect(cta()).not.toHaveTextContent("Swap");

    await userEvent.click(cta());
    expect(snacks()).toHaveLength(0);
    expect(cta()).toHaveTextContent("Choose");
  });
});

/* ------------------------------------------------------------------ *
 * Lane figma-polish item 42 — D5: a one-option `_combo` slot is an
 * INCLUDED item, pre-selected in the PDP's "new" customizable init through
 * the SDK rule a sheet pick runs (applySinglePunchSelection) — so the entry,
 * the PDP total, the committed row and the bill are exactly what picking it
 * through the sheet gives. Not seeded: an option that needs tier-2
 * (required nested groups), an inactive or out-of-stock option, the variant
 * flow (its groups arrive with the size) and the edit flow (the row's own
 * picks are restored). A FORK DIVERGENCE from the MIAM tier-1 path, where
 * the seed is commented out.
 * ------------------------------------------------------------------ */

const slot = (id: string, order: number, constituentItems: Array<Record<string, unknown>>) => ({
  _id: id,
  name: id,
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order,
  isActive: true,
  constituentItems,
});

const FRIES = { id: "d5-fries", name: "Large Fries", price: 0.5, calorieCount: 360, isActive: true };
const D5_SIDES = { ...slot("d5_2_combo", 1, [FRIES]), name: "Sides" };
const D5_DRINK = {
  ...slot("d5_3_combo", 2, [
    { id: "d5-cola", name: "Cola", price: 0, isActive: true },
    { id: "d5-lemonade", name: "Lemonade", price: 0, isActive: true },
  ]),
  name: "Drink",
};
/** One option whose entity carries a REQUIRED nested group → tier-2 first. */
const D5_SHAKE = { ...slot("d5_4_combo", 3, [{ id: "d5-shake", name: "Shake", price: 0, isActive: true }]), name: "Shake" };
const D5_DIP = { ...slot("d5_5_combo", 4, [{ id: "d5-dip", name: "Dip", price: 0, isActive: true, outOfStock: true }]), name: "Dip" };
const D5_DESSERT = { ...slot("d5_6_combo", 5, [{ id: "d5-churros", name: "Churros", price: 0, isActive: false }]), name: "Dessert" };
const D5_ICE = {
  _id: "d5_ice_addons",
  name: "Ice",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "d5-ice", name: "Ice", price: 0, isActive: true }],
};
/** Optional nested group: the fries are tier-2 CAPABLE (CUSTOMIZE), never tier-2 REQUIRED. */
const D5_SALT = { ...D5_ICE, _id: "d5_salt_addons", name: "Salt", min: 0, multiplePunchMin: 0 };

const D5_PACK = {
  id: "d5-pack",
  name: "Dream Box",
  price: 9,
  applyAddonsPrice: true,
  modifiers: [D5_SIDES._id, D5_DRINK._id, D5_SHAKE._id, D5_DIP._id, D5_DESSERT._id],
};

const D5_MODIFIERS = Object.fromEntries(
  [D5_SIDES, D5_DRINK, D5_SHAKE, D5_DIP, D5_DESSERT, D5_ICE, D5_SALT].map((group) => [group._id, group])
);

const seedD5 = (
  entity: Record<string, unknown> = D5_PACK,
  bottomSheet: Record<string, unknown> = { type: "customizableItem", openType: "new" },
  entities: Record<string, unknown> = {}
) => {
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: D5_MODIFIERS }));
  store.dispatch(
    setEntityMenuObject({
      menuEntityObject: {
        "d5-shake": { id: "d5-shake", name: "Shake", price: 0, isActive: true, outOfStock: false, modifiers: [D5_ICE._id] },
        ...entities,
      },
    })
  );
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", editCustomizationContent: {}, ...bottomSheet },
      selectedEntity: entity,
    })
  );
};

const picksOf = (groupId: string) =>
  ((tier1SelectedCustomization(store.getState()) as Record<string, unknown[]>)[groupId] ?? []) as Array<
    Record<string, unknown>
  >;
const radioOf = (card: HTMLElement) => card.querySelector("span[aria-hidden='true'].rounded-full");
const tap = (testId: string) =>
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });

describe("Customization page — D5: one-option slots are pre-selected (item 42)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("an active one-option slot is seeded: a FIXED card (no radio, not tappable), its meta, and its price in the live total", () => {
    seedD5();
    renderPage();

    expect(picksOf(D5_SIDES._id)).toEqual([{ ...FRIES, quantity: 1 }]);
    const card = screen.getByTestId(`pack-slot-${D5_SIDES._id}`);
    expect(card).toHaveTextContent("Large Fries");
    expect(card).toHaveTextContent("+£0.50 | 360 Cal");
    expect(radioOf(card)).toBeNull();
    expect(screen.queryByTestId(`pack-slot-open-${D5_SIDES._id}`)).not.toBeInTheDocument();
    expect(within(card).queryAllByRole("button")).toEqual([]); // not customizable: no CUSTOMIZE either
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£9.50");
  });

  it("not seeded: a two-option slot, an option that needs tier-2, an out-of-stock and an inactive option", () => {
    seedD5();
    renderPage();

    for (const group of [D5_DRINK, D5_SHAKE, D5_DIP, D5_DESSERT]) {
      expect(picksOf(group._id), group._id).toEqual([]);
    }
    // The tier-2-required and the out-of-stock one-option slots stay CHOICE slots (SELECT).
    for (const group of [D5_SHAKE, D5_DIP]) {
      const card = screen.getByTestId(`pack-slot-${group._id}`);
      expect(radioOf(card)).not.toBeNull();
      expect(screen.getByTestId(`pack-slot-cta-${group._id}`)).toHaveTextContent(`Select ${group.name}`);
      expect(screen.getByTestId(`pack-slot-open-${group._id}`)).toBeInTheDocument();
    }
    // No active option at all: no card.
    expect(screen.queryByTestId(`pack-slot-${D5_DESSERT._id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£9.50");
  });

  it("a seeded pick that can be customized gets CUSTOMIZE (pack-slot-customize-*), opening tier-2 on it", () => {
    seedD5(D5_PACK, undefined, {
      "d5-fries": { id: "d5-fries", name: "Large Fries", price: 0.5, isActive: true, outOfStock: false, modifiers: [D5_SALT._id] },
    });
    renderPage();

    expect(picksOf(D5_SIDES._id)).toHaveLength(1); // optional nested groups: still seeded
    const customize = screen.getByTestId(`pack-slot-customize-${D5_SIDES._id}`);
    expect(customize).toHaveTextContent(i18n.t("pack.customize"));
    expect(radioOf(screen.getByTestId(`pack-slot-${D5_SIDES._id}`))).toBeNull();

    tap(`pack-slot-customize-${D5_SIDES._id}`);
    expect(MIAMTier2Open(store.getState())).toBe(true);
  });

  it("the variant flow is not seeded: a sized pack's slot arrives empty with the size (a CHOICE slot)", () => {
    seedD5(
      {
        id: "d5-sized",
        name: "Sized Box",
        price: 0,
        hasVariant: true,
        variants: [{ id: "d5-large", name: "Large", price: 9, isActive: true, modifiers: [D5_SIDES._id] }],
      },
      { type: "variant", openType: "new", preselectedVariantId: "d5-large" }
    );
    renderPage();

    expect(screen.getByTestId("pdp-change-size")).toBeInTheDocument();
    expect(picksOf(D5_SIDES._id)).toEqual([]);
    expect(screen.getByTestId(`pack-slot-open-${D5_SIDES._id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`pack-slot-cta-${D5_SIDES._id}`)).toHaveTextContent("Select Sides");
  });

  it("the edit flow is not seeded: the row's own (empty) slot is restored as it was", () => {
    const ROW = {
      id: "d5-pack",
      itemId: "dp-1",
      uniqueItemId: "dp-1-u",
      name: "Dream Box",
      quantity: 1,
      type: "CUSTOMIZABLE",
      price: 9,
      total_price: 9,
      applyAddonsPrice: true,
      customizations: { [D5_SIDES._id]: [], [D5_DRINK._id]: [{ id: "d5-cola", name: "Cola", price: 0, quantity: 1 }] },
      baseItem: { ...D5_PACK, modifiers: [D5_SIDES._id, D5_DRINK._id] },
      modifiers: [D5_SIDES._id, D5_DRINK._id],
    };
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: D5_MODIFIERS }));
    store.dispatch(setCartItems([{ ...ROW }]));
    store.dispatch(openMakeItAMealModal({ isOpen: false, selectedItem: {}, availableCombos: [] }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(openTier1Modal());
    store.dispatch(setTeir1SelectedEntity({ ...ROW }));
    store.dispatch(
      setTier1BottomSheet({
        isOpen: true,
        type: "customizableItem",
        status: "customizableItem",
        openType: "edit",
        editCustomizationContent: ROW,
      })
    );
    store.dispatch(setTier1SelectedCustomization(ROW.customizations));
    store.dispatch(setSelectedEntity({ ...ROW.baseItem, itemId: ROW.itemId }));
    store.dispatch(setIsForceOpenMakeItAMealModal(false));
    renderPage();

    expect(screen.getByTestId(`pack-slot-${D5_SIDES._id}`)).toBeInTheDocument();
    expect(picksOf(D5_SIDES._id)).toEqual([]);
    expect(picksOf(D5_DRINK._id).map((pick) => pick.id)).toEqual(["d5-cola"]);
    expect(screen.getByTestId(`pack-slot-open-${D5_SIDES._id}`)).toBeInTheDocument();
  });
});

/*
  MONEY (H42-3): the seeded entry is the entry the sheet pick stores, so the
  PDP total, getTotalValueWithApplyAddonPrice, the committed row and the bill
  are identical whether the included item was seeded or picked.
*/
describe("Customization page — D5 money parity: seeded == picked through the sheet (item 42)", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter>{children}</MemoryRouter>
    </Provider>
  );
  const PARITY_PACK = { ...D5_PACK, modifiers: [D5_SIDES._id, D5_DRINK._id] };
  /** The committed row minus the ids minted per commit (`${Date.now()}_${id}` — never money). */
  const plain = (row: Record<string, unknown>) => {
    const { itemId, uniqueItemId, ...rest } = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
    expect(itemId).toMatch(/^\d+_d5-pack$/);
    expect(uniqueItemId).toBe(itemId);
    return rest;
  };

  /** Finish the order (pick the drink through its sheet), commit, and read the money. */
  const commit = () => {
    tap(`pack-slot-open-${D5_DRINK._id}`);
    tap("slot-option-d5-cola");
    tap("slot-sheet-save");
    tap("pdp-add-to-bag");
    const cart = (store.getState() as unknown as { cart: { cartItems: Array<Record<string, unknown>> } }).cart;
    expect(cart.cartItems).toHaveLength(1);
    const { result } = renderHook(() => useOrderHook(), { wrapper });
    const bill = result.current.getCalculatedBill(cart);
    return {
      row: plain(cart.cartItems[0]),
      subtotal: Number(bill.getSubtotal()),
      net: Number(bill.getNetAmount()),
    };
  };

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    // The Dexie cart mirror has no IndexedDB in jsdom; useCartHook logs its caught write.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the seeded entry deep-equals the sheet pick; the add-on value, the PDP total, the committed row and the bill are identical", () => {
    // A — seeded at init.
    seedD5(PARITY_PACK);
    const first = renderPage();
    const seeded = structuredClone(picksOf(D5_SIDES._id));
    const seededLabel = screen.getByTestId("pdp-add-to-bag").textContent;
    const seededValue = getTotalValueWithApplyAddonPrice({ [D5_SIDES._id]: seeded }, true);
    const a = commit();
    first.unmount();

    // B — the same slot emptied, then picked through the sheet.
    store.dispatch({ type: "RESET_STATE" });
    seedD5(PARITY_PACK);
    renderPage();
    act(() => {
      store.dispatch(
        setTier1SelectedCustomization({
          ...(tier1SelectedCustomization(store.getState()) as Record<string, unknown[]>),
          [D5_SIDES._id]: [],
        })
      );
    });
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£9.00");
    tap(`pack-slot-open-${D5_SIDES._id}`);
    tap("slot-option-d5-fries");
    tap("slot-sheet-save");
    const picked = structuredClone(picksOf(D5_SIDES._id));
    const pickedLabel = screen.getByTestId("pdp-add-to-bag").textContent;
    const b = commit();

    expect(seeded).toEqual([{ ...FRIES, quantity: 1 }]);
    expect(picked).toEqual(seeded);
    expect(seededValue).toBe(0.5);
    expect(getTotalValueWithApplyAddonPrice({ [D5_SIDES._id]: picked }, true)).toBe(seededValue);
    expect(seededLabel).toContain("£9.50");
    expect(pickedLabel).toBe(seededLabel);
    expect(b.row).toEqual(a.row);
    expect(a.row).toMatchObject({ id: "d5-pack", type: "CUSTOMIZABLE", quantity: 1, total_price: 9.5 });
    expect(a.subtotal).toBeCloseTo(9.5, 2);
    expect(b.subtotal).toBe(a.subtotal);
    expect(b.net).toBe(a.net);
  });
});

/* Item 42 shell (1:2920 / 1:4895): contents at x 24, the Included header over the slot grid, the live price kept in ADD TO BAG (D7-A). */
describe("Customization page — the item 42 shell", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("contents at x 24 (px-24, pb-72 above the 148 px bar), the grey 450 px hero band", () => {
    seedD5();
    renderPage();
    const scroller = document.getElementById("scrollCustomizableItem") as HTMLElement;

    expect(scroller).toHaveClass("px-[24px]", "pb-[72px]");
    expect(scroller.className).not.toContain("px-[48px]");
    expect(scroller.firstElementChild).toHaveClass("h-[450px]", "w-[1080px]", "-mx-[24px]", "bg-tb-grey-6");
    expect(screen.getByTestId("pdp-add-to-bag").parentElement).toHaveClass("h-[148px]");
  });

  it("the 'Included' GroupHeader (an h3) sits over the 3 × 328 slot grid", () => {
    seedD5();
    renderPage();
    const grid = screen.getByTestId("pack-slot-grid");
    const header = grid.previousElementSibling as HTMLElement;

    expect(within(header).getByRole("heading", { level: 3 })).toHaveTextContent(i18n.t("pack.included"));
    expect(grid).toHaveClass("grid-cols-[repeat(3,328px)]", "gap-[16px]");
  });

  it("ADD TO BAG keeps the LIVE price (D7-A): it moves with a priced pick and with the quantity", () => {
    seedD5({ ...D5_PACK, modifiers: [D5_DRINK._id] });
    renderPage();
    const cta = () => screen.getByTestId("pdp-add-to-bag");

    expect(cta()).toHaveTextContent(`${i18n.t("pdp.addToBag")} · £9.00`);
    act(() => {
      store.dispatch(
        setTier1SelectedCustomization({ [D5_DRINK._id]: [{ id: "d5-cola", name: "Cola", price: 1.25, quantity: 1 }] })
      );
    });
    expect(cta()).toHaveTextContent("£10.25");
    tap("pdp-qty-increase");
    expect(cta()).toHaveTextContent("£20.50");
  });

  it("an option group shows 'count of max' as Σ quantities (Title/H7, 1:4911)", () => {
    const SAUCES = {
      _id: "d5_sauces_addons",
      name: "Hot Sauces",
      min: 0,
      max: 4,
      multiplePunchMin: 0,
      multiplePunchMax: 6,
      multiplePunchMaxItem: 3,
      order: 9,
      isActive: true,
      constituentItems: [
        { id: "fire", name: "Fire", price: 0, isActive: true },
        { id: "mild", name: "Mild", price: 0, isActive: true },
      ],
    };
    store.dispatch(setModifiersMap({ modifiersMap: { [SAUCES._id]: SAUCES } }));
    store.dispatch(openMakeItAMealSession());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
        selectedEntity: { id: "nachos", name: "Nachos", price: 4, modifiers: [SAUCES._id] },
      })
    );
    renderPage();
    const group = screen.getByTestId(`pdp-group-${SAUCES._id}`);

    expect(group).toHaveTextContent("0 of 4");
    act(() => {
      store.dispatch(
        setTier1SelectedCustomization({
          [SAUCES._id]: [
            { id: "fire", name: "Fire", price: 0, quantity: 2 },
            { id: "mild", name: "Mild", price: 0, quantity: 1 },
          ],
        })
      );
    });
    expect(group).toHaveTextContent("3 of 4");
    // The max is the EFFECTIVE one the commit validates: multiplePunchMax under multiple punch.
    act(() => {
      store.dispatch(setAllowMultiplePunch(true));
    });
    expect(group).toHaveTextContent("3 of 6");
  });
});
