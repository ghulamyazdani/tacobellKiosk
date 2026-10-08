import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency, setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setReccomendationCategoryMap } from "@cx-sdk/catalog/state/recommendation.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import YouMightLikeRail from "../YouMightLikeRail";
import i18n from "../../../i18n";

/*
  Lane figma-polish R1 — the PDP "You Might Like" rail (Figma ProductSuggestion
  1:1825 in 1:2657 / 1:5867): the tenant suggestions for THIS item, one-tap
  adds only (intent "add" — any other intent would open a second tier-1
  session over the open PDP), on the bag rail's ForYouCard in its photo-top
  layout. Null when nothing qualifies. A tap is addEntity(entity,
  {suppressAddedModal: true}): one unit, no modal, no navigation — the count
  pill is the confirmation. Names resolve at render, never into state.
  Seams: navigation, the Dexie cart mirror, and addEntity (a pass-through spy).
*/

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), addEntity: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../../hooks/cartHooks/useCartIndexedDb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/cartHooks/useCartIndexedDb")>();
  return {
    ...actual,
    default: () => ({
      ...actual.default(),
      addToIndexedDbCart: () => Promise.resolve(),
      updateItemIndexedDbCart: () => Promise.resolve(),
      increaseItemQuantityByIdIndexedDb: () => Promise.resolve(),
    }),
  };
});

vi.mock("../../../hooks/menuHooks/useAddEntityToCart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/menuHooks/useAddEntityToCart")>();
  return {
    ...actual,
    default: () => {
      const hook = actual.default();
      return {
        ...hook,
        addEntity: (...args: Parameters<typeof hook.addEntity>) => {
          mocks.addEntity(...args);
          return hook.addEntity(...args);
        },
      };
    },
  };
});

const AR = (value: string) => [{ value, name: "Arabic", code: "ar", dir: "rtl" }];
const AR_FRIES = "بطاطس كبيرة";

const ENTITY_MAP = {
  burger: { id: "burger", name: "Cheese Burger", price: 8, isActive: true },
  fries: { id: "fries", name: "Large Fries", aliases: AR(AR_FRIES), price: 2, calorieCount: 360, isActive: true },
  pepsi: { id: "pepsi", name: "Pepsi", price: 3, isActive: true },
  /** Has modifier groups → intent "modifiers": never on the PDP rail. */
  wrap: { id: "wrap", name: "Wrap", price: 6, isActive: true, modifiers: ["wrap_addons"] },
};
const MAP = {
  burger: {
    baseItem_id: "burger",
    refers: [
      { refer_baseItem_id: "fries", occurrences: 1 },
      { refer_baseItem_id: "pepsi", occurrences: 9 },
      { refer_baseItem_id: "wrap", occurrences: 5 },
    ],
  },
  /** Only a customizable suggestion. */
  taco: { baseItem_id: "taco", refers: [{ refer_baseItem_id: "wrap", occurrences: 4 }] },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={["/customization"]}>{children}</MemoryRouter>
  </Provider>
);
const renderRail = (entityId?: string) => render(<YouMightLikeRail entityId={entityId} />, { wrapper });
const cartRows = () =>
  (store.getState() as unknown as { cart: { cartItems: Array<{ id: string; name: string; quantity: number }> } }).cart
    .cartItems;
/** The in-cart count pill (top-left on the photo-top card), or null. */
const pill = (testId: string) => screen.getByTestId(testId).querySelector("span.bg-tb-purple");
const railIds = () =>
  [...screen.getByTestId("pdp-rail").querySelectorAll("[data-testid^='pdp-rail-item-']")].map((card) =>
    card.getAttribute("data-testid")
  );

