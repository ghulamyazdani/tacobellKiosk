import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  emptyMenuData,
  setEntityMap,
  setMenuData,
  setModifiersMap,
  setTags,
} from "@cx-sdk/catalog/state/Menu.slice";
import {
  repeatItemBottomSheetData,
  setCartItems,
} from "@cx-sdk/ordering/state/cart.slice";
import { openLoyaltyItemsModal } from "@cx-sdk/ordering/state/loyalty.slice";
import { tier1CustomizationSelectedEntity } from "@cx-sdk/ordering/state/makeItAMeal.slice";
import {
  selectShowErrorModalGlobal,
  setCurrency,
  setEnableAccessibilityMode,
  setHideFilter,
  setKioskSettings,
  setShowRepeatCustomization,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setFilters } from "@cx-sdk/catalog/state/filter.slice";
import { setCurrentSession } from "@cx-sdk/catalog/state/dynamicPricing.slice";
import {
  setSelectedPipeline,
  setTabType,
} from "@cx-sdk/catalog/state/pipeline.slice";
import { setSelectedTabId } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import {
  mutateAddToCartModal,
  setOutOfStockItems,
  setRecommendationDetour,
} from "../../../redux/features/menuSelections/menuSelections.slice";
import { notePath } from "../../../hooks/utils/usePageEnter";
import Menu from "../index";
import i18n from "../../../i18n";

const { mockFetchMenu, mockNavigate, mockCapture } = vi.hoisted(() => ({
  mockFetchMenu: vi.fn(),
  mockNavigate: vi.fn(),
  mockCapture: vi.fn(),
}));

// The REAL hook (BagSheet and the loyalty sheet use the rest of it) with
// fetchMenu — the network seam — answered per test. Pending by default.
vi.mock("../../../hooks/menuHooks/useMenuConverters", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../hooks/menuHooks/useMenuConverters")
  >();
  return {
    default: () => ({
      ...actual.default(),
      fetchMenu: (...args: unknown[]) => mockFetchMenu(...args),
    }),
  };
});

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

// Analytics are asserted per event (never by the total call count).
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

/** Converted-shape fixture (mirrors legacyMenuConverters output fields the UI reads). */
const CONVERTED_MENU = {
  categories: [
    {
      id: "c1",
      name: "Side Orders",
      subCategories: [
        {
          id: "s1",
          name: "Sides",
          entities: [
            {
              id: "e-new",
              name: "Beefy Fries Box",
              price: 5.99,
              calorieCount: 740,
              image_url: "",
              badges: [{ name: "new" }],
              outOfStock: false,
            },
            {
              id: "e-oos",
              name: "Cheese Burger",
              price: 3.5,
              outOfStock: true,
            },
            {
              id: "e-plain",
              name: "Large Fries",
              price: 2.5,
              calorieCount: 360,
              outOfStock: false,
            },
          ],
        },
      ],
    },
    { id: "c2", name: "Drinks", subCategories: [] },
  ],
};

const renderMenu = (options: { reactStrictMode?: boolean; bagOpen?: boolean } = {}) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[options.bagOpen ? "/cart" : "/menu"]}>
        <Menu bagOpen={options.bagOpen} />
      </MemoryRouter>
    </Provider>,
    { reactStrictMode: options.reactStrictMode }
  );

describe("Menu (Figma 1:2595 — rail + grid + CTA)", () => {
  beforeEach(() => {
    mockFetchMenu.mockReset();
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    store.dispatch({ type: "RESET_STATE" });
    // setMenuData expects { menu } (SDK reducer destructures the payload)
    store.dispatch(setMenuData({ menu: CONVERTED_MENU }));
  });

  it("renders the category rail from the converted menu", () => {
    renderMenu();
    expect(screen.getByTestId("rail-c1")).toHaveTextContent("Side Orders");
    expect(screen.getByTestId("rail-c2")).toHaveTextContent("Drinks");
  });

  it("renders item cards with price + calories; a NEW/badged item is a regular grid card (the hero is retired, user 2026-10-13)", () => {
    renderMenu();
    const hero = screen.getByTestId("item-e-new");
    expect(hero).toHaveTextContent("Beefy Fries Box");
    expect(hero).toHaveTextContent("5.99");
    expect(hero).toHaveTextContent("740 Cal");
    expect(hero.className).not.toContain("col-span-2"); // no hero treatment
    expect(hero.className).not.toContain("rounded-t-[500px]");
  });

  it("out-of-stock items show UNAVAILABLE and lose the quick-add", () => {
    renderMenu();
    const oos = screen.getByTestId("item-e-oos");
    expect(oos).toHaveTextContent(/unavailable/i);
    expect(screen.queryByTestId("quick-add-e-oos")).not.toBeInTheDocument();
    expect(screen.getByTestId("quick-add-e-plain")).toBeInTheDocument();
  });

  it("CTA bar shows the (empty) cart total and count", () => {
    renderMenu();
    // posistKiosk's MenuFooter format (moduloCalcaledValue): a whole 0.
    expect(screen.getByTestId("cta-total")).toHaveTextContent(/Total: ₹0$/);
    expect(screen.getByTestId("cta-view-bag")).toHaveTextContent("(0)");
  });

  it("empty menu shows the loading state (while it refetches) instead of a blank pane", () => {
    store.dispatch({ type: "RESET_STATE" });
    renderMenu();
    expect(screen.getByText(/menu is loading/i)).toBeInTheDocument();
  });

  // The /forYou drop (user, 2026-10-11) — THE guard: /forYou now redirects to
  // /cart, so a URL-only e2e cannot see VIEW MY BAG regress to it. A flagged
  // item is what used to open that screen (MIN_CART_UPSELL_ITEMS is 1).
  it("VIEW MY BAG goes to /cart, never /forYou, even with a cart-recommended item; an empty bag stays put", () => {
    mockNavigate.mockReset();
    mockCapture.mockClear();
    store.dispatch(
      setEntityMap({
        entityMap: {
          "e-plain": { id: "e-plain", name: "Large Fries", price: 2.5, isActive: true, isCartRecommended: true },
        },
      })
    );
    renderMenu();

    fireEvent.click(screen.getByTestId("cta-view-bag"));
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => {
      store.dispatch(
        setCartItems([
          { id: "e-plain", itemId: "lf-1", name: "Large Fries", quantity: 1, type: "ITEM", price: 2.5, total_price: 2.5 },
        ])
      );
    });
    fireEvent.click(screen.getByTestId("cta-view-bag"));
    expect(mockNavigate).toHaveBeenLastCalledWith("/cart");
    expect(mockNavigate.mock.calls.map(([to]) => to)).not.toContain("/forYou");
    // The dropped screen's analytics stop with it: no cart_upsell_* event.
    const upsellEvents = mockCapture.mock.calls.filter(([event]) => String(event).startsWith("cart_upsell_"));
    expect(upsellEvents).toEqual([]);
  });
});

