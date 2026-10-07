import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setEntityMap, setMenuData, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  setTeir2SelectedEntity,
  setTier1SelectedCustomization,
  setTier2BottomSheet,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  openLoyaltyItemsModal,
  pushLoyaltyPointsAndCoupons,
  setLoyaltyPartner,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../redux/app/store";
import { setSelectedLanguage } from "../redux/features/multiLanguage/multiLanguage.slice";
import MenuItemCard from "../components/menu/MenuItemCard";
import SelectSizeModal from "../components/menu/SelectSizeModal";
import PackSlotCard from "../components/customization/PackSlotCard";
import SlotSelectionSheet from "../components/customization/SlotSelectionSheet";
import Tier2CustomizationSheet from "../components/customization/Tier2CustomizationSheet";
import BagItemRow from "../components/cart/BagItemRow";
import LoyaltyRewardsSheet from "../components/loyalty/LoyaltyRewardsSheet";
import ForYou from "../pages/ForYou";
import i18n from "../i18n";

/*
  Post-P9 28 — every name render site resolves the menu's ar alias at RENDER
  in an Arabic session (useLocalized): FSI…PDI isolated, and every accessible
  name keeps its visible label (WCAG 2.5.3 label-in-name). Callbacks and
  stored rows keep the raw entity — display only. Switching back to English
  restores the plain names. (Menu rail/H2/H3 + the product-added modal:
  Menu.test; the PDP: CustomizationArabic.test; /second: SecondLayout.test;
  the bag rail: CompleteYourMealRail.test; the MIAM combo: its own test.)
*/

// The loyalty sheet's RTK transport — never reached by a render.
vi.mock("@cx-sdk/ordering/services/loyaltyApi", () => ({
  useExecuteLoyaltyEventMutation: () => [vi.fn(), { isLoading: false, reset: () => {} }],
  useGetLoyaltyPartnerMutation: () => [vi.fn(), { isLoading: false }],
}));

const FSI = "⁨";
const PDI = "⁩";
const iso = (s: string) => `${FSI}${s}${PDI}`;
const ISOLATES = /[⁦-⁩]/;
const AR = (value: string) => [{ value, name: "Arabic", code: "ar", dir: "rtl" }];

const AR_CRUNCHWRAP = "كرانش راب";
const AR_BOX = "صندوق بيفي";
const AR_LARGE = "كبير";
const AR_REGULAR = "عادي";
const AR_DRINK_GROUP = "مشروب";
const AR_COLA = "كولا";
const AR_FRIES = "بطاطس محملة";
const AR_LARGE_COLA = "كولا كبيرة";
const AR_ICE_GROUP = "مستوى الثلج";
const AR_ICE = "ثلج عادي";
const AR_SAUCES = "صلصات";
const AR_SALSA = "سالسا";
const AR_BURGER = "تشيز برجر";
const AR_ONIONS = "بصل إضافي";
const AR_CHEESE = "جبنة إضافية";
const AR_PEPSI = "بيبسي";
const AR_SALAD = "سلطة يونانية";
const AR_NACHOS = "ناتشوز";

const AR_SESSION = { name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" };
const EN_SESSION = { name: "English", code: "en", dir: "ltr", type: "primary_language" };

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/menu"]}>{children}</MemoryRouter>
  </Provider>
);

const arabicSession = async () => {
  store.dispatch(setSelectedLanguage(AR_SESSION));
  await act(async () => {
    await i18n.changeLanguage("ar");
  });
};
/** The guest picks English again (App's sync moves i18n with the store). */
const englishAgain = async () => {
  store.dispatch(setSelectedLanguage(EN_SESSION));
  await act(async () => {
    await i18n.changeLanguage("en");
  });
};

