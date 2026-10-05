/* eslint-disable @typescript-eslint/no-explicit-any --
 * Menu-entity / cart-row fixtures mirror the untyped legacy converters and
 * slices. Typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  makeItAMealIsSessionOpen,
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import {
  setCurrency,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import "../../../i18n";

/*
  P9c (A6): Figma 1:2614 / 1:2920 / 1:5413 draw the "Footer bottom" strip
  (CANCEL ORDER · ADA DISPLAY · language) under the PDP's CTA bar in BOTH
  modes — without it an ADA guest on the PDP could neither leave the view nor
  cancel.

  CANCEL ORDER is the hazard-H1 path: /customization has a no-session guard,
  so resetting HERE first would close the tier-1 session while this route is
  still rendered and bounce the guest to the return path instead of the
  splash. Confirm must ONLY navigate; /start's mount owns revoke + reset. The
  routes are real so the landing screen is observable.
*/

const SAUCE_GROUP = {
  _id: "pdp_sauce",
  name: "Sauces",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "salsa", name: "Salsa", price: 0.5, isActive: true }],
};

const BURGER = {
  id: "cheese-burger",
  name: "Cheese Burger",
  price: 8,
  modifiers: [SAUCE_GROUP._id],
};

/** Already in the bag — what a reset would wipe. */
const TACO_ROW = {
  id: "taco",
  itemId: "taco-1",
  name: "Crunchy Taco",
  quantity: 1,
  type: "ITEM",
  total_price: 2,
};

const seedPdp = () => {
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: { pdp_sauce: SAUCE_GROUP } }));
  store.dispatch(setCartItems([{ ...TACO_ROW }]));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: {
        isOpen: true,
        status: "",
        type: "customizableItem",
        openType: "new",
        editCustomizationContent: {},
      },
      selectedEntity: BURGER,
    })
  );
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Routes>
          <Route path="/customization" element={<Customization />} />
          <Route path="/start" element={<div>start-screen</div>} />
          <Route path="/menu" element={<div>menu-screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

const state = () => store.getState() as any;
const tap = (testId: string) => fireEvent.click(screen.getByTestId(testId));

describe("PDP footer strip (P9c — Figma 1:2614 / 1:5413)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the hook's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    seedPdp();
  });

  it("normal mode: CANCEL ORDER, ADA DISPLAY and the language selector sit under the ADD TO BAG bar", () => {
    renderPdp();

    const addToBag = screen.getByTestId("pdp-add-to-bag");
    for (const id of ["footer-cancel", "footer-ada", "footer-language"]) {
      const control = screen.getByTestId(id);
      expect(
        addToBag.compareDocumentPosition(control) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    expect(screen.getByTestId("footer-ada")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("ADA: the same strip on a page sized by the reach zone, and the toggle gets the guest back out", () => {
    store.dispatch(toggleAccessibilityMode());
    renderPdp();

    expect(screen.getByTestId("customization-screen").className).toContain(
      "h-full"
    );
    expect(screen.getByTestId("footer-ada")).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    tap("footer-ada");

    expect(state().appSettings.accessibilityMode).toBe(false);
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
  });

  it("CANCEL ORDER asks first; NO keeps the guest on the PDP with the session intact", () => {
    renderPdp();

    tap("footer-cancel");
    expect(screen.getByTestId("cancel-order-modal")).toBeInTheDocument();

    tap("cancel-order-cancel");
    expect(screen.queryByTestId("cancel-order-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
    expect(makeItAMealIsSessionOpen(state())).toBe(true);
  });

  it("CANCEL ORDER → confirm ONLY navigates to /start: nothing is reset on the PDP (hazard H1)", () => {
    store.dispatch(toggleAccessibilityMode());
    renderPdp();

    tap("footer-cancel");
    tap("cancel-order-confirm");

    expect(screen.getByText("start-screen")).toBeInTheDocument();
    expect(screen.queryByText("menu-screen")).not.toBeInTheDocument();
    // Untouched — /start's mount revokes, then runs resetSession("full"),
    // which is also what closes ADA.
    expect(makeItAMealIsSessionOpen(state())).toBe(true);
    expect(state().cart.cartItems).toHaveLength(1);
    expect(state().appSettings.accessibilityMode).toBe(true);
  });

  it("the language selector opens the language sheet", () => {
    renderPdp();

    tap("footer-language");

    expect(screen.getByTestId("language-sheet")).toBeInTheDocument();
  });
});