/*
  P9b R8 — the menu is neverPersist, so a reload mid-session (chunk
  recovery, crash, power blip) lands on /menu with the cart rehydrated and NO
  menu. The screen refetches once per mount (fork parity, Menu.tsx:218) and
  judges what the fetch RETURNED (it resolves {} on any failure).
*/
describe("Menu — refetch on a menu-less mount (P9b R8)", () => {
  const PIPELINE = {
    _id: "p-take",
    tab_id: "t2",
    tab_type: "take_away",
    primary_name: "Take Out",
  };
  const CART_ROW = {
    id: "e-plain",
    itemId: "lf-1",
    name: "Large Fries",
    quantity: 1,
    type: "ITEM",
    price: 2.5,
    total_price: 2.5,
  };

  /** What survives a reload: pipeline + tab + cart, but no menu. */
  const seedReloadedSession = () => {
    store.dispatch(setSelectedPipeline(PIPELINE));
    store.dispatch(setSelectedTabId("t2"));
    store.dispatch(setTabType("take_away"));
    store.dispatch(setCartItems([CART_ROW]));
  };

  /** The real fetchMenu's success: it writes the menu, then returns it. */
  const loadsTheMenu = () =>
    Promise.resolve().then(() => {
      store.dispatch(setMenuData({ menu: CONVERTED_MENU }));
      return CONVERTED_MENU;
    });

  const cartRows = () =>
    (store.getState() as { cart: { cartItems: unknown[] } }).cart.cartItems;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    mockFetchMenu.mockReset();
    mockNavigate.mockReset();
    seedReloadedSession();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("refetches the persisted pipeline's menu ONCE on mount (StrictMode re-runs mount effects)", () => {
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    renderMenu({ reactStrictMode: true });

    expect(mockFetchMenu).toHaveBeenCalledTimes(1);
    expect(mockFetchMenu).toHaveBeenCalledWith(
      "t2",
      false,
      false,
      expect.objectContaining({ _id: "p-take", tab_type: "take_away" })
    );
    // While it runs, the honest "loading" copy — no dialog yet.
    expect(screen.getByText(i18n.t("menu.empty"))).toBeInTheDocument();
    expect(screen.queryByTestId("menu-error")).not.toBeInTheDocument();
  });

  it("a successful refetch puts the menu back", async () => {
    mockFetchMenu.mockImplementation(loadsTheMenu);
    renderMenu();
    await act(async () => {});

    expect(screen.getByTestId("rail-c1")).toHaveTextContent("Side Orders");
    expect(screen.queryByTestId("menu-error")).not.toBeInTheDocument();
  });

  it("a failed refetch ({}) shows the menu-error dialog with TRY AGAIN / START OVER", async () => {
    mockFetchMenu.mockResolvedValue({});
    renderMenu();
    await act(async () => {});

    const dialog = screen.getByTestId("menu-error");
    expect(dialog).toHaveAccessibleName(i18n.t("menuError.title"));
    expect(dialog).toHaveAccessibleDescription(i18n.t("menuError.message"));
    expect(screen.getByTestId("menu-error-retry")).toHaveTextContent(
      i18n.t("menuError.retry")
    );
    expect(screen.getByTestId("menu-error-start-over")).toHaveTextContent(
      i18n.t("menuError.startOver")
    );
  });

  it("TRY AGAIN refetches with the same arguments and recovers the menu", async () => {
    mockFetchMenu.mockResolvedValueOnce({});
    renderMenu();
    await act(async () => {});

    mockFetchMenu.mockImplementationOnce(loadsTheMenu);
    await act(async () => {
      fireEvent.click(screen.getByTestId("menu-error-retry"));
    });

    expect(mockFetchMenu).toHaveBeenCalledTimes(2);
    expect(mockFetchMenu.mock.calls[1]).toEqual(mockFetchMenu.mock.calls[0]);
    expect(screen.queryByTestId("menu-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("rail-c1")).toBeInTheDocument();
  });

  it("TRY AGAIN hides the dialog while it runs and brings it back if it fails again", async () => {
    mockFetchMenu.mockResolvedValueOnce({});
    renderMenu();
    await act(async () => {});

    let answer!: (menu: unknown) => void;
    mockFetchMenu.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    act(() => {
      fireEvent.click(screen.getByTestId("menu-error-retry"));
    });
    expect(screen.queryByTestId("menu-error")).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t("menu.empty"))).toBeInTheDocument();

    await act(async () => {
      answer({});
    });
    expect(screen.getByTestId("menu-error")).toBeInTheDocument();
  });

  it("START OVER only navigates to /start — /start's mount owns the reset (hazard H1)", async () => {
    mockFetchMenu.mockResolvedValue({});
    renderMenu();
    await act(async () => {});

    fireEvent.click(screen.getByTestId("menu-error-start-over"));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/start");
    // Nothing reset here: the emptied store would render on THIS route first.
    expect(cartRows()).toHaveLength(1);
  });

  it("a menu already in the store is not refetched", () => {
    store.dispatch(setMenuData({ menu: CONVERTED_MENU }));
    renderMenu();

    expect(mockFetchMenu).not.toHaveBeenCalled();
  });

  it("a menu emptied AFTER mount (the cancel-order reset on this screen) triggers no refetch", () => {
    store.dispatch(setMenuData({ menu: CONVERTED_MENU }));
    renderMenu();

    act(() => {
      store.dispatch(emptyMenuData());
    });

    expect(mockFetchMenu).not.toHaveBeenCalled();
    expect(screen.queryByTestId("menu-error")).not.toBeInTheDocument();
  });

  it("speaks the guest's language (AR)", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    mockFetchMenu.mockResolvedValue({});
    renderMenu();
    await act(async () => {});

    expect(screen.getByTestId("menu-error")).toHaveAccessibleName(
      i18n.t("menuError.title")
    );
    expect(screen.getByTestId("menu-error-start-over")).toHaveTextContent(
      i18n.t("menuError.startOver")
    );
  });
});

/*
  Post-P9 26 — the Figma 1:5263 scroll indicator: a direct child of the page
  root (the containing block), 505/790 normally and 170/578 in the ADA reach
  zone (1:5412), on the SAME node; the pane hides its native bar.
*/
describe("Menu — scroll indicator (post-P9 26)", () => {
  beforeEach(() => {
    mockFetchMenu.mockReset();
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setMenuData({ menu: CONVERTED_MENU }));
  });

  it("menu-scrollbar sits at top 505 / height 790, a direct child of the page root", () => {
    renderMenu();
    const bar = screen.getByTestId("menu-scrollbar");

    expect(bar.style.top).toBe("505px");
    expect(bar.style.height).toBe("790px");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar).toHaveClass("pointer-events-none");
    expect(bar.parentElement).toBe(screen.getByTestId("menu-screen"));
    expect(screen.getByTestId("menu-scrollbar-thumb")).toBeInTheDocument();
  });

  it("ADA on: 170 / 578 on the same node (no remount)", () => {
    renderMenu();
    const bar = screen.getByTestId("menu-scrollbar");

    act(() => {
      store.dispatch(setEnableAccessibilityMode(true));
      store.dispatch(toggleAccessibilityMode());
    });

    expect(screen.getByTestId("menu-scrollbar")).toBe(bar);
    expect(bar.style.top).toBe("170px");
    expect(bar.style.height).toBe("578px");
  });

  it("the item pane hides its native scrollbar ([scrollbar-width:none] + ::-webkit-scrollbar)", () => {
    renderMenu();
    const pane = screen.getByTestId("item-e-plain").closest(".overflow-y-auto");

    expect(pane).not.toBeNull();
    expect(pane).toHaveClass("[scrollbar-width:none]", "[&::-webkit-scrollbar]:hidden");
  });
});

