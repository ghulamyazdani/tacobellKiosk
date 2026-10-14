import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { selectCustomerPhone } from "@cx-sdk/core/customer/customerInfo.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import CustomerPhone from "../index";
import i18n from "../../../i18n";

/*
  User 2026-10-14: BACK returns to the step the guest came from — in checkout
  mode the table number when the order has one, else the bag (it was always
  the bag); pre-menu /second, as before. The typed number is kept.
*/

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../hooks/loyalty/useLoyalty", () => ({
  default: () => ({ executeLoyalty: vi.fn(), isLoyaltyEventLoading: false }),
}));

const BURGER = { id: "cb", itemId: "cb-1", name: "Cheese Burger", quantity: 1, type: "ITEM", total_price: 8 };
const CHECKOUT = { checkoutRoute: "phone" };

const mount = (state?: { checkoutRoute: string }) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[{ pathname: "/phone", state }]}>
        <CustomerPhone />
      </MemoryRouter>
    </Provider>
  );
const tap = (testId: string) => fireEvent.click(screen.getByTestId(testId));

describe("/phone — BACK to the step the guest came from", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCartItems([BURGER]));
    // A table order with CRM shown and loyalty off: bag → /tent → /phone.
    store.dispatch(setTabType("table"));
    store.dispatch(setKioskSettings({ skip_crm_page: false }));
    mockNavigate.mockReset();
  });

  it("checkout mode, a table order: BACK → the table number, the typed digits kept", () => {
    mount(CHECKOUT);
    for (const digit of "98765") tap(`numpad-key-${digit}`);
    tap("phone-back");

    expect(mockNavigate.mock.calls).toEqual([["/tent"]]);
    expect(selectCustomerPhone(store.getState())).toBe("98765");
  });

  it("checkout mode, no table step: BACK → the bag", () => {
    store.dispatch(setTabType("take_away"));
    mount(CHECKOUT);
    tap("phone-back");

    expect(mockNavigate.mock.calls).toEqual([["/cart"]]);
  });

  it("pre-menu (the loyalty lookup): BACK → the order-type screen, unchanged", () => {
    mount();
    tap("phone-back");

    expect(mockNavigate.mock.calls).toEqual([["/second"]]);
  });

  it("BACK reads BACK, and CANCEL ORDER's NO reads NO, BACK — never BACK TO MENU: it stays on /phone", () => {
    mount(CHECKOUT);
    expect(screen.getByTestId("phone-back")).toHaveTextContent(i18n.t("phone.back"));
    tap("footer-cancel");
    const no = screen.getByTestId("cancel-order-cancel");

    expect(no).toHaveTextContent(i18n.t("cancelOrder.back"));
    expect(no.textContent).not.toMatch(/menu/i);
    tap("cancel-order-cancel");
    expect(screen.getByTestId("phone-screen")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
