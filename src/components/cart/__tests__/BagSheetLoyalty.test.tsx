/* eslint-disable @typescript-eslint/no-explicit-any --
 * Cart-row fixtures and store reads mirror the untyped legacy cart/loyalty
 * slices. Typed in the P7+ domain passes. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  pushLoyaltyPointsAndCoupons,
  setClaimedCoupon,
  setLoyaltyPartner,
} from "@cx-sdk/ordering/state/loyalty.slice";
import {
  setCurrency,
  setKioskSettings,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import { store } from "../../../redux/app/store";
import BagSheet from "../BagSheet";
import "../../../i18n";

/** Paid row (P7a BagSheet fixture parity) — £8.60 line, qty 1. */
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
    sauce_group: [{ id: "onions", name: "Add Onions", price: 0.6, quantity: 1 }],
  },
  baseItem: {
    id: "cheese-burger",
    name: "Cheese Burger",
    price: 8,
    modifiers: ["sauce_group"],
  },
};

/** Redeemed XENO reward row (redeemItem + addLoyaltyItemToCart output). */
const REWARD_ROW = {
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

const FREE_SALAD_COUPON = {
  coupon_name: "Free Greek Salad",
  coupon_code: "static6562",
  discount_on: "item",
  discount_type: "percentage",
  discount_value: 100,
  products: [{ _id: REWARD_ROW.id, quantity: 1 }],
  extra_fields: [{ name: "Points Value", value: 3000 }],
};

const PARTNER = {
  partner: {
    partner_name: "Xeno",
    customer_key: "xeno-customer-key-1",
    partner_merchant_id: "xeno-merchant-uuid-1",
  },
  partnerDetails: { client_id: "xeno-client-1", partner_name: "Xeno" },
};

/** The ledger the revoke reads — without isClaimed the fetch early-returns. */
const CLAIMED = {
  couponCode: "static6562",
  claimedPoints: 3000,
  availedCouponCode: "static6562",
  datetime: "2026-09-30%2010%3A00%3A00",
  phoneNumber: "9953833675",
  merchantId: "xeno-merchant-uuid-1",
};

let fetchMock: ReturnType<typeof vi.fn>;

const cartState = () => (store.getState() as any).cart;
const loyaltyState = () => (store.getState() as any).loyalty;
const appSettingsState = () => (store.getState() as any).appSettings;

/** Loyalty ON = kiosk_settings.enable_loyalty AND the partner blob (trap 9). */
const seedLoyaltyOn = (coupons: any[] = [FREE_SALAD_COUPON]) => {
  store.dispatch(setKioskSettings({ enable_loyalty: true }));
  store.dispatch(setLoyaltyPartner(PARTNER));
  store.dispatch(
    pushLoyaltyPointsAndCoupons({
      coupons,
      loyalty_points: 3000,
      total_redeemable_points: 3000,
      min_bill_for_redemption: 0,
    })
  );
};

const renderSheet = (
  overrides: {
    onOpenLoyaltyLogin?: () => void;
    onOpenLoyaltyRewards?: () => void;
  } = {}
) => {
  const onClose = vi.fn();
  const utils = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <BagSheet open onClose={onClose} {...overrides} />
      </MemoryRouter>
    </Provider>
  );
  return { ...utils, onClose };
};