beforeAll(() => {
  // jsdom has no Element.scrollTo; the customization autoscroll calls it.
  Element.prototype.scrollTo = () => {};
});

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ symbol: "£" }));
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe.each([false, true])("MenuItemCard (large=%s)", (large) => {
  const ENTITY = { id: "cw", name: "Crunchwrap Supreme", price: "5.99", aliases: AR(AR_CRUNCHWRAP) };

  it("Arabic: the card shows the alias, the overlay is named by it, quick-add is the AR verb; callbacks get the raw entity", async () => {
    await arabicSession();
    const onOpen = vi.fn();
    const onQuickAdd = vi.fn();
    render(<MenuItemCard entity={ENTITY} currency="£" large={large} onOpen={onOpen} onQuickAdd={onQuickAdd} />, {
      wrapper,
    });
    const card = screen.getByTestId("item-cw");

    expect(card).toHaveTextContent(iso(AR_CRUNCHWRAP), { normalizeWhitespace: false });
    expect(card).not.toHaveTextContent("Crunchwrap Supreme");
    const overlay = screen.getByRole("button", { name: iso(AR_CRUNCHWRAP) });
    expect(card).toContainElement(overlay);
    expect(screen.getByTestId("quick-add-cw")).toHaveAccessibleName(i18n.t("menu.quickAdd"));

    fireEvent.click(overlay);
    fireEvent.click(screen.getByTestId("quick-add-cw"));
    expect(onOpen).toHaveBeenCalledWith(ENTITY);
    expect(onQuickAdd).toHaveBeenCalledWith(ENTITY);
  });

  it("switching back to English restores the name (unisolated) on the same card", async () => {
    await arabicSession();
    render(<MenuItemCard entity={ENTITY} currency="£" large={large} onOpen={vi.fn()} onQuickAdd={vi.fn()} />, {
      wrapper,
    });

    await englishAgain();

    expect(screen.getByRole("button", { name: "Crunchwrap Supreme" })).toBeInTheDocument();
    expect(screen.getByTestId("item-cw").textContent).not.toMatch(ISOLATES);
  });
});

describe("SelectSizeModal", () => {
  const ENTITY = {
    id: "box",
    name: "Beefy Fries Box",
    aliases: AR(AR_BOX),
    variants: [
      { id: "v-large", name: "Large", aliases: AR(AR_LARGE), price: 8.09, isActive: true },
      { id: "v-regular", name: "Regular", aliases: AR(AR_REGULAR), price: 5.59, isActive: true },
    ],
  };

  it("Arabic: the entity name, the hero variant and the tile variants show their aliases; CONTINUE returns the raw variant", async () => {
    await arabicSession();
    const onContinue = vi.fn();
    render(<SelectSizeModal entity={ENTITY} onClose={vi.fn()} onContinue={onContinue} />, { wrapper });
    const modal = screen.getByTestId("select-size-modal");

    expect(modal).toHaveTextContent(iso(AR_BOX), { normalizeWhitespace: false });
    expect(screen.getByTestId("size-v-large")).toHaveTextContent(iso(AR_LARGE), { normalizeWhitespace: false });
    expect(screen.getByTestId("size-v-regular")).toHaveTextContent(iso(AR_REGULAR), { normalizeWhitespace: false });
    expect(modal).not.toHaveTextContent("Beefy Fries Box");
    expect(modal).not.toHaveTextContent("Regular");

    fireEvent.click(screen.getByTestId("size-v-regular"));
    fireEvent.click(screen.getByTestId("size-continue"));
    expect(onContinue).toHaveBeenCalledWith(ENTITY.variants[1]);
  });
});

describe("PackSlotCard (incl. pack.selectGroup)", () => {
  const GROUP = { _id: "pack1_2_combo", name: "Drink", aliases: AR(AR_DRINK_GROUP), min: 1, max: 1 };
  const PREVIEW = { id: "d-cola", name: "Cola", aliases: AR(AR_COLA), price: 0, calorieCount: 170, image_url: "" };

  it("Arabic: the CTA and the button's accessible name are pack.selectGroup with the isolated group alias; the slot shows the preview alias", async () => {
    await arabicSession();
    render(<PackSlotCard group={GROUP} selection={[]} previewItem={PREVIEW} currency="£" onOpen={vi.fn()} />, {
      wrapper,
    });
    const label = i18n.t("pack.selectGroup", { name: iso(AR_DRINK_GROUP) });
    const open = screen.getByTestId("pack-slot-open-pack1_2_combo");

    expect(label).toContain(AR_DRINK_GROUP);
    expect(open).toHaveAccessibleName(label);
    expect(within(open).getByText(label)).toBeInTheDocument(); // the visible CTA = the name
    expect(open).toHaveTextContent(iso(AR_COLA), { normalizeWhitespace: false });
    expect(open).not.toHaveTextContent("Cola");
  });

  it("Arabic: without a preview the placeholder and the slot line show the group alias", async () => {
    await arabicSession();
    render(<PackSlotCard group={GROUP} selection={[]} previewItem={null} currency="£" onOpen={vi.fn()} />, {
      wrapper,
    });

    expect(screen.getAllByText(iso(AR_DRINK_GROUP))).toHaveLength(2); // placeholder + slot line
    expect(screen.getByTestId("pack-slot-pack1_2_combo")).not.toHaveTextContent("Drink");
  });
});

