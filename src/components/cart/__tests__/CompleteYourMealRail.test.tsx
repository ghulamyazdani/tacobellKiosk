/* eslint-disable @typescript-eslint/no-explicit-any --
 * Entity-map fixtures mirror the untyped converted-menu entities the engine
 * consumes; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setEntityMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  setCurrency,
  setKioskSettings,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setReccomendationCategoryMap } from "@cx-sdk/catalog/state/recommendation.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import CompleteYourMealRail from "../CompleteYourMealRail";
import i18n from "../../../i18n";

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
    store.dispatch(setCurrency({ symbol: "£" }));
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
    expect(screen.getByTestId("bag-rail-item-fries")).toHaveTextContent("£2.5");
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
    store.dispatch(setCurrency({ symbol: "£" }));
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
    store.dispatch(setCurrency({ symbol: "£" }));
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
