/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart-row fixtures mirror the untyped legacy cart slice rows the component
 * consumes; typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import {
  setMinMaxErroredBaseItems,
  setUpdatedBaseItems,
} from "@cx-sdk/catalog/state/Menu.slice";
import { store } from "../../../redux/app/store";
import BagItemRow, { isRowUnavailable } from "../BagItemRow";
import "../../../i18n";

/** Plain ITEM row — no customizations, no variant, no Edit link (contract B1). */
const ITEM_ROW = {
  id: "fries",
  itemId: "fries-1",
  uniqueItemId: "fries-1-u",
  name: "Large Fries",
  quantity: 1,
  type: "ITEM",
  price: 2.5,
  total_price: 2.5,
  customizations: {},
  baseItem: { id: "fries", name: "Large Fries", price: 2.5 },
};

/**
 * CUSTOMIZABLE row exercising every line-rendering rule (contract A2):
 * priced addon (+£ suffix), qty!==1 addon ("2 x " prefix), free removal
 * (no suffix), and a nested (2-level) customization.
 */
const BURGER_ROW = {
  id: "cheese-burger",
  itemId: "cb-1",
  uniqueItemId: "cb-1-u",
  name: "Cheese Burger",
  quantity: 1,
  type: "CUSTOMIZABLE",
  price: 8,
  total_price: 8.6,
  customizations: {
    sauce_group: [
      {
        id: "onions",
        name: "Add Onions",
        price: 0.6,
        quantity: 1,
        customizations: {
          nest_group: [
            { id: "crispy", name: "Extra Crispy", price: 0, quantity: 1 },
          ],
        },
      },
      { id: "cheese", name: "Extra Cheese", price: 1.2, quantity: 2 },
      { id: "no-lettuce", name: "No Lettuce", price: 0, quantity: 1 },
    ],
  },
  baseItem: {
    id: "cheese-burger",
    name: "Cheese Burger",
    price: 8,
    modifiers: ["sauce_group"],
  },
};

/** VARIANT row — prints selectedVariant.name first, Edit link allowed. */
const DRINK_ROW = {
  id: "pepsi",
  itemId: "pep-1",
  uniqueItemId: "pep-1-u",
  name: "Pepsi",
  quantity: 2,
  type: "VARIANT",
  price: 3,
  total_price: 3,
  selectedVariant: { id: "pepsi-l", name: "Large", price: 3 },
  customizations: {},
  baseItem: { id: "pepsi", name: "Pepsi", hasVariant: true },
};

const renderRow = (
  row: any,
  handlers: { onEdit?: () => void; onRequestRemove?: () => void } = {}
) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagItemRow
          row={row}
          currency="£"
          onEdit={handlers.onEdit ?? vi.fn()}
          onRequestRemove={handlers.onRequestRemove ?? vi.fn()}
        />
      </MemoryRouter>
    </Provider>
  );

const cartItems = () => (store.getState() as any).cart.cartItems;