/*
  Post-P9 28 — names are resolved at render from the menu's ar aliases in an
  Arabic session (FSI…PDI isolated), English otherwise. Accessible names keep
  the visible label (WCAG 2.5.3 label-in-name).
*/
describe("Menu — names in the guest's language (post-P9 28)", () => {
  const FSI = "\u2068";
  const PDI = "\u2069";
  const iso = (s: string) => `${FSI}${s}${PDI}`;
  const ISOLATES = /[\u2066-\u2069]/;
  const AR = (value: string) => [{ value, name: "Arabic", code: "ar", dir: "rtl" }];
  const AR_CATEGORY = "الطلبات الجانبية";
  const AR_SUB = "جوانب";
  const AR_FRIES = "بطاطس كبيرة";
  const AR_SALAD = "سلطة يونانية";
  const AR_SESSION = { name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" };
  const EN_SESSION = { name: "English", code: "en", dir: "ltr", type: "primary_language" };

  const SALAD = { id: "e-salad", name: "Greek Salad", price: 4, aliases: AR(AR_SALAD) };
  const MENU = {
    categories: [
      {
        id: "c1",
        name: "Side Orders",
        aliases: AR(AR_CATEGORY),
        subCategories: [
          {
            id: "s1",
            name: "Sides",
            aliases: AR(AR_SUB),
            entities: [{ id: "e-fries", name: "Large Fries", price: 2.5, aliases: AR(AR_FRIES), outOfStock: false }],
          },
          {
            id: "s2",
            name: "Salads",
            entities: [{ ...SALAD, outOfStock: false }],
          },
        ],
      },
    ],
  };

  const arabicSession = async () => {
    store.dispatch(setSelectedLanguage(AR_SESSION));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
  };
  /** The item pane (the product-added modal carries an h2 of its own). */
  const pane = () => screen.getByTestId("item-e-fries").closest(".overflow-y-auto") as HTMLElement;
  const h2 = () => within(pane()).getByRole("heading", { level: 2 }).textContent;
  const h3s = () => within(pane()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

  beforeEach(() => {
    mockFetchMenu.mockReset();
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setMenuData({ menu: MENU }));
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("English: rail, H2, H3 and cards are the plain names — no isolate anywhere", () => {
    renderMenu();

    expect(screen.getByTestId("rail-c1").textContent).toBe("Side Orders");
    expect(h2()).toBe("Side Orders");
    expect(h3s()).toEqual(["Sides", "Salads"]);
    expect(screen.getByRole("button", { name: "Large Fries" })).toBeInTheDocument();
    expect(screen.getByTestId("menu-screen").textContent).not.toMatch(ISOLATES);
  });

  it("the H2 and H3 break a word wider than the pane inside it (rail-wrap; railLongNames.spec measures it)", () => {
    renderMenu();

    const headings = within(pane()).getAllByRole("heading");
    expect(headings.map((h) => h.tagName)).toEqual(["H2", "H3", "H3"]);
    for (const h of headings) expect(h).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("Arabic: the rail, the H2 and the H3 show the aliases, isolated; no alias → the English name", async () => {
    await arabicSession();
    renderMenu();

    expect(screen.getByTestId("rail-c1").textContent).toBe(iso(AR_CATEGORY));
    expect(h2()).toBe(iso(AR_CATEGORY));
    expect(h3s()).toEqual([iso(AR_SUB), iso("Salads")]);
  });

  it("Arabic: a card shows its alias and its overlay is named by it (label-in-name); quick-add is the AR verb", async () => {
    await arabicSession();
    renderMenu();
    const card = screen.getByTestId("item-e-fries");

    expect(card).toHaveTextContent(iso(AR_FRIES), { normalizeWhitespace: false });
    expect(card).not.toHaveTextContent("Large Fries");
    const overlay = screen.getByRole("button", { name: iso(AR_FRIES) });
    expect(card).toContainElement(overlay);
    expect(screen.getByTestId("quick-add-e-fries")).toHaveAccessibleName(i18n.t("menu.quickAdd"));
  });

  it("Arabic: the product-added modal's You-Might-Like tile shows the alias", async () => {
    store.dispatch(setEntityMap({ entityMap: { [SALAD.id]: SALAD } }));
    await arabicSession();
    renderMenu();

    act(() => {
      store.dispatch(
        mutateAddToCartModal({ isOpen: true, item: { id: "e-fries", recommendedItems: [SALAD.id] } })
      );
    });

    const tile = screen.getByTestId(`added-rec-${SALAD.id}`);
    expect(tile).toHaveTextContent(iso(AR_SALAD), { normalizeWhitespace: false });
    expect(tile).not.toHaveTextContent("Greek Salad");
  });

  it("switching back to English restores every name, unisolated", async () => {
    store.dispatch(setEntityMap({ entityMap: { [SALAD.id]: SALAD } }));
    await arabicSession();
    renderMenu();
    act(() => {
      store.dispatch(
        mutateAddToCartModal({ isOpen: true, item: { id: "e-fries", recommendedItems: [SALAD.id] } })
      );
    });
    expect(screen.getByTestId("rail-c1").textContent).toBe(iso(AR_CATEGORY));

    act(() => {
      store.dispatch(setSelectedLanguage(EN_SESSION));
    });

    expect(screen.getByTestId("rail-c1").textContent).toBe("Side Orders");
    expect(h2()).toBe("Side Orders");
    expect(h3s()).toEqual(["Sides", "Salads"]);
    expect(screen.getByRole("button", { name: "Large Fries" })).toBeInTheDocument();
    expect(screen.getByTestId(`added-rec-${SALAD.id}`)).toHaveTextContent("Greek Salad");
    expect(screen.getByTestId("menu-screen").textContent).not.toMatch(
      new RegExp(`${AR_FRIES}|${AR_CATEGORY}|${AR_SUB}|${AR_SALAD}`)
    );
  });
});

/*
  audit-fixes U1 (PAR-05) — the VEG / NON-VEG chips sit in the rail under
  the bell; their selection (state.filter.filters) narrows the rail AND the
  sections through the SDK's convertCategoryData. Emptiness (the P9b
  refetch, the menu-error dialog) stays a property of the UNFILTERED menu.
*/
describe("Menu — the diet filter and the card marks (U1)", () => {
  const TAGGED_MENU = {
    categories: [
      {
        id: "c-mains",
        name: "Mains",
        subCategories: [
          {
            id: "s-tacos",
            name: "Tacos",
            entities: [
              { id: "e-bean", name: "Bean Taco", price: 3, tags: ["veg"], outOfStock: false },
              { id: "e-chicken", name: "Chicken Taco", price: 4, tags: ["non-veg"], outOfStock: false },
            ],
          },
          {
            id: "s-bowls",
            name: "Bowls",
            entities: [{ id: "e-veg-bowl", name: "Veggie Bowl", price: 6, tags: ["veg"], outOfStock: false }],
          },
        ],
      },
      {
        id: "c-drinks",
        name: "Drinks",
        subCategories: [
          {
            id: "s-drinks",
            name: "Drinks",
            entities: [{ id: "e-cola", name: "Cola", price: 2, tags: ["veg"], outOfStock: false }],
          },
        ],
      },
      {
        id: "c-meat",
        name: "Meat Lovers",
        subCategories: [
          {
            id: "s-meat",
            name: "Meat",
            entities: [{ id: "e-steak", name: "Steak Bowl", price: 9, tags: ["non-veg"], outOfStock: false }],
          },
        ],
      },
    ],
  };

  const railIds = () =>
    Array.from(screen.getByTestId("category-rail").querySelectorAll('[data-testid^="rail-"]')).map(
      (row) => row.getAttribute("data-testid")
    );
  const itemIds = () =>
    screen.queryAllByTestId(/^item-/).map((card) => card.getAttribute("data-testid"));
  const sectionIds = () =>
    screen.queryAllByTestId(/^section-/).map((section) => section.getAttribute("data-testid"));
  const filters = () =>
    (store.getState() as unknown as { filter: { filters: string[] } }).filter.filters;

  beforeAll(() => {
    // jsdom has no Element.scrollTo; the rail tap's smooth scroll calls it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    mockFetchMenu.mockReset();
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    mockCapture.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setMenuData({ menu: TAGGED_MENU }));
    store.dispatch(setTags({ tags: ["veg", "non-veg"] }));
  });

  // FILTERS_HIDDEN — user 2026-10-14: "for now disable the filters dont show
  // it on menu left side bar". The Menu renders MenuFilterChips without
  // `enabled`; re-enable by passing it there and un-skipping the paused tests.
  it("filters hidden for now: no chip group in the rail, and a persisted pick never narrows the menu", () => {
    store.dispatch(setFilters(["non-veg"]));
    renderMenu();

    expect(screen.queryByRole("group", { name: i18n.t("menu.filters") })).toBeNull();
    expect(screen.queryByTestId("menu-filter-veg")).toBeNull();
    expect(screen.queryByTestId("menu-filter-non-veg")).toBeNull();
    expect(filters()).toEqual([]);
    expect(itemIds()).toHaveLength(5);
  });

  // Paused while the chips are hidden (FILTERS_HIDDEN below).
  it.skip("the chips sit in the rail between the bell and the category list", () => {
    renderMenu();
    const rail = screen.getByTestId("category-rail");
    const group = within(rail).getByRole("group", { name: i18n.t("menu.filters") });

    expect(group).toContainElement(screen.getByTestId("menu-filter-veg"));
    expect(group).toContainElement(screen.getByTestId("menu-filter-non-veg"));
    expect(rail.firstElementChild?.tagName).toBe("IMG");
    expect(group.compareDocumentPosition(screen.getByTestId("rail-c-mains")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(rail).getAllByRole("button")[0]).toBe(screen.getByTestId("menu-filter-veg"));
  });

  // Paused while the chips are hidden (FILTERS_HIDDEN below).
  it.skip("NON-VEG narrows the rail AND the sections; VEG swaps; a re-tap restores the whole menu", () => {
    renderMenu();
    expect(railIds()).toEqual(["rail-c-mains", "rail-c-drinks", "rail-c-meat"]);

    fireEvent.click(screen.getByTestId("menu-filter-non-veg"));
    expect(filters()).toEqual(["non-veg"]);
    expect(railIds()).toEqual(["rail-c-mains", "rail-c-meat"]);
    expect(sectionIds()).toEqual(["section-c-mains", "section-c-meat"]);
    expect(itemIds()).toEqual(["item-e-chicken", "item-e-steak"]);
    // Bowls emptied → dropped; Mains is left with one sub-category (no H3).
    expect(within(screen.getByTestId("section-c-mains")).queryByRole("heading", { level: 3 })).toBeNull();

    fireEvent.click(screen.getByTestId("menu-filter-veg"));
    expect(filters()).toEqual(["veg"]);
    expect(railIds()).toEqual(["rail-c-mains", "rail-c-drinks"]);
    expect(itemIds()).toEqual(["item-e-bean", "item-e-veg-bowl", "item-e-cola"]);

    fireEvent.click(screen.getByTestId("menu-filter-veg"));
    expect(filters()).toEqual([]);
    expect(railIds()).toEqual(["rail-c-mains", "rail-c-drinks", "rail-c-meat"]);
    expect(itemIds()).toEqual(["item-e-bean", "item-e-chicken", "item-e-veg-bowl", "item-e-cola", "item-e-steak"]);
  });

  // Paused while the chips are hidden (FILTERS_HIDDEN below).
  it.skip("the selected category filtered away → the first rail row stands in", () => {
    renderMenu();
    fireEvent.click(screen.getByTestId("rail-c-drinks"));
    expect(screen.getByTestId("rail-c-drinks")).toHaveClass("bg-tb-purple-vibrant");

    // Not through a chip: the fallback alone (a filter can arrive with a reload).
    act(() => {
      store.dispatch(setFilters(["non-veg"]));
    });
    expect(screen.queryByTestId("rail-c-drinks")).toBeNull();
    expect(screen.getByTestId("rail-c-mains")).toHaveClass("bg-tb-purple-vibrant");
  });

  // Paused while the chips are hidden (FILTERS_HIDDEN below).
  it.skip("a chip tap returns the pane to its top and the rail to its first row", () => {
    renderMenu();
    // The item pane (the rail's list scrolls too, and comes first).
    const pane = screen.getByTestId("item-e-bean").closest(".overflow-y-auto") as HTMLElement;
    fireEvent.click(screen.getByTestId("rail-c-meat"));
    pane.scrollTop = 640;

    fireEvent.click(screen.getByTestId("menu-filter-non-veg"));

    expect(pane.scrollTop).toBe(0);
    expect(screen.getByTestId("rail-c-mains")).toHaveClass("bg-tb-purple-vibrant");
    expect(screen.getByTestId("rail-c-meat")).not.toHaveClass("bg-tb-purple-vibrant");
  });

  // Paused while the chips are hidden (FILTERS_HIDDEN below).
  it.skip("a filter that empties the grid is not an empty menu: no refetch, no menu-error, no loading copy — the chips stay to undo it", async () => {
    // A stale tag list: VEG is offered, but nothing on this menu is veg.
    store.dispatch(
      setMenuData({
        menu: {
          categories: [TAGGED_MENU.categories[2]],
        },
      })
    );
    renderMenu();

    await act(async () => {
      fireEvent.click(screen.getByTestId("menu-filter-veg"));
    });

    expect(itemIds()).toEqual([]);
    expect(railIds()).toEqual([]);
    expect(mockFetchMenu).not.toHaveBeenCalled();
    expect(screen.queryByTestId("menu-error")).toBeNull();
    expect(screen.queryByText(i18n.t("menu.empty"))).toBeNull();

    fireEvent.click(screen.getByTestId("menu-filter-veg"));
    expect(itemIds()).toEqual(["item-e-steak"]);
  });

  it("hide_filter → no chips; the menu shows unfiltered", () => {
    store.dispatch(setHideFilter(true));
    renderMenu();

    expect(screen.queryByTestId("menu-filter-veg")).toBeNull();
    expect(screen.queryByRole("group", { name: i18n.t("menu.filters") })).toBeNull();
    expect(itemIds()).toHaveLength(5);
  });

  it("each card's price line leads with its diet mark; hide_veg_non_veg removes the marks and the chips", () => {
    const { unmount } = renderMenu();

    const bean = screen.getByTestId("item-e-bean");
    const mark = within(bean).getByTestId("veg-mark-veg");
    expect(mark).toHaveAccessibleName(i18n.t("menu.veg"));
    expect(mark.parentElement?.textContent).toBe("£3");
    expect(within(screen.getByTestId("item-e-steak")).getByTestId("veg-mark-non-veg")).toBeInTheDocument();
    unmount();

    store.dispatch(setKioskSettings({ hide_veg_non_veg: true }));
    renderMenu();
    expect(screen.queryAllByTestId(/^veg-mark-/)).toHaveLength(0);
    expect(screen.queryByTestId("menu-filter-veg")).toBeNull();
    expect(screen.queryByTestId("menu-filter-non-veg")).toBeNull();
  });
});

/*
  audit-fixes B3 (PAR-07) steps 5–7 — the /menu funnel events, fork ItemCard
  parity: raw primary-language fields (names resolve only at render).
*/
describe("Menu — the funnel events (B3)", () => {
  const SIDES = "s-sides";
  const PLAIN = { id: "e-fries", name: "Large Fries", price: 2.5, subCategoryId: SIDES, outOfStock: false };
  const DP_ITEM = { id: "e-dp", name: "Lunch Taco", price: 3, subCategoryId: SIDES, isDpItem: true, outOfStock: false };
  const CUSTOM = {
    id: "e-burger",
    name: "Cheese Burger",
    price: 8,
    subCategoryId: SIDES,
    modifiers: ["g-extras"],
    outOfStock: false,
  };
  const SIZED = {
    id: "e-taco",
    name: "Crunchy Taco",
    price: 0,
    subCategoryId: SIDES,
    hasVariant: true,
    isVariant: false,
    variants: [{ id: "v-regular", name: "Regular", price: 4 }],
    outOfStock: false,
  };
  const COMBO = {
    id: "e-salad",
    name: "Greek Salad",
    price: 17,
    subCategoryId: SIDES,
    // Converted combos are entities (filterEntitiesByTags drops bare ids),
    // active ones (addUpSellEntities resolves no other) — the meal prompt
    // offers only those, and an item with none is no upsell (walk-oos 2).
    upsellItems: [{ id: "combo-1", name: "Salad Meal", tags: ["veg"], isActive: true }],
    recommendedItems: [],
    outOfStock: false,
  };
  const SOLD_OUT = { id: "e-oos", name: "Nachos", price: 3, subCategoryId: SIDES, outOfStock: true };
  const EVENT_MENU = {
    categories: [
      {
        id: "c1",
        name: "Side Orders",
        subCategories: [{ id: SIDES, name: "Sides", entities: [PLAIN, DP_ITEM, CUSTOM, SIZED, COMBO] }],
      },
      {
        id: "c2",
        name: "More",
        subCategories: [
          { id: "s-more", name: "More", entities: [SOLD_OUT] },
          { id: "s-empty", name: "Empty", entities: [] },
        ],
      },
    ],
  };

  const eventCalls = (event: string) => mockCapture.mock.calls.filter(([name]) => name === event);
  const cartRows = () =>
    (store.getState() as unknown as { cart: { cartItems: { id: string; quantity: number }[] } }).cart.cartItems;

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    mockFetchMenu.mockReset();
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    mockNavigate.mockReset();
    mockCapture.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setMenuData({ menu: EVENT_MENU }));
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("MenuViewed once per mount (StrictMode re-runs effects) with the category and item counts", () => {
    renderMenu({ reactStrictMode: true });

    expect(eventCalls("menu_viewed")).toEqual([["menu_viewed", { category_count: 2, total_items: 6 }]]);
  });

  it("MenuViewed waits for the menu: nothing while it refetches, once when it arrives", () => {
    store.dispatch({ type: "RESET_STATE" });
    renderMenu();
    expect(eventCalls("menu_viewed")).toHaveLength(0);

    act(() => {
      store.dispatch(setMenuData({ menu: EVENT_MENU }));
    });
    expect(eventCalls("menu_viewed")).toEqual([["menu_viewed", { category_count: 2, total_items: 6 }]]);

    act(() => {
      store.dispatch(setMenuData({ menu: { categories: [EVENT_MENU.categories[0]] } }));
    });
    expect(eventCalls("menu_viewed")).toHaveLength(1);
  });

  it("no MenuViewed under the bag (/cart is its own mount of this page)", () => {
    renderMenu({ bagOpen: true });

    expect(eventCalls("menu_viewed")).toHaveLength(0);
  });

  it("a card tap: ItemClicked (raw name, price, sub-category), then ItemAddedToCart once it landed", () => {
    renderMenu();
    mockCapture.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Large Fries" }));

    expect(mockCapture).toHaveBeenCalledWith("item_clicked", {
      item_id: "e-fries",
      item_name: "Large Fries",
      item_price: 2.5,
      category: SIDES,
    });
    expect(mockCapture).toHaveBeenCalledWith("item_added_to_cart", {
      item_id: "e-fries",
      item_name: "Large Fries",
      item_price: 2.5,
      quantity: 1,
      item_type: undefined,
    });
    expect(cartRows()).toHaveLength(1);
  });

  it("the '+' quick add: ItemAddedToCart without ItemClicked; a second '+' bumps the row and reports again", () => {
    renderMenu();
    mockCapture.mockClear();

    fireEvent.click(screen.getByTestId("quick-add-e-fries"));
    fireEvent.click(screen.getByTestId("quick-add-e-fries"));

    expect(eventCalls("item_clicked")).toHaveLength(0);
    expect(eventCalls("item_added_to_cart")).toHaveLength(2);
    expect(cartRows()).toEqual([expect.objectContaining({ id: "e-fries", quantity: 2 })]);
  });

  it("a quick add the DP session cap rejects sends no ItemAddedToCart (and adds nothing)", () => {
    store.dispatch(setCurrentSession({ _id: "dp-lunch", sessionName: "Lunch", _extras: { maxQtyItem: "1" } }));
    store.dispatch(
      setCartItems([
        { id: "e-held", itemId: "h-1", name: "Held Taco", quantity: 1, type: "ITEM", isDpItem: true, price: 3, total_price: 3 },
      ])
    );
    renderMenu();
    mockCapture.mockClear();

    fireEvent.click(screen.getByTestId("quick-add-e-dp"));

    expect(eventCalls("item_added_to_cart")).toHaveLength(0);
    expect(cartRows()).toHaveLength(1);
  });

  it("an unavailable card has no tap target, so it reports nothing", () => {
    renderMenu();
    mockCapture.mockClear();

    fireEvent.click(screen.getByTestId("item-e-oos"));

    expect(eventCalls("item_clicked")).toHaveLength(0);
  });

  it("modifiers: CustomizationOpened {source:'menu'} from the card and from '+', on the way to the PDP", () => {
    renderMenu();
    mockCapture.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Cheese Burger" }));
    fireEvent.click(screen.getByTestId("quick-add-e-burger"));

    const opened = { item_id: "e-burger", item_name: "Cheese Burger", source: "menu" };
    expect(eventCalls("customization_opened")).toEqual([
      ["customization_opened", opened],
      ["customization_opened", opened],
    ]);
    expect(eventCalls("item_clicked")).toHaveLength(1);
    expect(mockNavigate).toHaveBeenCalledWith("/customization", undefined);
  });

  it("a sized item: the card tap opens the PDP (CustomizationOpened); its '+' opens Select a Size (no event yet)", () => {
    renderMenu();
    mockCapture.mockClear();

    fireEvent.click(screen.getByTestId("quick-add-e-taco"));
    expect(screen.getByTestId("select-size-modal")).toBeInTheDocument();
    expect(eventCalls("customization_opened")).toHaveLength(0);
    // Its X (the scrim is the first closer, the card's X the second).
    fireEvent.click(
      within(screen.getByTestId("select-size-modal")).getAllByRole("button", { name: i18n.t("language.close") })[1]
    );
    expect(screen.queryByTestId("select-size-modal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Crunchy Taco" }));
    expect(mockCapture).toHaveBeenCalledWith("customization_opened", {
      item_id: "e-taco",
      item_name: "Crunchy Taco",
      source: "menu",
    });
  });

  it("the combo upsell: MakeItAMealOpened {item_id, item_name}", () => {
    store.dispatch(setKioskSettings({ enable_combo_upsell: true }));
    renderMenu();
    mockCapture.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Greek Salad" }));

    expect(mockCapture).toHaveBeenCalledWith("make_it_a_meal_clicked", {
      item_id: "e-salad",
      item_name: "Greek Salad",
    });
    expect(eventCalls("item_added_to_cart")).toHaveLength(0);
  });

  it("a product-added suggestion reports ItemAddedToCart when ADD TO ORDER buys it (with its quantity) — never at the tap that picks it", () => {
    store.dispatch(setEntityMap({ entityMap: { [PLAIN.id]: PLAIN } }));
    renderMenu();
    act(() => {
      store.dispatch(mutateAddToCartModal({ isOpen: true, item: { id: "e-burger", recommendedItems: [PLAIN.id] } }));
    });
    mockCapture.mockClear();

    fireEvent.click(screen.getByTestId(`added-rec-add-${PLAIN.id}`));
    expect(eventCalls("item_added_to_cart")).toHaveLength(0);
    expect(cartRows()).toEqual([]);

    fireEvent.click(screen.getByTestId("added-continue"));

    expect(mockCapture).toHaveBeenCalledWith("item_added_to_cart", {
      item_id: "e-fries",
      item_name: "Large Fries",
      item_price: 2.5,
      quantity: 1,
      item_type: undefined,
    });
    expect(cartRows()).toEqual([expect.objectContaining({ id: "e-fries" })]);
  });

  it("Arabic session: the events still carry the PRIMARY-language name", async () => {
    store.dispatch(
      setMenuData({
        menu: {
          categories: [
            {
              id: "c1",
              name: "Side Orders",
              subCategories: [
                {
                  id: SIDES,
                  name: "Sides",
                  entities: [{ ...PLAIN, aliases: [{ value: "بطاطس كبيرة", name: "Arabic", code: "ar", dir: "rtl" }] }],
                },
              ],
            },
          ],
        },
      })
    );
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderMenu();
    mockCapture.mockClear();

    fireEvent.click(screen.getByTestId("quick-add-e-fries"));

    expect(mockCapture).toHaveBeenCalledWith(
      "item_added_to_cart",
      expect.objectContaining({ item_id: "e-fries", item_name: "Large Fries" })
    );
  });
});


/*
  Lane motion (§2.4 / §2.7 / §3.9). The page root latches data-enter at mount:
  none on a page load (POP); fwd on a PUSH — unless Menu mounts QUIET under
  an open overlay: the bag (/cart), the product-added modal (Figma 1:5502:
  the menu stays still) or the loyalty rewards sheet. The rail + pane row is
  the one arriving block; the scrollbar, the CTA bar and the footer stay. The
  rail tap scrolls smooth, or jumps under reduced motion.
*/
describe("Menu — motion (lane motion)", () => {
  /** A PUSH from another route (<Navigate> fires after the first commit). */
  const mountPushed = (to: "/menu" | "/cart" = "/menu") =>
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/second"]}>
          <Routes>
            <Route path="/second" element={<Navigate to={to} />} />
            <Route path="/menu" element={<Menu />} />
            <Route path="/cart" element={<Menu bagOpen />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );
  const root = () => screen.getByTestId("menu-screen");
  const defaultMatchMedia = window.matchMedia;

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    mockFetchMenu.mockReset();
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setMenuData({ menu: CONVERTED_MENU }));
    notePath("/start");
    notePath("/second");
  });

  afterEach(() => {
    window.matchMedia = defaultMatchMedia;
    vi.restoreAllMocks();
  });

  it("a page load (POP) mounts still; a PUSH from /second arrives fwd", () => {
    const pop = renderMenu();
    expect(root()).not.toHaveAttribute("data-enter");
    pop.unmount();

    mountPushed();
    expect(root()).toHaveAttribute("data-enter", "fwd");
  });

  it("the rail + pane row is the one tb-enter block (0) — never the scrollbar, the CTA bar or the footer", () => {
    mountPushed();
    const blocks = [...root().querySelectorAll(".tb-enter")];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveClass("[--i:0]");
    expect(blocks[0]).toContainElement(screen.getByTestId("rail-c1"));
    for (const id of ["menu-scrollbar", "cta-view-bag", "footer-cancel"]) {
      expect(screen.getByTestId(id).closest(".tb-enter")).toBeNull();
    }
  });

  it.each([
    ["the open bag (/cart)", () => {}, "/cart"],
    ["the product-added modal", () => store.dispatch(mutateAddToCartModal({ isOpen: true, item: { id: "e-plain" } })), "/menu"],
    ["the loyalty rewards sheet", () => store.dispatch(openLoyaltyItemsModal({ isTimerOn: false })), "/menu"],
  ] as const)("quiet under %s: a PUSH mounts still", (_overlay, open, to) => {
    open();
    mountPushed(to);
    expect(root()).not.toHaveAttribute("data-enter");
  });

  it("a rail tap scrolls the pane smooth — or jumps (auto) when the OS asks for reduced motion", () => {
    const scrollTo = vi.spyOn(Element.prototype, "scrollTo").mockImplementation(() => {});
    renderMenu();

    fireEvent.click(screen.getByTestId("rail-c1"));
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));

    window.matchMedia = (query: string) => ({
      ...defaultMatchMedia(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    });
    fireEvent.click(screen.getByTestId("rail-c1"));
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});


/*
  posistKiosk parity (user report 2026-10-12: "when item is clicked its
  directly adding to the cart"). The product-added modal STAGES — nothing
  reaches the bag until ADD TO ORDER. A suggestion tap ends in exactly one of:
  (a) a one-tap item is PICKED on its tile (the pill and the Total count it);
  (b) an item that needs a choice HIDES the modal — still open, its picks
  kept — with recommendationDetour set, and what the menu '+' opens for it
  takes over (Select a Size / the PDP; never the repeat sheet, whose '+'
  writes to the bag); the add that chooser ends in is PARKED back in the
  modal, and every exit clears the flag, which brings the modal back.
  ADD TO ORDER writes the picks (the DP cap can refuse them); X discards.
*/
describe("Menu — product-added suggestions are staged (posistKiosk parity)", () => {
  const PLAIN = { id: "e-fries", name: "Large Fries", price: 2.5, outOfStock: false };
  const OPTIONS = { id: "e-burger", name: "Cheese Burger", price: 8, modifiers: ["g-extras"], outOfStock: false };
  const SIZED = {
    id: "e-taco",
    name: "Crunchy Taco",
    price: 0,
    hasVariant: true,
    isVariant: false,
    outOfStock: false,
    // isActive: the resolver drops a size parent with no active size.
    variants: [
      { id: "v-regular", name: "Regular", price: 4, isActive: true, isDpItem: true },
      { id: "v-large", name: "Large", price: 6, isActive: true, modifiers: ["g-taco"] },
    ],
  };
  const DP_PLAIN = { id: "e-dp", name: "Lunch Taco", price: 3, isDpItem: true, outOfStock: false };
  /** A pack: its group id ends "_combo"; the menu sells it only while a group is live. */
  const PACK = { id: "e-box", name: "Dream Box", price: 25, modifiers: ["snacks_combo"], outOfStock: false };
  /** A one-tap item with suggestions of its own (the no-chain guard). */
  const CHAINED = { id: "e-nachos", name: "Nachos", price: 3, outOfStock: false, recommendedItems: [PLAIN.id] };
  const HELD_DP_ROW = { id: "e-held", itemId: "h-1", name: "Held Taco", quantity: 1, type: "ITEM", isDpItem: true, price: 3, total_price: 3 };
  const DP_SESSION = { _id: "dp-lunch", sessionName: "Lunch", _extras: { maxQtyItem: "1" } };
  const MENU = {
    categories: [{ id: "c1", name: "Side Orders", subCategories: [{ id: "s1", name: "Sides", entities: [PLAIN] }] }],
  };

  type Selections = {
    addToCartModal: { isOpen: boolean; item: Record<string, unknown> };
    recommendationDetour: boolean;
    upsellStaging: { pending: Record<string, number>; pendingCustom: Record<string, unknown>[] };
  };
  const selections = () => (store.getState() as unknown as { menuSelections: Selections }).menuSelections;
  const cartRows = () =>
    (store.getState() as unknown as { cart: { cartItems: Record<string, unknown>[] } }).cart.cartItems;
  const eventCalls = (event: string) => mockCapture.mock.calls.filter(([name]) => name === event);
  /** The modal over the menu, as a plain add of the Greek Salad opened it. */
  const openAdded = (recommendedItems: string[]) =>
    act(() => {
      store.dispatch(
        mutateAddToCartModal({ isOpen: true, item: { id: "e-salad", name: "Greek Salad", recommendedItems } })
      );
    });
  const tapPlus = (id: string) => fireEvent.click(screen.getByTestId(`added-rec-add-${id}`));
  const pill = (id: string) => screen.queryByTestId(`added-count-${id}`)?.textContent ?? null;
  const sizeX = () =>
    fireEvent.click(
      within(screen.getByTestId("select-size-modal")).getAllByRole("button", { name: i18n.t("language.close") })[1]
    );
  /** A chooser is up: the modal is still open (its picks kept) but not on screen. */
  const expectHidden = () => {
    expect(selections().addToCartModal.isOpen).toBe(true);
    expect(screen.queryByTestId("product-added-modal")).toBeNull();
    expect(selections().recommendationDetour).toBe(true);
  };

  beforeEach(() => {
    mockFetchMenu.mockReset();
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    mockNavigate.mockReset();
    mockCapture.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setMenuData({ menu: MENU }));
    // Live, or toMenuSellableEntity sells OPTIONS as a one-tap item.
    store.dispatch(setModifiersMap({ modifiersMap: { "g-extras": { _id: "g-extras", isActive: true } } }));
    store.dispatch(
      setEntityMap({ entityMap: Object.fromEntries([PLAIN, OPTIONS, SIZED, DP_PLAIN].map((e) => [e.id, e])) })
    );
  });

  it("a plain suggestion is PICKED, not bought — no row, no event, no detour; the pill and the Total count it; ADD TO ORDER lands it in one write and reports it once", () => {
    renderMenu();
    openAdded([PLAIN.id]);
    mockCapture.mockClear();

    tapPlus(PLAIN.id);

    expect(selections().addToCartModal).toMatchObject({ isOpen: true, item: { id: "e-salad" } });
    expect(selections().recommendationDetour).toBe(false);
    expect(cartRows()).toEqual([]);
    expect(eventCalls("item_added_to_cart")).toHaveLength(0);
    expect(pill(PLAIN.id)).toBe("1");
    // The Total previews the order with the pick (the bag is still empty):
    // the bag's own Total, whose round off takes the £2.50 to £3.
    expect(screen.getByTestId("added-total")).toHaveTextContent(/^Total £3$/);

    fireEvent.click(screen.getByRole("button", { name: `${i18n.t("menu.quickAdd")} ${PLAIN.name}` }));
    expect(pill(PLAIN.id)).toBe("2");
    expect(screen.getByTestId("added-total")).toHaveTextContent(/^Total £5$/);
    expect(cartRows()).toEqual([]);

    // ADD TO ORDER is the purchase: both units in ONE row, ONE event.
    fireEvent.click(screen.getByTestId("added-continue"));
    expect(selections().addToCartModal.isOpen).toBe(false);
    expect(screen.queryByTestId("product-added-modal")).toBeNull();
    expect(cartRows()).toEqual([expect.objectContaining({ id: PLAIN.id, quantity: 2, total_price: 2.5 })]);
    expect(eventCalls("item_added_to_cart")).toEqual([
      [
        "item_added_to_cart",
        { item_id: PLAIN.id, item_name: PLAIN.name, item_price: 2.5, quantity: 2, item_type: undefined },
      ],
    ]);
    expect(selections().recommendationDetour).toBe(false);
  });

  it("X throws the picks away — the bag untouched", () => {
    renderMenu();
    openAdded([PLAIN.id]);
    tapPlus(PLAIN.id);

    // DOM order: the scrim, then the card's X.
    fireEvent.click(
      within(screen.getByTestId("product-added-modal")).getAllByRole("button", { name: i18n.t("language.close") })[1]
    );

    expect(selections().addToCartModal.isOpen).toBe(false);
    expect(cartRows()).toEqual([]);
    expect(selections().upsellStaging).toEqual({ pending: {}, pendingCustom: [] });
  });

  // Test stage — no chain: a one-tap suggestion with suggestions of its own
  // is picked on the first item's strip and bought with suppressAddedModal,
  // so it never opens the modal on itself.
  it("no chain: a one-tap suggestion with suggestions of its own is picked on the first item's strip; ADD TO ORDER opens no modal on it", () => {
    store.dispatch(setEntityMap({ entityMap: { [PLAIN.id]: PLAIN, [CHAINED.id]: CHAINED } }));
    renderMenu();
    openAdded([CHAINED.id]);

    fireEvent.click(screen.getByRole("button", { name: `${i18n.t("menu.quickAdd")} ${CHAINED.name}` }));

    expect(selections().addToCartModal).toMatchObject({ isOpen: true, item: { id: "e-salad" } });
    expect(pill(CHAINED.id)).toBe("1");
    expect(screen.queryByTestId(`added-rec-${PLAIN.id}`)).toBeNull();

    fireEvent.click(screen.getByTestId("added-continue"));
    expect(cartRows()).toEqual([expect.objectContaining({ id: CHAINED.id, quantity: 1 })]);
    expect(selections().addToCartModal.isOpen).toBe(false);
  });

  it("a DP suggestion over the cap is picked, but ADD TO ORDER is refused — the global error, nothing added, the modal stays with it still picked, no event", () => {
    store.dispatch(setCurrentSession(DP_SESSION));
    store.dispatch(setCartItems([HELD_DP_ROW]));
    renderMenu();
    openAdded([DP_PLAIN.id]);
    mockCapture.mockClear();

    tapPlus(DP_PLAIN.id);
    expect(pill(DP_PLAIN.id)).toBe("1");
    expect(selectShowErrorModalGlobal(store.getState())).toBe(false);

    fireEvent.click(screen.getByTestId("added-continue"));

    expect(selectShowErrorModalGlobal(store.getState())).toBe(true);
    expect(cartRows()).toEqual([HELD_DP_ROW]);
    expect(selections().addToCartModal.isOpen).toBe(true);
    expect(pill(DP_PLAIN.id)).toBe("1");
    expect(eventCalls("item_added_to_cart")).toHaveLength(0);
  });

  // The menu '+''s row (already in the bag) takes the picked units in ONE
  // write, so the cap check sees the true total.
  it("a pick of an item already in the bag bumps that row in one write — refused as a whole at the cap, the row unchanged", () => {
    const DP_ROW = { id: DP_PLAIN.id, itemId: "dp-1", name: DP_PLAIN.name, quantity: 1, type: "ITEM", isDpItem: true, price: 3, total_price: 3 };
    store.dispatch(setCurrentSession(DP_SESSION));
    store.dispatch(setCartItems([DP_ROW]));
    renderMenu();
    openAdded([DP_PLAIN.id]);
    // The pill is what the guest is adding, not what the bag holds.
    expect(pill(DP_PLAIN.id)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: `${i18n.t("menu.quickAdd")} ${DP_PLAIN.name}` }));
    fireEvent.click(screen.getByTestId("added-continue"));

    expect(selectShowErrorModalGlobal(store.getState())).toBe(true);
    expect(cartRows()).toEqual([DP_ROW]);
    expect(pill(DP_PLAIN.id)).toBe("1");
    expect(selections().addToCartModal.isOpen).toBe(true);
  });

  it("options → the PDP, the detour marked; the modal stays OPEN but hidden, the picks kept, nothing in the bag", () => {
    renderMenu();
    openAdded([PLAIN.id, OPTIONS.id]);
    tapPlus(PLAIN.id);

    tapPlus(OPTIONS.id);

    expect(mockNavigate).toHaveBeenCalledWith("/customization", undefined);
    expectHidden();
    expect(selections().upsellStaging.pending).toEqual({ [PLAIN.id]: 1 });
    expect(cartRows()).toEqual([]);
  });

  // T4, a pack (test stage): what the menu '+' opens for it — the PDP on its
  // own tier-1 (slot) session — from a tap ANYWHERE on the card.
  it("a pack (a live _combo group) → the PDP on the pack's session — from the card itself; the modal hidden", () => {
    store.dispatch(
      setModifiersMap({
        modifiersMap: {
          "g-extras": { _id: "g-extras", isActive: true },
          snacks_combo: { _id: "snacks_combo", isActive: true },
        },
      })
    );
    store.dispatch(setEntityMap({ entityMap: { [PLAIN.id]: PLAIN, [PACK.id]: PACK } }));
    renderMenu();
    openAdded([PACK.id]);

    // A tile that leaves the modal is named "Customize <name>" (review UIA-2).
    fireEvent.click(screen.getByRole("button", { name: `${i18n.t("pack.customize")} ${PACK.name}` }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/customization", undefined);
    expect(tier1CustomizationSelectedEntity(store.getState())).toMatchObject({ id: PACK.id, quantity: 1 });
    expectHidden();
    expect(cartRows()).toEqual([]);
  });

  it("already in the bag (repeat on) → still the PDP, never the repeat sheet (its '+' would write to the bag past ADD TO ORDER)", () => {
    store.dispatch(setShowRepeatCustomization(true));
    store.dispatch(
      setCartItems([{ id: OPTIONS.id, itemId: "b-1", name: OPTIONS.name, quantity: 1, type: "CUSTOMIZABLE", price: 8, total_price: 8 }])
    );
    renderMenu();
    openAdded([OPTIONS.id]);

    tapPlus(OPTIONS.id);

    expect(repeatItemBottomSheetData(store.getState())?.isOpen).toBeFalsy();
    expect(mockNavigate).toHaveBeenCalledWith("/customization", undefined);
    expectHidden();
  });

  it("sized → the menu '+''s Select a Size (no PDP), the modal hidden; its X ends the detour and brings the modal back with its picks, nothing added", () => {
    renderMenu();
    openAdded([PLAIN.id, SIZED.id]);
    tapPlus(PLAIN.id);

    tapPlus(SIZED.id);

    expect(screen.getByTestId("select-size-modal")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expectHidden();

    sizeX();
    expect(screen.queryByTestId("select-size-modal")).toBeNull();
    expect(selections().recommendationDetour).toBe(false);
    expect(screen.getByTestId("product-added-modal")).toBeInTheDocument();
    expect(pill(PLAIN.id)).toBe("1");
    expect(pill(SIZED.id)).toBeNull();
    expect(cartRows()).toEqual([]);
  });

  // Review R3: SelectSizeModal used to stay mounted (null while closed), so a
  // size picked and abandoned came back ticked, with CONTINUE live (1:5628
  // draws it disabled until a size is chosen).
  it("a size picked then abandoned (X) is never ticked when Select a Size opens again", () => {
    renderMenu();
    openAdded([SIZED.id]);
    tapPlus(SIZED.id);
    fireEvent.click(screen.getByTestId("size-v-large"));
    expect(screen.getByTestId("size-v-large")).toHaveAttribute("aria-pressed", "true");
    sizeX();

    tapPlus(SIZED.id);

    expect(screen.getByTestId("size-v-large")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("size-continue")).toBeDisabled();
    expect(cartRows()).toEqual([]);
  });

  it("a size-only CONTINUE PARKS its VARIANT row — the bag unchanged — and the same modal is back with it counted (no second strip); ADD TO ORDER lands it", () => {
    // Test stage: suggestions of its own, so a chained strip would show them.
    store.dispatch(
      setEntityMap({ entityMap: { [PLAIN.id]: PLAIN, [SIZED.id]: { ...SIZED, recommendedItems: [PLAIN.id] } } })
    );
    renderMenu();
    openAdded([SIZED.id]);
    tapPlus(SIZED.id);

    fireEvent.click(screen.getByTestId("size-v-regular"));
    fireEvent.click(screen.getByTestId("size-continue"));

    expect(cartRows()).toEqual([]);
    // variantPrice: the bill prices a VARIANT row by it (never `price`).
    expect(selections().upsellStaging.pendingCustom).toEqual([
      expect.objectContaining({ id: SIZED.id, type: "VARIANT", quantity: 1, variantPrice: 4 }),
    ]);
    expect(selections().addToCartModal).toMatchObject({ isOpen: true, item: { id: "e-salad" } });
    expect(selections().recommendationDetour).toBe(false);
    expect(screen.getByTestId("product-added-modal")).toBeInTheDocument();
    expect(pill(SIZED.id)).toBe("1");
    expect(screen.queryByTestId(`added-rec-${PLAIN.id}`)).toBeNull();
    expect(screen.getByTestId("added-total")).toHaveTextContent(/^Total £4$/);
    // The chooser's own confirm reports the item (the PDP's ADD TO BAG does too).
    expect(eventCalls("item_added_to_cart")).toEqual([
      ["item_added_to_cart", expect.objectContaining({ item_id: SIZED.id, item_price: 4, item_type: "VARIANT" })],
    ]);

    fireEvent.click(screen.getByTestId("added-continue"));
    expect(cartRows()).toEqual([
      expect.objectContaining({ id: SIZED.id, type: "VARIANT", quantity: 1, variantPrice: 4 }),
    ]);
    expect(selections().addToCartModal.isOpen).toBe(false);
    expect(eventCalls("item_added_to_cart")).toHaveLength(1);
  });

  it("a CONTINUE the DP cap refuses parks nothing and ends the detour — the global error says why, the modal back", () => {
    store.dispatch(setCurrentSession(DP_SESSION));
    store.dispatch(setCartItems([HELD_DP_ROW]));
    renderMenu();
    openAdded([SIZED.id]);
    tapPlus(SIZED.id);

    fireEvent.click(screen.getByTestId("size-v-regular"));
    fireEvent.click(screen.getByTestId("size-continue"));

    expect(selectShowErrorModalGlobal(store.getState())).toBe(true);
    expect(cartRows()).toEqual([HELD_DP_ROW]);
    expect(selections().upsellStaging.pendingCustom).toEqual([]);
    expect(selections().addToCartModal.isOpen).toBe(true);
    expect(selections().recommendationDetour).toBe(false);
    expect(eventCalls("item_added_to_cart")).toHaveLength(0);
  });

  it.each([
    ["not in the bag", false],
    ["in the bag with repeat on", true],
  ])("CONTINUE on a size with groups (%s) goes on to the PDP — never the repeat sheet; the detour carries on, the modal hidden", (_case, inBag) => {
    if (inBag) {
      store.dispatch(setShowRepeatCustomization(true));
      store.dispatch(
        setCartItems([{ id: SIZED.id, itemId: "t-1", name: SIZED.name, quantity: 1, type: "VARIANT", price: 4, total_price: 4 }])
      );
    }
    renderMenu();
    openAdded([SIZED.id]);
    tapPlus(SIZED.id);

    fireEvent.click(screen.getByTestId("size-v-large"));
    fireEvent.click(screen.getByTestId("size-continue"));

    expect(mockNavigate).toHaveBeenCalledWith("/customization", undefined);
    expect(repeatItemBottomSheetData(store.getState())?.isOpen).toBeFalsy();
    expectHidden();
    expect(cartRows()).toHaveLength(inBag ? 1 : 0);
  });

  /*
    Leak sweep (2026-10-12): the hand-off from Select a Size to the PDP. RR7
    navigates inside a transition, so this page stays on screen until the
    PDP renders; closing the sheet first left the BARE menu under the finger
    — the modal hidden, the detour still set, and no edge to arm
    DetourTapGuard — so a double tap's second half added the menu card
    beneath (or opened the bag). The sheet stays up as the cover until the
    route change unmounts this page (navigate is a spy here, so it never
    does), and a second CONTINUE does nothing.
  */
  it("CONTINUE on a size with groups keeps Select a Size up as the cover until the PDP replaces the page; a second CONTINUE does nothing", () => {
    renderMenu();
    openAdded([SIZED.id]);
    tapPlus(SIZED.id);
    fireEvent.click(screen.getByTestId("size-v-large"));

    fireEvent.click(screen.getByTestId("size-continue"));
    fireEvent.click(screen.getByTestId("size-continue"));

    expect(screen.getByTestId("select-size-modal")).toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(eventCalls("customization_opened")).toHaveLength(1);
    expectHidden();
    expect(cartRows()).toEqual([]);
  });

  it.each([
    ["a menu card tap", () => fireEvent.click(screen.getByRole("button", { name: PLAIN.name }))],
    ["a menu card's '+'", () => fireEvent.click(screen.getByTestId(`quick-add-${PLAIN.id}`))],
  ])("%s ends a leftover detour — a fresh menu tap is never a detour's add", (_what, tap) => {
    store.dispatch(setRecommendationDetour(true));
    renderMenu();

    tap();

    expect(selections().recommendationDetour).toBe(false);
    expect(cartRows()).toEqual([expect.objectContaining({ id: PLAIN.id, quantity: 1 })]);
  });
});

/*
  walk-oos 2 (user 2026-10-14, "Show it Unavailable"): an item with a
  REQUIRED group whose every option is out of stock can never be completed —
  its card is the sold-out card (nothing to open, no "+"), and a size with
  its own such group is a greyed size in Select a Size. Re-evaluated live:
  PAY's fresher stock map moves the cards.
*/
describe("Menu — walk-oos 2: an item no guest can complete reads Unavailable", () => {
  const opt = (id: string, outOfStock = false) => ({ id, name: id, isActive: true, outOfStock });
  const MODS = {
    drink: { _id: "drink", isActive: true, min: 1, max: 1, constituentItems: [opt("cola", true), opt("lime", true)] },
    sauce: { _id: "sauce", isActive: true, min: 1, max: 1, constituentItems: [opt("hot", true), opt("mild")] },
  };
  const MEAL = { id: "e-meal", name: "Taco Meal", price: 9, modifiers: ["drink"], outOfStock: false };
  const BURRITO = { id: "e-burrito", name: "Burrito", price: 5, modifiers: ["sauce"], outOfStock: false };
  // The dead Large first: Select a Size moves it last.
  const SODA = {
    id: "e-soda",
    name: "Soda",
    price: 2,
    hasVariant: true,
    isVariant: false,
    outOfStock: false,
    variants: [
      { id: "soda-l", name: "Large", price: 3, isActive: true, modifiers: ["drink"] },
      { id: "soda-r", name: "Regular", price: 2, isActive: true, modifiers: [] },
    ],
  };
  // One size, and its own required drink is out: no size left to complete.
  const NACHOS = {
    id: "e-nachos",
    name: "Nachos",
    price: 4,
    hasVariant: true,
    isVariant: false,
    outOfStock: false,
    variants: [{ id: "nachos-r", name: "Regular", price: 4, isActive: true, modifiers: ["drink"] }],
  };

  beforeEach(() => {
    mockFetchMenu.mockReset();
    mockFetchMenu.mockReturnValue(new Promise(() => {}));
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: MODS }));
    store.dispatch(
      setMenuData({
        menu: { categories: [{ id: "c1", name: "Mains", subCategories: [{ id: "s1", name: "Mains", entities: [MEAL, BURRITO, SODA, NACHOS] }] }] },
      })
    );
  });

  it("a sized item with no size left to complete is the sold-out card — no '+', nothing to tap; PAY's map brings a drink back and it is live", () => {
    renderMenu();

    const nachos = screen.getByTestId("item-e-nachos");
    expect(nachos).toHaveAttribute("aria-disabled", "true");
    expect(nachos).toHaveTextContent(i18n.t("menu.unavailable"));
    expect(within(nachos).queryAllByRole("button")).toHaveLength(0);

    act(() => {
      store.dispatch(setOutOfStockItems({ cola: { type: "combo", inStock: true } }));
    });
    expect(screen.getByTestId("item-e-nachos")).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("quick-add-e-nachos")).toBeInTheDocument();
  });

  it("the meal (its required drink: every option out) is the sold-out card — aria-disabled, Unavailable, nothing to tap; the burrito (one sauce left) is live", () => {
    renderMenu();

    const meal = screen.getByTestId("item-e-meal");
    expect(meal).toHaveAttribute("aria-disabled", "true");
    expect(meal).toHaveTextContent(i18n.t("menu.unavailable"));
    expect(within(meal).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("item-e-burrito")).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("quick-add-e-burrito")).toBeInTheDocument();
  });

  it("re-evaluated live: PAY's map takes the burrito's last sauce — its card goes Unavailable; the map clears — it is back", () => {
    renderMenu();

    act(() => {
      store.dispatch(setOutOfStockItems({ mild: { type: "addon", inStock: false } }));
    });
    expect(screen.getByTestId("item-e-burrito")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByTestId("quick-add-e-burrito")).not.toBeInTheDocument();

    act(() => {
      store.dispatch(setOutOfStockItems({}));
    });
    expect(screen.getByTestId("item-e-burrito")).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("quick-add-e-burrito")).toBeInTheDocument();
  });

  it("a sized item: '+' opens Select a Size with the Large (its own required drink out) greyed — disabled, named unavailable, last — and the Regular pickable", () => {
    renderMenu();

    fireEvent.click(screen.getByTestId("quick-add-e-soda"));

    expect(screen.getByTestId("select-size-modal")).toBeInTheDocument();
    const large = screen.getByTestId("size-soda-l");
    expect(large).toBeDisabled();
    expect(large).toHaveAccessibleName(i18n.t("pdp.optionUnavailable", { name: "Large" }));
    expect(screen.getByTestId("size-soda-r")).toBeEnabled();
    expect(screen.getAllByTestId(/^size-soda-/).map((node) => node.dataset.testid)).toEqual(["size-soda-r", "size-soda-l"]);
  });

  it("a sized item's card tap: the PDP's session carries the Large out of stock (its size grid greys it), the Regular in", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Soda" }));

    const session = tier1CustomizationSelectedEntity(store.getState()) as {
      variants?: { id: string; outOfStock?: boolean }[];
    };
    expect(session?.variants?.map((size) => [size.id, size.outOfStock === true])).toEqual([
      ["soda-l", true],
      ["soda-r", false],
    ]);
  });
});
