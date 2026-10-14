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
  User report 2026-10-14 ("max and total selected quantity is not coming in
  some items"): Honey BBQ Wings' "Test 1" — stepper rows, Missi Roti ×2 —
  had no "count of max" while its card groups read "0 of 3" / "2 of 4". The
  header counted only above a max of 1, so a group the PDP refuses at 1 (a
  stepper's second unit, a second card of a non-swap group) showed none.
  The counter's max is the one the "You can choose up to" guard refuses at,
  and ADD TO BAG accepts what it shows. A group with a max of 0 has no
  counter: the guard lets picks in there that the commit refuses (PROGRESS
  R13, an open call), so no number can agree with both.
*/

const ROWS = [
  { id: "missi", name: "Missi Roti", price: 0, isActive: true },
  { id: "garlic", name: "Garlic Naan", price: 0, isActive: true },
  { id: "tandoori", name: "Tandoori Roti", price: 0, isActive: true },
];
const GROUP_ID = "wings_test1_addons";

const seed = (bounds: Record<string, unknown>, rows = ROWS) => {
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
  store.dispatch(
    setModifiersMap({
      modifiersMap: {
        [GROUP_ID]: { _id: GROUP_ID, name: "Test 1", order: 1, isActive: true, constituentItems: rows, ...bounds },
      },
    }),
  );
  store.dispatch(openMakeItAMealSession());
  store.dispatch(
    setTier1BottomSheetAndSelectedEntity({
      bottomSheet: { isOpen: true, status: "", type: "customizableItem", openType: "new", editCustomizationContent: {} },
      selectedEntity: { id: "wings", name: "Honey BBQ Wings", price: 100, modifiers: [GROUP_ID] },
    }),
  );
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/customization"]}>
        <Customization />
        <GlobalErrorHost />
      </MemoryRouter>
    </Provider>,
  );
};

const tap = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};
const plus = (row: string) => screen.getByRole("button", { name: `${i18n.t("pdp.increase")} ${row}` });
const minus = (row: string) => screen.getByRole("button", { name: `${i18n.t("pdp.decrease")} ${row}` });
const section = () => screen.getByTestId(`pdp-group-${GROUP_ID}`);
/** The header row: the h3 and its siblings (Required, the counter). */
const header = () => within(section()).getByRole("heading", { level: 3, name: "Test 1" }).parentElement as HTMLElement;
const counter = (count: number, max: number) => i18n.t("pdp.groupCount", { count, max });
const expectCounter = (count: number, max: number) => {
  const el = within(header()).getByText(counter(count, max));
  // The extreme right of the header (1:4911).
  expect(el).toHaveClass("ml-auto");
  expect(header().lastElementChild).toBe(el);
};
const expectNoCounter = () => expect(header()).not.toHaveTextContent(/\bof\b/);
const picks = () =>
  (tier1SelectedCustomization(store.getState())[GROUP_ID] ?? []).map(
    (row: { id: string; quantity: number }) => [row.id, row.quantity],
  );
const bagRows = () => (store.getState() as { cart: { cartItems: unknown[] } }).cart.cartItems.length;
/** The global error's text, then GOT IT. */
const dismissError = async () => {
  const text = screen.getByTestId("global-error").textContent;
  await tap(screen.getByTestId("global-error-ok"));
  return text;
};
/** ADD TO BAG; true when it committed (no completion warning, one bag row). */
const addToBag = async () => {
  await tap(screen.getByTestId("pdp-add-to-bag"));
  return !screen.queryByTestId("pdp-incomplete") && bagRows() === 1;
};