describe("SlotSelectionSheet", () => {
  const GROUP = { _id: "pack1_3_combo", name: "Side", aliases: AR(AR_DRINK_GROUP), min: 1, max: 1 };
  const FRIES = { id: "opt-fries", name: "Loaded Fries", aliases: AR(AR_FRIES), price: 0.75, image_url: "" };

  it("Arabic: the title is pack.selectGroup with the alias; each option shows its alias and its overlay is named by it", async () => {
    await arabicSession();
    const onSave = vi.fn();
    render(
      <SlotSelectionSheet
        open
        group={GROUP}
        options={[FRIES]}
        currency="£"
        canCustomize={() => false}
        onSave={onSave}
        onCustomize={vi.fn()}
        onClose={vi.fn()}
      />,
      { wrapper }
    );
    const sheet = screen.getByTestId("slot-sheet");
    const option = screen.getByTestId("slot-option-opt-fries");

    expect(within(sheet).getByRole("heading", { level: 2 }).textContent).toBe(
      i18n.t("pack.selectGroup", { name: iso(AR_DRINK_GROUP) })
    );
    expect(option).toHaveAccessibleName(iso(AR_FRIES));
    expect(option.parentElement).toHaveTextContent(iso(AR_FRIES), { normalizeWhitespace: false });
    expect(sheet).not.toHaveTextContent("Loaded Fries");

    fireEvent.click(option);
    fireEvent.click(screen.getByTestId("slot-sheet-save"));
    expect(onSave).toHaveBeenCalledWith(FRIES);
  });
});

describe("Tier2CustomizationSheet", () => {
  const SLOT_GROUP = { _id: "pack1_2_combo", name: "Drink", min: 1, max: 1, order: 2, isActive: true };
  const ICE_GROUP = {
    _id: "dl_ice",
    name: "Ice Level",
    aliases: AR(AR_ICE_GROUP),
    min: 0,
    max: 1,
    multiplePunchMin: 0,
    multiplePunchMax: 1,
    multiplePunchMaxItem: 1, // grid
    order: 1,
    isActive: true,
    constituentItems: [{ id: "ice", name: "Regular Ice", aliases: AR(AR_ICE), price: 0, isActive: true }],
  };
  const SAUCE_GROUP = {
    _id: "dl_sauce",
    name: "Sauces",
    aliases: AR(AR_SAUCES),
    min: 0,
    max: 3,
    multiplePunchMin: 0,
    multiplePunchMax: 3,
    multiplePunchMaxItem: 3, // stepper rows
    order: 2,
    isActive: true,
    constituentItems: [{ id: "salsa", name: "Salsa", aliases: AR(AR_SALSA), price: 0, isActive: true }],
  };
  const ENTITY = {
    id: "d-large",
    name: "Large Cola",
    aliases: AR(AR_LARGE_COLA),
    price: 0.75,
    quantity: 1,
    modifiers: [ICE_GROUP._id, SAUCE_GROUP._id],
  };

  const openTier2 = () => {
    const selections = { [SLOT_GROUP._id]: [] };
    store.dispatch(setModifiersMap({ modifiersMap: { [ICE_GROUP._id]: ICE_GROUP, [SAUCE_GROUP._id]: SAUCE_GROUP } }));
    store.dispatch(setTier1SelectedCustomization(selections));
    store.dispatch(
      setTeir2SelectedEntity({
        entity: ENTITY,
        groupId: SLOT_GROUP._id,
        currentCustomizations: { selectedCustomizations: selections, group: SLOT_GROUP },
      })
    );
    store.dispatch(
      setTier2BottomSheet({ isOpen: true, type: "customizableItem", openType: "new", status: "", editCustomizationContent: {} })
    );
  };

  it("Arabic: the header, the group titles and the grid / stepper option names show their aliases", async () => {
    await arabicSession();
    openTier2();
    render(<Tier2CustomizationSheet />, { wrapper });
    const sheet = screen.getByTestId("tier2-sheet");

    expect(within(sheet).getByRole("heading", { level: 2 }).textContent).toBe(iso(AR_LARGE_COLA));
    expect(within(screen.getByTestId("tier2-group-dl_ice")).getByRole("heading", { level: 3 }).textContent).toBe(
      iso(AR_ICE_GROUP)
    );
    expect(within(screen.getByTestId("tier2-group-dl_sauce")).getByRole("heading", { level: 3 }).textContent).toBe(
      iso(AR_SAUCES)
    );
    expect(screen.getByTestId("tier2-option-ice")).toHaveAccessibleName(iso(AR_ICE)); // grid tile: named by its text
    expect(screen.getByTestId("tier2-option-salsa")).toHaveTextContent(iso(AR_SALSA), { normalizeWhitespace: false });
    expect(sheet).not.toHaveTextContent("Large Cola");
    expect(sheet).not.toHaveTextContent("Regular Ice");
  });
});

