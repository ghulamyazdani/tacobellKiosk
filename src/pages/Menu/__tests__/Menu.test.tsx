import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  emptyMenuData,
  setEntityMap,
  setMenuData,
} from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  setEnableAccessibilityMode,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import {
  setSelectedPipeline,
  setTabType,
} from "@cx-sdk/catalog/state/pipeline.slice";
import { setSelectedTabId } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import { mutateAddToCartModal } from "../../../redux/features/menuSelections/menuSelections.slice";
import Menu from "../index";
import i18n from "../../../i18n";

const { mockFetchMenu, mockNavigate } = vi.hoisted(() => ({
  mockFetchMenu: vi.fn(),
  mockNavigate: vi.fn(),
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

const renderMenu = (options: { reactStrictMode?: boolean } = {}) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <Menu />
      </MemoryRouter>
    </Provider>,
    options
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

  it("renders item cards with price + calories; NEW/badged items get the hero card", () => {
    renderMenu();
    const hero = screen.getByTestId("item-e-new");
    expect(hero).toHaveTextContent("Beefy Fries Box");
    expect(hero).toHaveTextContent("5.99");
    expect(hero).toHaveTextContent("740 Cal");
    expect(hero.className).toContain("col-span-2"); // hero treatment
    expect(screen.getByTestId("item-e-plain").className).not.toContain("col-span-2");
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
    expect(screen.getByTestId("cta-total")).toHaveTextContent("0.00");
    expect(screen.getByTestId("cta-view-bag")).toHaveTextContent("(0)");
  });

  it("empty menu shows the loading state (while it refetches) instead of a blank pane", () => {
    store.dispatch({ type: "RESET_STATE" });
    renderMenu();
    expect(screen.getByText(/menu is loading/i)).toBeInTheDocument();
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
