import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import i18n from "../../../i18n";

/*
  P9f on the PDP: the calories (§2.6) and the multi-punch stepper names go
  through i18n (EN byte-identical, never "Cal" in AR), and "Show more" is a
  44 px toggle OUTSIDE the line-clamped description — inside it, a long
  description clipped the only control that reveals the rest.
*/

const EXTRAS = {
  _id: "pdp_extras",
  name: "Extras",
  min: 0,
  max: 3,
  multiplePunchMin: 0,
  multiplePunchMax: 3,
  multiplePunchMaxItem: 3, // > 1 → stepper rows
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "pickles", name: "Extra Pickles", price: 0, isActive: true },
    { id: "jalapenos", name: "Jalapenos", price: 0.6, isActive: true },
  ],
};

const DESCRIPTION = "Seasoned beef, nacho cheese sauce and crunchy shell in a warm grilled tortilla";

const BURGER = {
  id: "cheese-burger",
  name: "Cheese Burger",
  price: 8,
  calorieCount: 740,
  description: DESCRIPTION,
  modifiers: [EXTRAS._id],
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Routes>
          <Route path="/customization" element={<Customization />} />
          <Route path="/menu" element={<div>menu-screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

describe("PDP copy and controls (P9f)", () => {
  beforeAll(() => {
    // jsdom has no Element.scrollTo; the hook's autoscroll paths call it.
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    store.dispatch(setModifiersMap({ modifiersMap: { [EXTRAS._id]: EXTRAS } }));
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
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("EN is unchanged: '£8.00 | 740 Cal', the free row reads '0 Cal'", () => {
    renderPdp();

    expect(screen.getByText("£8.00 | 740 Cal")).toBeInTheDocument();
    expect(screen.getByText("0 Cal")).toBeInTheDocument();
    expect(screen.getByText("+£0.60")).toBeInTheDocument();
  });

  it("AR — switched on the PDP itself — renders t('pack.cal') for the price line and the free row, never 'Cal'", async () => {
    renderPdp();
    expect(screen.getByText("£8.00 | 740 Cal")).toBeInTheDocument();

    // The PDP mounts its own LanguageSheet: the memoised price line must follow t.
    await act(async () => {
      await i18n.changeLanguage("ar");
    });

    const priceLine = screen.getByText(`£8.00 | ${i18n.t("pack.cal", { value: 740 })}`);
    const freeRow = screen.getByText(i18n.t("pack.cal", { value: 0 }));
    expect(priceLine).not.toHaveTextContent("Cal");
    expect(freeRow).not.toHaveTextContent("Cal");
  });

  it.each(["en", "ar"])("%s: the multi-punch steppers are named t('pdp.decrease'/'pdp.increase') + the item", async (lng) => {
    await act(async () => {
      await i18n.changeLanguage(lng);
    });
    renderPdp();

    const increase = screen.getByRole("button", { name: `${i18n.t("pdp.increase")} Extra Pickles` });
    const decrease = screen.getByRole("button", { name: `${i18n.t("pdp.decrease")} Extra Pickles` });
    expect(decrease.nextElementSibling).toHaveTextContent(/^0$/);

    fireEvent.click(increase);
    expect(decrease.nextElementSibling).toHaveTextContent(/^1$/);
    fireEvent.click(decrease);
    expect(decrease.nextElementSibling).toHaveTextContent(/^0$/);
  });

  it("Show more sits after the clamped description (never inside it), is ≥44 px, and toggles the label AND the clamp", () => {
    renderPdp();

    const description = screen.getByText(DESCRIPTION);
    const toggle = screen.getByTestId("pdp-show-more");
    expect(description.tagName).toBe("P");
    expect(description).not.toContainElement(toggle);
    expect(description.nextElementSibling).toBe(toggle);
    expect(toggle).toHaveClass("min-h-[44px]");
    expect(toggle).toHaveAccessibleName(i18n.t("pdp.showMore"));
    expect(description).toHaveClass("line-clamp-2");

    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName(i18n.t("pdp.showLess"));
    expect(description).not.toHaveClass("line-clamp-2");

    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName(i18n.t("pdp.showMore"));
    expect(description).toHaveClass("line-clamp-2");
  });
});