describe("YouMightLikeRail (R1 — PDP 'You Might Like')", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setEntityMap({ entityMap: ENTITY_MAP }));
    store.dispatch(setReccomendationCategoryMap(MAP));
    mocks.navigate.mockReset();
    mocks.addEntity.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it.each([
    ["no entity id", undefined],
    ["an item without a map entry", "fries"],
    ["an item whose only suggestion is customizable (intent 'modifiers')", "taco"],
  ])("renders null for %s", (_label, entityId) => {
    const { container } = renderRail(entityId);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders null when enable_cart_upsell_screen is false (D7)", () => {
    store.dispatch(setKioskSettings({ enable_cart_upsell_screen: false }));
    const { container } = renderRail("burger");

    expect(container).toBeEmptyDOMElement();
  });

  it("only one-tap ('add') suggestions, ranked; the 'You Might Like' label; cards named 'Quick add <name>'", () => {
    renderRail("burger");
    const rail = screen.getByTestId("pdp-rail");

    expect(railIds()).toEqual(["pdp-rail-item-pepsi", "pdp-rail-item-fries"]);
    expect(screen.queryByTestId("pdp-rail-item-wrap")).not.toBeInTheDocument();
    expect(rail).toHaveClass("mt-[64px]", "w-full");
    expect(within(rail).getByText(i18n.t("added.youMightLike"))).toBeInTheDocument();
    expect(screen.getByTestId("pdp-rail-item-fries")).toHaveAccessibleName(`${i18n.t("menu.quickAdd")} Large Fries`);
  });

  it("the ProductSuggestion card (1:1829): the photo-top ForYouCard, prices in the PDP's money format", () => {
    renderRail("burger");
    const card = screen.getByTestId("pdp-rail-item-fries");

    expect(card).toHaveTextContent("£2.00 | 360 Cal");
    expect(screen.getByTestId("pdp-rail-item-pepsi")).toHaveTextContent("£3.00");
    // Photo first (192 × 85, 76 px down), then the 72 px name / price block.
    expect(card.firstElementChild).toHaveClass("mt-[76px]", "h-[85px]", "w-[192px]");
    expect(card.children[1]).toHaveClass("h-[72px]", "mb-[24px]");
  });

  it("a tap is addEntity(entity, {suppressAddedModal: true}): one unit, then +1 — no modal, no navigation, the count pill updates", () => {
    renderRail("burger");

    fireEvent.click(screen.getByTestId("pdp-rail-item-fries"));
    expect(mocks.addEntity).toHaveBeenCalledTimes(1);
    expect(mocks.addEntity).toHaveBeenCalledWith(expect.objectContaining({ id: "fries" }), { suppressAddedModal: true });
    expect(cartRows().map((row) => [row.id, row.quantity])).toEqual([["fries", 1]]);
    expect(pill("pdp-rail-item-fries")).toHaveTextContent(/^1$/);
    expect(pill("pdp-rail-item-fries")).toHaveClass("top-[12px]", "left-[12px]");

    fireEvent.click(screen.getByTestId("pdp-rail-item-fries"));
    expect(cartRows().map((row) => [row.id, row.quantity])).toEqual([["fries", 2]]);
    expect(pill("pdp-rail-item-fries")).toHaveTextContent(/^2$/);

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect((store.getState() as unknown as { menuSelections: { addToCartModal?: { isOpen?: boolean } } }).menuSelections.addToCartModal?.isOpen).toBeFalsy();
  });

  it("a suggestion already in the bag stays on the rail with its count", () => {
    store.dispatch(setCartItems([{ id: "pepsi", itemId: "p-1", name: "Pepsi", quantity: 3, type: "ITEM", price: 3, total_price: 9 }]));
    renderRail("burger");

    expect(pill("pdp-rail-item-pepsi")).toHaveTextContent(/^3$/);
    expect(pill("pdp-rail-item-fries")).toBeNull();
  });

  it("Arabic: the card shows the alias (isolated) — the add hands over the RAW entity and the row keeps the English name", async () => {
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderRail("burger");
    const card = screen.getByTestId("pdp-rail-item-fries");

    expect(card).toHaveTextContent(AR_FRIES);
    expect(card).not.toHaveTextContent("Large Fries");

    fireEvent.click(card);
    expect(mocks.addEntity.mock.calls[0][0]).toMatchObject({ id: "fries", name: "Large Fries" });
    expect(cartRows()[0].name).toBe("Large Fries");
    expect(JSON.stringify(store.getState())).not.toContain(`⁨${AR_FRIES}⁩`);
  });
});
