/* eslint-disable @typescript-eslint/no-explicit-any --
 * Entity-map fixtures mirror the untyped converted-menu entities the engine
 * consumes; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setEntityMap, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  setCurrency,
  setKioskSettings,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setReccomendationCategoryMap } from "@cx-sdk/catalog/state/recommendation.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import { selectAddToCartModal } from "../../../redux/features/menuSelections/menuSelections.slice";
import { resolveEntityImage } from "../../../utils/entityImage";
import CompleteYourMealRail from "../CompleteYourMealRail";
import i18n from "../../../i18n";

// The real lookup, watched: a rail card resolves its photo once per render
// (perf BAG-8 counts card renders by it).
vi.mock("../../../utils/entityImage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils/entityImage")>();
  return { ...actual, resolveEntityImage: vi.fn(actual.resolveEntityImage) };
});

/** Converted-menu entityMap — only `isCartRecommended: true` entities count. */
const ENTITY_MAP = {
  fries: {
    id: "fries",
    name: "Large Fries",
    price: 2.5,
    calorieCount: 360,
    isActive: true,
    isCartRecommended: true,
  },
  pepsi: {
    id: "pepsi",
    name: "Pepsi",
    price: 3,
    isActive: true,
    isCartRecommended: true,
  },
  // Flagged but inactive → engine drops it.
  churros: {
    id: "churros",
    name: "Churros",
    price: 5,
    isActive: false,
    isCartRecommended: true,
  },
  // Not flagged → never offered.
  burger: { id: "burger", name: "Cheese Burger", price: 8, isActive: true },
};

const renderRail = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <CompleteYourMealRail />
      </MemoryRouter>
    </Provider>
  );

describe("CompleteYourMealRail (locked decision 6 — source-2 isCartRecommended engine)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  });

  it("renders null with no entityMap at all", () => {
    renderRail();
    expect(screen.queryByTestId("bag-rail")).not.toBeInTheDocument();
  });

  it("renders null when no entity carries isCartRecommended", () => {
    store.dispatch(
      setEntityMap({ entityMap: { burger: ENTITY_MAP.burger } } as any)
    );
    renderRail();
    expect(screen.queryByTestId("bag-rail")).not.toBeInTheDocument();
  });

  it("flagged entities render as rail cards; unflagged and inactive ones never do", () => {
    store.dispatch(setEntityMap({ entityMap: ENTITY_MAP } as any));
    renderRail();
    const rail = screen.getByTestId("bag-rail");
    expect(rail).toBeInTheDocument();
    expect(screen.getByTestId("bag-rail-item-fries")).toHaveTextContent(
      "Large Fries"
    );
    // posistKiosk's moduloCalcaledValue: a fraction to two decimals.
    expect(screen.getByTestId("bag-rail-item-fries")).toHaveTextContent("£2.50");
    expect(screen.getByTestId("bag-rail-item-pepsi")).toBeInTheDocument();
    expect(screen.queryByTestId("bag-rail-item-burger")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("bag-rail-item-churros")
    ).not.toBeInTheDocument();
  });

  it("entities already in the cart are filtered out of the rail", () => {
    store.dispatch(setEntityMap({ entityMap: ENTITY_MAP } as any));
    store.dispatch(
      setCartItems([
        {
          id: "fries",
          itemId: "fries-1",
          name: "Large Fries",
          quantity: 1,
          type: "ITEM",
          total_price: 2.5,
        },
      ])
    );
    renderRail();
    expect(screen.queryByTestId("bag-rail-item-fries")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-rail-item-pepsi")).toBeInTheDocument();
  });

  it("renders null when EVERY eligible entity is already in the cart (a rail that can render empty is a broken rail)", () => {
    store.dispatch(
      setEntityMap({
        entityMap: { fries: ENTITY_MAP.fries, pepsi: ENTITY_MAP.pepsi },
      } as any)
    );
    store.dispatch(
      setCartItems([
        {
          id: "fries",
          itemId: "fries-1",
          name: "Large Fries",
          quantity: 1,
          type: "ITEM",
          total_price: 2.5,
        },
        {
          id: "pepsi",
          itemId: "pep-1",
          name: "Pepsi",
          quantity: 1,
          type: "ITEM",
          total_price: 3,
        },
      ])
    );
    renderRail();
    expect(screen.queryByTestId("bag-rail")).not.toBeInTheDocument();
  });

  it("out-of-stock flagged entities are dropped by the engine", () => {
    store.dispatch(
      setEntityMap({
        entityMap: {
          fries: { ...ENTITY_MAP.fries, outOfStock: true },
          pepsi: ENTITY_MAP.pepsi,
        },
      } as any)
    );
    renderRail();
    expect(screen.queryByTestId("bag-rail-item-fries")).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-rail-item-pepsi")).toBeInTheDocument();
  });
});

