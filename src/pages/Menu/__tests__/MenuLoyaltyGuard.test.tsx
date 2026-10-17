import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { UnknownAction } from "@reduxjs/toolkit";
import { setMenuData } from "@cx-sdk/catalog/state/Menu.slice";
import {
  selectErrorMessageGlobal,
  selectShowErrorModalGlobal,
  setKioskSettings,
  setShowErrorModalGlobal,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  pushLoyaltyPointsAndCoupons,
  setLoyaltyIdentified,
  setLoyaltyPartner,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { setPhoneNumberRdx } from "@cx-sdk/core/customer/customerInfo.slice";
import { store } from "../../../redux/app/store";
import { setSelectedLanguage } from "../../../redux/features/multiLanguage/multiLanguage.slice";
import Menu from "../index";
import i18n from "../../../i18n";

/*
  Lane figma-polish G1 — the menu's rewards entry guards (contract
  §Partner-branch table, Xeno column) raise the GLOBAL error with translated
  copy, and the menu no longer renders it itself: the match-by-message bridge
  (LoyaltyErrorModal over the two guard messages) is gone — the app-wide
  GlobalErrorHost (IdleGuard) is the one renderer.
  Seams: the mount's fetchMenu (pending) and navigation.
*/

const mocks = vi.hoisted(() => ({ fetchMenu: vi.fn(), navigate: vi.fn() }));

vi.mock("../../../hooks/menuHooks/useMenuConverters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/menuHooks/useMenuConverters")>();
  return {
    default: () => ({
      ...actual.default(),
      fetchMenu: (...args: unknown[]) => mocks.fetchMenu(...args),
    }),
  };
});

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

const MENU = {
  categories: [
    {
      id: "c1",
      name: "Sides",
      subCategories: [
        { id: "s1", name: "Sides", entities: [{ id: "e-fries", name: "Large Fries", price: 2.5, outOfStock: false }] },
      ],
    },
  ],
};

const PARTNER = {
  partner: { partner_name: "Xeno", customer_key: "k", partner_merchant_id: "m" },
  partnerDetails: { client_id: "c", partner_name: "Xeno" },
};

const COUPON = {
  coupon_name: "Free Greek Salad",
  coupon_code: "static6562",
  discount_on: "item",
  discount_type: "percentage",
  discount_value: 100,
  products: [{ _id: "salad", quantity: 1 }],
  extra_fields: [{ name: "Points Value", value: 3000 }],
};

/** A redeemed Xeno reward already in the bag (redeemItem + addLoyaltyItemToCart output). */
const REWARD_ROW = {
  id: "salad",
  itemId: "lr-1",
  name: "Greek Salad",
  quantity: 1,
  type: "ITEM",
  isLoyaltyItem: true,
  isRedeemed: true,
  price: 0,
  total_price: 0,
};

/**
 * Loyalty ON (kiosk_settings AND the partner blob) with an identified guest:
 * the login modal's lookup answered for the phone in the store.
 */
const seedIdentifiedGuest = (coupons: unknown[]) => {
  store.dispatch(setKioskSettings({ enable_loyalty: true }));
  store.dispatch(setLoyaltyPartner(PARTNER));
  store.dispatch(setPhoneNumberRdx("9953833675"));
  store.dispatch(
    pushLoyaltyPointsAndCoupons({
      coupons,
      loyalty_points: 3000,
      total_redeemable_points: 3000,
      min_bill_for_redemption: 0,
    })
  );
  store.dispatch(setLoyaltyIdentified(true));
};

const renderMenu = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/menu"]}>
        <Menu />
      </MemoryRouter>
    </Provider>
  );

/** The global-error actions a tap dispatched (spy taken before render: dispatch is captured at mount). */
const tapRewards = (dispatched: ReturnType<typeof vi.spyOn>) => {
  dispatched.mockClear();
  act(() => {
    fireEvent.click(screen.getByTestId("menu-rewards-link"));
  });
  return (dispatched.mock.calls as Array<[UnknownAction]>)
    .map(([action]) => action)
    .filter(setShowErrorModalGlobal.match);
};

describe("Menu rewards entry guards → the GLOBAL error, never a menu-local modal (G1)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    store.dispatch(setMenuData({ menu: MENU }));
    mocks.fetchMenu.mockReset();
    mocks.fetchMenu.mockReturnValue(new Promise(() => {}));
    mocks.navigate.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it.each([
    ["a reward already in the bag", [COUPON], [REWARD_ROW], "loyalty.alreadyAvailed", "Loyalty Item already availed"],
    ["no coupons on file", [], [], "loyalty.noCoupons", "No coupons available for you at the moment"],
  ])("%s: dispatches setShowErrorModalGlobal with the translated copy, and the menu renders no dialog", (_label, coupons, cart, key, english) => {
    seedIdentifiedGuest(coupons);
    store.dispatch(setCartItems(cart));
    const dispatched = vi.spyOn(store, "dispatch");
    renderMenu();

    expect(tapRewards(dispatched).map((action) => action.payload)).toEqual([
      { showErrorModal: true, errorMessage: i18n.t(key) },
    ]);
    expect(i18n.t(key)).toBe(english);
    expect(selectShowErrorModalGlobal(store.getState())).toBe(true);
    expect(selectErrorMessageGlobal(store.getState())).toBe(english);
    // The bridge is gone: nothing on the menu renders the flag.
    expect(screen.queryByTestId("loyalty-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("global-error")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("Arabic session: the dispatched copy is the Arabic translation, never the English literal", async () => {
    store.dispatch(setSelectedLanguage({ name: "Arabic", code: "ar", dir: "rtl", type: "secondary_language" }));
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    seedIdentifiedGuest([]);
    const dispatched = vi.spyOn(store, "dispatch");
    renderMenu();

    const [raised] = tapRewards(dispatched);
    expect(raised.payload).toEqual({ showErrorModal: true, errorMessage: i18n.t("loyalty.noCoupons") });
    expect((raised.payload as { errorMessage?: string }).errorMessage).not.toBe(
      "No coupons available for you at the moment"
    );
  });

  it("a phone with no lookup behind it (typed at checkout's /phone) is not an identity: REWARDS opens the login modal, no guard error (user 2026-10-17)", () => {
    seedIdentifiedGuest([]);
    store.dispatch(setLoyaltyIdentified(false));
    const dispatched = vi.spyOn(store, "dispatch");
    renderMenu();

    expect(tapRewards(dispatched)).toEqual([]);
    expect(screen.getByTestId("loyalty-login")).toBeInTheDocument();
    expect(selectShowErrorModalGlobal(store.getState())).toBe(false);
  });

  it("a global error raised by anything (even the guard copy) is never rendered by the menu", () => {
    seedIdentifiedGuest([COUPON]);
    renderMenu();

    act(() => {
      store.dispatch(
        setShowErrorModalGlobal({ showErrorModal: true, errorMessage: i18n.t("loyalty.alreadyAvailed") })
      );
    });

    expect(screen.queryByTestId("loyalty-error")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("rail-c1")).toBeInTheDocument();
  });
});
