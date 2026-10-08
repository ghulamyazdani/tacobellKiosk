/* eslint-disable @typescript-eslint/no-explicit-any --
 * Menu entities flow through untyped from the legacy converters, matching
 * the component under test. Do not add NEW anys.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import { mutateAddToCartModal } from "../../../redux/features/menuSelections/menuSelections.slice";
import ProductAddedModal from "../ProductAddedModal";
import i18n from "../../../i18n";

/*
  audit-fixes B4 (F09, closes X04) — "YOUR PRODUCT HAS BEEN ADDED" per Figma
  1:4571 / modal 1:4589: a 680 card on a tb-purple/80 scrim, up to three
  You-Might-Like tiles (2-line names, "£x | N Cal" with the calories only
  when > 0, a 36 px quick add on a 44 px hit area), the Total (the menu
  bar's live subTotal) and ONE CTA — ADD TO ORDER closes it. The frame has
  no VIEW MY BAG: the menu's CTA bar keeps that edge (and its upsell gate).
*/

const TACO = { id: "r-taco", name: "Crunchy Taco", price: 4, calorieCount: 0 };
const BURRITO = { id: "r-burrito", name: "Crispy Chicken Burrito", price: 5.59, calorieCount: 360 };
const SOLD_OUT = { id: "r-oos", name: "Nachos", price: 3, outOfStock: true };
const QUESADILLA = { id: "r-quesadilla", name: "Quesadilla", price: 5.59 };
const TWISTS = { id: "r-twists", name: "Cinnamon Twists", price: 2 };
const ENTITY_MAP = Object.fromEntries(
  [TACO, BURRITO, SOLD_OUT, QUESADILLA, TWISTS].map((e) => [e.id, e])
);
/** Two rows, £7.00 + 2 × £2.50 = £12.00 — the CTA bar's subTotal. */
const CART = [
  { id: "c-1", itemId: "i-1", name: "Taco", quantity: 1, type: "ITEM", price: 7, total_price: 7 },
  { id: "c-2", itemId: "i-2", name: "Fries", quantity: 2, type: "ITEM", price: 2.5, total_price: 2.5 },
];

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
const tiles = () => screen.queryAllByTestId(/^added-rec-(?!add-)/);

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

  it("the frame's shell: tb-purple/80 scrim, a 680 card (tb-modal-enter centred), the H5 title, a 48 px close at 25/25", () => {
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
    expect(card).toHaveClass(
      "tb-modal-enter",
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
    expect(plus).toHaveAccessibleName(i18n.t("menu.quickAdd"));
    expect(plus).toHaveClass("absolute", "right-[7px]", "top-[5px]", "h-[44px]", "w-[44px]");
    expect(plus.firstElementChild).toHaveClass("h-[36px]", "w-[36px]", "rounded-full");
    fireEvent.click(plus);

    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onQuickAdd).toHaveBeenCalledWith(BURRITO);
    expect(isOpen()).toBe(true);
  });

  it("Total = the menu bar's subTotal; ONE CTA — ADD TO ORDER closes; no VIEW MY BAG", () => {
    store.dispatch(setCartItems(CART));
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id] });

    const total = screen.getByTestId("added-total");
    expect(total).toHaveTextContent(`${i18n.t("menu.total")} £12.00`);
    expect(total).toHaveClass("text-[24px]", "leading-[24px]", "text-tb-ink-purple");
    expect(screen.queryByTestId("added-view-bag")).toBeNull();
    expect(screen.queryByText(i18n.t("menu.viewMyBag"))).toBeNull();

    const cta = screen.getByTestId("added-continue");
    expect(cta).toHaveTextContent(i18n.t("added.addToOrder"));
    expect(cta).toHaveClass("tb-display", "h-[60px]", "w-full", "rounded-[4px]", "bg-tb-purple", "text-tb-surface");
    fireEvent.click(cta);

    expect(isOpen()).toBe(false);
    expect(screen.queryByTestId("product-added-modal")).toBeNull();
  });

  it.each([
    ["the X", 1],
    ["the scrim", 0],
  ])("%s closes it too", (_what, index) => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id] });
    // DOM order: the scrim, then the card's X.
    const closers = screen.getAllByRole("button", { name: i18n.t("language.close") });
    expect(closers).toHaveLength(2);

    fireEvent.click(closers[index]);
    expect(isOpen()).toBe(false);
  });

  it("suppressRecommendations (a suggestion-detour add) → no strip: the title, the Total and the CTA only", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [TACO.id, BURRITO.id], suppressRecommendations: true });

    expect(tiles()).toHaveLength(0);
    expect(screen.queryByText(i18n.t("added.youMightLike"))).toBeNull();
    expect(screen.getByTestId("added-total")).toBeInTheDocument();
    expect(screen.getByTestId("added-continue")).toBeInTheDocument();
  });

  it("no suggestion survives (all sold out) → no strip", () => {
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [SOLD_OUT.id] });

    expect(tiles()).toHaveLength(0);
    expect(screen.queryByText(i18n.t("added.youMightLike"))).toBeNull();
  });

  it("Arabic: the copy and the 'Cal' label are translated; the price keeps its £", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    render(<ProductAddedModal onQuickAdd={vi.fn()} />, { wrapper });
    open({ id: "added", recommendedItems: [BURRITO.id] });

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(i18n.t("added.title"));
    expect(screen.getByTestId("added-continue")).toHaveTextContent(i18n.t("added.addToOrder"));
    const tile = screen.getByTestId(`added-rec-${BURRITO.id}`);
    expect(tile).toHaveTextContent(`£5.59 | ${i18n.t("pack.cal", { value: 360 })}`, {
      normalizeWhitespace: false,
    });
    expect(tile).not.toHaveTextContent("Cal");
  });
});
