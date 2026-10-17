/* eslint-disable @typescript-eslint/no-explicit-any --
 * Coupon blobs and the loyalty proxy envelope are untyped in the SDK (same
 * domain header the component under test carries). Typed in a later loyalty
 * domain pass. Do not add NEW anys.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import { setTabType } from "@cx-sdk/catalog/state/pipeline.slice";
import { setCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import { setCustomerName } from "@cx-sdk/core/customer/customerInfo.slice";
import { store } from "../../../redux/app/store";
import LoyaltyLoginModal from "../LoyaltyLoginModal";
import i18n from "../../../i18n";

/** Same RTK-layer seam as the rewards-sheet suite — see its header note. */
const { executeEvent, mockCapture } = vi.hoisted(() => ({
  executeEvent: vi.fn(),
  mockCapture: vi.fn(),
}));

vi.mock("../../../utils/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/analytics")>()),
  captureKioskEvent: (...args: unknown[]) => mockCapture(...args),
}));

vi.mock("@cx-sdk/ordering/services/loyaltyApi", () => ({
  useExecuteLoyaltyEventMutation: () => [
    executeEvent,
    { isLoading: false, reset: () => {} },
  ],
  useGetLoyaltyPartnerMutation: () => [vi.fn(), { isLoading: false }],
}));

const PHONE = "9953833675";

const GREEK_SALAD = {
  id: "5dd1093829754a432f2c32e2",
  name: "Greek Salad",
  price: 17,
  image_url: "https://cdn.example.test/greek-salad.jpg",
  modifiers: [] as string[],
};

const MENU = {
  categories: [
    { id: "cat-1", subCategories: [{ id: "sub-1", entities: [GREEK_SALAD] }] },
  ],
};

const FREE_SALAD = {
  coupon_name: "Free Greek Salad",
  coupon_code: "static6562",
  discount_on: "item",
  discount_type: "percentage",
  discount_value: 100,
  special_offer: false,
  item_options: {},
  products: [{ _id: GREEK_SALAD.id, quantity: 1 }],
  extra_fields: [
    { name: "Points Value", value: 3000 },
    { name: "Reward Type", value: "Loyalty Reward" },
  ],
};

const PARTNER = {
  partner: {
    partner_name: "Xeno",
    customer_key: "xeno-customer-key-1",
    partner_merchant_id: "xeno-merchant-uuid-1",
    partner_merchant_username: "kiosk@xeno.in",
  },
  partnerDetails: { client_id: "xeno-client-1", partner_name: "Xeno" },
};

const BALANCE_OK = {
  status_code: 200,
  response: {
    loyalty_points: 6000,
    total_redeemable_points: 6000,
    min_bill_for_redemption: 0,
    coupons: [FREE_SALAD],
  },
};
const BALANCE_EMPTY = {
  status_code: 200,
  response: { coupons: [], loyalty_points: 0 },
};
const BALANCE_FAILED = {
  status_code: 400,
  response: { success: false, message: "Loyalty service unavailable" },
};

const loyaltyState = () => (store.getState() as any).loyalty;
const customerState = () => (store.getState() as any).customerInfo;

const seedDeployment = () => {
  store.dispatch(setLoyaltyPartner(PARTNER));
  store.dispatch(
    setCountryCode({ code: "IN", dialCode: "+91", min: 10, max: 10 })
  );
  store.dispatch(setMenuData({ menu: MENU }));
};

const renderModal = (open = true) => {
  const onClose = vi.fn();
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <LoyaltyLoginModal open={open} onClose={onClose} />
      </MemoryRouter>
    </Provider>
  );
  return { ...utils, onClose };
};

const typeDigits = async (digits: string) => {
  for (const digit of digits) {
    await userEvent.click(screen.getByTestId(`numpad-key-${digit}`));
  }
};