/*
  Post-P9 29a — the tenant (S3) co-purchase list for THIS cart comes first,
  ranked by summed occurrences; with no tenant match the rail falls back to
  the flagged (isCartRecommended) list; `enable_cart_upsell_screen: false`
  hides BOTH (D7, TB semantics). 28: card titles are resolved at render.
*/
describe("CompleteYourMealRail — tenant recommendations first (post-P9 29a)", () => {
  const TENANT_ENTITIES = {
    ...ENTITY_MAP,
    salad: { id: "salad", name: "Greek Salad", price: 4, isActive: true },
    nachos: { id: "nachos", name: "Nachos", price: 3.5, isActive: true },
  };
  /** burger → nachos ×5, salad ×2, fries ×1 (fries is flagged too). */
  const TENANT_MAP = {
    burger: {
      baseItem_id: "burger",
      refers: [
        { refer_baseItem_id: "salad", occurrences: 2 },
        { refer_baseItem_id: "nachos", occurrences: 5 },
        { refer_baseItem_id: "fries", occurrences: 1 },
      ],
    },
  };
  const BURGER_ROW = {
    id: "burger",
    itemId: "b-1",
    name: "Cheese Burger",
    quantity: 1,
    type: "ITEM",
    total_price: 8,
  };
  const railIds = () =>
    screen
      .queryAllByTestId(/^bag-rail-item-/)
      .map((card) => card.getAttribute("data-testid")?.replace("bag-rail-item-", ""));

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setEntityMap({ entityMap: TENANT_ENTITIES }));
    store.dispatch(setCartItems([BURGER_ROW]));
  });

  it("the tenant list beats the flagged list, ordered by occurrences", () => {
    store.dispatch(setReccomendationCategoryMap(TENANT_MAP));
    renderRail();

    expect(railIds()).toEqual(["nachos", "salad", "fries"]);
    expect(screen.queryByTestId("bag-rail-item-pepsi")).not.toBeInTheDocument(); // flagged, not referred
  });

  it("an empty tenant map falls back to the flagged list", () => {
    store.dispatch(setReccomendationCategoryMap({}));
    renderRail();

    expect(railIds()).toEqual(["fries", "pepsi"]);
  });

  it("a tenant map with nothing for THIS cart falls back to the flagged list too", () => {
    store.dispatch(
      setReccomendationCategoryMap({
        taco: { baseItem_id: "taco", refers: [{ refer_baseItem_id: "salad", occurrences: 9 }] },
      })
    );
    renderRail();

    expect(railIds()).toEqual(["fries", "pepsi"]);
  });

  it("enable_cart_upsell_screen: false hides both sources (D7)", () => {
    store.dispatch(setReccomendationCategoryMap(TENANT_MAP));
    store.dispatch(setKioskSettings({ enable_cart_upsell_screen: false }));
    renderRail();

    expect(screen.queryByTestId("bag-rail")).not.toBeInTheDocument();
  });

  it("enable_cart_upsell_screen: false with no tenant map hides the flagged list as before", () => {
    store.dispatch(setKioskSettings({ enable_cart_upsell_screen: false }));
    renderRail();

    expect(screen.queryByTestId("bag-rail")).not.toBeInTheDocument();
  });

  it("the tenant list shows on a menu with NO flagged entity (the flagged source's gate never hides it)", () => {
    store.dispatch(
      setEntityMap({
        entityMap: {
          burger: TENANT_ENTITIES.burger,
          salad: TENANT_ENTITIES.salad,
          nachos: TENANT_ENTITIES.nachos,
        },
      })
    );
    store.dispatch(setReccomendationCategoryMap(TENANT_MAP));
    renderRail();

    expect(railIds()).toEqual(["nachos", "salad"]); // fries is not on this menu
  });
});

describe("CompleteYourMealRail — card titles in the guest's language (post-P9 28)", () => {
  const FSI = "\u2068";
  const PDI = "\u2069";
  const iso = (s: string) => `${FSI}${s}${PDI}`;
  const AR_FRIES = "بطاطس كبيرة";

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(
      setEntityMap({
        entityMap: {
          fries: { ...ENTITY_MAP.fries, aliases: [{ value: AR_FRIES, name: "Arabic", code: "ar" }] },
        },
      })
    );
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("Arabic: the card shows the alias and is named by verb + title (label-in-name)", async () => {
    store.dispatch(
      setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" })
    );
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderRail();
    const card = screen.getByTestId("bag-rail-item-fries");

    expect(card).toHaveTextContent(iso(AR_FRIES), { normalizeWhitespace: false });
    expect(card).not.toHaveTextContent("Large Fries");
    expect(card).toHaveAccessibleName(`${i18n.t("menu.quickAdd")} ${iso(AR_FRIES)}`);
  });

  it("English: the plain name", () => {
    renderRail();

    expect(screen.getByTestId("bag-rail-item-fries")).toHaveAccessibleName(
      `${i18n.t("menu.quickAdd")} Large Fries`
    );
  });
});

