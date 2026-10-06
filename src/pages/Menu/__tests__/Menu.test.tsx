import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { emptyMenuData, setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  setSelectedPipeline,
  setTabType,
} from "@cx-sdk/catalog/state/pipeline.slice";
import { setSelectedTabId } from "@cx-sdk/core/auth/authentication.slice";
import { store } from "../../../redux/app/store";
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