describe("BagSheet — XENO reward legs (contract steps 7-9)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setCurrency({ symbol: "£" }));
    // The revoke is a RAW cross-origin fetch in the ported hook (a documented
    // Rule-2 carry-over) — stub it so it can never reach the network.
    fetchMock = vi
      .fn()
      .mockResolvedValue({ json: () => Promise.resolve({ status: "success" }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("reward-row Remove (out-of-stock only)", () => {
    it("drops the row, refunds its Points Value and revokes the claim", async () => {
      seedLoyaltyOn();
      store.dispatch(setClaimedCoupon(CLAIMED));
      store.dispatch(
        setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW, outOfStock: true }])
      );
      renderSheet();

      expect(loyaltyState().totalLoyaltyPoints).toBe(3000);
      await userEvent.click(screen.getByTestId("bag-loyalty-remove-lr-1"));

      // 1. the reward left the cart, the paid row stayed
      await waitFor(() => expect(cartState().cartItems).toHaveLength(1));
      expect(cartState().cartItems[0].itemId).toBe("cb-1");
      // 2. the points came back
      expect(loyaltyState().totalLoyaltyPoints).toBe(6000);
      // 3. the partner was told (before anything resets the ledger)
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const uri = String(fetchMock.mock.calls[0][0]);
      expect(uri).toContain("https://xeno.in:2223/");
      expect(uri).toContain("undoRewardRedemption");
      expect(uri).toContain("pointsToBeReturned=3000");
      expect(uri).toContain("rewardId=static6562");
      expect(uri).toContain("apikey=xeno-merchant-uuid-1");
      // 4. …and the ledger is cleared once the revoke lands
      await waitFor(() =>
        expect(loyaltyState().claimedCoupon.isClaimed).toBe(false)
      );
    });

    it("refunding a reward with no Points Value never NaNs the balance", async () => {
      seedLoyaltyOn();
      store.dispatch(setClaimedCoupon(CLAIMED));
      // A coupon with no "Points Value" pair — the fork dispatched the refund
      // unguarded here, which NaN'd the balance for the rest of the session.
      const noPoints = { ...REWARD_ROW, extra_fields: [] as any[] };
      store.dispatch(
        setCartItems([{ ...BURGER_ROW }, { ...noPoints, outOfStock: true }])
      );
      renderSheet();

      await userEvent.click(screen.getByTestId("bag-loyalty-remove-lr-1"));
      await waitFor(() => expect(cartState().cartItems).toHaveLength(1));
      expect(loyaltyState().totalLoyaltyPoints).toBe(3000);
      expect(Number.isNaN(loyaltyState().totalLoyaltyPoints)).toBe(false);
    });
  });

  describe("auto-reversal (contract step 8) — a reward cannot outlive its order", () => {
    it("removing the LAST paid row reverses the reward, refunds the points and revokes", async () => {
      seedLoyaltyOn();
      store.dispatch(setClaimedCoupon(CLAIMED));
      store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
      renderSheet();

      // Drive it the way a customer does: decrease at qty 1 → REMOVE ITEM
      // confirm → the paid row is deleted.
      await userEvent.click(screen.getByTestId("bag-dec-cb-1"));
      await userEvent.click(screen.getByTestId("remove-item-confirm"));

      await waitFor(() => expect(cartState().cartItems).toHaveLength(0));
      expect(loyaltyState().totalLoyaltyPoints).toBe(6000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain(
        "pointsToBeReturned=3000"
      );
    });

    it("a reward redeemed into an EMPTY cart is NOT reversed (the fork's ref guard)", async () => {
      seedLoyaltyOn();
      store.dispatch(setClaimedCoupon(CLAIMED));
      store.dispatch(setCartItems([{ ...REWARD_ROW }]));
      renderSheet();

      // Only a cart that ONCE held paid rows may fall into the reversal.
      await waitFor(() =>
        expect(screen.getByTestId("bag-loyalty-row-lr-1")).toBeInTheDocument()
      );
      expect(cartState().cartItems).toHaveLength(1);
      expect(loyaltyState().totalLoyaltyPoints).toBe(3000);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("removing one of TWO paid rows leaves the reward alone", async () => {
      seedLoyaltyOn();
      store.dispatch(setClaimedCoupon(CLAIMED));
      store.dispatch(
        setCartItems([
          { ...BURGER_ROW },
          { ...BURGER_ROW, itemId: "cb-2", uniqueItemId: "cb-2-u" },
          { ...REWARD_ROW },
        ])
      );
      renderSheet();

      await userEvent.click(screen.getByTestId("bag-dec-cb-2"));
      await userEvent.click(screen.getByTestId("remove-item-confirm"));

      await waitFor(() => expect(cartState().cartItems).toHaveLength(2));
      expect(
        cartState().cartItems.some((row: any) => row?.isLoyaltyItem)
      ).toBe(true);
      expect(loyaltyState().totalLoyaltyPoints).toBe(3000);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("LOG-IN & GET REWARDS entry (locked decision 5b)", () => {
    it("unidentified customer → the login modal", async () => {
      seedLoyaltyOn();
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      const onOpenLoyaltyLogin = vi.fn();
      const onOpenLoyaltyRewards = vi.fn();
      renderSheet({ onOpenLoyaltyLogin, onOpenLoyaltyRewards });

      await userEvent.click(screen.getByTestId("bag-login-rewards"));
      expect(onOpenLoyaltyLogin).toHaveBeenCalledTimes(1);
      expect(onOpenLoyaltyRewards).not.toHaveBeenCalled();
    });

    it("identified customer with coupons → the rewards sheet", async () => {
      seedLoyaltyOn();
      store.dispatch(setPhoneNumberRdx("9953833675"));
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      const onOpenLoyaltyLogin = vi.fn();
      const onOpenLoyaltyRewards = vi.fn();
      renderSheet({ onOpenLoyaltyLogin, onOpenLoyaltyRewards });

      await userEvent.click(screen.getByTestId("bag-login-rewards"));
      expect(onOpenLoyaltyRewards).toHaveBeenCalledTimes(1);
      expect(onOpenLoyaltyLogin).not.toHaveBeenCalled();
    });

    it("a reward already in the cart → 'already availed', no sheet", async () => {
      seedLoyaltyOn();
      store.dispatch(setPhoneNumberRdx("9953833675"));
      store.dispatch(setCartItems([{ ...BURGER_ROW }, { ...REWARD_ROW }]));
      const onOpenLoyaltyRewards = vi.fn();
      renderSheet({ onOpenLoyaltyLogin: vi.fn(), onOpenLoyaltyRewards });

      await userEvent.click(screen.getByTestId("bag-login-rewards"));
      expect(onOpenLoyaltyRewards).not.toHaveBeenCalled();
      expect(appSettingsState().showGlobalError).toBe(true);
      expect(appSettingsState().errorMessageGlobal).toBe(
        "Loyalty Item already availed"
      );
    });

    it("no coupons → 'no coupons available', no sheet", async () => {
      seedLoyaltyOn([]);
      store.dispatch(setPhoneNumberRdx("9953833675"));
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      const onOpenLoyaltyRewards = vi.fn();
      renderSheet({ onOpenLoyaltyLogin: vi.fn(), onOpenLoyaltyRewards });

      await userEvent.click(screen.getByTestId("bag-login-rewards"));
      expect(onOpenLoyaltyRewards).not.toHaveBeenCalled();
      expect(appSettingsState().errorMessageGlobal).toBe(
        "No coupons available for you at the moment"
      );
    });

    it("with loyalty OFF the CTA is not rendered, even with openers wired (user decision 2026-10-05 — hide)", () => {
      store.dispatch(setCartItems([{ ...BURGER_ROW }]));
      renderSheet({
        onOpenLoyaltyLogin: vi.fn(),
        onOpenLoyaltyRewards: vi.fn(),
      });

      expect(screen.queryByTestId("bag-login-rewards")).not.toBeInTheDocument();
      expect(screen.getByTestId("bag-pay")).toBeInTheDocument();
    });
  });
});