describe("BagItemRow", () => {
  const CUSTOMIZABLE = {
    id: "cheese-burger",
    itemId: "cb-1",
    name: "Cheese Burger",
    aliases: AR(AR_BURGER),
    quantity: 1,
    type: "CUSTOMIZABLE",
    price: 8,
    total_price: 10.6,
    customizations: {
      g1: [
        { id: "onions", name: "Add Onions", aliases: AR(AR_ONIONS), price: 0.6, quantity: 1 },
        { id: "cheese", name: "Extra Cheese", aliases: AR(AR_CHEESE), price: 1, quantity: 2 },
      ],
    },
    baseItem: { id: "cheese-burger", name: "Cheese Burger", modifiers: ["g1"] },
  };
  const VARIANT = {
    id: "pepsi",
    itemId: "pep-1",
    name: "Pepsi",
    aliases: AR(AR_PEPSI),
    quantity: 1,
    type: "VARIANT",
    price: 3,
    total_price: 3,
    selectedVariant: { id: "pepsi-l", name: "Large", aliases: AR(AR_LARGE), price: 3 },
    customizations: {},
    baseItem: { id: "pepsi", name: "Pepsi", hasVariant: true },
  };
  const renderRow = (row: object) =>
    render(<BagItemRow row={row} currency="£" onEdit={vi.fn()} onRequestRemove={vi.fn()} />, { wrapper });
  /** The add-on / variant <p> lines of a row. */
  const lineOf = (rowEl: HTMLElement, text: string) =>
    [...rowEl.querySelectorAll("p")].find((p) => p.textContent?.includes(text)) as HTMLElement;

  it("Arabic: the row name shows the alias; the stored row keeps its English name", async () => {
    await arabicSession();
    renderRow(CUSTOMIZABLE);
    const row = screen.getByTestId("bag-row-cb-1");

    expect(row).toHaveTextContent(iso(AR_BURGER), { normalizeWhitespace: false });
    expect(row).not.toHaveTextContent("Cheese Burger");
    expect(CUSTOMIZABLE.name).toBe("Cheese Burger");
  });

  it("Arabic: an add-on line is the isolated alias with '+price' AFTER it, in its own run", async () => {
    await arabicSession();
    renderRow(CUSTOMIZABLE);
    const row = screen.getByTestId("bag-row-cb-1");

    const onions = lineOf(row, AR_ONIONS);
    expect(onions.textContent).toBe(`${iso(AR_ONIONS)} +£0.60`);
    const cheese = lineOf(row, AR_CHEESE);
    expect(cheese.textContent).toBe(`${i18n.t("bag.lineQty", { qty: 2 })} ${iso(AR_CHEESE)} +£1.00`);
    // The isolate closes before the price starts — the price can never be pulled into the name.
    expect(cheese.textContent?.lastIndexOf(PDI)).toBeLessThan(cheese.textContent?.indexOf("+£") ?? -1);
  });

  it("Arabic: a VARIANT row prints the variant alias", async () => {
    await arabicSession();
    renderRow(VARIANT);
    const row = screen.getByTestId("bag-row-pep-1");

    expect(row).toHaveTextContent(iso(AR_PEPSI), { normalizeWhitespace: false });
    expect(lineOf(row, AR_LARGE).textContent).toBe(iso(AR_LARGE));
    expect(row).not.toHaveTextContent("Large");
  });

  it("switching back to English restores the row, add-on and variant names", async () => {
    await arabicSession();
    renderRow(CUSTOMIZABLE);
    await englishAgain();

    const row = screen.getByTestId("bag-row-cb-1");
    expect(row).toHaveTextContent("Cheese Burger");
    expect(lineOf(row, "Add Onions").textContent).toBe("Add Onions +£0.60");
    expect(row.textContent).not.toMatch(ISOLATES);
  });
});

