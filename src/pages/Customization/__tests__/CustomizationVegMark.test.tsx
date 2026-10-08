import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency, setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import i18n from "../../../i18n";

/*
  audit-fixes U1 — the PDP's diet mark (design language, no Figma frame):
  the foundation's VegMark (24 px) leads the price line; the price text
  stays in ONE span (bare runs in the flex <p> would each take the gap), so
  the line still reads "£8.00" for every text matcher. Tri-state: an
  untagged item shows no mark; the operator's hide_veg_non_veg hides it.
  Seam: navigation (the no-session guard).
*/

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

const BURGER = { id: "burger", name: "Burger", price: 8, modifiers: [] };

const seed = (entity: Record<string, unknown>) => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: {} }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
      selectedEntity: entity,
    }),
  );
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
      </MemoryRouter>
    </Provider>,
  );

/** The price line: the <p> holding the price span. */
const priceLine = () => {
  const line = screen.getByText("£8.00").closest("p");
  if (!line) throw new Error("no price line");
  return line;
};

describe("PDP diet mark (U1)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("a veg item: the 24 px veg mark leads the price line, labelled, and the price text stays one run", () => {
    seed({ ...BURGER, tags: ["veg"] });
    renderPdp();

    const line = priceLine();
    const mark = within(line).getByRole("img", { name: i18n.t("menu.veg") });
    expect(mark).toHaveAttribute("data-testid", "veg-mark-veg");
    expect(mark).toHaveStyle({ width: "24px", height: "24px" });
    expect(line.firstElementChild).toBe(mark);
    expect(line).toHaveClass("flex", "items-center", "gap-[12px]");
    expect(line).toHaveTextContent(/^£8\.00$/);
    expect(line.querySelectorAll(":scope > span")).toHaveLength(2);
  });

  it("a non-veg item gets the non-veg mark", () => {
    seed({ ...BURGER, tags: ["non-veg"] });
    renderPdp();

    expect(within(priceLine()).getByRole("img", { name: i18n.t("menu.nonVeg") })).toHaveAttribute(
      "data-testid",
      "veg-mark-non-veg",
    );
  });

  it("an untagged item shows no mark (tri-state)", () => {
    seed(BURGER);
    renderPdp();

    expect(within(priceLine()).queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^veg-mark-/)).not.toBeInTheDocument();
  });

  it("hide_veg_non_veg hides it", () => {
    store.dispatch(setKioskSettings({ hide_veg_non_veg: true }));
    seed({ ...BURGER, tags: ["veg"] });
    renderPdp();

    expect(screen.queryByTestId("veg-mark-veg")).not.toBeInTheDocument();
    expect(priceLine()).toHaveTextContent(/^£8\.00$/);
  });
});
