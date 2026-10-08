import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { store } from "../../../redux/app/store";
import CustomerPhone from "../index";
import i18n from "../../../i18n";

/*
  P9a (D10, Rule 1): the check_loyalty_balance continuation dispatches and
  navigates after its await. Once /phone is gone (Back, Skip, Cancel, idle ->
  /start) it must do neither — it would yank the kiosk off whatever screen it
  is on and open the rewards sheet for the NEXT customer. useLoyalty is the
  seam (its own late-write guard is covered in useLoyalty.test); useNavigate
  is a spy.
*/

const mockNavigate = vi.fn();
const mockExecuteLoyalty = vi.fn();
const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../hooks/loyalty/useLoyalty", () => ({
  default: () => ({
    executeLoyalty: (...args: unknown[]) => mockExecuteLoyalty(...args),
    isLoyaltyEventLoading: false,
  }),
}));

const XENO = {
  partner: { partner_name: "Xeno", partner_merchant_id: "xeno-merchant-uuid-1" },
  partnerDetails: { partner_name: "Xeno" },
};

/** A Xeno customer with something to redeem → the rewards sheet opens. */
const REWARDS = {
  status_code: 200,
  response: { coupons: [{ coupon_code: "static6562" }], loyalty_points: 3000 },
};

const rewardsSheetOpen = () =>
  (store.getState() as { loyalty: { loyaltyItemsModal: { isOpen: boolean } } })
    .loyalty.loyaltyItemsModal.isOpen;

const mount = (state?: { checkoutRoute: string }) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[{ pathname: "/phone", state }]}>
        <CustomerPhone />
      </MemoryRouter>
    </Provider>
  );

/** CONTINUE with a valid number; the lookup stays in flight until settled. */
const continueWithLookupInFlight = () => {
  let settle!: { answer: (r: unknown) => void; fail: (e: unknown) => void };
  mockExecuteLoyalty.mockReturnValue(
    new Promise((resolve, reject) => {
      settle = { answer: resolve, fail: reject };
    })
  );
  act(() => {
    fireEvent.click(screen.getByTestId("phone-continue"));
  });
  expect(mockExecuteLoyalty).toHaveBeenCalledTimes(1);
  const flush = (fn: () => void) =>
    act(async () => {
      fn();
      await Promise.resolve();
      await Promise.resolve();
    });
  return {
    answer: (r: unknown) => flush(() => settle.answer(r)),
    fail: (e: unknown) => flush(() => settle.fail(e)),
  };
};

