import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setEntityMap, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setReccomendationCategoryMap } from "@cx-sdk/catalog/state/recommendation.slice";
import { store } from "../../../redux/app/store";
import useCartUpsell from "../../../hooks/menuHooks/useCartUpsell";
import CompleteYourMealRail from "../CompleteYourMealRail";
import YouMightLikeRail from "../../customization/YouMightLikeRail";
import i18n from "../../../i18n";

/*
  UB6 Fix B: the rail offers what the MENU sells, in the menu's shape. An item
  whose groups are all dead (missing or inactive) is a one-tap add that stays
  in the bag; a pack whose groups are all dead is not offered (the menu drops
  it); an item with a live group still opens the PDP. Before the fix the rail
  read the raw pre-conversion entityMap: the dead pack was offered and the
  dead-group item opened the PDP, where it crashed.
*/
const ENTITIES = {
  fries: { id: "fries", name: "Large Fries", price: 9, isActive: true, isCartRecommended: true, modifiers: ["gone_addons"] },
  box: { id: "box", name: "Dream box", price: 25, isActive: true, isCartRecommended: true, modifiers: ["box_1_combo", "gone_combo"] },
  burger: { id: "burger", name: "Cheese Burger", price: 8, isActive: true, isCartRecommended: true, modifiers: ["burger_addons", "gone_addons"] },
  salad: { id: "salad", name: "Greek Salad", price: 17, isActive: true },
};
const GROUPS = {
  burger_addons: { _id: "burger_addons", isActive: true },
  box_1_combo: { _id: "box_1_combo", isActive: false },
};
const SALAD_ROW = { id: "salad", itemId: "s-1", name: "Greek Salad", quantity: 1, type: "ITEM", total_price: 17 };
const PDP = "pdp-sentinel";

const renderRail = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <Routes>
          <Route path="/cart" element={<CompleteYourMealRail />} />
          <Route path="/customization" element={<p>{PDP}</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
const railIds = () =>
  screen.queryAllByTestId(/^bag-rail-item-/).map((card) => card.getAttribute("data-testid")?.replace("bag-rail-item-", ""));
const rows = () =>
  (store.getState() as unknown as { cart: { cartItems: Array<{ id: string; type: string }> } }).cart.cartItems;

const seedBag = (tenant: boolean) => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setEntityMap({ entityMap: ENTITIES }));
  store.dispatch(setModifiersMap({ modifiersMap: GROUPS }));
  store.dispatch(setCartItems([SALAD_ROW]));
  if (tenant) {
    store.dispatch(
      setReccomendationCategoryMap({
        salad: {
          baseItem_id: "salad",
          refers: ["fries", "box", "burger"].map((id, i) => ({ refer_baseItem_id: id, occurrences: 9 - i })),
        },
      })
    );
  }
};

describe.each([
  ["flagged (isCartRecommended) source", false],
  ["tenant (S3) source", true],
])("CompleteYourMealRail — dead modifier groups (UB6), %s", (_label, tenant) => {
  beforeEach(() => seedBag(tenant));

  it("hides the dead pack; the dead-group item is a 'Quick add' that adds an ITEM row and stays on /cart", () => {
    renderRail();

    expect(railIds()).not.toContain("box");
    expect(railIds()).toEqual(expect.arrayContaining(["fries", "burger"]));
    expect(screen.getByTestId("bag-rail-item-fries")).toHaveAccessibleName(`${i18n.t("menu.quickAdd")} Large Fries`);

    fireEvent.click(screen.getByTestId("bag-rail-item-fries"));

    expect(rows().map((row) => [row.id, row.type])).toEqual([
      ["salad", "ITEM"],
      ["fries", "ITEM"],
    ]);
    expect(screen.queryByText(PDP)).not.toBeInTheDocument();
    expect(screen.getByTestId("bag-rail")).toBeInTheDocument();
  });

  it("an item with a live group still opens the PDP", () => {
    renderRail();

    fireEvent.click(screen.getByTestId("bag-rail-item-burger"));

    expect(screen.getByText(PDP)).toBeInTheDocument();
    expect(rows().map((row) => row.id)).toEqual(["salad"]);
  });
});

describe("the same menu on the other surfaces that share these selectors (UB6)", () => {
  it("the flagged source's suppression telemetry (getBreakdown) counts what the menu sells", () => {
    seedBag(false);
    const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

    const { result } = renderHook(() => useCartUpsell(), { wrapper });

    // fries (one-tap) + burger (live group); the dead pack is not on the menu.
    expect(result.current.getBreakdown()).toMatchObject({ flagged: 2, eligible: 2, needs_customization: 1 });
  });

  it("the PDP You Might Like rail offers the dead-group item as the menu's one-tap add, never the dead pack", () => {
    seedBag(true);
    render(
      <Provider store={store}>
        <MemoryRouter>
          <YouMightLikeRail entityId="salad" />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByTestId("pdp-rail-item-fries")).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-rail-item-box")).not.toBeInTheDocument();
  });
});
