/* eslint-disable @typescript-eslint/no-explicit-any --
 * Coupon blobs, menu entities and the loyalty proxy envelopes are untyped in
 * the SDK (same domain header the component under test carries). Typed in a
 * later loyalty domain pass. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  openLoyaltyItemsModal,
  pushLoyaltyPointsAndCoupons,
  setLoyaltyPartner,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { setMenuData, setModifiersMap } from "@cx-sdk/catalog/state/Menu.slice";
import { setCountryCode } from "@cx-sdk/core/auth/authentication.slice";
import {
  closeAccessibilityMode,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import { store } from "../../../redux/app/store";
import LoyaltyRewardsSheet from "../LoyaltyRewardsSheet";
import i18n from "../../../i18n";

/*
 * THE REDEMPTION CHAIN IS MOCKED AT THE RTK LAYER, not at the useLoyalty
 * boundary: the whole point of these tests is the contract's dispatch
 * sequence, and that sequence lives inside the REAL useLoyalty (parkRedeemedItem,
 * buildInfoForClaim, buildClaimedCouponRecord, setClaimedCoupon…). Stubbing
 * the hook would stub away the thing under test. `executeLoyaltyEvent` is the
 * single transport all five Xeno ops ride, so one mock covers validate_coupon,
 * authenticate_redemption and redeem_coupon — branching on `event_name`
 * exactly like the e2e route multiplexer does.
 */
const { executeEvent } = vi.hoisted(() => ({ executeEvent: vi.fn() }));

vi.mock("@cx-sdk/ordering/services/loyaltyApi", () => ({
  useExecuteLoyaltyEventMutation: () => [
    executeEvent,
    { isLoading: false, reset: () => {} },
  ],
  useGetLoyaltyPartnerMutation: () => [vi.fn(), { isLoading: false }],
}));

// ---- Menu + coupon fixtures (the contract's ids, prices and points) -------

/** Modifier-free reward → the plain ITEM redemption path. */
const GREEK_SALAD = {
  id: "5dd1093829754a432f2c32e2",
  name: "Greek Salad",
  price: 17,
  image_url: "https://cdn.example.test/greek-salad.jpg",
  modifiers: [] as string[],
};

/** Customizable reward → the CUSTOMIZABLE redemption path (auto-selected group). */
const CHEESE_BURGER = {
  id: "5dd10936712f5b622a66aab7",
  name: "Cheese Burger",
  price: 8,
  image_url: "https://cdn.example.test/cheese-burger.jpg",
  modifiers: ["cb_sauce"],
};

/** In the menu but priceless → the engine DROPS it from the tile list. */
const PRICELESS_SIDE = {
  id: "5dd10938eb1ccee31ca352fa",
  name: "Mystery Side",
  price: 0,
  image_url: "https://cdn.example.test/side.jpg",
  modifiers: [] as string[],
};

/** min1/max1 with a single active option → handleParkItem auto-selects it. */
const SAUCE_GROUP = {
  _id: "cb_sauce",
  name: "Sauce",
  min: 1,
  max: 1,
  multiplePunchMin: 1,
  multiplePunchMax: 1,
  multiplePunchMaxItem: 1,
  order: 1,
  isActive: true,
  constituentItems: [
    { id: "mild", name: "Mild Sauce", price: 0.5, isActive: true },
  ],
};

const MENU = {
  categories: [
    {
      id: "cat-1",
      subCategories: [
        {
          id: "sub-1",
          entities: [GREEK_SALAD, CHEESE_BURGER, PRICELESS_SIDE],
        },
      ],
    },
  ],
};

const coupon = (
  code: string,
  name: string,
  productId: string,
  discountValue: number,
  points: number
) => ({
  coupon_name: name,
  coupon_code: code,
  discount_on: "item",
  discount_type: "percentage",
  discount_value: discountValue,
  special_offer: false,
  item_options: {},
  products: [{ _id: productId, quantity: 1 }],
  extra_fields: [
    { name: "Points Value", value: points },
    { name: "Reward Type", value: "Loyalty Reward" },
  ],
});