describe("CustomerPhone — a late lookup never navigates (P9a, D10)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    store.dispatch(setLoyaltyPartner(XENO));
    // Ten digits for the default IN country (min = max = 10).
    store.dispatch(setPhoneNumberRdx("9876543210"));
    mockNavigate.mockReset();
    mockExecuteLoyalty.mockReset();
  });

  it("answered while /phone is up: opens the rewards sheet and continues to the menu", async () => {
    mount();
    const lookup = continueWithLookupInFlight();

    await lookup.answer(REWARDS);

    expect(rewardsSheetOpen()).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith("/menu");
  });

  it("answered after the customer left: no rewards sheet, no navigation", async () => {
    const view = mount();
    const lookup = continueWithLookupInFlight();

    view.unmount();
    await lookup.answer(REWARDS);

    expect(rewardsSheetOpen()).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("failed after the customer left: no navigation either", async () => {
    const view = mount();
    const lookup = continueWithLookupInFlight();

    view.unmount();
    await lookup.fail(new Error("loyalty proxy 502"));

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("CustomerPhone placeholder (P9f contrast)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("the empty-number placeholder is 55 % black (35 % was 2.43:1)", () => {
    mount();

    const placeholder = screen.getByText(i18n.t("phone.placeholder"));
    expect(placeholder).toHaveClass("text-black/55");
    expect(placeholder).not.toHaveClass("text-black/35");
  });
});

/*
  audit-fixes A3 (F34): in CHECKOUT mode the guest has a bag, so CANCEL ORDER
  asks first (CancelOrderModal, Figma 1:4552). NO keeps the screen; YES ONLY
  navigates to /start — /start's mount revokes and resets (H1), so this screen
  never touches the store. Pre-menu /phone keeps the direct exit (an empty
  bag, like /second — D-A3-1).
*/
describe("CustomerPhone — CANCEL ORDER (A3)", () => {
  const BURGER = { id: "cb", itemId: "cb-1", name: "Cheese Burger", quantity: 1, type: "ITEM", total_price: 8 };
  const cartRows = () => (store.getState() as { cart: { cartItems: unknown[] } }).cart.cartItems;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCartItems([BURGER]));
    mockNavigate.mockReset();
  });

  it("checkout mode: CANCEL ORDER opens the confirm and navigates nowhere", async () => {
    mount({ checkoutRoute: "phone" });

    await userEvent.click(screen.getByTestId("footer-cancel"));

    expect(screen.getByTestId("cancel-order-modal")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("checkout mode: NO closes the confirm and stays on /phone with the bag", async () => {
    mount({ checkoutRoute: "phone" });
    await userEvent.click(screen.getByTestId("footer-cancel"));

    await userEvent.click(screen.getByTestId("cancel-order-cancel"));

    expect(screen.queryByTestId("cancel-order-modal")).toBeNull();
    expect(screen.getByTestId("phone-screen")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(cartRows()).toHaveLength(1);
  });

  it("checkout mode: YES only navigates to /start — the store is untouched (H1: /start's mount resets)", async () => {
    mount({ checkoutRoute: "phone" });
    await userEvent.click(screen.getByTestId("footer-cancel"));
    const dispatch = vi.spyOn(store, "dispatch");

    await userEvent.click(screen.getByTestId("cancel-order-confirm"));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/start");
    expect(dispatch).not.toHaveBeenCalled();
    expect(cartRows()).toEqual([BURGER]);
    dispatch.mockRestore();
  });

  it("pre-menu: CANCEL ORDER goes straight to /start (no confirm)", async () => {
    mount();

    await userEvent.click(screen.getByTestId("footer-cancel"));

    expect(screen.queryByTestId("cancel-order-modal")).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith("/start");
  });
});

/*
  audit-fixes UB5: the "+91" pill opens the country picker. A pick stores
  {…, picked: true}; the keypad cap, the length check and the lookup's
  country code follow it; the typed digits stay (fork parity); the keypad
  ignores a leading 0.
*/
describe("CustomerPhone — the country picker (UB5)", () => {
  const UAE = { code: "AE", dialCode: "+971", min: 9, max: 9, picked: true };
  const country = () =>
    (store.getState() as { auth: { selectedCountryCode: unknown } }).auth.selectedCountryCode;
  const globalError = () =>
    (store.getState() as { appSettings: { errorMessageGlobal: string } }).appSettings
      .errorMessageGlobal;

  const typeDigits = async (digits: string) => {
    for (const digit of digits) {
      await userEvent.click(screen.getByTestId(`numpad-key-${digit}`));
    }
  };

  // The sheet rides the ONE lazy chunk, which the /phone mount starts
  // loading; transforming it the first time takes longer than findBy's 1 s.
  beforeAll(async () => {
    await import("../../../components/cart/bagLazyParts");
  }, 30_000);

  /** Pill → sheet (its lazy chunk loads at the /phone mount) → search → row. */
  const pickUae = async () => {
    await userEvent.click(screen.getByTestId("phone-country-code"));
    const sheet = await screen.findByTestId("country-sheet");
    const keyboard = within(within(sheet).getByTestId("kiosk-keyboard"));
    for (const key of "emir") {
      await userEvent.click(keyboard.getByRole("button", { name: key }));
    }
    await userEvent.click(within(sheet).getByTestId("country-AE"));
  };

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    store.dispatch(setLoyaltyPartner(XENO));
    mockNavigate.mockReset();
    mockExecuteLoyalty.mockReset();
    mockExecuteLoyalty.mockResolvedValue(REWARDS);
    mockCapture.mockReset();
  });

  it("the pill is a named button (phone.changeCountry) that opens the sheet and reports the tap", async () => {
    mount();

    const pill = screen.getByRole("button", {
      name: i18n.t("phone.changeCountry", { dialCode: "+91" }),
    });
    expect(pill).toHaveAttribute("data-testid", "phone-country-code");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveTextContent("+91");

    await userEvent.click(pill);

    expect(await screen.findByTestId("country-sheet")).toBeInTheDocument();
    expect(mockCapture).toHaveBeenCalledWith("country_code_selection_clicked", {
      current_country_code: "+91",
    });
  });

  it("picking the UAE stores it with picked:true and the pill follows", async () => {
    mount();

    await pickUae();

    expect(country()).toEqual(UAE);
    expect(screen.queryByTestId("country-sheet")).toBeNull();
    expect(screen.getByTestId("phone-country-code")).toHaveTextContent("+971");
    expect(screen.getByTestId("phone-country-code")).toHaveAccessibleName(
      i18n.t("phone.changeCountry", { dialCode: "+971" })
    );
  });

  it("the keypad caps at the UAE's 9 digits and 8 digits get the exact-length error", async () => {
    mount();
    await pickUae();

    await typeDigits("5012345678");
    await userEvent.click(screen.getByTestId("phone-visibility"));
    expect(screen.getByTestId("phone-number-display")).toHaveTextContent("501234567");

    await userEvent.click(screen.getByTestId("numpad-backspace"));
    await userEvent.click(screen.getByTestId("phone-continue"));
    expect(globalError()).toBe(i18n.t("phone.exactDigits", { digits: 9 }));
    expect(mockExecuteLoyalty).not.toHaveBeenCalled();
  });

  it("CONTINUE looks the number up with the picked country code", async () => {
    mount();
    await pickUae();

    await typeDigits("501234567");
    await act(async () => {
      fireEvent.click(screen.getByTestId("phone-continue"));
    });

    expect(mockExecuteLoyalty).toHaveBeenCalledWith({
      countryCode: "+971",
      phoneNumber: "501234567",
    });
    expect(mockCapture).toHaveBeenCalledWith(
      "phone_number_entered",
      expect.objectContaining({ country_code: "+971", phone_length: 9 })
    );
  });

  it("the typed digits survive a country change (fork parity)", async () => {
    mount();
    await typeDigits("98765");

    await pickUae();

    await userEvent.click(screen.getByTestId("phone-visibility"));
    expect(screen.getByTestId("phone-number-display")).toHaveTextContent("98765");
  });

  it("the keypad ignores a leading 0 (a trunk prefix) and keeps later zeros", async () => {
    mount();

    await typeDigits("0501");
    await userEvent.click(screen.getByTestId("phone-visibility"));

    // Exact: toHaveTextContent("501") is a substring match, so "0501" passed it too.
    expect(screen.getByTestId("phone-number-display").textContent).toBe("501");
  });
});
