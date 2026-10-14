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
import i18n from "../../../i18n";

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

describe("OfferRemovalNotice — the offer name (walk 2026-10-14)", () => {
  // The rows case a name with CSS capitalize ("amount ic" shows "Amount
  // Ic"); in this sentence the name is its own element with the same class.
  const renderNamed = (name: string) => {
    store.dispatch(setCartItems([row("p0"), row("p1"), row("p2")]));
    store.dispatch(openOfferRemovalModal({ ...MIN_THREE, name }));
    render(
      <Provider store={store}>
        <MemoryRouter>
          <OfferRemovalNotice />
        </MemoryRouter>
      </Provider>
    );
  };

  it("the name is its own capitalize element inside the whole sentence", () => {
    renderNamed("amount ic");
    const name = screen.getByTestId("offer-removal-name");
    expect(name).toHaveTextContent(/^amount ic$/);
    expect(name).toHaveClass("capitalize");
    expect(name.parentElement).toHaveTextContent(/^amount ic no longer applies to your order\.$/);
  });

  it("Arabic: the sentence stays whole around the name, and the name stays an isolate", async () => {
    await i18n.changeLanguage("ar");
    try {
      renderNamed("amount ic");
      const name = screen.getByTestId("offer-removal-name");
      const sentence = name.parentElement as HTMLElement;
      // The same sentence i18n renders with the name in its slot.
      expect(sentence.textContent).toBe(i18n.t("offers.removedBody", { name: "amount ic" }));
      expect(sentence.textContent).toMatch(/\p{Script=Arabic}/u);
      expect(sentence.textContent).toContain("⁨amount ic⁩");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
