import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
import { KioskEventName } from "../../../utils/analytics";

// A second select in the SAME tap re-adds from the same render's selections (the state looks
// right), so "once" is counted where it shows: one ModifierSelected per tap.
const net = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => net.capture(...args),
}));

/*
  User report 2026-10-09 ("why choose is not coming in some addons
  customizations"): Figma draws a button on every option card (PDP - Single
  Product 1:2614 / 1:2728, Build Your Own Pack 1:5332), add-on grids
  included. The button is the label of the card's own tap, so it says what
  the SDK engine (applySinglePunchSelection) does with that tap: CHOOSE on
  an unpicked card, REMOVE on a pick the tap takes back (flexible and toggle
  groups), and nothing on the pick of a single-slot group (min 1 / max 1,
  several options), where a tap only re-selects it.
*/

const EXTRAS = {
  _id: "burger_extras_addons",
  name: "Extras",
  min: 0,
  max: 2,
  multiplePunchMin: 0,
  multiplePunchMax: 2,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "pickles", name: "Extra Pickles", price: 1, isActive: true },
    { id: "ketchup", name: "Extra Ketchup", price: 0, isActive: true },
    { id: "mustard", name: "Extra Mustard", price: 0, isActive: true },
  ],
};
/** Single-slot: min 1 / max 1 over two options, Cola pre-selected (isDefault). */
const DRINK = {
  _id: "burger_drink_addons",
  name: "Drink",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 2,
  isActive: true,
  constituentItems: [
    { id: "cola", name: "Cola", price: 0, isActive: true, isDefault: true },
    { id: "lemonade", name: "Lemonade", price: 0, isActive: true },
  ],
};
/** Toggle: min 0 / max 0 (no cap). */
const WITHOUT = {
  _id: "burger_without_addons",
  name: "Without",
  min: 0,
  max: 0,
  multiplePunchMin: 0,
  multiplePunchMax: 0,
  multiplePunchMaxItem: 1,
  order: 3,
  isActive: true,
  constituentItems: [{ id: "no-onions", name: "No Onions", price: 0, isActive: true }],
};
/** Item cap 2 → stepper rows (Cards/Item/Old), never cards. */
const SAUCES = {
  _id: "burger_sauce_addons",
  name: "Sauces",
  min: 0,
  max: 4,
  multiplePunchMin: 0,
  multiplePunchMax: 4,
  multiplePunchMaxItem: 2,
  order: 4,
  isActive: true,
  constituentItems: [{ id: "mild", name: "Mild Sauce", price: 0, isActive: true }],
};
const GROUPS = [EXTRAS, DRINK, WITHOUT, SAUCES];
const BURGER = { id: "burger", name: "Cheese Burger", price: 8, modifiers: GROUPS.map((g) => g._id) };

const seed = () => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(setModifiersMap({ modifiersMap: Object.fromEntries(GROUPS.map((g) => [g._id, g])) }));
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
      selectedEntity: BURGER,
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
const cta = (id: string) => screen.getByTestId(`pdp-option-cta-${id}`);
const picksIn = (groupId: string) =>
  (tier1SelectedCustomization(store.getState())[groupId] ?? []).map(
    (row: { id: string; quantity: number }) => [row.id, row.quantity],
  );

