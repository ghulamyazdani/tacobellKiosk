import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

const seed = (preselectedVariantId?: string, selectedEntity: object = COLA) => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
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
      selectedEntity,
    })
  );
};

const renderPdp = (embedded = false) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization embedded={embedded} />
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
    // UB2: the CTA is live before a size (a tap names the size in the
    // completion warning — CustomizationLimits.test).
    expect(screen.getByTestId("pdp-add-to-bag")).toBeEnabled();
    // The picker still filters what the guest may choose.
    expect(screen.getByTestId("pdp-variant-cola-s")).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-variant-cola-x")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pdp-variant-cola-o")).not.toBeInTheDocument();
  });
});

/*
  Walk 2026-10-14. A sized item showed "£0.00" under its title and
  "ADD TO BAG · £0.00" until a size was picked (basePrice read the empty
  selectedVariant): the item looked free. Before a size the line reads as
  the item's menu card does (formatMenuPriceLine) and the CTA carries no
  price — Figma's PDP CTA (1:2614 / 1:2728 / 1:5540) is the label alone.
  A size picked: today's live price.
*/
describe("PDP price before a size is chosen (walk 2026-10-14)", () => {
  const NOODLES = {
    id: "noodles",
    name: "Noodles",
    price: 5,
    calorieCount: 254,
    hasVariant: true,
    variants: [
      { id: "noodles-half", name: "Half", price: 10, isActive: true, modifiers: [EXTRAS._id] },
      { id: "noodles-quarter", name: "Quarter", price: 5, isActive: true, modifiers: [] },
      { id: "noodles-full", name: "Full", price: 15, isActive: true, modifiers: [] },
    ],
  };

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("no size: the menu card's line ('£5 | 254 Cal'), a priceless ADD TO BAG — never £0.00; a size brings the live price", () => {
    seed(undefined, NOODLES);
    renderPdp();

    expect(screen.getByTestId("pdp-variant-picker")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-price")).toHaveTextContent(/^£5 \| 254 Cal$/);
    const cta = screen.getByTestId("pdp-add-to-bag");
    expect(cta).toHaveTextContent(/^Add to bag$/);
    expect(screen.getByTestId("customization-screen")).not.toHaveTextContent("£0.00");

    fireEvent.click(screen.getByTestId("pdp-variant-noodles-half"));
    expect(screen.getByTestId("pdp-price")).toHaveTextContent(/^£10.00 \| 254 Cal$/);
    expect(cta).toHaveTextContent("Add to bag · £10.00");
  });
});

/*
  Walk 2026-10-14: the buy stage's size tile hands the PDP an entity whose
  sizes are subset to that one size, and it opened on the size grid with
  that size unselected. A lone pickable size is the choice already.
*/
describe("PDP opens on a lone pickable size (walk 2026-10-14)", () => {
  const LASSI = {
    id: "lassi",
    name: "Lassi",
    price: 4,
    hasVariant: true,
    variants: [
      { id: "lassi-m", name: "Medium", price: 4, isActive: true, modifiers: [EXTRAS._id] },
      { id: "lassi-x", name: "Huge", price: 6, isActive: false, modifiers: [] },
      { id: "lassi-o", name: "Offer Size", price: 7, isActive: true, isGetVariantDisabled: true, modifiers: [] },
    ],
  };

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it.each([
    ["a menu PDP", false, LASSI],
    ["the buy stage's size tile (embedded)", true, { ...LASSI, isBuyStageItem: true, quantity: 1 }],
  ])("%s: no picker — the one size is chosen, its groups and its price show", (_label, embedded, entity) => {
    seed(undefined, entity);
    renderPdp(embedded);

    expect(screen.queryByTestId("pdp-variant-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-change-size")).toHaveTextContent(`Medium · ${i18n.t("pdp.change")}`);
    expect(screen.getByTestId(`pdp-group-${EXTRAS._id}`)).toBeInTheDocument();
    expect(screen.getByTestId("pdp-price")).toHaveTextContent(/^£4.00$/);
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£4.00");
  });
});

/*
  Walk 2026-10-14: after HALF + an add-on (CTA £20.00), "HALF · Change"
  opened the grid with NO size marked while the header and the CTA kept
  HALF's money; ADD TO BAG then asked for a size, and re-picking a size
  wiped the add-ons. The grid now opens over the CURRENT size (marked):
  the header, the CTA and ADD TO BAG all stay that size; tapping it keeps
  its add-ons; a DIFFERENT size resets them, as before. (posistKiosk marks
  the current size too, but resets the add-ons even on the same size.)
*/
describe("PDP Change size keeps the current size (walk 2026-10-14)", () => {
  type Row = { selectedVariant?: { id?: string }; customizations?: unknown };
  const cartItems = () => (store.getState() as unknown as { cart: { cartItems: Row[] } }).cart.cartItems;
  const picks = () => tier1SelectedCustomization(store.getState()) as Record<string, Array<{ id?: string }>>;

  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    seed("cola-l");
    renderPdp();
    fireEvent.click(screen.getByTestId("pdp-option-pickles"));
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£4.00");
    fireEvent.click(screen.getByTestId("pdp-change-size"));
  });

  it("the grid marks the current size; the header, the CTA and the pick stay Large's", () => {
    expect(screen.getByTestId("pdp-variant-picker")).toBeInTheDocument();
    expect(screen.getByTestId("pdp-variant-cola-l")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("pdp-variant-cola-s")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("pdp-variant-cola-l").querySelector("img[src*='radio-check']")).not.toBeNull();
    expect(screen.getByTestId("pdp-variant-cola-s").querySelector("img[src*='radio-check']")).toBeNull();
    expect(screen.getByTestId("pdp-price")).toHaveTextContent(/^£3.00$/);
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£4.00");
    expect(picks()[EXTRAS._id]?.map((pick) => pick?.id)).toEqual(["pickles"]);
  });

  it("tapping the current size closes the grid and keeps its add-ons", () => {
    fireEvent.click(screen.getByTestId("pdp-variant-cola-l"));

    expect(screen.queryByTestId("pdp-variant-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-option-pickles")).toHaveAttribute("aria-pressed", "true");
    expect(picks()[EXTRAS._id]?.map((pick) => pick?.id)).toEqual(["pickles"]);
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£4.00");
  });

  it("ADD TO BAG with the grid open commits the current size and its add-on — no size warning", () => {
    fireEvent.click(screen.getByTestId("pdp-add-to-bag"));

    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(cartItems()).toHaveLength(1);
    expect(cartItems()[0]?.selectedVariant?.id).toBe("cola-l");
    expect(JSON.stringify(cartItems()[0]?.customizations)).toContain("pickles");
  });

  it("a different size behaves as before: picked, its own (empty) add-ons, its price", () => {
    fireEvent.click(screen.getByTestId("pdp-variant-cola-s"));

    expect(screen.queryByTestId("pdp-variant-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-change-size")).toHaveTextContent(`Small · ${i18n.t("pdp.change")}`);
    expect(picks()).toEqual({});
    expect(screen.getByTestId("pdp-price")).toHaveTextContent(/^£2.00$/);
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£2.00");
  });
});
