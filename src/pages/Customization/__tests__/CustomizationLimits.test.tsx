import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  openMakeItAMealSession,
  setTier1BottomSheetAndSelectedEntity,
  tier1SelectedCustomization,
} from "@cx-sdk/ordering/state/makeItAMeal.slice";
import { setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setAllowMultiplePunch, setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import GlobalErrorHost from "../../../components/common/GlobalErrorHost";
import Customization from "../index";
import i18n from "../../../i18n";

/*
  audit-fixes UB2 on the PDP ("no message when I pick several in a 1/1
  group", "messages on ADD TO BAG when the choices are not complete"):
  - the presentation follows the EFFECTIVE bounds: an effective 1/1 group
    is radio cards (a second tap swaps) even when its item cap is > 1, and
    "Required" follows the effective min (multi-punch on → 0);
  - a pick past a group's max is refused out loud through the app-wide
    GlobalErrorHost ("You can choose up to {{max}} {{group}}");
  - ADD TO BAG before a size is live and answers with the 1:2855 warning
    naming the size — nothing is committed.
*/

/** A 1/1 group whose ITEM cap is 3 (it used to render steppers → 3 of 1). */
const DRINK = {
  _id: "drink_addons",
  name: "Drink",
  min: 1,
  max: 1,
  multiplePunchMin: 0,
  multiplePunchMax: 6,
  multiplePunchMaxItem: 3,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "cola", name: "Cola", price: 0, isActive: true },
    { id: "lemonade", name: "Lemonade", price: 0, isActive: true },
  ],
};
/** The fixture's Dream box "Snacks": 0 / 2, stepper rows (item cap 2). */
const SNACKS = {
  _id: "box_6_combo",
  name: "Snacks",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 4,
  multiplePunchMaxItem: 2,
  order: 2,
  isActive: true,
  constituentItems: [
    { id: "nuggets", name: "Nuggets", price: 5, isActive: true },
    { id: "donuts", name: "Donuts", price: 5, isActive: true },
  ],
};

const MEAL = { id: "meal", name: "Meal", price: 10, modifiers: [DRINK._id, SNACKS._id] };
const COLA_SIZES = {
  id: "cola-cup",
  name: "Cola",
  price: 0,
  hasVariant: true,
  variants: [
    { id: "cola-r", name: "Regular", price: 2, isActive: true, modifiers: [] },
    { id: "cola-l", name: "Large", price: 3, isActive: true, modifiers: [] },
  ],
};

const seed = (entity: Record<string, unknown>, type = "customizableItem") => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: { [DRINK._id]: DRINK, [SNACKS._id]: SNACKS } }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type, openType: "new", editCustomizationContent: {} },
      selectedEntity: entity,
    }),
  );
};

/** The PDP with the app-wide error host beside it (IdleGuard mounts it in the app). */
const renderPdp = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
        <GlobalErrorHost />
      </MemoryRouter>
    </Provider>,
  );

const tap = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};
const picksIn = (groupId: string) =>
  (tier1SelectedCustomization(store.getState())[groupId] ?? []).map(
    (row: { id: string; quantity: number }) => [row.id, row.quantity],
  );
const cartItems = () => (store.getState() as unknown as { cart: { cartItems: unknown[] } }).cart.cartItems;
const increase = (name: string) =>
  screen.getByRole("button", { name: `${i18n.t("pdp.increase")} ${name}` });