describe("PDP option cards — the CTA on every grid card (user report 2026-10-09)", () => {
  beforeAll(() => {
    Element.prototype.scrollTo = () => {};
  });

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    seed();
  });

  afterEach(async () => {
    store.dispatch(setAllowMultiplePunch(false));
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("an add-on group: every unpicked card carries CHOOSE", () => {
    renderPdp();

    for (const id of ["pickles", "ketchup", "mustard"]) {
      expect(cta(id).textContent).toBe(i18n.t("pack.choose"));
    }
  });

  it("one tap on CHOOSE picks the item ONCE (one ModifierSelected), then the CTA reads REMOVE", async () => {
    renderPdp();
    net.capture.mockClear();

    await tap(cta("pickles"));

    expect(net.capture.mock.calls.filter(([name]) => name === KioskEventName.ModifierSelected)).toHaveLength(1);
    expect(picksIn(EXTRAS._id)).toEqual([["pickles", 1]]);
    expect(cta("pickles").textContent).toBe(i18n.t("pack.remove"));
    expect(screen.getByTestId("pdp-option-pickles")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£9.00");
  });

  it("REMOVE takes the pick back, and the card reads CHOOSE again", async () => {
    renderPdp();

    await tap(cta("pickles"));
    await tap(cta("pickles"));

    expect(picksIn(EXTRAS._id)).toEqual([]);
    expect(cta("pickles").textContent).toBe(i18n.t("pack.choose"));
    expect(screen.getByTestId("pdp-option-pickles")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("pdp-add-to-bag")).toHaveTextContent("£8.00");
  });

  it("a single-slot group: the pick has no CTA (a tap only re-selects it) but keeps its box, the others read CHOOSE, and CHOOSE swaps", async () => {
    renderPdp();
    const reserved = (id: string) => screen.getByTestId(`pdp-option-${id}`).querySelector("span.invisible");

    expect(picksIn(DRINK._id)).toEqual([["cola", 1]]);
    expect(screen.queryByTestId("pdp-option-cta-cola")).toBeNull();
    expect(reserved("cola")).not.toBeNull();
    expect(screen.getByTestId("pdp-option-cola")).toHaveAttribute("aria-pressed", "true");
    expect(cta("lemonade").textContent).toBe(i18n.t("pack.choose"));

    await tap(cta("lemonade"));

    expect(picksIn(DRINK._id)).toEqual([["lemonade", 1]]);
    expect(screen.queryByTestId("pdp-option-cta-lemonade")).toBeNull();
    expect(reserved("lemonade")).not.toBeNull();
    expect(cta("cola").textContent).toBe(i18n.t("pack.choose"));
    expect(reserved("cola")).toBeNull();
  });

  it("a full flexible group: CHOOSE on a further card is refused out loud (UB2) and picks nothing", async () => {
    renderPdp();
    await tap(cta("pickles"));
    await tap(cta("ketchup"));
    expect(picksIn(EXTRAS._id)).toEqual([["pickles", 1], ["ketchup", 1]]);
    expect(cta("mustard").textContent).toBe(i18n.t("pack.choose"));

    await tap(cta("mustard"));

    expect(screen.getByTestId("global-error")).toHaveTextContent(
      i18n.t("pdp.groupMaxReached", { max: 2, group: "Extras" }),
    );
    expect(picksIn(EXTRAS._id)).toEqual([["pickles", 1], ["ketchup", 1]]);
    expect(cta("mustard").textContent).toBe(i18n.t("pack.choose"));
  });

  it("a toggle group (min 0 / max 0): CHOOSE adds, REMOVE takes it back", async () => {
    renderPdp();

    await tap(cta("no-onions"));
    expect(picksIn(WITHOUT._id)).toEqual([["no-onions", 1]]);
    expect(cta("no-onions").textContent).toBe(i18n.t("pack.remove"));

    await tap(cta("no-onions"));
    expect(picksIn(WITHOUT._id)).toEqual([]);
    expect(cta("no-onions").textContent).toBe(i18n.t("pack.choose"));
  });

  it("multi-punch ON: the CTA reads the EFFECTIVE bounds the engine taps with — Extras (raw 0/2, multi-punch 1/1) is a swap: its pick has no CTA, CHOOSE swaps", async () => {
    store.dispatch(setAllowMultiplePunch(true));
    store.dispatch(
      setModifiersMap({
        modifiersMap: {
          ...Object.fromEntries(GROUPS.map((g) => [g._id, g])),
          [EXTRAS._id]: { ...EXTRAS, multiplePunchMin: 1, multiplePunchMax: 1 },
        },
      }),
    );
    renderPdp();

    await tap(cta("pickles"));
    expect(picksIn(EXTRAS._id)).toEqual([["pickles", 1]]);
    expect(screen.queryByTestId("pdp-option-cta-pickles")).toBeNull();
    expect(cta("ketchup").textContent).toBe(i18n.t("pack.choose"));

    await tap(cta("ketchup"));
    expect(picksIn(EXTRAS._id)).toEqual([["ketchup", 1]]);
    expect(cta("pickles").textContent).toBe(i18n.t("pack.choose"));
  });

  it("Arabic: CHOOSE / REMOVE are i18n.t('pack.choose' / 'pack.remove') in Arabic", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    renderPdp();

    expect(cta("pickles").textContent).toBe(i18n.t("pack.choose"));
    expect(cta("pickles")).not.toHaveTextContent("Choose");
    await tap(cta("pickles"));
    expect(cta("pickles").textContent).toBe(i18n.t("pack.remove"));
    expect(cta("pickles")).not.toHaveTextContent("Remove");
  });

  it("ONE control per card, named by the item: the CTA is the label of the card's own tap, not a second button", () => {
    renderPdp();

    const card = screen.getByTestId("pdp-option-pickles");
    expect(screen.getByRole("button", { name: "Extra Pickles" })).toBe(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(card).toContainElement(cta("pickles"));
    expect(card.querySelectorAll("button")).toHaveLength(0);
  });

  it("guard: stepper rows (item cap > 1) carry no CTA", () => {
    renderPdp();

    expect(screen.getByTestId("pdp-option-mild")).toBeInTheDocument();
    expect(screen.queryByTestId("pdp-option-cta-mild")).toBeNull();
  });
});