describe("PDP group header — 'count of max' on every group shape (user report 2026-10-14)", () => {
  beforeAll(async () => {
    Element.prototype.scrollTo = () => {};
    // The completion warning rides in the one lazy chunk.
    await import("../../../components/cart/bagLazyParts");
  }, 60_000);

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  afterEach(async () => {
    store.dispatch(setAllowMultiplePunch(false));
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("a single choice (1/1 over three options): radio cards, Required, no counter — a tap swaps, nothing is refused", async () => {
    seed({ min: 1, max: 1, multiplePunchMin: 1, multiplePunchMax: 1, multiplePunchMaxItem: 1 });

    expect(within(header()).getByText(i18n.t("pdp.required"))).toBeInTheDocument();
    expectNoCounter();
    await tap(screen.getByTestId("pdp-option-missi"));
    await tap(screen.getByTestId("pdp-option-garlic"));
    expect(picks()).toEqual([["garlic", 1]]);
    expectNoCounter();
  });

  it("a multi-choice with a max (0 / 3 cards): '0 of 3', then '2 of 3' after two picks", async () => {
    seed({ min: 0, max: 3, multiplePunchMin: 0, multiplePunchMax: 3, multiplePunchMaxItem: 1 });

    expectCounter(0, 3);
    await tap(screen.getByTestId("pdp-option-missi"));
    await tap(screen.getByTestId("pdp-option-garlic"));
    expectCounter(2, 3);
  });

  it("a pick-one card group that refuses (0 / 1 over three options): '0 of 1' → '1 of 1'; a second card is refused saying 'up to 1', and ADD TO BAG takes the one", async () => {
    seed({ min: 0, max: 1, multiplePunchMin: 0, multiplePunchMax: 1, multiplePunchMaxItem: 1 });

    expect(screen.queryByRole("button", { name: `${i18n.t("pdp.increase")} Missi Roti` })).toBeNull(); // cards
    expectCounter(0, 1);
    await tap(screen.getByTestId("pdp-option-missi"));
    expectCounter(1, 1);
    await tap(screen.getByTestId("pdp-option-garlic"));
    expect(await dismissError()).toContain(i18n.t("pdp.groupMaxReached", { max: 1, group: "Test 1" }));
    expect(picks()).toEqual([["missi", 1]]);
    expectCounter(1, 1);
    expect(await addToBag()).toBe(true);
  });

  it("a pick-one card group of ONE option (0 / 1): no counter — nothing can be refused", async () => {
    seed({ min: 0, max: 1, multiplePunchMin: 0, multiplePunchMax: 1, multiplePunchMaxItem: 1 }, ROWS.slice(0, 1));

    expectNoCounter();
    await tap(screen.getByTestId("pdp-option-missi"));
    expect(picks()).toEqual([["missi", 1]]);
    expectNoCounter();
  });

  it("a stepper with a group max (0 / 4, item cap 2): '0 of 4' → '4 of 4'; the 5th unit is refused AT the counter's max, − counts down, and ADD TO BAG takes '4 of 4'", async () => {
    seed({ min: 0, max: 4, multiplePunchMin: 0, multiplePunchMax: 4, multiplePunchMaxItem: 2 });

    expectCounter(0, 4);
    await tap(plus("Missi Roti"));
    await tap(plus("Missi Roti"));
    await tap(plus("Garlic Naan"));
    expectCounter(3, 4);
    await tap(plus("Tandoori Roti"));
    expectCounter(4, 4);
    await tap(plus("Garlic Naan"));
    expect(await dismissError()).toContain(i18n.t("pdp.groupMaxReached", { max: 4, group: "Test 1" }));
    expectCounter(4, 4);
    await tap(minus("Missi Roti"));
    expectCounter(3, 4);
    await tap(plus("Garlic Naan"));
    expectCounter(4, 4);
    expect(await addToBag()).toBe(true);
  });

  it("a stepper with a group max of 1 (item cap 3): '0 of 1' → '1 of 1'; the second unit is refused saying 'up to 1', and ADD TO BAG takes '1 of 1'", async () => {
    seed({ min: 0, max: 1, multiplePunchMin: 0, multiplePunchMax: 1, multiplePunchMaxItem: 3 });

    // Steppers (0 / 1 is not the 1/1 swap), and now a counter.
    expect(plus("Missi Roti")).toBeInTheDocument();
    expectCounter(0, 1);
    await tap(plus("Missi Roti"));
    expectCounter(1, 1);
    await tap(plus("Missi Roti"));
    expect(await dismissError()).toContain(i18n.t("pdp.groupMaxReached", { max: 1, group: "Test 1" }));
    expect(picks()).toEqual([["missi", 1]]);
    expectCounter(1, 1);
    expect(await addToBag()).toBe(true);
  });

  it("a stepper whose limit is the TOTAL quantity: Missi Roti ×2 counts 2 (one row, two units) — '2 of 3', the next unit anywhere is refused, and ADD TO BAG takes '3 of 3'", async () => {
    seed({ min: 0, max: 3, multiplePunchMin: 0, multiplePunchMax: 3, multiplePunchMaxItem: 3 });

    await tap(plus("Missi Roti"));
    await tap(plus("Missi Roti"));
    expect(picks()).toEqual([["missi", 2]]);
    expectCounter(2, 3);
    await tap(plus("Garlic Naan"));
    expectCounter(3, 3);
    await tap(plus("Tandoori Roti"));
    expect(await dismissError()).toContain(i18n.t("pdp.groupMaxReached", { max: 3, group: "Test 1" }));
    expect(picks()).toEqual([
      ["missi", 2],
      ["garlic", 1],
    ]);
    expectCounter(3, 3);
    expect(await addToBag()).toBe(true);
  });

  it.each([
    ["min / max 0 / 0", { min: 0, max: 0, multiplePunchMin: 0, multiplePunchMax: 5, multiplePunchMaxItem: 3 }, false],
    ["multi-punch ON, multi-punch 0 / 0", { min: 0, max: 5, multiplePunchMin: 0, multiplePunchMax: 0, multiplePunchMaxItem: 3 }, true],
  ])(
    "a stepper with only per-item maxima (%s): no counter, before or after picks; each row stops at its cap; ADD TO BAG still refuses the picks (R13, open)",
    async (_label, bounds, amp) => {
      store.dispatch(setAllowMultiplePunch(amp));
      seed(bounds);

      expect(within(header()).queryByText(i18n.t("pdp.required"))).not.toBeInTheDocument();
      expectNoCounter();
      for (let i = 0; i < 4; i += 1) await tap(plus("Missi Roti"));
      expect(await dismissError()).toContain(i18n.t("toast.alreadyReachedMaximumLimit"));
      await tap(plus("Garlic Naan"));
      expect(picks()).toEqual([
        ["missi", 3],
        ["garlic", 1],
      ]);
      expectNoCounter();
      // The commit's cap is the 0 (findFirstMinMaxViolation). Rows × cap
      // here read "4 of 9" over a group ADD TO BAG refuses.
      expect(await addToBag()).toBe(false);
      expect(section()).toHaveClass("ring-red-500");
      expectNoCounter();
    },
  );

  it("an EMPTY stepper on 0 / 0 has no counter and ADD TO BAG takes the item", async () => {
    seed({ min: 0, max: 0, multiplePunchMin: 0, multiplePunchMax: 0, multiplePunchMaxItem: 3 });

    expectNoCounter();
    expect(await addToBag()).toBe(true);
  });

  it("a required stepper with no max (min 1 / max 0): Required, no counter", () => {
    seed({ min: 1, max: 0, multiplePunchMin: 1, multiplePunchMax: 0, multiplePunchMaxItem: 3 });

    expect(plus("Missi Roti")).toBeInTheDocument();
    expect(within(header()).getByText(i18n.t("pdp.required"))).toBeInTheDocument();
    expectNoCounter();
  });

  it.each([
    ["null", { min: null, max: null, multiplePunchMaxItem: 3 }],
    ["missing", { multiplePunchMaxItem: 3 }],
    ["text", { min: "0", max: "x", multiplePunchMaxItem: 3 }],
  ])("malformed bounds on a stepper (%s): no counter — no bound to count against", async (_label, bounds) => {
    seed(bounds);

    expect(plus("Missi Roti")).toBeInTheDocument();
    expectNoCounter();
    await tap(plus("Missi Roti"));
    expect(picks()).toEqual([["missi", 1]]);
    expectNoCounter();
  });

  it("0 / 0 cards (the toggle group, item cap 1): no counter (R13, as the stepper); CHOOSE still adds", async () => {
    seed({ min: 0, max: 0, multiplePunchMin: 0, multiplePunchMax: 0, multiplePunchMaxItem: 1 });

    expectNoCounter();
    await tap(screen.getByTestId("pdp-option-missi"));
    expect(picks()).toEqual([["missi", 1]]);
    expectNoCounter();
  });

  it("a required stepper keeps Required beside its counter, and ADD TO BAG on it empty turns Required red with the counter still at the right", async () => {
    seed({ min: 1, max: 2, multiplePunchMin: 1, multiplePunchMax: 2, multiplePunchMaxItem: 2 });

    const required = within(header()).getByText(i18n.t("pdp.required"));
    expect(required).not.toHaveClass("text-red-600");
    expectCounter(0, 2);
    expect(await addToBag()).toBe(false);
    expect(section()).toHaveClass("ring-red-500");
    expect(within(header()).getByText(i18n.t("pdp.required"))).toHaveClass("font-bold", "text-red-600");
    expectCounter(0, 2);
  });

  it("Arabic: a stepper's counter reads the Arabic 'count من max' at the header's right", async () => {
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    seed({ min: 0, max: 1, multiplePunchMin: 0, multiplePunchMax: 1, multiplePunchMaxItem: 3 });

    await tap(plus("Missi Roti"));
    const el = within(header()).getByText(counter(1, 1));
    expect(el.textContent).toContain("من");
    expect(el).not.toHaveTextContent("of");
    expect(header().lastElementChild).toBe(el);
  });
});
