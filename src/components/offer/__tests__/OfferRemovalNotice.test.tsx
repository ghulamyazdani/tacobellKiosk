/**
 * REWARD REMOVED notice — the copy it restates (walk 2026-10-14): the WHY of
 * a min-items removal is the sheet's own nudge, plural-aware.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { openOfferRemovalModal, setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { setCurrency } from "@cx-sdk/catalog/state/appSettings.slice";
import { store } from "../../../redux/app/store";
import OfferRemovalNotice from "../OfferRemovalNotice";
import "../../../i18n";

const row = (itemId: string) => ({
  id: "tortilla",
  itemId,
  uniqueItemId: itemId,
  name: "Tortilla Sauce",
  type: "ITEM",
  price: 2,
  total_price: 2,
  quantity: 1,
  customizations: {},
});

/** £2 off once the order holds 3 items. */
const MIN_THREE = {
  _id: "min-three",
  name: "Test % 2 & 3",
  type: { name: "amount", value: 2 },
  minItemCount: 3,
  applicable: { on: "complete", rawItems: [] },
};

const renderNotice = (paidUnits: number) => {
  store.dispatch(setCartItems(Array.from({ length: paidUnits }, (_, i) => row(`p${i}`))));
  store.dispatch(openOfferRemovalModal(MIN_THREE));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <OfferRemovalNotice />
      </MemoryRouter>
    </Provider>
  );
  return screen.getByTestId("offer-removal-notice");
};

beforeEach(() => {
  store.dispatch({ type: "RESET_STATE" });
  store.dispatch(setCurrency({ currency: "GBP", text: "£" }));
});

describe("OfferRemovalNotice — the min-items reason", () => {
  it("1 short → 'Add 1 more item…' (singular)", () => {
    expect(renderNotice(2)).toHaveTextContent(
      "Add 1 more item to your order to be eligible to redeem this reward"
    );
  });

  it("2 short → 'Add 2 more items…' (plural, no '+')", () => {
    const notice = renderNotice(1);
    expect(notice).toHaveTextContent("Add 2 more items to your order to be eligible to redeem this reward");
    expect(notice).not.toHaveTextContent("+");
  });
});
