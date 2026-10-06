import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
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

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/phone"]}>
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
