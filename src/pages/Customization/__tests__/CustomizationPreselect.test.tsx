import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import Customization from "../index";
import i18n from "../../../i18n";

/*
  Lane figma-polish S1 — the Select-a-Size fast lane already chose the size,
  so a tier-1 VARIANT session carrying `bottomSheet.preselectedVariantId`
  opens the PDP on the builder for THAT size (the edit branch's trio: select
  it, fetch its groups, confirm it) — no size picker. An id that is unknown,
  inactive or offer-capped (isGetVariantDisabled) is ignored: the picker
  shows, as before. Seam: navigation (the no-session guard).
*/

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

const EXTRAS = {
  _id: "lg_addons",
  name: "Extras",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [{ id: "pickles", name: "Extra Pickles", price: 1, isActive: true }],
};

const COLA = {
  id: "cola",
  name: "Cola",
  price: 0,
  hasVariant: true,
  variants: [
    { id: "cola-s", name: "Small", price: 2, isActive: true, modifiers: [] },
    { id: "cola-l", name: "Large", price: 3, isActive: true, modifiers: [EXTRAS._id] },
    { id: "cola-x", name: "Huge", price: 4, isActive: false, modifiers: [EXTRAS._id] },
    { id: "cola-o", name: "Offer Size", price: 5, isActive: true, isGetVariantDisabled: true, modifiers: [EXTRAS._id] },
  ],
};

const seed = (preselectedVariantId?: string) => {
  store.dispatch(setCurrency({ symbol: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: { [EXTRAS._id]: EXTRAS } }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: {
        isOpen: true,
        status: "",
        type: "variant",
        openType: "new",
        editCustomizationContent: {},
        ...(preselectedVariantId ? { preselectedVariantId } : {}),
      },
      selectedEntity: COLA,
    })
  );
};

const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
      </MemoryRouter>
    </Provider>
  );

describe("PDP opens on the preselected size (S1)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("a preselected active size opens the builder for it: pdp-change-size names it, no picker, its groups render, the live price", () => {
    seed("cola-l");
    renderPdp();

    expect(screen.queryByTestId("pdp-variant-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-change-size")).toHaveTextContent(`Large · ${i18n.t("pdp.change")}`);
    expect(screen.getByTestId(`pdp-group-${EXTRAS._id}`)).toBeInTheDocument();
    expect(screen.getByTestId("pdp-option-pickles")).toBeInTheDocument();
    expect(tier1SelectedCustomization(store.getState())).toEqual({ [EXTRAS._id]: [] });
    const cta = screen.getByTestId("pdp-add-to-bag");
    expect(cta).toBeEnabled();
    expect(cta).toHaveTextContent("£3.00");
  });

  it.each([
    ["no id (every other way in)", undefined],
    ["an unknown id", "cola-gone"],
    ["an inactive size", "cola-x"],
    ["an offer-capped size (isGetVariantDisabled)", "cola-o"],
  ])("%s: the size picker shows, as before", (_label, id) => {
    seed(id);
    renderPdp();

    const picker = screen.getByTestId("pdp-variant-picker");
    expect(picker).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-change-size")).not.toBeInTheDocument();
    expect(screen.queryByTestId(`pdp-group-${EXTRAS._id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-add-to-bag")).toBeDisabled();
    // The picker still filters what the guest may choose.
    expect(screen.getByTestId("pdp-variant-cola-s")).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-variant-cola-x")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdp-variant-cola-o")).not.toBeInTheDocument();
  });
});
