/**
 * `<Customization embedded/>` — the PDP hosted IN PLACE inside the bag by
 * OfferTierHost for an offer freebie (isGetItem) or a buy-stage item
 * (isBuyStageItem) tier session (lane "offers", item 32). It must never
 * navigate (hazard H1), render no footer strip / CANCEL ORDER / language
 * sheet, and a freebie's CTA makes no price claim.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  closeMakeItAMealSession,
  makeItAMealIsSessionOpen,
  openComboConstutientCustomizations,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import "../../../i18n";

const PICKLE_GROUP = {
  _id: "pickle_group",
  name: "Extras",
  min: 0,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "pickles", name: "Extra Pickles", price: 1, isActive: true }],
};

const BURGER = {
  id: "cheese-burger",
  name: "Cheese Burger",
  price: 9,
  modifiers: ["pickle_group"],
  hasVariant: false,
  quantity: 1,
  hasSecondTier: false,
};
const FREEBIE_BURGER = { ...BURGER, isGetItem: true, type: "CUSTOMIZABLE" };
const BUY_STAGE_BURGER = { ...BURGER, isBuyStageItem: true };
const FREEBIE_DRINK = {
  id: "drink",
  name: "Drink",
  price: 0,
  hasVariant: true,
  quantity: 1,
  isGetItem: true,
  type: "VARIANT",
  variants: [
    { id: "small", name: "Small", price: 2, isActive: true },
    { id: "medium", name: "Medium", price: 3, isActive: true },
    // The sameOrLess ceiling flags sizes dearer than the bought item.
    { id: "large", name: "Large", price: 4, isActive: true, isGetVariantDisabled: true },
  ],
};

const seedTier = (selectedEntity: object, type = "customizableItem") => {
  store.dispatch(openComboConstutientCustomizations());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type, openType: "new", editCustomizationContent: {} },
      selectedEntity,
    })
  );
};

const LocationProbe = () => <span data-testid="location">{useLocation().pathname}</span>;

const renderPdp = (embedded: boolean, path: string) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Customization embedded={embedded} />
        <LocationProbe />
      </MemoryRouter>
    </Provider>
  );

const sessionOpen = () => Boolean(makeItAMealIsSessionOpen(store.getState()));
const location = () => screen.getByTestId("location").textContent;

describe("Customization embedded (in-bag PDP for offer tier sessions)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the hook's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: { pickle_group: PICKLE_GROUP } }));
    store.dispatch(setCartItems([{ id: "taco", itemId: "taco-1", quantity: 1, type: "ITEM", total_price: 5 }]));
  });

  it("a session close never navigates: BACK and an external close both leave the router at /cart", async () => {
    seedTier(FREEBIE_BURGER);
    renderPdp(true, "/cart");
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("pdp-back"));
    expect(sessionOpen()).toBe(false);
    expect(screen.queryByTestId("customization-screen")).not.toBeInTheDocument();
    expect(location()).toBe("/cart");

    // The bag closing mid-tier: the guard effect sees no session — and stays put.
    act(() => seedTier(FREEBIE_BURGER));
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
    act(() => void store.dispatch(closeMakeItAMealSession()));
    expect(screen.queryByTestId("customization-screen")).not.toBeInTheDocument();
    expect(location()).toBe("/cart");
  });

  it("control: the ROUTE PDP's no-session guard still bounces (only `embedded` turns it off)", () => {
    renderPdp(false, "/customization");
    expect(location()).toBe("/menu");
  });

  it("renders no footer strip, no CANCEL ORDER and no language selector; the root says data-embedded", () => {
    seedTier(FREEBIE_BURGER);
    renderPdp(true, "/cart");
    expect(screen.getByTestId("customization-screen")).toHaveAttribute("data-embedded", "true");
    for (const id of ["footer-cancel", "footer-ada", "footer-language"]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  });

  it("control: the route PDP keeps its footer strip and carries no data-embedded", () => {
    seedTier(BURGER);
    renderPdp(false, "/customization");
    expect(screen.getByTestId("customization-screen")).not.toHaveAttribute("data-embedded");
    expect(screen.getByTestId("footer-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("footer-language")).toBeInTheDocument();
  });

  it("a freebie has no qty stepper and its CTA makes no price claim ('ADD TO REWARD', no '£')", () => {
    seedTier(FREEBIE_BURGER);
    renderPdp(true, "/cart");
    for (const id of ["pdp-qty", "pdp-qty-decrease", "pdp-qty-increase"]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    const cta = screen.getByTestId("pdp-add-to-bag");
    expect(cta).toHaveTextContent("ADD TO REWARD");
    expect(cta.textContent).not.toContain("£");
  });

  it("a buy-stage item keeps the stepper and the priced CTA (it is a paid row)", () => {
    seedTier(BUY_STAGE_BURGER);
    renderPdp(true, "/cart");
    expect(screen.getByTestId("pdp-qty")).toHaveTextContent("1");
    expect(screen.getByTestId("pdp-qty-increase")).toBeInTheDocument();
    const cta = screen.getByTestId("pdp-add-to-bag");
    expect(cta).toHaveTextContent("Add to bag");
    expect(cta).toHaveTextContent("£9.00");
  });

  it("isGetVariantDisabled sizes are hidden from the size picker", () => {
    seedTier(FREEBIE_DRINK, "variant");
    renderPdp(true, "/cart");
    expect(screen.getByTestId("pdp-variant-small")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-variant-medium")).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-variant-large")).not.toBeInTheDocument();
  });
});