/*
  figma-polish residual R6 — a card is named by what its TAP does: the
  classifier addEntity runs (the PDP rail's convention), never the
  isOneTapAddable stamp. With enable_combo_upsell on, a plain item carrying
  upsellItems is stamped "not one tap", yet the tap adds it at once (TB's raw
  upsellItems are ids, which the tag filter drops, so no MIAM prompt opens):
  it was announced "Customize" for a tap that adds.
*/
describe("CompleteYourMealRail — a card is named by what its tap does (R6)", () => {
  const rows = () =>
    (store.getState() as unknown as { cart: { cartItems: { id: string }[] } }).cart.cartItems.map((row) => row.id);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setKioskSettings({ enable_combo_upsell: true }));
    store.dispatch(setModifiersMap({ modifiersMap: { fries_addons: { _id: "fries_addons", isActive: true } } }));
    store.dispatch(
      setEntityMap({
        entityMap: {
          pepsi: { ...ENTITY_MAP.pepsi, upsellItems: ["pepsi-combo"] },
          fries: { ...ENTITY_MAP.fries, modifiers: ["fries_addons"] },
        },
      })
    );
  });

  it("a one-tap item with upsellItems is 'Quick add' — and the tap adds it, the rail staying", () => {
    renderRail();
    const card = screen.getByTestId("bag-rail-item-pepsi");

    expect(card).toHaveAccessibleName(`${i18n.t("menu.quickAdd")} Pepsi`);
    fireEvent.click(card);
    expect(rows()).toEqual(["pepsi"]);
    expect(screen.getByTestId("bag-rail")).toBeInTheDocument();
  });

  it("an item whose tap opens a chooser keeps 'Customize'", () => {
    renderRail();

    expect(screen.getByTestId("bag-rail-item-fries")).toHaveAccessibleName(`${i18n.t("pack.customize")} Large Fries`);
  });
});

/*
  Every menu add opens the product-added modal now (user 2026-10-14), so the
  rail's suppressAddedModal is all that keeps a plain rail add from opening
  it: under the open bag (both z-40, the modal mounted first), arming the
  500 ms tap guard over the bag, then greeting the guest on /menu when the bag
  closes (round 1's stale modal, walk bag_offers 8). In the bag the row is the
  confirmation. The +1 branch is out of this rail's reach: a card in the bag
  never shows (the in-cart filter tests above).
*/
describe("CompleteYourMealRail — a plain add confirms by its row, never the added modal", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    store.dispatch(setEntityMap({ entityMap: { pepsi: ENTITY_MAP.pepsi } }));
  });

  it("a plain card's tap lands its row and leaves the modal shut", () => {
    renderRail();
    fireEvent.click(screen.getByTestId("bag-rail-item-pepsi"));

    expect(
      (store.getState() as unknown as { cart: { cartItems: unknown[] } }).cart.cartItems
    ).toEqual([expect.objectContaining({ id: "pepsi", quantity: 1 })]);
    expect(selectAddToCartModal(store.getState())).toBe(false);
  });
});

/*
  Perf BAG-8 — the rail re-renders on every cart write (selectCart), and the
  memoized ForYouCard can skip only with a stable onAdd. A write or a new
  onDetour that leaves a card's props alone renders no card; the currency
  moving renders each; a tap runs the LATEST handler (today's onDetour).
*/
describe("CompleteYourMealRail — a cart write re-renders no card (perf BAG-8)", () => {
  const BURGER_ROW = { id: "burger", itemId: "b-1", name: "Cheese Burger", quantity: 1, type: "ITEM", price: 8, total_price: 8 };
  const cardRenders = (id: string) =>
    vi.mocked(resolveEntityImage).mock.calls.filter(([entity]) => (entity as { id?: string } | null)?.id === id)
      .length;
  const ui = (onDetour: () => void) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <CompleteYourMealRail onDetour={onDetour} />
      </MemoryRouter>
    </Provider>
  );

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
    // Fries opens a chooser (a live group), so its tap leaves through onDetour.
    store.dispatch(setModifiersMap({ modifiersMap: { fries_addons: { _id: "fries_addons", isActive: true } } }));
    store.dispatch(
      setEntityMap({
        entityMap: { fries: { ...ENTITY_MAP.fries, modifiers: ["fries_addons"] }, pepsi: ENTITY_MAP.pepsi },
      })
    );
  });

  it("a cart write or a parent re-render renders no card; the currency renders each; a tap calls the latest onDetour", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(ui(first));
    expect(cardRenders("fries")).toBeGreaterThan(0);
    vi.mocked(resolveEntityImage).mockClear();

    act(() => {
      store.dispatch(setCartItems([BURGER_ROW]));
    });
    view.rerender(ui(latest));
    expect(cardRenders("fries")).toBe(0);
    expect(cardRenders("pepsi")).toBe(0);

    act(() => {
      store.dispatch(setCurrency({ currency: "USD", text: "$" }));
    });
    expect(screen.getByTestId("bag-rail-item-fries")).toHaveTextContent("$2.50");
    expect(cardRenders("fries")).toBe(1);
    expect(cardRenders("pepsi")).toBe(1);

    fireEvent.click(screen.getByTestId("bag-rail-item-fries"));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
