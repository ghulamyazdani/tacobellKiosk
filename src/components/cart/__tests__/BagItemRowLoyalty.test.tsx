/* eslint-disable @typescript-eslint/no-explicit-any --
 * Reward-row fixtures mirror redeemItem()'s untyped output (the legacy cart
 * slice shape). Typed in the P7+ domain passes. Do not add NEW anys.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import BagItemRow from "../BagItemRow";
import "../../../i18n";

/**
 * A XENO reward row exactly as it arrives: redeemItem() stamps
 * `isRedeemed`, applies the percentage discount to price/total_price and
 * keeps the undiscounted pair; addLoyaltyItemToCart() stamps itemId/quantity.
 * `extra_fields` survives the coupon→menu join and is what the bag reads the
 * refund off (contract step 7).
 */
const FREE_SALAD_ROW = {
  id: "5dd1093829754a432f2c32e2",
  itemId: "lr-1",
  uniqueItemId: "lr-1-u",
  name: "Greek Salad",
  quantity: 1,
  type: "ITEM",
  isLoyaltyItem: true,
  isRedeemed: true,
  coupon_code: "static6562",
  discount_type: "percentage",
  discount_value: 100,
  price: 0,
  total_price: 0,
  undiscounted_price: 17,
  undiscounted_total_price: 17,
  extra_fields: [{ name: "Points Value", value: 3000 }],
  customizations: {},
};

/** Half-price reward — the "{v}% off" chip and a non-zero live line. */
const HALF_BURGER_ROW = {
  ...FREE_SALAD_ROW,
  id: "5dd10936712f5b622a66aab7",
  itemId: "lr-2",
  uniqueItemId: "lr-2-u",
  name: "Cheese Burger",
  type: "CUSTOMIZABLE",
  coupon_code: "static8056",
  discount_value: 50,
  price: 4,
  total_price: 4,
  undiscounted_price: 8,
  undiscounted_total_price: 8,
  extra_fields: [{ name: "Points Value", value: 1000 }],
};

const renderRow = (row: any, onRemoveLoyalty = vi.fn()) => {
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <BagItemRow
          row={row}
          currency="£"
          onEdit={vi.fn()}
          onRequestRemove={vi.fn()}
          onRemoveLoyalty={onRemoveLoyalty}
        />
      </MemoryRouter>
    </Provider>
  );
  return { ...utils, onRemoveLoyalty };
};

describe("BagItemRow — XENO reward treatment (locked decision 6)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCartItems([{ ...FREE_SALAD_ROW }]));
  });

  it("a reward row gets the loyalty testid, NOT the paid-row one", () => {
    renderRow(FREE_SALAD_ROW);
    expect(screen.getByTestId("bag-loyalty-row-lr-1")).toBeInTheDocument();
    // The bag/offers specs count `bag-row-` rows — a reward must not join them.
    expect(screen.queryByTestId("bag-row-lr-1")).not.toBeInTheDocument();
  });

  it("100 % coupon → Free chip, struck undiscounted line over the live £0.00", () => {
    renderRow(FREE_SALAD_ROW);
    const row = screen.getByTestId("bag-loyalty-row-lr-1");
    expect(screen.getByTestId("bag-loyalty-chip-lr-1")).toHaveTextContent(
      "Free"
    );
    expect(within(row).getByText("£17.00")).toHaveClass("line-through");
    expect(within(row).getByText("£0.00")).toBeInTheDocument();
    expect(within(row).getByText("£0.00")).not.toHaveClass("line-through");
  });

  it("partial coupon → '{v}% off' chip, struck £8.00 over the live £4.00", () => {
    renderRow(HALF_BURGER_ROW);
    const row = screen.getByTestId("bag-loyalty-row-lr-2");
    expect(screen.getByTestId("bag-loyalty-chip-lr-2")).toHaveTextContent(
      "50% off"
    );
    expect(within(row).getByText("£8.00")).toHaveClass("line-through");
    expect(within(row).getByText("£4.00")).toBeInTheDocument();
  });

  it("a non-percentage coupon keeps the blanket Free ribbon (redeemItem never discounted it)", () => {
    renderRow({
      ...FREE_SALAD_ROW,
      discount_type: "flat",
      discount_value: 5,
      price: 17,
      total_price: 17,
    });
    expect(screen.getByTestId("bag-loyalty-chip-lr-1")).toHaveTextContent(
      "Free"
    );
    // No struck line when nothing was actually discounted.
    const row = screen.getByTestId("bag-loyalty-row-lr-1");
    expect(within(row).getByText("£17.00")).not.toHaveClass("line-through");
  });

  it("quantity is locked: no stepper and no Edit link on a reward row", () => {
    renderRow(HALF_BURGER_ROW);
    expect(screen.queryByTestId("bag-inc-lr-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bag-dec-lr-2")).not.toBeInTheDocument();
    // …even though the row is CUSTOMIZABLE, which would normally earn Edit.
    expect(screen.queryByTestId("bag-edit-lr-2")).not.toBeInTheDocument();
  });

  describe("conditional Remove (contract branch table)", () => {
    it("a servable reward has NO Remove — the customer cannot drop it", () => {
      renderRow(FREE_SALAD_ROW);
      expect(
        screen.queryByTestId("bag-loyalty-remove-lr-1")
      ).not.toBeInTheDocument();
    });

    it("outOfStock reveals Remove and hands the row to onRemoveLoyalty", async () => {
      const row = { ...FREE_SALAD_ROW, outOfStock: true };
      const { onRemoveLoyalty } = renderRow(row);
      const remove = screen.getByTestId("bag-loyalty-remove-lr-1");
      expect(remove).toHaveTextContent("Remove");
      // Rule 4 — the reversal affordance is still a kiosk touch target.
      expect(remove.className).toContain("min-h-[44px]");

      await userEvent.click(remove);
      expect(onRemoveLoyalty).toHaveBeenCalledTimes(1);
      expect(onRemoveLoyalty.mock.calls[0][0].itemId).toBe("lr-1");
      // The row itself never mutates the cart — BagSheet owns the recipe.
      expect((store.getState() as any).cart.cartItems).toHaveLength(1);
    });

    it("isAvailable === false also reveals Remove", () => {
      renderRow({ ...FREE_SALAD_ROW, isAvailable: false });
      expect(
        screen.getByTestId("bag-loyalty-remove-lr-1")
      ).toBeInTheDocument();
    });

    it("an unavailable PAID row never gets the loyalty Remove", () => {
      renderRow({
        id: "fries",
        itemId: "paid-1",
        name: "Large Fries",
        quantity: 1,
        type: "ITEM",
        price: 2.5,
        total_price: 2.5,
        outOfStock: true,
        customizations: {},
      });
      expect(
        screen.queryByTestId("bag-loyalty-remove-paid-1")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("bag-row-paid-1")).toBeInTheDocument();
    });
  });
});
