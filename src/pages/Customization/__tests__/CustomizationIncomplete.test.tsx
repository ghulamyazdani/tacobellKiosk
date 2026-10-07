import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  openComboConstutientCustomizations,
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import OfferTierHost from "../../../components/offer/OfferTierHost";
import Customization from "../index";
import i18n, { isolate } from "../../../i18n";

/*
  Item 23 (lane bag-pdp, Figma 1:2827 → Modal 1:945): a failed ADD TO BAG
  names EVERY incomplete group in one warning — box title when a pack slot is
  among them, item title otherwise — on top of today's ring + AutoScroll (the
  first failing group keeps its ring). GOT IT is the only exit. Each failed
  tap re-reads the groups. Never on a successful add. Also in the embedded
  in-bag PDP (OfferTierHost), the variant flow, and in Arabic.
*/

const AR = (value: string) => [{ value, name: "Arabic", code: "ar", dir: "rtl" }];
const AR_NUGGETS = "ناجتس";
const AR_DRINKS = "مشروبات";

const slot = (id: string, name: string, order: number, extra: Record<string, unknown> = {}) => ({
  _id: id,
  name,
  type: "Combo",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order,
  isActive: true,
  constituentItems: [{ id: `${id}-a`, name: `${name} A`, price: 0, isActive: true }],
  ...extra,
});

const BURRITO = {
  ...slot("pack1_1_combo", "Burrito", 1),
  constituentItems: [{ id: "b-beef", name: "Beefy Burrito", price: 0, isActive: true, isDefault: true }],
};
const NUGGETS = slot("pack1_2_combo", "Nuggets", 2, { aliases: AR(AR_NUGGETS) });
const DRINKS = slot("pack1_3_combo", "Drinks", 3, { aliases: AR(AR_DRINKS) });
/** A required NON-slot group (addons, min 1). */
const SAUCE = {
  _id: "pack1_addons",
  name: "Sauce",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 4,
  isActive: true,
  constituentItems: [{ id: "mild", name: "Mild Sauce", price: 0, isActive: true }],
};
const ICE = { ...SAUCE, _id: "cola-l_ice_addons", name: "Ice", order: 2, constituentItems: [{ id: "ice", name: "Ice", price: 0, isActive: true }] };
const STRAW = { ...SAUCE, _id: "cola-l_straw_addons", name: "Straw", order: 1, constituentItems: [{ id: "straw", name: "Straw", price: 0, isActive: true }] };

const MODIFIERS = Object.fromEntries([BURRITO, NUGGETS, DRINKS, SAUCE, ICE, STRAW].map((g) => [g._id, g]));
const PACK = {
  id: "pack1",
  name: "Dream Box",
  price: 25,
  applyAddonsPrice: true,
  modifiers: [BURRITO._id, NUGGETS._id, DRINKS._id],
};
const COLA = {
  id: "cola",
  name: "Cola",
  price: 0,
  hasVariant: true,
  variants: [{ id: "cola-l", name: "Large", price: 3, isActive: true, modifiers: [ICE._id, STRAW._id] }],
};

const seed = (entity: Record<string, unknown>, type = "customizableItem") => {
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: MODIFIERS }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type, openType: "new", editCustomizationContent: {} },
      selectedEntity: entity,
    }),
  );
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
      </MemoryRouter>
    </Provider>,
  );

const cartItems = () => (store.getState() as unknown as { cart: { cartItems: unknown[] } }).cart.cartItems;
const message = () => document.getElementById("pdp-incomplete-message")?.textContent;
const title = () => document.getElementById("pdp-incomplete-title")?.textContent;

/** ADD TO BAG inside act: the lazy warning (bag chunk) resolves in scope. */
const addToBag = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("pdp-add-to-bag"));
  });
};