describe("PDP limits (UB2)", () => {
  beforeAll(async () => {
    Element.prototype.scrollTo = () => {};
    // The completion warning rides in the one lazy chunk.
    await import("../../../components/cart/bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(() => {
    store.dispatch(setAllowMultiplePunch(false));
  });

  it("an effective 1/1 group with an item cap of 3 renders radio cards, no steppers; a second tap swaps, no error", async () => {
    seed(MEAL);
    renderPdp();

    const drink = screen.getByTestId(`pdp-group-${DRINK._id}`);
    expect(within(drink).queryByRole("button", { name: new RegExp(`^${i18n.t("pdp.increase")}`) })).toBeNull();
    expect(screen.getByTestId("pdp-option-cola")).toHaveAttribute("aria-pressed", "false");
    expect(within(drink).getByText(i18n.t("pdp.required"))).toBeInTheDocument();

    await tap(screen.getByTestId("pdp-option-cola"));
    await tap(screen.getByTestId("pdp-option-lemonade"));

    expect(picksIn(DRINK._id)).toEqual([["lemonade", 1]]);
    expect(screen.getByTestId("pdp-option-lemonade")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("global-error")).not.toBeInTheDocument();
  });

  it("multi-punch ON: the header follows the multi-punch bounds — no Required (mp min 0), the count is of 6, picks add up", async () => {
    store.dispatch(setAllowMultiplePunch(true));
    seed(MEAL);
    renderPdp();

    const drink = screen.getByTestId(`pdp-group-${DRINK._id}`);
    expect(within(drink).queryByText(i18n.t("pdp.required"))).not.toBeInTheDocument();
    expect(drink).toHaveTextContent(i18n.t("pdp.groupCount", { count: 0, max: 6 }));
    // 0 / 6 is not 1/1: the item cap of 3 makes stepper rows again.
    await tap(increase("Cola"));
    await tap(increase("Lemonade"));
    expect(picksIn(DRINK._id)).toEqual([
      ["cola", 1],
      ["lemonade", 1],
    ]);
    expect(drink).toHaveTextContent(i18n.t("pdp.groupCount", { count: 2, max: 6 }));
  });

  it("with the error host mounted, a third Snacks unit is refused out loud: global-error says 'You can choose up to 2 Snacks', the pick stays out", async () => {
    seed(MEAL);
    renderPdp();
    const snacks = screen.getByTestId(`pdp-group-${SNACKS._id}`);

    await tap(increase("Nuggets"));
    await tap(increase("Nuggets"));
    expect(snacks).toHaveTextContent(i18n.t("pdp.groupCount", { count: 2, max: 2 }));
    expect(screen.queryByTestId("global-error")).not.toBeInTheDocument();

    await tap(increase("Donuts"));

    const error = screen.getByTestId("global-error");
    expect(error).toHaveTextContent("You can choose up to 2 Snacks");
    expect(error).toHaveTextContent(i18n.t("pdp.groupMaxReached", { max: 2, group: "Snacks" }));
    expect(picksIn(SNACKS._id)).toEqual([["nuggets", 2]]);
    expect(snacks).toHaveTextContent(i18n.t("pdp.groupCount", { count: 2, max: 2 }));

    await tap(screen.getByTestId("global-error-ok"));
    expect(screen.queryByTestId("global-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("customization-screen")).toBeInTheDocument();
  });

  it("no size yet: ADD TO BAG is live; a tap opens the warning naming the size and commits nothing; GOT IT keeps the picker", async () => {
    seed(COLA_SIZES, "variant");
    renderPdp();

    expect(screen.getByTestId("pdp-variant-picker")).toBeInTheDocument();
    const cta = screen.getByTestId("pdp-add-to-bag");
    expect(cta).toBeEnabled();
    await tap(cta);

    expect(screen.getByTestId("pdp-incomplete")).toHaveAttribute("role", "alertdialog");
    expect(document.getElementById("pdp-incomplete-title")?.textContent).toBe(
      "Let's finish your choices first",
    );
    expect(document.getElementById("pdp-incomplete-message")?.textContent).toBe(
      "Please choose your size before adding to your bag",
    );
    expect(cartItems()).toHaveLength(0);
    expect(screen.queryByTestId("global-error")).not.toBeInTheDocument();

    await tap(screen.getByTestId("pdp-incomplete-gotit"));
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(screen.getByTestId("pdp-variant-picker")).toBeInTheDocument();

    // Pick a size: the same button now commits.
    await tap(screen.getByTestId("pdp-variant-cola-l"));
    await tap(screen.getByTestId("pdp-add-to-bag"));
    expect(screen.queryByTestId("pdp-incomplete")).not.toBeInTheDocument();
    expect(cartItems()).toHaveLength(1);
  });
});