describe("LoyaltyRewardsSheet", () => {
  const SALAD = {
    id: "5dd1093829754a432f2c32e2",
    name: "Greek Salad",
    aliases: AR(AR_SALAD),
    price: 17,
    image_url: "https://cdn.example.test/greek-salad.jpg",
    modifiers: [] as string[],
  };
  const COUPON = {
    coupon_name: "Free Greek Salad",
    coupon_code: "static6562",
    discount_on: "item",
    discount_type: "percentage",
    discount_value: 100,
    special_offer: false,
    item_options: {},
    products: [{ _id: SALAD.id, quantity: 1 }],
    extra_fields: [
      { name: "Points Value", value: 3000 },
      { name: "Reward Type", value: "Loyalty Reward" },
    ],
  };

  it("Arabic: a reward tile shows the menu item's alias", async () => {
    await arabicSession();
    store.dispatch(
      setLoyaltyPartner({
        partner: { partner_name: "Xeno" },
        partnerDetails: { partner_name: "Xeno" },
      })
    );
    store.dispatch(setMenuData({ menu: { categories: [{ id: "c", subCategories: [{ id: "s", entities: [SALAD] }] }] } }));
    store.dispatch(
      pushLoyaltyPointsAndCoupons({
        coupons: [COUPON],
        loyalty_points: 6000,
        total_redeemable_points: 6000,
        min_bill_for_redemption: 0,
      })
    );
    store.dispatch(openLoyaltyItemsModal({ isTimerOn: false }));
    render(<LoyaltyRewardsSheet />, { wrapper });
    const tile = screen.getByTestId("loyalty-reward-static6562");

    expect(tile).toHaveTextContent(iso(AR_SALAD), { normalizeWhitespace: false });
    expect(tile).not.toHaveTextContent("Greek Salad");
  });
});

describe("ForYou page", () => {
  const NACHOS = {
    id: "nachos",
    name: "Nachos BellGrande",
    aliases: AR(AR_NACHOS),
    price: 4,
    isActive: true,
    isCartRecommended: true,
  };

  it("Arabic: the card title is the alias, and the card is named by verb + title (label-in-name)", async () => {
    await arabicSession();
    store.dispatch(setEntityMap({ entityMap: { [NACHOS.id]: NACHOS } }));
    store.dispatch(
      setCartItems([{ id: "seed", itemId: "seed-1", name: "Row", quantity: 1, type: "ITEM", total_price: 1 }])
    );
    render(<ForYou />, { wrapper });
    const card = screen.getByTestId("foryou-card-nachos");

    expect(card).toHaveTextContent(iso(AR_NACHOS), { normalizeWhitespace: false });
    expect(card).not.toHaveTextContent("Nachos BellGrande");
    expect(card).toHaveAccessibleName(`${i18n.t("menu.quickAdd")} ${iso(AR_NACHOS)}`);
  });
});