const tap = async (testId: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

describe("PDP completion warning (item 23)", () => {
  beforeAll(async () => {
    Element.prototype.scrollTo = () => {};
    await import("../../../components/cart/bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("pack: missing Nuggets + Drinks → ONE warning naming both (box title); the ring stays; GOT IT closes; nothing added", async () => {
    seed(PACK);
    renderPdp();
    await addToBag();

    const warning = screen.getByTestId("pdp-incomplete");
    expect(warning).toHaveAttribute("role", "alertdialog");
    expect(title()).toBe("Let's finish building your box first");
    expect(message()).toBe("Please choose your nuggets and drinks before adding to your bag");
    expect(warning.querySelector("img")).toBeNull(); // the plain Modal, no warning mark
    expect(screen.getByTestId("pdp-incomplete-gotit")).toHaveTextContent(i18n.t("offers.gotIt"));
    expect(screen.getByTestId("pdp-incomplete-gotit")).toHaveFocus();
    expect(screen.getByTestId(`pack-slot-${NUGGETS._id}`)).toHaveClass("ring-4", "ring-red-500");
    expect(cartItems()).toHaveLength(0);

    await tap("pdp-incomplete-gotit");
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(screen.getByTestId(`pack-slot-${NUGGETS._id}`)).toHaveClass("ring-4", "ring-red-500");
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
  });

  it("each failed tap re-reads the groups; once complete the add lands with no warning", async () => {
    seed(PACK);
    renderPdp();
    await addToBag();
    await tap("pdp-incomplete-gotit");

    await tap(`pack-slot-open-${DRINKS._id}`);
    await tap(`slot-option-${DRINKS._id}-a`);
    await tap("slot-sheet-save");
    await addToBag();
    expect(message()).toBe("Please choose your nuggets before adding to your bag");
    await tap("pdp-incomplete-gotit");

    await tap(`pack-slot-open-${NUGGETS._id}`);
    await tap(`slot-option-${NUGGETS._id}-a`);
    await tap("slot-sheet-save");
    await addToBag();
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(cartItems()).toHaveLength(1);
  });

  it("a required NON-slot group → the item title", async () => {
    seed({ id: "burger", name: "Burger", price: 8, modifiers: [SAUCE._id] });
    renderPdp();
    await addToBag();
    expect(title()).toBe("Let's finish your choices first");
    expect(message()).toBe("Please choose your sauce before adding to your bag");
    expect(screen.getByTestId(`pdp-group-${SAUCE._id}`)).toHaveClass("ring-4", "ring-red-500");
  });

  it("a slot group among the missing ones → the box title", async () => {
    seed({ ...PACK, modifiers: [BURRITO._id, DRINKS._id, SAUCE._id] });
    renderPdp();
    await addToBag();
    expect(title()).toBe("Let's finish building your box first");
    expect(message()).toBe("Please choose your drinks and sauce before adding to your bag");
  });

  it("a complete PDP adds straight away — no warning ever opens", async () => {
    seed({ id: "burger", name: "Burger", price: 8, modifiers: [SAUCE._id] });
    renderPdp();
    await tap("pdp-option-mild");
    await addToBag();
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(cartItems()).toHaveLength(1);
  });

  it("variant flow: a size's required groups are named in the size's group order", async () => {
    seed(COLA, "variant");
    renderPdp();
    await tap("pdp-variant-cola-l");
    await addToBag();
    expect(title()).toBe("Let's finish your choices first");
    expect(message()).toBe("Please choose your straw and ice before adding to your bag");
    expect(cartItems()).toHaveLength(0);
  });

  it("embedded in the bag (OfferTierHost, a buy-stage pack): the warning opens over the in-place PDP; GOT IT keeps the host", async () => {
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: MODIFIERS }));
    store.dispatch(openComboConstutientCustomizations());
    store.dispatch(
      setTier1BottomSheetAndSelectedEntity({
        bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
        selectedEntity: { ...PACK, isBuyStageItem: true, quantity: 1 },
      }),
    );
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <OfferTierHost />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByTestId("customization-screen")).toHaveAttribute("data-embedded", "true");
    await addToBag();
    expect(title()).toBe("Let's finish building your box first");
    expect(message()).toBe("Please choose your nuggets and drinks before adding to your bag");
    await tap("pdp-incomplete-gotit");
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
    expect(cartItems()).toHaveLength(0);
  });

  it("Arabic: the groups' Arabic names, joined by the Arabic list format, in the Arabic copy", async () => {
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    seed(PACK);
    renderPdp();
    await addToBag();

    const groups = new Intl.ListFormat("ar", { type: "conjunction" }).format([isolate(AR_NUGGETS), isolate(AR_DRINKS)]);
    expect(title()).toBe(i18n.t("pdp.incomplete.titleBox"));
    expect(message()).toBe(i18n.t("pdp.incomplete.body", { groups }));
    expect(message()).toContain(AR_NUGGETS);
    expect(message()).toContain(` و`);
    expect(message()).not.toMatch(/nuggets|drinks| and /i);
    expect(screen.getByTestId("pdp-incomplete-gotit")).toHaveTextContent(i18n.t("offers.gotIt"));
  });
});
