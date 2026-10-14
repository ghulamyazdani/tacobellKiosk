/* eslint-disable @typescript-eslint/no-explicit-any --
 * Menu entities flow through untyped from the legacy converters, matching
 * the component under test. Do not add NEW anys.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  selectShowErrorModalGlobal,
  setCurrency,
  setDeploymentInfo,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setCurrentSession } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import { applyOffer, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../../cart/BagSheet";
import {
  mutateAddToCartModal,
  setOutOfStockItems,
  setRecommendationDetour,
  stageConfiguredUpsellItem,
  stageUpsellItem,
  type StagedCartRow,
  type UpsellStaging,
} from "../../../redux/features/menuSelections/menuSelections.slice";
import ProductAddedModal from "../ProductAddedModal";
import i18n from "../../../i18n";

/*
  audit-fixes B4 (F09, closes X04) — "YOUR PRODUCT HAS BEEN ADDED" per Figma
  1:4571 / modal 1:4589: a 680 card on a tb-purple/80 scrim, up to three
  You-Might-Like tiles (2-line names, "£x | N Cal" with the calories only
  when > 0, a 36 px quick add on a 44 px hit area), the Total and ONE CTA.
  The frame has no VIEW MY BAG: the menu's CTA bar keeps that edge.

  posistKiosk parity (user report 2026-10-12): the modal STAGES. A tile tap
  goes to Menu (onQuickAdd), which stages a one-tap item or sends a choice
  item through Select a Size / the PDP, whose add is PARKED back here
  (useCartHook). Nothing reaches the bag until ADD TO ORDER; X and the scrim
  throw the picks away.
*/

const TACO = { id: "r-taco", name: "Crunchy Taco", price: 4, calorieCount: 0 };
const BURRITO = { id: "r-burrito", name: "Crispy Chicken Burrito", price: 5.59, calorieCount: 360 };
const SOLD_OUT = { id: "r-oos", name: "Nachos", price: 3, outOfStock: true };
const QUESADILLA = { id: "r-quesadilla", name: "Quesadilla", price: 5.59 };
const TWISTS = { id: "r-twists", name: "Cinnamon Twists", price: 2 };
const ENTITY_MAP = Object.fromEntries(
  [TACO, BURRITO, SOLD_OUT, QUESADILLA, TWISTS].map((e) => [e.id, e])
);
/** Two rows, £7.00 + 2 × £2.50 = £12.00, untaxed. */
const CART = [
  { id: "c-1", itemId: "i-1", name: "Taco", quantity: 1, type: "ITEM", price: 7, total_price: 7 },
  { id: "c-2", itemId: "i-2", name: "Fries", quantity: 2, type: "ITEM", price: 2.5, total_price: 2.5 },
];
const VAT15 = { _id: "vat15", name: "VAT@ 15%", type: "percentage", value: 15, isGSTOSC: false, cascadingTaxes: [] };
/** The same rows under VAT 15 % exclusive: £12.00 + £1.80. */
const TAXED_CART = CART.map((row) => ({ ...row, taxes: [VAT15] }));
/** A size the chooser parked (useCartHook's VARIANT row): £7, VAT 15 %. */
const LARGE_PARKED = {
  id: "r-elsewhere",
  itemId: "p-large",
  uniqueItemId: "p-large",
  name: "Elsewhere",
  type: "VARIANT",
  quantity: 1,
  price: 7,
  variantPrice: 7,
  total_price: 7,
  selectedVariant: { id: "v-large", name: "Large", price: 7 },
  taxes: [VAT15],
};
/** £2 off the whole order (BagSheetTotals' FLAT_TWO). */
const FLAT_TWO = {
  _id: "offer-flat-2",
  name: "£2 off your order",
  type: { name: "amount", value: 2 },
  isAvailable: true,
  applicable: { on: "complete", categories: [], items: [], isExclude: false, isInclude: false, rawItems: [] },
  buyItems: {},
  getItems: {},
};

// No router: the modal never navigates (VIEW MY BAG and its useNavigate are gone).
const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

const open = (item: Record<string, unknown>) =>
  act(() => {
    store.dispatch(mutateAddToCartModal({ isOpen: true, item }));
  });
const isOpen = () =>
  (store.getState() as any).menuSelections.addToCartModal.isOpen as boolean;
const tiles = () => screen.queryAllByTestId(/^added-rec-(?!add-|remove-)/);
const state = () =>
  store.getState() as unknown as {
    menuSelections: { upsellStaging: UpsellStaging };
    cart: { cartItems: Record<string, unknown>[]; subTotal: number };
  };