describe("BagItemRow (Figma 1:3193 — bag row card)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  describe("line rendering per row type", () => {
    it("ITEM row: name + line total, no variant line, no customization lines", () => {
      // Even a stray selectedVariant on an ITEM row must not print — the
      // variant line is gated on type === "VARIANT".
      renderRow({ ...ITEM_ROW, selectedVariant: { id: "x", name: "Jumbo" } });
      const row = screen.getByTestId("bag-row-fries-1");
      expect(row).toHaveTextContent("Large Fries");
      expect(row).toHaveTextContent("£2.50");
      expect(row).not.toHaveTextContent("Jumbo");
      expect(screen.queryByTestId("bag-edit-fries-1")).not.toBeInTheDocument();
    });

    it("CUSTOMIZABLE row: +£ suffix only when price > 0, qty prefix only when quantity !== 1, nested lines included", () => {
      renderRow(BURGER_ROW);
      const row = screen.getByTestId("bag-row-cb-1");
      // Priced addon, qty 1 → no prefix, "+£0.60" suffix.
      expect(row).toHaveTextContent("Add Onions +£0.60");
      // qty 2 addon → "2 x " prefix + price suffix.
      expect(row).toHaveTextContent("2 x Extra Cheese +£1.20");
      // Free removal line → bare name, no "+£0.00".
      expect(row).toHaveTextContent("No Lettuce");
      expect(row).not.toHaveTextContent("No Lettuce +£");
      // Nested (2nd level) line surfaces too.
      expect(row).toHaveTextContent("Extra Crispy");
      // Line total = total_price * quantity.
      expect(row).toHaveTextContent("£8.60");
    });

    it("VARIANT row: prints the selected variant name and multiplies the line total by quantity", () => {
      renderRow(DRINK_ROW);
      const row = screen.getByTestId("bag-row-pep-1");
      expect(row).toHaveTextContent("Pepsi");
      expect(row).toHaveTextContent("Large");
      expect(row).toHaveTextContent("£6.00"); // 3 × 2
    });
  });

  describe("stepper visibility (contract A2: paid rows only)", () => {
    it("paid row shows the − n + stepper", () => {
      renderRow(BURGER_ROW);
      expect(screen.getByTestId("bag-inc-cb-1")).toBeInTheDocument();
      expect(screen.getByTestId("bag-dec-cb-1")).toBeInTheDocument();
    });

    it("isGetItem row hides the stepper AND the Edit link", () => {
      renderRow({ ...BURGER_ROW, isGetItem: true });
      expect(screen.queryByTestId("bag-inc-cb-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("bag-dec-cb-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("bag-edit-cb-1")).not.toBeInTheDocument();
    });

    it("isLoyaltyItem row hides the stepper AND the Edit link", () => {
      renderRow({ ...DRINK_ROW, isLoyaltyItem: true });
      expect(screen.queryByTestId("bag-inc-pep-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("bag-dec-pep-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("bag-edit-pep-1")).not.toBeInTheDocument();
    });

    // Walk 2026-10-14: "Chilli Manchurian [1% OFF] £40.00 → £39.60" for two
    // units with no quantity anywhere. A reward row has no stepper, so its
    // units lead the name ("2 x", the picker's and the add-on lines' prefix).
    const CHILLI_REWARD = {
      id: "chilli",
      itemId: "chilli-g1",
      uniqueItemId: "chilli-g1-u",
      name: "Chilli Manchurian",
      type: "ITEM",
      price: 20,
      total_price: 20,
      quantity: 2,
      customizations: {},
      isGetItem: true,
      discountType: "percent",
      discountValue: 1,
      undiscounted_total_price: 20,
      discounted_total_price: 19.8,
    };

    it("a reward row of 2 units names them: '2 x Chilli Manchurian', £40.00 struck over £39.60", () => {
      renderRow(CHILLI_REWARD);
      const row = screen.getByTestId("bag-row-chilli-g1");
      expect(row).toHaveTextContent("2 x Chilli Manchurian");
      expect(row).toHaveTextContent("£40.00");
      expect(row).toHaveTextContent("£39.60");
      expect(screen.getByTestId("bag-free-chip-chilli-g1")).toHaveTextContent("1% off");
    });

    it("a reward row of 1 unit stays bare (no '1 x'), and a paid row never takes the prefix", () => {
      renderRow({ ...CHILLI_REWARD, quantity: 1 });
      expect(screen.getByTestId("bag-row-chilli-g1")).not.toHaveTextContent(/\d x Chilli/);
      expect(screen.getByTestId("bag-row-chilli-g1")).toHaveTextContent("£19.80");
      renderRow({ ...ITEM_ROW, quantity: 2 });
      expect(screen.getByTestId("bag-row-fries-1")).not.toHaveTextContent("2 x Large Fries");
    });
  });

  describe("Edit link guard matrix (contract B1)", () => {
    it("CUSTOMIZABLE and VARIANT rows get the Edit link", () => {
      const { unmount } = renderRow(BURGER_ROW);
      expect(screen.getByTestId("bag-edit-cb-1")).toBeInTheDocument();
      unmount();
      renderRow(DRINK_ROW);
      expect(screen.getByTestId("bag-edit-pep-1")).toBeInTheDocument();
    });

    it("type ITEM never gets an Edit link", () => {
      renderRow(ITEM_ROW);
      expect(screen.queryByTestId("bag-edit-fries-1")).not.toBeInTheDocument();
    });

    it("outOfStock row loses the Edit link", () => {
      renderRow({ ...BURGER_ROW, outOfStock: true });
      expect(screen.queryByTestId("bag-edit-cb-1")).not.toBeInTheDocument();
    });

    it("isAvailable === false row loses the Edit link", () => {
      renderRow({ ...BURGER_ROW, isAvailable: false });
      expect(screen.queryByTestId("bag-edit-cb-1")).not.toBeInTheDocument();
    });

    // Lane figma-polish S4 #10 (verified 1:3193): the Edit link is the
    // CTA/Show more style — Exp Bd 16/24, −0.08, purple, underlined — and
    // keeps its 44 px target.
    it("the Edit link is CTA/Show more (Exp Bd 16/24, −0.08, purple, underline) and stays ≥ 44 × 44", () => {
      renderRow(BURGER_ROW);
      const edit = screen.getByTestId("bag-edit-cb-1");

      expect(edit).toHaveTextContent("Edit");
      expect(edit).toHaveClass(
        "tb-display",
        "font-bold",
        "normal-case",
        "text-[16px]",
        "leading-[24px]",
        "tracking-[-0.08px]",
        "text-tb-purple",
        "underline",
        "min-h-[44px]",
        "min-w-[44px]",
        "inline-flex",
        "items-center"
      );
    });

    it("Edit tap hands the row to onEdit (the sheet owns the B1 recipe)", async () => {
      const onEdit = vi.fn();
      renderRow(BURGER_ROW, { onEdit });
      await userEvent.click(screen.getByTestId("bag-edit-cb-1"));
      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit.mock.calls[0][0].itemId).toBe("cb-1");
    });
  });

  describe("stepper behavior against the real store", () => {
    it("increase dispatches through useCartHook and bumps the store row", async () => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      renderRow(BURGER_ROW);
      await userEvent.click(screen.getByTestId("bag-inc-cb-1"));
      expect(cartItems()[0].quantity).toBe(2);
      expect((store.getState() as any).cart.totalQuantity).toBe(2);
    });

    it("increase is a no-op for an outOfStock row (guarded before dispatch)", async () => {
      const oosRow = { ...BURGER_ROW, outOfStock: true };
      store.dispatch(setCartItems([oosRow]));
      renderRow(oosRow);
      const inc = screen.getByTestId("bag-inc-cb-1");
      expect(inc).toHaveAttribute("aria-disabled", "true");
      await userEvent.click(inc);
      expect(cartItems()[0].quantity).toBe(1);
    });

    it("decrease at qty > 1 dispatches the plain decrease (no confirm)", async () => {
      const onRequestRemove = vi.fn();
      store.dispatch(setCartItems([{ ...DRINK_ROW }]));
      renderRow(DRINK_ROW, { onRequestRemove });
      await userEvent.click(screen.getByTestId("bag-dec-pep-1"));
      expect(onRequestRemove).not.toHaveBeenCalled();
      expect(cartItems()[0].quantity).toBe(1);
    });

    it("decrease at qty 1 does NOT dispatch — it asks for the remove confirm (locked decision 3)", async () => {
      const onRequestRemove = vi.fn();
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      renderRow(BURGER_ROW, { onRequestRemove });
      await userEvent.click(screen.getByTestId("bag-dec-cb-1"));
      expect(onRequestRemove).toHaveBeenCalledTimes(1);
      expect(onRequestRemove.mock.calls[0][0].itemId).toBe("cb-1");
      // Row untouched until the modal confirms.
      expect(cartItems()).toHaveLength(1);
      expect(cartItems()[0].quantity).toBe(1);
    });
  });

  /*
    audit-fixes U1 — the diet mark (the foundation's VegMark) leads the
    name: tri-state, a VARIANT row reads its size's tags, and the operator's
    hide_veg_non_veg hides it. Fixer UI-1: mark and name share a line that
    never wraps (in the chips' flex-wrap row a long name dropped below the
    mark and left it alone on its line — geometry in visual-bagpdp BAG
    EXTRAS); the mark sits 6 px down, centred on the name's 36 px first line.
  */
  describe("the veg / non-veg mark (U1)", () => {
    it("a veg row: the 24 px veg mark leads the name on a non-wrapping line, labelled for screen readers", () => {
      renderRow({ ...BURGER_ROW, tags: ["veg"] });
      const mark = screen.getByTestId("veg-mark-veg");
      const nameLine = screen.getByText("Cheese Burger").parentElement as HTMLElement;
      expect(nameLine.firstElementChild).toBe(mark);
      expect(nameLine).toHaveClass("flex", "items-start");
      expect(nameLine).not.toHaveClass("flex-wrap");
      expect(mark).toHaveClass("mt-[6px]");
      expect(mark).toHaveAccessibleName("Veg");
      expect(mark).toHaveStyle({ width: "24px", height: "24px" });
      expect(screen.getByTestId("bag-row-cb-1")).toHaveTextContent("Cheese Burger");
    });

    it("a non-veg row: the non-veg mark; an untagged row: none", () => {
      const { unmount } = renderRow({ ...ITEM_ROW, tags: ["non-veg"] });
      expect(screen.getByTestId("veg-mark-non-veg")).toHaveAccessibleName("Non-veg");
      unmount();
      renderRow(ITEM_ROW);
      expect(screen.queryByTestId("veg-mark-veg")).not.toBeInTheDocument();
      expect(screen.queryByTestId("veg-mark-non-veg")).not.toBeInTheDocument();
    });

    it("a VARIANT row reads its size's tags (selectedVariant.tags) over the row's own", () => {
      renderRow({ ...DRINK_ROW, tags: ["veg"], selectedVariant: { ...DRINK_ROW.selectedVariant, tags: ["non-veg"] } });
      expect(screen.getByTestId("veg-mark-non-veg")).toBeInTheDocument();
      expect(screen.queryByTestId("veg-mark-veg")).not.toBeInTheDocument();
    });

    it("hidden under kiosk_settings.hide_veg_non_veg", () => {
      store.dispatch(setKioskSettings({ hide_veg_non_veg: true }));
      renderRow({ ...BURGER_ROW, tags: ["veg"] });
      expect(screen.queryByTestId("veg-mark-veg")).not.toBeInTheDocument();
    });
  });

  /*
    audit-fixes A1 — the looks PAY's stock re-check leaves on a row (design
    language, sign-off): unavailable = art at 50 % + "Unavailable" (out of
    stock, its size out of stock, or outside its schedule); needs changes =
    a red "Some choices are no longer available" line from Menu.slice's PAY
    lists, Edit kept. Neither testid starts "bag-row-" (the specs count
    rows by that prefix).
  */
  describe("the stock looks (A1)", () => {
    const art = (itemId: string) =>
      screen.getByTestId(`bag-row-${itemId}`).firstElementChild as HTMLElement;

    const UNAVAILABLE_FLAGS: [string, object][] = [
      ["outOfStock", { outOfStock: true }],
      ["its size out of stock", { selectedVariant: { id: "pepsi-l", name: "Large", outOfStock: true } }],
      ["outside its schedule (isAvailable false)", { isAvailable: false }],
    ];

    it.each(UNAVAILABLE_FLAGS)("%s → the art at 50 % and 'Unavailable'", (_label, flags) => {
      renderRow({ ...DRINK_ROW, ...flags });
      expect(screen.getByTestId("bag-unavailable-pep-1")).toHaveTextContent("Unavailable");
      expect(art("pep-1")).toHaveClass("opacity-50");
      expect(screen.queryByTestId("bag-changed-pep-1")).not.toBeInTheDocument();
      expect(isRowUnavailable({ ...DRINK_ROW, ...flags })).toBe(true);
    });

    // The affordances read the look's predicate: a row that says
    // "Unavailable" never takes a "+" or offers Edit (a sold-out SIZE
    // included — PAY's sweep flags selectedVariant, not the row).
    it.each(UNAVAILABLE_FLAGS)("%s → '+' is inert and Edit is gone", async (_label, flags) => {
      const row = { ...DRINK_ROW, ...flags };
      store.dispatch(setCartItems([row]));
      renderRow(row);
      const inc = screen.getByTestId("bag-inc-pep-1");
      expect(inc).toHaveAttribute("aria-disabled", "true");
      await userEvent.click(inc);
      expect(cartItems()[0].quantity).toBe(2);
      expect(screen.queryByTestId("bag-edit-pep-1")).not.toBeInTheDocument();
    });

    it("a row with a photo: the photo itself dims (and only while unavailable)", () => {
      const photo = { ...BURGER_ROW, image_url: "https://items.e2e.test/burger.png" };
      const { unmount } = renderRow({ ...photo, outOfStock: true });
      expect(art("cb-1").tagName).toBe("IMG");
      expect(art("cb-1")).toHaveClass("opacity-50", "object-contain");
      unmount();
      renderRow(photo);
      expect(art("cb-1")).not.toHaveClass("opacity-50");
    });

    it("an available row: no line, full art (and the predicate agrees)", () => {
      renderRow({ ...DRINK_ROW, outOfStock: false, isAvailable: true });
      expect(screen.queryByTestId("bag-unavailable-pep-1")).not.toBeInTheDocument();
      expect(art("pep-1")).not.toHaveClass("opacity-50");
      expect(isRowUnavailable({ ...DRINK_ROW, outOfStock: false, isAvailable: true })).toBe(false);
      expect(isRowUnavailable(null)).toBe(false);
    });

    it.each([
      ["lost a choice (updatedBaseItems)", () => store.dispatch(setUpdatedBaseItems({ updatedBaseItems: ["cb-1"] }))],
      ["broke a min / max (minMaxErroredBaseItems)", () => store.dispatch(setMinMaxErroredBaseItems({ minMaxErroredBaseItems: ["cb-1"] }))],
    ])("a row that %s: the red line, Edit kept to fix it", (_label, arrange) => {
      arrange();
      renderRow(BURGER_ROW);
      const line = screen.getByTestId("bag-changed-cb-1");
      expect(line).toHaveTextContent("Some choices are no longer available");
      expect(line).toHaveClass("text-tb-red", "text-[24px]", "leading-[24px]");
      expect(screen.getByTestId("bag-edit-cb-1")).toBeInTheDocument();
      expect(screen.queryByTestId("bag-unavailable-cb-1")).not.toBeInTheDocument();
    });

    it("unavailable wins over needs-changes; another row's id changes nothing", () => {
      store.dispatch(setUpdatedBaseItems({ updatedBaseItems: ["cb-1", "other-1"] }));
      const { unmount } = renderRow({ ...BURGER_ROW, outOfStock: true });
      expect(screen.getByTestId("bag-unavailable-cb-1")).toBeInTheDocument();
      expect(screen.queryByTestId("bag-changed-cb-1")).not.toBeInTheDocument();
      unmount();
      renderRow(DRINK_ROW);
      expect(screen.queryByTestId("bag-changed-pep-1")).not.toBeInTheDocument();
    });

    it("the lines never share the row counters' bag-row- prefix", () => {
      store.dispatch(setUpdatedBaseItems({ updatedBaseItems: ["pep-1"] }));
      renderRow(DRINK_ROW);
      renderRow({ ...BURGER_ROW, outOfStock: true });
      expect(document.querySelectorAll('[data-testid^="bag-row-"]')).toHaveLength(2);
    });
  });
});