const FREE_SALAD = coupon(
  "static6562",
  "Free Greek Salad",
  GREEK_SALAD.id,
  100,
  3000
);
const HALF_BURGER = coupon(
  "static8056",
  "Half-price Cheese Burger",
  CHEESE_BURGER.id,
  50,
  1000
);
/** Menu entity has no price → dropped by getAllLoyaltyItemsFromMenu. */
const PRICELESS_REWARD = coupon(
  "static8055",
  "Free Mystery Side",
  PRICELESS_SIDE.id,
  100,
  2000
);
/** Product id absent from the menu entirely → also dropped. */
const OFF_MENU_REWARD = coupon(
  "static9999",
  "Free Ghost Taco",
  "not-in-this-menu",
  100,
  500
);

const PARTNER = {
  partner: {
    partner_name: "Xeno",
    customer_key: "xeno-customer-key-1",
    partner_merchant_id: "xeno-merchant-uuid-1",
    partner_merchant_username: "kiosk@xeno.in",
  },
  partnerDetails: { client_id: "xeno-client-1", partner_name: "Xeno" },
};

// ---- Proxy bodies (contract §E2E MOCKS — HTTP 200 wrapping the outcome) ---

const OK_BODIES: Record<string, any> = {
  validate_coupon: {
    status_code: 200,
    response: { valid: true, coupon_code: "static6562" },
  },
  authenticate_redemption: {
    status_code: 200,
    response: {
      authentication: true,
      points_value: 3000,
      message: "OTP sent to registered mobile",
    },
  },
  redeem_coupon: {
    status_code: 200,
    response: {
      success: true,
      points_redeemed: 3000,
      remaining_points: 3000,
      coupon_code: "static6562",
      message: "Reward redeemed successfully",
    },
  },
};

const VALIDATE_FAIL = {
  status_code: 400,
  response: { success: false, message: "Coupon not valid for this bill" },
};
const AUTHENTICATE_FAIL = {
  status_code: 400,
  response: {
    success: false,
    error_code: "LOYALTY_REDEMPTION_VALIDATION_FAILED",
    message: "Minimum purchase amount is not met for this reward.",
  },
};
const REDEEM_FAIL = {
  status_code: 400,
  response: { success: false, message: "Invalid OTP. Please try again." },
};

const respondWith = (overrides: Record<string, any> = {}) => {
  const bodies = { ...OK_BODIES, ...overrides };
  executeEvent.mockImplementation((args: any) =>
    Promise.resolve({ data: bodies[args?.event_name] })
  );
};

/** The event_name sequence the sheet actually put on the wire. */
const firedEvents = () =>
  executeEvent.mock.calls.map((call: any[]) => call[0]?.event_name);

const loyaltyState = () => (store.getState() as any).loyalty;
const cartItems = () => (store.getState() as any).cart.cartItems;

const seedIdentifiedCustomer = (coupons: any[] = [FREE_SALAD, HALF_BURGER]) => {
  store.dispatch(setLoyaltyPartner(PARTNER));
  store.dispatch(
    setCountryCode({ code: "IN", dialCode: "+91", min: 10, max: 10 })
  );
  store.dispatch(setPhoneNumberRdx("9953833675"));
  store.dispatch(setMenuData({ menu: MENU }));
  store.dispatch(setModifiersMap({ modifiersMap: { cb_sauce: SAUCE_GROUP } }));
  store.dispatch(
    pushLoyaltyPointsAndCoupons({
      coupons,
      loyalty_points: 6000,
      total_redeemable_points: 6000,
      min_bill_for_redemption: 0,
    })
  );
};

const openSheet = (isTimerOn = false) =>
  store.dispatch(openLoyaltyItemsModal({ isTimerOn }));

const renderSheet = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <LoyaltyRewardsSheet />
      </MemoryRouter>
    </Provider>
  );

const typeOtp = async (digits: string) => {
  for (const digit of digits) {
    await userEvent.click(screen.getByTestId(`numpad-key-${digit}`));
  }
};

/** Pick the salad tile, REDEEM, land on the OTP step. */
const reachOtpStep = async () => {
  await userEvent.click(screen.getByTestId("loyalty-reward-static6562"));
  await userEvent.click(screen.getByTestId("loyalty-redeem"));
  await screen.findByTestId("loyalty-otp-display");
};

