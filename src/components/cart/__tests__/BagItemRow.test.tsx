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
import { store } from "../../../redux/app/store";
import BagItemRow from "../BagItemRow";
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
});