const staging = () => state().menuSelections.upsellStaging;
const cartItems = () => state().cart.cartItems;
const stage = (id: string, units = 1) =>
  act(() => {
    for (let i = 0; i < units; i += 1) store.dispatch(stageUpsellItem({ id, delta: 1 }));
  });
/** A chooser's finished row as useCartHook parks it (buildCartItemContent's shape). */
const park = (row: StagedCartRow) =>
  act(() => {
    store.dispatch(stageConfiguredUpsellItem(row));
  });

describe("ProductAddedModal (Figma 1:4589)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setEntityMap({ entityMap: ENTITY_MAP }));
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("closed → renders nothing", () => {
    const { container } = render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("the frame's shell: tb-purple/80 scrim, a 680 card (the Figma tb-modal-spring, centred by its fill), the H5 title, a 48 px close at 25/25", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id] });

    const modal = screen.getByTestId("product-added-modal");
    expect(modal).toHaveClass("absolute", "inset-0", "z-40");
    // Fixer UI-5: a modal dialog named by its H5 title.
    expect(screen.getByRole("dialog", { name: i18n.t("added.title") })).toBe(modal);
    expect(modal).toHaveAttribute("aria-modal", "true");
    const [scrim, card] = Array.from(modal.children);
    expect(scrim).toHaveClass("bg-tb-purple/80", "absolute", "inset-0");
    expect(scrim).toHaveAccessibleName(i18n.t("language.close"));
    // Motion lane: Figma 1:5502 → 1:5521 springs the card — ONE animation
    // owner, so the generic entrance is gone.
    expect(card).not.toHaveClass("tb-modal-enter");
    expect(card).toHaveClass(
      "tb-modal-spring",
      "left-1/2",
      "top-1/2",
      "w-[680px]",
      "gap-[75px]",
      "rounded-[16px]",
      "pt-[80px]",
      "px-[24px]",
      "pb-[24px]"
    );
    const title = within(card as HTMLElement).getByRole("heading", { level: 2 });
    expect(title).toHaveTextContent(i18n.t("added.title"));
    expect(title).toHaveClass("tb-display", "w-[502px]", "text-[32px]", "leading-[32px]", "tracking-[-1px]", "text-tb-purple");
    const close = within(card as HTMLElement).getByRole("button", { name: i18n.t("language.close") });
    expect(close).toHaveClass("absolute", "right-[25px]", "top-[25px]", "h-[48px]", "w-[48px]");
  });

  it("at most three tiles, out-of-stock suggestions dropped, in the menu's order", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({
      id: "added",
      recommendedItems: [TACO.id, SOLD_OUT.id, { id: BURRITO.id }, QUESADILLA.id, TWISTS.id, "missing"],
    });

    expect(screen.getByText(i18n.t("added.youMightLike"))).toBeInTheDocument();
    expect(tiles().map((t) => t.dataset.testid)).toEqual([
      `added-rec-${TACO.id}`,
      `added-rec-${BURRITO.id}`,
      `added-rec-${QUESADILLA.id}`,
    ]);
    expect(screen.queryByTestId(`added-rec-${SOLD_OUT.id}`)).toBeNull();
  });

  it("a tile: 204 wide, the 126×71 photo box, a 2-line name, and the meta 'price' — '| N Cal' only when the calories are > 0", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id] });

    const taco = screen.getByTestId(`added-rec-${TACO.id}`);
    expect(taco).toHaveClass("relative", "w-[204px]", "min-h-[235px]", "rounded-[8px]", "bg-tb-grey-6", "pt-[48px]");
    expect(taco.firstElementChild).toHaveClass("h-[71px]", "w-[126px]");
    const name = within(taco).getByText(TACO.name);
    expect(name).toHaveClass("line-clamp-2", "text-[20px]", "leading-[24px]");
    expect(name.nextElementSibling?.textContent).toBe("£4");
    expect(within(screen.getByTestId(`added-rec-${BURRITO.id}`)).getByText("£5.59 | 360 Cal")).toBeInTheDocument();
  });

  it("'+' quick-adds that suggestion through onQuickAdd: a 44×44 hit area around the frame's 36 px circle", () => {
    const onQuickAdd = vi.fn();
    render(<ProductAddedModal onQuickAdd={onQuickAdd} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id] });

    const plus = screen.getByTestId(`added-rec-add-${BURRITO.id}`);
    // Lane added-modal: the tile's overlay is its ONE accessible control; the
    // '+' is its visual twin above it, hidden from AT and the tab order.
    expect(plus).toHaveAttribute("aria-hidden", "true");
    expect(plus).toHaveAttribute("tabindex", "-1");
    expect(plus).toHaveClass("absolute", "z-10", "right-[7px]", "top-[5px]", "h-[44px]", "w-[44px]");
    expect(plus.firstElementChild).toHaveClass("h-[36px]", "w-[36px]", "rounded-full");
    // Figma Quick Add (1:421) pressed: the white circle turns #F3D9FF. The
    // white is on the circle, not the button, so the press reaches it
    // through `group` (the unlayered button.bg-tb-surface fill cannot).
    expect(plus).toHaveClass("group");
    expect(plus.firstElementChild).toHaveClass("bg-tb-surface", "group-active:bg-tb-lilac");
    fireEvent.click(plus);

    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    // The resolver's entity: the menu's own plus the resolved price and the
    // isDirectlyAddable stamp.
    expect(onQuickAdd).toHaveBeenCalledWith(expect.objectContaining(BURRITO));
    expect(isOpen()).toBe(true);
  });

  /*
    Lane added-modal (user report 2026-10-09, RC1): the WHOLE tile adds — an
    EMPTY overlay (P9f overlay-button pattern; tb-press-card squeezes on
    `> button:empty:active`) named "Quick add <name>". DOM order after the
    text: the count status, the overlay, the '+' (z-10) — so a tap on the
    pill lands on the overlay.
  */
  it("the whole tile adds: an empty overlay 'Quick add <name>' (a direct child, the card presses); the '+' above it fires exactly once too", () => {
    const onQuickAdd = vi.fn();
    render(<ProductAddedModal onQuickAdd={onQuickAdd} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id] });

    const card = screen.getByTestId(`added-rec-${BURRITO.id}`);
    expect(card).toHaveClass("tb-press-card", "relative");
    const overlay = screen.getByRole("button", { name: "Quick add Crispy Chicken Burrito" });
    expect(overlay.parentElement).toBe(card);
    expect(overlay).toBeEmptyDOMElement();
    expect(overlay).toHaveClass("absolute", "inset-0");
    const plus = screen.getByTestId(`added-rec-add-${BURRITO.id}`);
    expect(Array.from(card.children).slice(-3)).toEqual([within(card).getByRole("status"), overlay, plus]);
    // Nothing picked yet: the tile's only controls (its "−" comes with a pick).
    expect(within(card).getAllByRole("button", { hidden: true })).toEqual([overlay, plus]);

    fireEvent.click(overlay);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd).toHaveBeenCalledWith(expect.objectContaining(BURRITO));

    onQuickAdd.mockClear();
    fireEvent.click(plus);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd).toHaveBeenCalledWith(expect.objectContaining(BURRITO));
    expect(plus).toHaveClass("z-10");
    expect(plus).toHaveAttribute("aria-hidden", "true");
    expect(plus).toHaveAttribute("tabindex", "-1");
    // ONE accessible control per tile.
    expect(screen.getAllByRole("button", { name: /^Quick add / }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Quick add Crunchy Taco",
      "Quick add Crispy Chicken Burrito",
    ]);
    expect(isOpen()).toBe(true);
  });

  // Review UIA-1: a tap moved focus onto the aria-hidden '+' (Chrome then
  // un-hides it as a nameless focused button and warns "Blocked aria-hidden").
  // Its mousedown default — the focus move, touch's compat mousedown too — is
  // cancelled; the press and the add stay.
  it("the '+' never takes focus: its mousedown default is cancelled, and the tap still adds", () => {
    const onQuickAdd = vi.fn();
    render(<ProductAddedModal onQuickAdd={onQuickAdd} />, { wrapper });
    open({ id: "added", recommendedItems: [BURRITO.id] });
    const plus = screen.getByTestId(`added-rec-add-${BURRITO.id}`);

    // fireEvent answers false when the handler called preventDefault().
    expect(fireEvent.mouseDown(plus)).toBe(false);
    fireEvent.click(plus);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
  });

  // Review UIA-2 — ForYouCard's convention (the bag and PDP rails): a tile
  // that adds in place is "Quick add <name>"; one that needs a choice LEAVES
  // the modal (Select a Size / the PDP / the repeat sheet) and is named
  // "Customize <name>", the only warning a screen reader gives of that.
  it("a tile that needs a choice is named 'Customize <name>'; a one-tap tile 'Quick add <name>'", () => {
    const BOX = {
      id: "r-sized",
      name: "Cravings Box",
      hasVariant: true,
      isVariant: false,
      variants: [{ id: "s-regular", price: 5, isActive: true }],
    };
    store.dispatch(setEntityMap({ entityMap: { ...ENTITY_MAP, [BOX.id]: BOX } }));
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BOX.id] });

    expect(within(screen.getByTestId(`added-rec-${TACO.id}`)).getByRole("button")).toHaveAccessibleName(
      `${i18n.t("menu.quickAdd")} ${TACO.name}`
    );
    expect(within(screen.getByTestId(`added-rec-${BOX.id}`)).getByRole("button")).toHaveAccessibleName(
      `${i18n.t("pack.customize")} ${BOX.name}`
    );
  });

  /*
    The pill counts what the guest is ADDING — one-tap units plus parked
    chooser rows of that id — never what the bag already holds (posistKiosk:
    "how many you are adding", so it starts at zero even for an item in the
    bag). ForYouCard's pill, centred between the "−" and the "+": it pops in
    (tb-pop-in), each change re-keys the number so it bumps (tb-bump). The
    digits are aria-hidden; an always-mounted status speaks "N selected".
  */
  it("the count pill: the STAGED count (one-tap units + parked rows of that id), never the bag's; the number re-keys inside the same pill; a status speaks 'N selected' (EN, AR)", async () => {
    store.dispatch(
      setCartItems([{ id: TACO.id, itemId: "t-1", name: "Taco", quantity: 2, type: "ITEM", price: 4, total_price: 4 }])
    );
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id, QUESADILLA.id] });
    expect(screen.queryByTestId(`added-count-${TACO.id}`)).toBeNull();

    stage(BURRITO.id, 2);
    const pill = screen.getByTestId(`added-count-${BURRITO.id}`);
    expect(pill).toHaveTextContent(/^2$/);
    expect(pill).toHaveAttribute("aria-hidden", "true");
    expect(pill).toHaveClass(
      "tb-pop-in",
      "h-[36px]",
      "min-w-[36px]",
      "rounded-full",
      "bg-tb-purple",
      "px-[8px]",
      "text-[18px]",
      "font-bold",
      "text-tb-surface"
    );
    const number = pill.firstElementChild;
    expect(number).toHaveClass("tb-bump");
    expect(screen.queryByTestId(`added-count-${TACO.id}`)).toBeNull();
    expect(screen.queryByTestId(`added-count-${QUESADILLA.id}`)).toBeNull();

    // Every tile carries its status, centred on the "−" / "+" row (empty at 0).
    const statuses = tiles().map((tile) => within(tile).getByRole("status"));
    expect(statuses).toHaveLength(3);
    statuses.forEach((s) => expect(s).toHaveClass("absolute", "inset-x-0", "top-[9px]", "justify-center"));
    expect(statuses[0]).toBeEmptyDOMElement();
    expect(statuses[1]).toContainElement(pill);
    const spoken = () => statuses[1].querySelector(".sr-only")?.textContent;
    expect(spoken()).toBe("2 selected");

    // A parked chooser row of that id counts its whole quantity.
    park({ id: BURRITO.id, itemId: "p-1", name: BURRITO.name, type: "CUSTOMIZABLE", quantity: 2, total_price: 6 });
    expect(screen.getByTestId(`added-count-${BURRITO.id}`)).toBe(pill);
    expect(pill).toHaveTextContent(/^4$/);
    expect(pill.firstElementChild).not.toBe(number);
    expect(pill.firstElementChild).toHaveClass("tb-bump");
    expect(spoken()).toBe("4 selected");
    // Staging never touches the bag.
    expect(cartItems()).toEqual([expect.objectContaining({ id: TACO.id, quantity: 2 })]);

    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    expect(spoken()).toBe(i18n.t("added.selected", { value: 4 }));
    expect(spoken()).not.toBe("4 selected");
  });

  /*
    posistKiosk's "−": shown only while the tile has picks — the trash glyph
    at 1, "−" from 2 (D6, OptionRow) — on the "+"'s circle at the mirrored
    corner. Each tap takes ONE pick back: one-tap units first (one tap puts a
    unit back; a configuration cost a trip through a chooser), then the most
    recent parked row.
  */
  it("'−': only while picked — trash at 1, minus from 2, 'Remove one <name>' on a 44 px hit area; each tap takes back one unit, then the most recent parked row", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [BURRITO.id] });
    expect(screen.queryByTestId(`added-rec-remove-${BURRITO.id}`)).toBeNull();

    stage(BURRITO.id, 2);
    park({ id: BURRITO.id, itemId: "p-old", type: "CUSTOMIZABLE", quantity: 1, total_price: 6 });
    park({ id: BURRITO.id, itemId: "p-new", type: "CUSTOMIZABLE", quantity: 1, total_price: 7 });
    const remove = screen.getByRole("button", { name: "Remove one Crispy Chicken Burrito" });
    expect(remove).toHaveAttribute("data-testid", `added-rec-remove-${BURRITO.id}`);
    expect(remove).toHaveClass("absolute", "left-[7px]", "top-[5px]", "z-10", "h-[44px]", "w-[44px]");
    expect(remove.firstElementChild).toHaveClass("h-[36px]", "w-[36px]", "rounded-full", "bg-tb-surface");
    const glyph = () => remove.querySelector("img")?.getAttribute("src") ?? "";
    const count = () => screen.queryByTestId(`added-count-${BURRITO.id}`)?.textContent ?? null;
    expect(count()).toBe("4");
    expect(glyph()).toContain("qty-minus");

    fireEvent.click(remove);
    expect(count()).toBe("3");
    expect(staging().pending).toEqual({ [BURRITO.id]: 1 });
    fireEvent.click(remove);
    expect(count()).toBe("2");
    expect(staging().pending).toEqual({});
    expect(staging().pendingCustom.map((row) => row.itemId)).toEqual(["p-old", "p-new"]);
    fireEvent.click(remove);
    expect(count()).toBe("1");
    expect(staging().pendingCustom.map((row) => row.itemId)).toEqual(["p-old"]);
    expect(glyph()).toContain("trash");
    expect(glyph()).not.toContain("qty-minus");
    fireEvent.click(remove);

    expect(count()).toBeNull();
    expect(screen.queryByTestId(`added-rec-remove-${BURRITO.id}`)).toBeNull();
    expect(staging()).toEqual({ pending: {}, pendingCustom: [] });
    expect(isOpen()).toBe(true);
  });

  /*
    RC5: the strip resolves through the SDK's resolveItemRecommendations — the
    resolver the modal-open check mirrors — over the menu-sellable map (UB6)
    and the LIVE out-of-stock map.
  */
  describe("the strip resolves through the SDK resolver (RC5)", () => {
    const SELF = { id: "added", name: "Bean Burrito", price: 3 };
    const INACTIVE = { id: "r-inactive", name: "Old Taco", price: 2, isActive: false };
    const PHANTOM = {
      id: "r-phantom",
      name: "Nachos Meal",
      price: 9,
      hasVariant: true,
      isVariant: false,
      variants: [{ id: "p-1", price: 9, isActive: false }],
    };
    const SIZED = {
      id: "r-box",
      name: "Cravings Box",
      price: 13,
      hasVariant: true,
      isVariant: false,
      variants: [
        { id: "x-large", price: 7, isActive: true },
        { id: "x-regular", price: 5, isActive: true },
        { id: "x-off", price: 1, isActive: false },
      ],
    };
    const ids = () => tiles().map((t) => t.dataset.testid?.replace("added-rec-", ""));

    beforeEach(() => {
      store.dispatch(
        setEntityMap({
          entityMap: {
            ...ENTITY_MAP,
            ...Object.fromEntries([SELF, INACTIVE, PHANTOM, SIZED].map((e) => [e.id, e])),
          },
        })
      );
    });

    it("{baseItemId} / {refer_baseItem_id} references count; never the added item itself; no duplicates", () => {
      render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
      open({
        id: SELF.id,
        recommendedItems: [{ baseItemId: TACO.id }, { refer_baseItem_id: BURRITO.id }, SELF.id, TACO.id],
      });

      expect(ids()).toEqual([TACO.id, BURRITO.id]);
    });

    it("a row without recommendedItems falls back to the menu's list for that item", () => {
      store.dispatch(
        setEntityMap({ entityMap: { ...ENTITY_MAP, [SELF.id]: { ...SELF, recommendedItems: [QUESADILLA.id] } } })
      );
      render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
      open({ id: SELF.id });

      expect(ids()).toEqual([QUESADILLA.id]);
    });

    it("the LIVE out-of-stock map drops a suggestion — before the modal opens and while it is open", () => {
      store.dispatch(setOutOfStockItems({ [TWISTS.id]: { _id: TWISTS.id, inStock: false } }));
      render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
      open({ id: SELF.id, recommendedItems: [TACO.id, QUESADILLA.id, TWISTS.id] });
      expect(ids()).toEqual([TACO.id, QUESADILLA.id]);

      act(() => {
        store.dispatch(
          setOutOfStockItems({
            [TWISTS.id]: { _id: TWISTS.id, inStock: false },
            [QUESADILLA.id]: { _id: QUESADILLA.id, inStock: false },
          })
        );
      });
      expect(ids()).toEqual([TACO.id]);
    });

    it("an inactive entity and a size parent with no active size are never offered", () => {
      render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
      open({ id: SELF.id, recommendedItems: [INACTIVE.id, PHANTOM.id, TACO.id] });

      expect(ids()).toEqual([TACO.id]);
    });

    it("a size parent reads its lowest ACTIVE size price (the menu card's), never its raw price", () => {
      render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
      open({ id: SELF.id, recommendedItems: [SIZED.id] });

      const tile = screen.getByTestId(`added-rec-${SIZED.id}`);
      expect(within(tile).getByText(SIZED.name).nextElementSibling?.textContent).toBe("£5");
    });
  });

  it("nothing picked over a strip: Total = the bag's (the menu bar's), printed as posistKiosk does; the ONE CTA reads NO THANKS and just closes; no VIEW MY BAG", () => {
    store.dispatch(setCartItems(CART));
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id] });

    const total = screen.getByTestId("added-total");
    expect(total.textContent).toBe(`${i18n.t("menu.total")} £12`);
    expect(total).toHaveClass("text-[24px]", "leading-[24px]", "text-tb-ink-purple");
    expect(screen.queryByTestId("added-view-bag")).toBeNull();
    expect(screen.queryByText(i18n.t("menu.viewMyBag"))).toBeNull();

    const cta = screen.getByTestId("added-continue");
    expect(cta).toHaveTextContent("No thanks");
    expect(cta).toHaveClass("tb-display", "h-[60px]", "w-full", "rounded-[4px]", "bg-tb-purple", "text-tb-surface");
    fireEvent.click(cta);

    expect(isOpen()).toBe(false);
    expect(screen.queryByTestId("product-added-modal")).toBeNull();
    expect(cartItems()).toEqual(CART);
  });

  /*
    User decision 2026-10-14: the Total is the bag's own Total — after
    rewards, taxes and round off — with the picks in it (it was the pre-tax
    subtotal + the picks: ﷼65.00 over a ﷼34.13 bag). The bag's bill runs
    over the cart ADD TO ORDER would leave, so after ADD TO ORDER the bag
    shows the very figure the modal did. Nothing reaches the bag before.
  */
  it("Total = the bag's own Total with the picks in it — taxes and the reward included — and the bag ADD TO ORDER leaves totals the same", () => {
    store.dispatch(setDeploymentInfo([{ name: "disable_roundoff", selected: true }]));
    store.dispatch(setEntityMap({ entityMap: { ...ENTITY_MAP, [TACO.id]: { ...TACO, taxes: [VAT15] } } }));
    store.dispatch(setCartItems(TAXED_CART));
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id] });
    const total = () => screen.getByTestId("added-total").textContent;

    // £12 + VAT £1.80 — never the £12 subtotal.
    expect(total()).toBe(`${i18n.t("menu.total")} £13.80`);
    stage(TACO.id);
    // + £4 + VAT £0.60
    expect(total()).toBe(`${i18n.t("menu.total")} £18.40`);
    stage(BURRITO.id, 2);
    // + 2 × £5.59, untaxed
    expect(total()).toBe(`${i18n.t("menu.total")} £29.58`);
    // A parked size counts even without its tile: + £7 + VAT £1.05.
    park(LARGE_PARKED);
    expect(total()).toBe(`${i18n.t("menu.total")} £37.63`);
    expect(cartItems()).toEqual(TAXED_CART);

    // A reward on the bag reprices the preview too.
    act(() => {
      store.dispatch(applyOffer({ offer: FLAT_TWO }));
    });
    const previewed = total();
    expect(previewed).not.toBe(`${i18n.t("menu.total")} £37.63`);

    fireEvent.click(screen.getByTestId("added-continue"));
    expect(isOpen()).toBe(false);
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/cart"]}>
          <BagSheet open onClose={vi.fn()} />
        </MemoryRouter>
      </Provider>,
    );
    expect(`${i18n.t("menu.total")} ${screen.getByTestId("bag-total").textContent}`).toBe(previewed);
  });

  it("a whole Total prints whole and the bag's round off applies: £13.80 → £14", () => {
    store.dispatch(setCartItems(TAXED_CART));
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id] });

    expect(screen.getByTestId("added-total").textContent).toBe(`${i18n.t("menu.total")} £14`);
  });

  /*
    ADD TO ORDER is the ONE write: one per product carrying the whole
    quantity (the cart writers' DP check then sees the true total — a loop of
    +1s each checked the same stale cart), onto the row the menu "+" bumps
    (the first paid row of that id) or a new one; parked rows are replayed
    as built. Then it closes and the picks are gone.
  */
  it("ADD TO ORDER writes the picks — the menu '+'s row bumped by its units in one write, a new row with the whole quantity, the parked rows replayed — then closes with nothing left picked", () => {
    store.dispatch(
      setCartItems([{ id: TACO.id, itemId: "t-1", name: TACO.name, quantity: 1, type: "ITEM", price: 4, total_price: 4 }])
    );
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id] });
    stage(TACO.id, 2);
    stage(BURRITO.id, 3);
    park({
      id: QUESADILLA.id,
      itemId: "p-1",
      uniqueItemId: "p-1",
      name: QUESADILLA.name,
      type: "CUSTOMIZABLE",
      quantity: 1,
      price: 5.59,
      total_price: 6.59,
    });

    fireEvent.click(screen.getByTestId("added-continue"));

    expect(isOpen()).toBe(false);
    expect(screen.queryByTestId("product-added-modal")).toBeNull();
    const rows = cartItems();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: TACO.id, itemId: "t-1", quantity: 3 });
    expect(rows[1]).toMatchObject({ id: BURRITO.id, type: "ITEM", quantity: 3, total_price: 5.59 });
    expect(rows[2]).toMatchObject({ id: QUESADILLA.id, type: "CUSTOMIZABLE", quantity: 1, total_price: 6.59 });
    // 3 × 4 + 3 × 5.59 + 6.59
    expect(state().cart.subTotal).toBeCloseTo(35.36, 2);
    expect(staging()).toEqual({ pending: {}, pendingCustom: [] });
  });

  /*
    Two parked rows of ONE product (two sizes of it, say) replay in one
    handler: restamped, both would get the same "<ms>_<id>" itemId — one cart
    key for two rows, and the Dexie mirror (keyed by itemId) would drop the
    second. Each keeps the itemId it was parked with (separate chooser trips).
  */
  it("ADD TO ORDER replays two parked rows of one product with the itemIds they were parked with — never one restamped key for both", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
      open({ id: "added", recommendedItems: [BURRITO.id] });
      park({ id: BURRITO.id, itemId: "p-regular", uniqueItemId: "p-regular", type: "VARIANT", quantity: 1, total_price: 5 });
      park({ id: BURRITO.id, itemId: "p-large", uniqueItemId: "p-large", type: "VARIANT", quantity: 1, total_price: 7 });

      fireEvent.click(screen.getByTestId("added-continue"));

      expect(cartItems().map((row) => row.itemId)).toEqual(["p-regular", "p-large"]);
      expect(isOpen()).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  it("a refused write (the DP cap — its error is up) keeps the modal open with only the refused pick; what landed is no longer picked", () => {
    store.dispatch(setCurrentSession({ _id: "dp-lunch", sessionName: "Lunch", _extras: { maxQtyItem: "1" } }));
    store.dispatch(setEntityMap({ entityMap: { ...ENTITY_MAP, [TACO.id]: { ...TACO, isDpItem: true } } }));
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id] });
    stage(TACO.id, 2); // 2 DP units against a cap of 1
    stage(BURRITO.id);

    fireEvent.click(screen.getByTestId("added-continue"));

    expect(selectShowErrorModalGlobal(store.getState())).toBe(true);
    expect(isOpen()).toBe(true);
    expect(cartItems()).toEqual([expect.objectContaining({ id: BURRITO.id, quantity: 1 })]);
    expect(staging()).toEqual({ pending: { [TACO.id]: 2 }, pendingCustom: [] });
    expect(screen.getByTestId(`added-count-${TACO.id}`)).toHaveTextContent(/^2$/);
    expect(screen.queryByTestId(`added-count-${BURRITO.id}`)).toBeNull();
    // Something is still picked, so the CTA still offers to buy it.
    expect(screen.getByTestId("added-continue")).toHaveTextContent("Add to order");
  });

  it.each([
    ["the X", 1],
    ["the scrim", 0],
  ])("%s throws the picks away: closed, the bag unchanged, nothing left picked", (_what, index) => {
    store.dispatch(setCartItems(CART));
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id] });
    stage(TACO.id, 2);
    park({ id: BURRITO.id, itemId: "p-1", type: "CUSTOMIZABLE", quantity: 1, total_price: 6 });
    // DOM order: the scrim, then the card's X.
    const closers = screen.getAllByRole("button", { name: i18n.t("language.close") });
    expect(closers).toHaveLength(2);

    fireEvent.click(closers[index]);
    expect(isOpen()).toBe(false);
    expect(cartItems()).toEqual(CART);
    expect(staging()).toEqual({ pending: {}, pendingCustom: [] });
  });

  it("every open starts with nothing picked: a new add's modal never inherits the last one's picks", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id] });
    stage(TACO.id);
    park({ id: BURRITO.id, itemId: "p-1", type: "CUSTOMIZABLE", quantity: 1, total_price: 6 });

    open({ id: "added-again", recommendedItems: [TACO.id] });

    expect(staging()).toEqual({ pending: {}, pendingCustom: [] });
    expect(screen.queryByTestId(`added-count-${TACO.id}`)).toBeNull();
  });

  /*
    A choice suggestion's detour (Select a Size / the PDP) HIDES the modal —
    it stays open, so its picks survive — and every chooser exit clears the
    flag, which brings it back with the chooser's parked row counted.
  */
  it("hidden while a suggestion's chooser detour is up (still open, picks kept); back when it ends", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id] });
    stage(TACO.id);

    act(() => {
      store.dispatch(setRecommendationDetour(true));
    });
    expect(screen.queryByTestId("product-added-modal")).toBeNull();
    expect(isOpen()).toBe(true);

    park({ id: BURRITO.id, itemId: "p-1", type: "VARIANT", quantity: 1, total_price: 7 });
    act(() => {
      store.dispatch(setRecommendationDetour(false));
    });
    expect(screen.getByTestId("product-added-modal")).toBeInTheDocument();
    expect(screen.getByTestId(`added-count-${TACO.id}`)).toHaveTextContent(/^1$/);
    expect(screen.getByTestId(`added-count-${BURRITO.id}`)).toHaveTextContent(/^1$/);
    expect(cartItems()).toEqual([]);
  });

  it("suppressRecommendations (a suggestion-detour add) → no strip: the title, the Total and the CTA only — GOT IT, nothing to add", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id], suppressRecommendations: true });

    expect(tiles()).toHaveLength(0);
    expect(screen.queryByText(i18n.t("added.youMightLike"))).toBeNull();
    expect(screen.getByTestId("added-total")).toBeInTheDocument();
    expect(screen.getByTestId("added-continue")).toHaveTextContent("GOT IT");
  });

  it("no suggestion survives (all sold out) → no strip, and the CTA reads GOT IT", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [SOLD_OUT.id] });

    expect(tiles()).toHaveLength(0);
    expect(screen.queryByText(i18n.t("added.youMightLike"))).toBeNull();
    expect(screen.getByTestId("added-continue")).toHaveTextContent("GOT IT");
  });

  it("Arabic: the copy and the 'Cal' label are translated; the price keeps its £", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [BURRITO.id] });

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(i18n.t("added.title"));
    const tile = screen.getByTestId(`added-rec-${BURRITO.id}`);
    expect(tile).toHaveTextContent(`£5.59 | ${i18n.t("pack.cal", { value: 360 })}`, {
      normalizeWhitespace: false,
    });
    expect(tile).not.toHaveTextContent("Cal");
    // The CTA's words, in Arabic: posistKiosk's "No, Thanks" until a pick, then ADD TO ORDER.
    const cta = screen.getByTestId("added-continue");
    expect(cta).toHaveTextContent("لا، شكرًا");
    stage(BURRITO.id);
    expect(cta).toHaveTextContent("أضف إلى الطلب");
  });

  /*
    The ONE CTA says what its tap does (user report 2026-10-12: "why add to
    order button is coming when there is no item to add to order"). It buys
    exactly what ADD TO ORDER walks — a one-tap pick on a live tile, or any
    parked row — so that is when it reads ADD TO ORDER. With nothing to buy
    it only closes, in posistKiosk's words: "No, Thanks" over a strip, its
    "Okay" (TB's GOT IT, the app's acknowledgement) without one. Same filled
    button, same place: only the words change.
  */
  it("the CTA names its tap: NO THANKS over a strip with nothing picked, ADD TO ORDER once something is picked, back on the last '−'; a pick whose tile sold out is not bought — GOT IT; a parked row alone still reads ADD TO ORDER", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id] });
    const cta = () => screen.getByTestId("added-continue");
    expect(cta()).toHaveTextContent("No thanks");

    stage(TACO.id);
    expect(cta()).toHaveTextContent("Add to order");
    expect(cta()).toHaveClass("bg-tb-purple", "text-tb-surface");

    fireEvent.click(screen.getByTestId(`added-rec-remove-${TACO.id}`));
    expect(cta()).toHaveTextContent("No thanks");

    // Picked, then sold out: no tile, so ADD TO ORDER would buy nothing.
    stage(TACO.id);
    act(() => {
      store.dispatch(setOutOfStockItems({ [TACO.id]: { _id: TACO.id, inStock: false } }));
    });
    expect(tiles()).toHaveLength(0);
    expect(cta()).toHaveTextContent("GOT IT");

    // A parked row is bought even without its tile.
    park({ id: "r-elsewhere", itemId: "p-1", type: "VARIANT", quantity: 1, total_price: 7 });
    expect(cta()).toHaveTextContent("Add to order");
  });
});