describe("LoyaltyRewardsSheet (Xeno redemption surface — contract step 6)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    executeEvent.mockReset();
    respondWith();
    // The revoke leg is a RAW cross-origin fetch in the ported hook — it must
    // never reach the network from a unit test (and jsdom has no fetch stack
    // for xeno.in anyway).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve({ status: "success" }) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("open gate + tiles (built from selectCoupons via the menu join)", () => {
    it("renders nothing while loyaltyItemsModal is closed", () => {
      seedIdentifiedCustomer();
      renderSheet();
      expect(
        screen.queryByTestId("loyalty-rewards-sheet")
      ).not.toBeInTheDocument();
    });

    it("open: a tile per joinable coupon, points balance header, Free / % off chips and points cost", () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();

      expect(screen.getByTestId("loyalty-rewards-sheet")).toBeInTheDocument();
      // Header balance comes from check_loyalty_balance, not from the tiles.
      expect(screen.getByTestId("loyalty-points-balance")).toHaveTextContent(
        "6000 points"
      );

      // 100 % coupon → "Free"; the menu entity's name wins over coupon_name.
      const salad = screen.getByTestId("loyalty-reward-static6562");
      expect(salad).toHaveTextContent("Greek Salad");
      expect(salad).toHaveTextContent("Free");
      expect(salad).toHaveTextContent("3000 points");

      // 50 % coupon → "{v}% off".
      const burger = screen.getByTestId("loyalty-reward-static8056");
      expect(burger).toHaveTextContent("Cheese Burger");
      expect(burger).toHaveTextContent("50% off");
      expect(burger).toHaveTextContent("1000 points");
    });

    it("silently drops rewards the menu join cannot price (no price / not in the menu)", () => {
      seedIdentifiedCustomer([
        FREE_SALAD,
        PRICELESS_REWARD,
        OFF_MENU_REWARD,
      ]);
      openSheet();
      renderSheet();

      expect(screen.getByTestId("loyalty-reward-static6562")).toBeInTheDocument();
      // Priced 0 in the menu → deleted by getAllLoyaltyItemsFromMenu.
      expect(
        screen.queryByTestId("loyalty-reward-static8055")
      ).not.toBeInTheDocument();
      // Product id never joined a menu entity → no price at all → deleted.
      expect(
        screen.queryByTestId("loyalty-reward-static9999")
      ).not.toBeInTheDocument();
    });

    it("no coupons: the empty copy shows and REDEEM is disabled", () => {
      seedIdentifiedCustomer([]);
      openSheet();
      renderSheet();
      expect(
        screen.getByText("No coupons available for you at the moment")
      ).toBeInTheDocument();
      expect(screen.getByTestId("loyalty-redeem")).toBeDisabled();
    });

    it("the close button dispatches closeLoyaltyItemsModal (default teardown, no prop)", async () => {
      seedIdentifiedCustomer();
      openSheet(true);
      renderSheet();
      await userEvent.click(screen.getByTestId("loyalty-rewards-close"));
      expect(loyaltyState().loyaltyItemsModal).toEqual({
        isOpen: false,
        isTimerOn: false,
      });
      expect(
        screen.queryByTestId("loyalty-rewards-sheet")
      ).not.toBeInTheDocument();
    });

    it("tapping a tile selects it; tapping it again clears the selection", async () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      const salad = screen.getByTestId("loyalty-reward-static6562");
      await userEvent.click(salad);
      expect(salad).toHaveAttribute("aria-checked", "true");
      await userEvent.click(salad);
      expect(salad).toHaveAttribute("aria-checked", "false");
    });
  });

  describe("REDEEM chain — the contract's dispatch sequence", () => {
    it("validate_coupon → authenticate_redemption puts the customer on the 4-digit OTP step and parks the priced reward", async () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      await reachOtpStep();

      expect(firedEvents()).toEqual([
        "validate_coupon",
        "authenticate_redemption",
      ]);
      expect(
        screen.getByText("Enter the 4-digit code sent to your phone")
      ).toBeInTheDocument();

      // addItemToLoyaltyParking(redeemItem(selected)) ran BEFORE the OTP step:
      // discounted to £0 with the undiscounted line preserved.
      const parked = loyaltyState().parkedRedeemedItem;
      expect(parked.coupon_code).toBe("static6562");
      expect(parked.isRedeemed).toBe(true);
      expect(parked.total_price).toBe(0);
      expect(parked.undiscounted_total_price).toBe(17);
      // Nothing has reached the cart or the ledger yet.
      expect(cartItems()).toHaveLength(0);
      expect(loyaltyState().claimedCoupon.isClaimed).toBe(false);
      expect(loyaltyState().totalLoyaltyPoints).toBe(6000);
    });

    it("OTP confirm runs the EXACT success sequence: cart row → items modal closed → success modal → claimedCoupon → points decreased", async () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      await reachOtpStep();
      await typeOtp("1234");
      await userEvent.click(screen.getByTestId("loyalty-otp-submit"));

      await waitFor(() => expect(cartItems()).toHaveLength(1));

      expect(firedEvents()).toEqual([
        "validate_coupon",
        "authenticate_redemption",
        "redeem_coupon",
      ]);

      // 1. the reward landed as an ordinary (discounted) cart row
      const row = cartItems()[0];
      expect(row.isLoyaltyItem).toBe(true);
      expect(row.isRedeemed).toBe(true);
      expect(row.coupon_code).toBe("static6562");
      expect(row.type).toBe("ITEM");
      expect(row.quantity).toBe(1);
      expect(row.total_price).toBe(0);
      expect(row.undiscounted_total_price).toBe(17);

      // 2. the rewards sheet closed…
      expect(loyaltyState().loyaltyItemsModal.isOpen).toBe(false);
      expect(
        screen.queryByTestId("loyalty-rewards-sheet")
      ).not.toBeInTheDocument();

      // 3. …and the celebration opened (the reducer always stamps "redeem")
      expect(loyaltyState().openLoyaltyModal.isOpen).toBe(true);
      expect(loyaltyState().openLoyaltyModal.type).toBe("redeem");
      expect(loyaltyState().openLoyaltyModal.data.item.coupon_code).toBe(
        "static6562"
      );

      // 4. the revoke ledger carries the points actually claimed
      const claimed = loyaltyState().claimedCoupon;
      expect(claimed.isClaimed).toBe(true);
      expect(claimed.couponData.couponCode).toBe("static6562");
      expect(claimed.couponData.availedCouponCode).toBe("static6562");
      expect(claimed.couponData.claimedPoints).toBe(3000);
      expect(claimed.couponData.phoneNumber).toBe("9953833675");
      expect(claimed.couponData.merchantId).toBe("xeno-merchant-uuid-1");
      expect(claimed.couponData.datetime).toBeTruthy();

      // 5. balance drops by the reward's "Points Value"
      expect(loyaltyState().totalLoyaltyPoints).toBe(3000);
    });

    it("the redeem_coupon call carries the entered OTP and the parked reward's coupon code", async () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      await reachOtpStep();
      await typeOtp("1234");
      await userEvent.click(screen.getByTestId("loyalty-otp-submit"));

      await waitFor(() => expect(firedEvents()).toHaveLength(3));
      const redeemCall = executeEvent.mock.calls.find(
        (call: any[]) => call[0]?.event_name === "redeem_coupon"
      );
      expect(JSON.stringify(redeemCall?.[0]?.data)).toContain("1234");
      expect(JSON.stringify(redeemCall?.[0]?.data)).toContain("static6562");
    });

    it("a CUSTOMIZABLE reward auto-selects its single-option required group and lands at the discounted line", async () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();

      await userEvent.click(screen.getByTestId("loyalty-reward-static8056"));
      await userEvent.click(screen.getByTestId("loyalty-redeem"));
      await screen.findByTestId("loyalty-otp-display");
      await typeOtp("1234");
      await userEvent.click(screen.getByTestId("loyalty-otp-submit"));

      await waitFor(() => expect(cartItems()).toHaveLength(1));
      const row = cartItems()[0];
      expect(row.type).toBe("CUSTOMIZABLE");
      // 8.00 base + 0.50 auto-selected sauce, halved by the 50 % coupon.
      expect(row.undiscounted_total_price).toBeCloseTo(8.5, 2);
      expect(row.total_price).toBeCloseTo(4.25, 2);
      // The auto-selected option rode along, keyed by the group's real _id —
      // the fork writes a literal "undefined" key here (it reads `.id`, which
      // these group objects do not carry), which strands the group for the
      // order payload and every group-keyed lookup downstream.
      expect(Object.keys(row.customizations ?? {})).toEqual(["cb_sauce"]);
      expect(row.customizations?.undefined).toBeUndefined();
      const picked = Object.values(row.customizations ?? {}).flat() as any[];
      expect(picked.map((item) => item?.id)).toContain("mild");
      // Its own "Points Value" is what the ledger records.
      expect(loyaltyState().claimedCoupon.couponData.claimedPoints).toBe(1000);
      expect(loyaltyState().totalLoyaltyPoints).toBe(5000);
    });
  });

  describe("failure paths — the chain stops and the customer gets TRY AGAIN", () => {
    it("validate_coupon failure: error modal, NO authenticate_redemption, no OTP step, no cart row", async () => {
      respondWith({ validate_coupon: VALIDATE_FAIL });
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();

      await userEvent.click(screen.getByTestId("loyalty-reward-static6562"));
      await userEvent.click(screen.getByTestId("loyalty-redeem"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Error in validating coupon");
      expect(firedEvents()).toEqual(["validate_coupon"]);
      expect(
        screen.queryByTestId("loyalty-otp-display")
      ).not.toBeInTheDocument();
      expect(cartItems()).toHaveLength(0);
      expect(loyaltyState().totalLoyaltyPoints).toBe(6000);
    });

    it("authenticate_redemption failure surfaces the PARTNER message and stops before the OTP step", async () => {
      respondWith({ authenticate_redemption: AUTHENTICATE_FAIL });
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();

      await userEvent.click(screen.getByTestId("loyalty-reward-static6562"));
      await userEvent.click(screen.getByTestId("loyalty-redeem"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent(
        "Minimum purchase amount is not met for this reward."
      );
      expect(firedEvents()).toEqual([
        "validate_coupon",
        "authenticate_redemption",
      ]);
      expect(
        screen.queryByTestId("loyalty-otp-display")
      ).not.toBeInTheDocument();
      expect(cartItems()).toHaveLength(0);
    });

    it("wrong OTP: partner message, no cart row, points unchanged, ledger untouched — TRY AGAIN returns to the OTP step", async () => {
      respondWith({ redeem_coupon: REDEEM_FAIL });
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      await reachOtpStep();
      await typeOtp("9999");
      await userEvent.click(screen.getByTestId("loyalty-otp-submit"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Invalid OTP. Please try again.");
      expect(cartItems()).toHaveLength(0);
      expect(loyaltyState().totalLoyaltyPoints).toBe(6000);
      expect(loyaltyState().claimedCoupon.isClaimed).toBe(false);
      expect(loyaltyState().openLoyaltyModal.isOpen).toBe(false);
      // The sheet stayed open behind the dialog.
      expect(loyaltyState().loyaltyItemsModal.isOpen).toBe(true);

      await userEvent.click(screen.getByTestId("loyalty-error-retry"));
      expect(screen.queryByTestId("loyalty-error")).not.toBeInTheDocument();
      expect(screen.getByTestId("loyalty-otp-display")).toBeInTheDocument();
    });

    it("a dead transport on validate_coupon fails CLOSED (the hook swallows the throw, getLoyaltyRedemptionError catches the undefined)", async () => {
      executeEvent.mockImplementation(() =>
        Promise.reject(new Error("network down"))
      );
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();

      await userEvent.click(screen.getByTestId("loyalty-reward-static6562"));
      await userEvent.click(screen.getByTestId("loyalty-redeem"));

      // useLoyalty.validateCoupon has its OWN try/catch and returns undefined;
      // the SDK parser treats a missing body as failure, so the chain stops
      // here instead of walking on with an undefined response (Rule 2).
      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Error in validating coupon");
      expect(screen.getByTestId("loyalty-error-retry")).toBeInTheDocument();
      expect(
        screen.queryByTestId("loyalty-otp-display")
      ).not.toBeInTheDocument();
      expect(cartItems()).toHaveLength(0);
    });

    it("a thrown redeem_coupon (the one leg with no hook-level catch) never freezes the sheet (Rule 2)", async () => {
      executeEvent.mockImplementation((args: any) =>
        args?.event_name === "redeem_coupon"
          ? Promise.reject(new Error("network down"))
          : Promise.resolve({ data: OK_BODIES[args?.event_name] })
      );
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      await reachOtpStep();
      await typeOtp("1234");
      await userEvent.click(screen.getByTestId("loyalty-otp-submit"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Error in redeeming points");
      expect(screen.getByTestId("loyalty-error-retry")).toBeInTheDocument();
      expect(cartItems()).toHaveLength(0);
      expect(loyaltyState().claimedCoupon.isClaimed).toBe(false);
      expect(loyaltyState().totalLoyaltyPoints).toBe(6000);
    });
  });

  /*
    P9b R1 (D1, money): redeem_coupon over a FAILED transport. The trigger
    resolves `{ error }` with no body — a timeout once the 10 s Rule 2 budget
    runs out. It must read as a failure: no reward row, no claim, no points.
    M5: a 2xx body without status_code 200 is not a confirmation either
    (fork LoyaltyItemsModal gates on status_code === 200).
  */
  describe("redeem_coupon without a Xeno confirmation grants NOTHING (P9b R1)", () => {
    const expectNothingGranted = async () => {
      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent(i18n.t("loyalty.redeemError"));
      expect(cartItems()).toHaveLength(0);
      expect(loyaltyState().claimedCoupon.isClaimed).toBe(false);
      expect(loyaltyState().totalLoyaltyPoints).toBe(6000);
      expect(loyaltyState().openLoyaltyModal.isOpen).toBe(false);
      // The sheet stays up behind the dialog: TRY AGAIN is live (Rule 2).
      expect(loyaltyState().loyaltyItemsModal.isOpen).toBe(true);
      expect(screen.getByTestId("loyalty-error-retry")).toBeInTheDocument();
    };

    const submitOtpWith = async (redeemResult: unknown) => {
      executeEvent.mockImplementation((args: any) =>
        args?.event_name === "redeem_coupon"
          ? Promise.resolve(redeemResult)
          : Promise.resolve({ data: OK_BODIES[args?.event_name] })
      );
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      await reachOtpStep();
      await typeOtp("1234");
      await userEvent.click(screen.getByTestId("loyalty-otp-submit"));
    };

    it.each([
      ["timed out (TIMEOUT_ERROR)", { error: { status: "TIMEOUT_ERROR", error: "TimeoutError: signal timed out" } }],
      [
        "body ran past the budget (PARSING_ERROR)",
        {
          error: {
            status: "PARSING_ERROR",
            originalStatus: 200,
            data: "",
            error: "TimeoutError: signal timed out",
          },
        },
      ],
      ["network down (FETCH_ERROR)", { error: { status: "FETCH_ERROR", error: "TypeError: Failed to fetch" } }],
    ])("transport failure — %s", async (_label, rtkResult) => {
      await submitOtpWith(rtkResult);
      await expectNothingGranted();
    });

    it.each([
      ["an empty 2xx body", { data: {} }],
      ["a 2xx body with no status_code", { data: { response: { success: true } } }],
    ])("no positive confirmation — %s", async (_label, rtkResult) => {
      await submitOtpWith(rtkResult);
      await expectNothingGranted();
    });
  });

  describe("guards", () => {
    it("REDEEM without a selection asks for one and puts nothing on the wire", async () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      await userEvent.click(screen.getByTestId("loyalty-redeem"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Please select a reward to redeem");
      expect(executeEvent).not.toHaveBeenCalled();
    });

    it("one reward per order: with a reward already in the cart REDEEM is refused", async () => {
      seedIdentifiedCustomer();
      store.dispatch(
        setCartItems([
          {
            id: GREEK_SALAD.id,
            itemId: "lr-1",
            name: "Greek Salad",
            quantity: 1,
            type: "ITEM",
            isLoyaltyItem: true,
            coupon_code: "static6562",
            total_price: 0,
          },
        ])
      );
      openSheet();
      renderSheet();

      await userEvent.click(screen.getByTestId("loyalty-reward-static6562"));
      await userEvent.click(screen.getByTestId("loyalty-redeem"));

      const error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Loyalty Item already availed");
      expect(executeEvent).not.toHaveBeenCalled();
    });

    it("the OTP gate is exactly four digits: a short code never reaches redeem_coupon", async () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      await reachOtpStep();

      // Nothing entered.
      await userEvent.click(screen.getByTestId("loyalty-otp-submit"));
      let error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Please enter a valid OTP");
      await userEvent.click(screen.getByTestId("loyalty-error-retry"));

      // Three digits is still short.
      await typeOtp("123");
      await userEvent.click(screen.getByTestId("loyalty-otp-submit"));
      error = await screen.findByTestId("loyalty-error");
      expect(error).toHaveTextContent("Please enter a valid OTP");

      expect(firedEvents()).toEqual([
        "validate_coupon",
        "authenticate_redemption",
      ]);
      expect(cartItems()).toHaveLength(0);
    });

    it("BACK from the OTP step returns to the reward list with the OTP cleared", async () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();
      await reachOtpStep();
      await typeOtp("12");
      await userEvent.click(screen.getByTestId("loyalty-otp-back"));

      expect(screen.getByTestId("loyalty-redeem")).toBeInTheDocument();
      expect(
        screen.queryByTestId("loyalty-otp-display")
      ).not.toBeInTheDocument();
      expect(cartItems()).toHaveLength(0);
    });
  });

  /*
    P9c — WCAG 2.2.1 (Timing Adjustable). The phone lookup opens the sheet
    with isTimerOn: a 25 s auto-dismiss behind a draining bar (fork parity).
    In the ADA view that is a content-set time limit on exactly the guests who
    cannot race it, so it is off — and latched at open, so leaving the view
    mid-sheet never starts a countdown on a guest who was given none.
  */
  describe("auto-dismiss vs the ADA view (P9c, WCAG 2.2.1)", () => {
    const sheet = () => screen.queryByTestId("loyalty-rewards-sheet");
    const drainBar = () => sheet()?.querySelector(".bg-tb-pink") ?? null;
    const advance = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("normal mode: the lookup open drains for 25 s, then closes itself", () => {
      vi.useFakeTimers();
      seedIdentifiedCustomer();
      openSheet(true);
      renderSheet();
      expect(drainBar()).toHaveStyle({ width: "100%" });

      advance(1_000);
      expect(drainBar()).toHaveStyle({ width: "96%" });

      advance(23_000);
      expect(sheet()).toBeInTheDocument();

      advance(1_000);
      expect(sheet()).not.toBeInTheDocument();
      expect(loyaltyState().loyaltyItemsModal.isOpen).toBe(false);
    });

    it("ADA: no drain bar and no countdown — the sheet waits for the guest", () => {
      vi.useFakeTimers();
      store.dispatch(toggleAccessibilityMode());
      seedIdentifiedCustomer();
      openSheet(true);
      renderSheet();

      expect(drainBar()).toBeNull();
      advance(60_000);
      expect(sheet()).toBeInTheDocument();
    });

    it("opened in ADA: leaving the view mid-sheet never starts a countdown", () => {
      vi.useFakeTimers();
      store.dispatch(toggleAccessibilityMode());
      seedIdentifiedCustomer();
      openSheet(true);
      renderSheet();

      act(() => {
        store.dispatch(closeAccessibilityMode()); // the brand-zone exit
      });
      advance(60_000);

      expect(drainBar()).toBeNull();
      expect(sheet()).toBeInTheDocument();
    });

    it("is capped by its containing block (the reach zone in ADA) with the X and REDEEM outside the scroller", () => {
      seedIdentifiedCustomer();
      openSheet();
      renderSheet();

      const close = screen.getByTestId("loyalty-rewards-close");
      expect(close.closest(".rounded-t-\\[60px\\]")?.className).toContain(
        "h-[min(1470px,calc(100%_-_96px))]"
      );
      expect(close.closest(".overflow-y-auto")).toBeNull();
      expect(
        screen.getByTestId("loyalty-redeem").closest(".overflow-y-auto")
      ).toBeNull();
    });
  });
});