/*
  Motion §3.3: the stepper's quantity re-keys a small leaf (a NEW node per
  quantity replays tb-bump; the SAME node otherwise), and the row rises in
  only when BagSheet says it was added while the bag was open.
*/
describe("BagItemRow — motion", () => {
  const tree = (row: any, rise?: boolean) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={["/cart"]}>
        <BagItemRow row={row} rise={rise} currency="£" onEdit={vi.fn()} onRequestRemove={vi.fn()} />
      </MemoryRouter>
    </Provider>
  );
  const qty = () => screen.getByTestId("bag-dec-fries-1").nextElementSibling as HTMLElement;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("the quantity is a NEW tb-bump leaf per quantity, the SAME one on a same-quantity render", () => {
    const { rerender } = render(tree(ITEM_ROW));
    const one = qty();
    expect(one).toHaveClass("tb-bump");
    expect(one).toHaveTextContent(/^1$/);

    rerender(tree({ ...ITEM_ROW, total_price: 3 }));
    expect(qty()).toBe(one);

    rerender(tree({ ...ITEM_ROW, quantity: 2 }));
    expect(qty()).not.toBe(one);
    expect(qty()).toHaveTextContent(/^2$/);
  });

  it("rises (tb-rise) only when told to", () => {
    const { rerender } = render(tree(ITEM_ROW));
    expect(screen.getByTestId("bag-row-fries-1")).not.toHaveClass("tb-rise");
    rerender(tree(ITEM_ROW, true));
    expect(screen.getByTestId("bag-row-fries-1")).toHaveClass("tb-rise");
  });
});