describe("LoyaltyLoginModal (Figma 1:4174 — REWARDS login)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    executeEvent.mockReset();
    executeEvent.mockResolvedValue({ data: BALANCE_OK });
    // The ported revoke is a raw cross-origin fetch — never let a unit test
    // reach the network.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve({ status: "success" }) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing while closed", () => {
    seedDeployment();
    renderModal(false);
    expect(screen.queryByTestId("loyalty-login")).not.toBeInTheDocument();
  });

  it("open: the segmented pill, the masked entry display, the numpad and the CONTINUE bar", () => {
    seedDeployment();
    renderModal();
    expect(screen.getByTestId("loyalty-login")).toBeInTheDocument();
    expect(screen.getByTestId("loyalty-tab-scan")).toHaveTextContent("Scan App");
    expect(screen.getByTestId("loyalty-tab-code")).toHaveTextContent(
      "Enter Phone"
    );
    expect(screen.getByTestId("loyalty-phone-display")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Enter your mobile number" })).toHaveAttribute("aria-readonly", "true");
    expect(screen.getByTestId("kiosk-numpad")).toBeInTheDocument();
    expect(screen.getByTestId("loyalty-login-submit")).toHaveTextContent(
      "Continue"
    );
    // UB5: the dial code is a chip of its own that opens the country picker.
    const chip = screen.getByTestId("loyalty-country-code");
    expect(chip).toHaveTextContent("+91");
    expect(chip).toHaveAccessibleName(i18n.t("phone.changeCountry", { dialCode: "+91" }));
    expect(chip).toHaveAttribute("aria-haspopup", "dialog");
    expect(chip.className).toContain("min-h-[44px]");
    expect(screen.getByTestId("loyalty-phone-display")).not.toHaveTextContent("+91");
  });

  describe("SCAN APP is present but inert (locked decision 3)", () => {
    it("is marked aria-disabled while ENTER PHONE is the pressed segment", () => {
      seedDeployment();
      renderModal();
      expect(screen.getByTestId("loyalty-tab-scan")).toHaveAttribute(
        "aria-disabled",
        "true"
      );
      expect(screen.getByTestId("loyalty-tab-scan")).toHaveAttribute(
        "aria-pressed",
        "false"
      );
      expect(screen.getByTestId("loyalty-tab-code")).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    it("tapping it shows the coming-soon state and starts NO lookup, opens NO sheet", async () => {
      seedDeployment();
      const { onClose } = renderModal();
      await userEvent.click(screen.getByTestId("loyalty-tab-scan"));

      expect(screen.getByTestId("loyalty-tab-scan")).toHaveTextContent(
        "Coming soon"
      );
      // Still the live segment — the pill never switches.
      expect(screen.getByTestId("loyalty-tab-code")).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      expect(executeEvent).not.toHaveBeenCalled();
      expect(loyaltyState().loyaltyItemsModal.isOpen).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("phone entry", () => {
    it("the newest digit is legible in the display while the rest stay masked", async () => {
      seedDeployment();
      renderModal();
      await typeDigits("7");
      expect(screen.getByTestId("loyalty-phone-display")).toHaveTextContent("7");
    });

    it("an empty entry is refused before any request goes out", async () => {
      seedDeployment();
      renderModal();
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Please enter a valid mobile number");
      expect(executeEvent).not.toHaveBeenCalled();
    });

    it("a number short of the country's `min` is refused before any request goes out", async () => {
      seedDeployment();
      renderModal();
      await typeDigits("99538");
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Please enter a valid mobile number");
      expect(executeEvent).not.toHaveBeenCalled();
      // TRY AGAIN keeps the customer on the entry, ready to correct it.
      await userEvent.click(screen.getByTestId("loyalty-error-retry"));
      expect(screen.getByTestId("loyalty-login")).toBeInTheDocument();
    });

    it("the numpad cannot overrun the country's `max`", async () => {
      seedDeployment();
      renderModal();
      await typeDigits(`${PHONE}77`);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      await waitFor(() => expect(executeEvent).toHaveBeenCalledTimes(1));
      expect(customerState().customerInfo.customerPhone).toBe(PHONE);
    });
  });

  describe("submit runs the /phone lookup path (contract steps 3-4, minus the navigation)", () => {
    it("success with coupons + points: phone stored, balance pushed, rewards sheet armed with isTimerOn, modal closed", async () => {
      seedDeployment();
      // A previous customer's name must not follow a new number.
      store.dispatch(setCustomerName("Rahul"));
      const { onClose } = renderModal();

      await typeDigits(PHONE);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

      // check_loyalty_balance — a pure lookup, NO OTP at this step.
      expect(executeEvent).toHaveBeenCalledTimes(1);
      expect(executeEvent.mock.calls[0][0].event_name).toBe(
        "check_loyalty_balance"
      );
      expect(JSON.stringify(executeEvent.mock.calls[0][0].data)).toContain(
        PHONE
      );

      expect(customerState().customerInfo.customerPhone).toBe(PHONE);
      expect(customerState().customerName).toBe("");
      expect(loyaltyState().totalLoyaltyPoints).toBe(6000);
      expect(loyaltyState().coupons).toHaveLength(1);
      expect(loyaltyState().areCouponsAvailable).toBe(true);
      // THE post-lookup auto-open branch the Menu page hosts.
      expect(loyaltyState().loyaltyItemsModal).toEqual({
        isOpen: true,
        isTimerOn: true,
      });
    });

    it("success with NO coupons: flag cleared, sheet stays shut, modal stays open behind the notice", async () => {
      executeEvent.mockResolvedValue({ data: BALANCE_EMPTY });
      seedDeployment();
      const { onClose } = renderModal();

      await typeDigits(PHONE);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent(
        "No coupons available for you at the moment"
      );
      expect(loyaltyState().areCouponsAvailable).toBe(false);
      expect(loyaltyState().loyaltyItemsModal.isOpen).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
      // The phone still landed — a failed lookup must not lose the identity.
      expect(customerState().customerInfo.customerPhone).toBe(PHONE);
    });

    it("another number after that 200, closed before its lookup answers: nobody is identified", async () => {
      executeEvent.mockResolvedValue({ data: BALANCE_EMPTY });
      seedDeployment();
      const { unmount } = renderModal();
      await typeDigits(PHONE);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));
      await screen.findByTestId("loyalty-error");
      expect(loyaltyState().isLoyaltyIdentified).toBe(true);

      // TRY AGAIN → a different number; the guest closes while Xeno is slow.
      await userEvent.click(screen.getByTestId("loyalty-error-retry"));
      await userEvent.click(screen.getByTestId("numpad-clear"));
      let answer!: (value: unknown) => void;
      executeEvent.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
      await typeDigits("8800112233");
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));
      unmount();
      await act(async () => answer({ data: BALANCE_OK }));

      // Not A's 200 standing for B: the rewards entry retries, PAY asks.
      expect(customerState().customerInfo.customerPhone).toBe("8800112233");
      expect(loyaltyState().isLoyaltyIdentified).toBe(false);
    });

    it("a rejected lookup surfaces the retryable failure copy and never opens the sheet", async () => {
      executeEvent.mockResolvedValue({ data: BALANCE_FAILED });
      seedDeployment();
      const { onClose } = renderModal();

      await typeDigits(PHONE);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent(
        "We couldn't reach your rewards account. Please try again."
      );
      expect(loyaltyState().areCouponsAvailable).toBe(false);
      expect(loyaltyState().loyaltyItemsModal.isOpen).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("a thrown transport is contained: the modal stays usable (Rule 2)", async () => {
      executeEvent.mockRejectedValue(new Error("network down"));
      seedDeployment();
      const { onClose } = renderModal();

      await typeDigits(PHONE);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent(
        "We couldn't reach your rewards account. Please try again."
      );
      expect(loyaltyState().loyaltyItemsModal.isOpen).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  /*
    The lookup funnel: the login is now where a loyalty guest's number is
    looked up, so it reports what the pre-menu /phone reports for the same
    steps, with the same properties — and never the number.
  */
  describe("the lookup funnel — /phone's events", () => {
    const FUNNEL = [
      "number_screen_viewed",
      "phone_number_entered",
      "account_send_code",
      "account_reorder_available",
      "account_reorder_unavailable",
      "order_checkin_not_available",
      "account_resend_code_error",
    ];
    const funnel = () => mockCapture.mock.calls.filter(([name]) => FUNNEL.includes(name));
    const submitted = [
      ["phone_number_entered", { phone_length: 10, country_code: "+91" }],
      ["account_send_code", { country_code: "+91" }],
    ];

    beforeEach(() => {
      mockCapture.mockReset();
      seedDeployment();
      store.dispatch(setTabType("dine_in"));
    });

    it("opening reports the number screen; a refused entry reports nothing more", async () => {
      renderModal();
      expect(funnel()).toEqual([
        ["number_screen_viewed", { loyalty_enabled: true, tab_type: "dine_in" }],
      ]);

      await typeDigits("99538");
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));
      await screen.findByTestId("loyalty-error");
      expect(funnel()).toHaveLength(1);
    });

    it.each([
      ["coupons and points", { data: BALANCE_OK }, ["account_reorder_available", { coupon_count: 1, loyalty_points: 6000 }]],
      ["a 200 without them", { data: BALANCE_EMPTY }, ["account_reorder_unavailable", { reason: "no_coupons_or_points" }]],
      ["a non-200", { data: BALANCE_FAILED }, ["order_checkin_not_available", { reason: "api_error" }]],
      ["no answer (a failed transport)", { error: { status: "FETCH_ERROR" } }, ["order_checkin_not_available", { reason: "api_error" }]],
    ])("a lookup answered with %s: entered → send code → its outcome", async (_label, rtkResult, outcome) => {
      executeEvent.mockResolvedValue(rtkResult);
      renderModal();
      await typeDigits(PHONE);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      await waitFor(() => expect(funnel()).toHaveLength(4));
      expect(funnel().slice(1)).toEqual([...submitted, outcome]);
      expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(PHONE);
    });

    it("a throw after the lookup reports account_resend_code_error with its message", async () => {
      const { onClose } = renderModal();
      onClose.mockImplementation(() => {
        throw new Error("close failed");
      });
      await typeDigits(PHONE);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      await screen.findByTestId("loyalty-error");
      expect(funnel().slice(-1)).toEqual([
        ["account_resend_code_error", { error_message: "close failed" }],
      ]);
    });

    it("closed before the lookup answers: no outcome, as /phone once it is left", async () => {
      let answer!: (value: unknown) => void;
      executeEvent.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
      const { unmount } = renderModal();
      await typeDigits(PHONE);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));
      unmount();
      await act(async () => answer({ data: BALANCE_OK }));

      expect(funnel().map(([name]) => name)).toEqual([
        "number_screen_viewed",
        ...submitted.map(([name]) => name),
      ]);
    });
  });

  /*
    audit-fixes UB5: the same picker as /phone, opened from the dial-code chip
    at z-[70] (above this z-60 modal, below its error z-80, the global error
    z-95 and the idle prompt z-100). A pick moves the keypad cap and the
    length check; the phone keypad ignores a leading 0.
  */
  describe("the country chip (UB5)", () => {
    beforeAll(async () => {
      // The ONE lazy chunk: the first transform outlasts findBy's 1 s.
      await import("../../cart/bagLazyParts");
    }, 30_000);

    beforeEach(() => {
      mockCapture.mockReset();
    });

    it("opens the picker over the modal at z-[70] and reports the tap", async () => {
      seedDeployment();
      renderModal();

      await userEvent.click(screen.getByTestId("loyalty-country-code"));

      const sheet = await screen.findByTestId("country-sheet");
      expect(sheet.parentElement?.className).toContain("z-[70]");
      expect(screen.getByTestId("loyalty-login")).toContainElement(sheet);
      expect(mockCapture).toHaveBeenCalledWith("country_code_selection_clicked", {
        current_country_code: "+91",
      });
    });

    it("a pick moves the cap: the UAE takes 9 digits, and the lookup carries +971", async () => {
      seedDeployment();
      renderModal();

      await userEvent.click(screen.getByTestId("loyalty-country-code"));
      const sheet = await screen.findByTestId("country-sheet");
      const keyboard = within(within(sheet).getByTestId("kiosk-keyboard"));
      for (const key of "emir") {
        await userEvent.click(keyboard.getByRole("button", { name: key }));
      }
      await userEvent.click(within(sheet).getByTestId("country-AE"));

      expect(screen.queryByTestId("country-sheet")).toBeNull();
      expect(screen.getByTestId("loyalty-country-code")).toHaveTextContent("+971");
      expect((store.getState() as any).auth.selectedCountryCode).toEqual({
        code: "AE",
        dialCode: "+971",
        min: 9,
        max: 9,
        picked: true,
      });

      // Ten taps, nine digits land (the UAE cap), and they pass the check.
      await typeDigits("5012345678");
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      await waitFor(() => expect(executeEvent).toHaveBeenCalledTimes(1));
      expect(customerState().customerInfo.customerPhone).toBe("501234567");
      expect(JSON.stringify(executeEvent.mock.calls[0][0].data)).toContain("+971");
    });

    it("the chip shows the selected country's round flag before the dial code, follows a pick, and stays named by its label", async () => {
      seedDeployment();
      renderModal();
      const chip = () => screen.getByTestId("loyalty-country-code");
      const flag = () => chip().firstElementChild as HTMLElement;

      expect(flag()).toHaveAttribute("aria-hidden", "true");
      expect(flag()).toHaveClass("rounded-full");
      expect(flag().querySelector("img")).toHaveAttribute("src", "/flags/in.png");
      expect(flag().querySelector("img")).toHaveAttribute("alt", "");
      expect(flag().nextElementSibling).toHaveTextContent("+91");

      await userEvent.click(chip());
      const sheet = await screen.findByTestId("country-sheet");
      const keyboard = within(within(sheet).getByTestId("kiosk-keyboard"));
      for (const key of "emir") {
        await userEvent.click(keyboard.getByRole("button", { name: key }));
      }
      await userEvent.click(within(sheet).getByTestId("country-AE"));

      expect(flag().querySelector("img")).toHaveAttribute("src", "/flags/ae.png");
      expect(chip()).toHaveAccessibleName(i18n.t("phone.changeCountry", { dialCode: "+971" }));
    });

    it("the scrim closes the picker and keeps +91", async () => {
      seedDeployment();
      renderModal();

      await userEvent.click(screen.getByTestId("loyalty-country-code"));
      await userEvent.click(await screen.findByTestId("country-sheet-scrim"));

      expect(screen.queryByTestId("country-sheet")).toBeNull();
      expect(screen.getByTestId("loyalty-login")).toBeInTheDocument();
      expect(screen.getByTestId("loyalty-country-code")).toHaveTextContent("+91");
    });

    it("the phone keypad ignores a leading 0", async () => {
      seedDeployment();
      renderModal();

      await typeDigits(`0${PHONE}`);
      await userEvent.click(screen.getByTestId("loyalty-login-submit"));

      await waitFor(() => expect(executeEvent).toHaveBeenCalledTimes(1));
      expect(customerState().customerInfo.customerPhone).toBe(PHONE);
    });
  });

  it("X closes without touching loyalty state", async () => {
    seedDeployment();
    const { onClose } = renderModal();
    await userEvent.click(screen.getByTestId("loyalty-login-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(executeEvent).not.toHaveBeenCalled();
    expect(loyaltyState().loyaltyItemsModal.isOpen).toBe(false);
  });
});
