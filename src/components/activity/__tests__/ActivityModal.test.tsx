import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { setKioskSettings } from "@cx-sdk/catalog/state/appSettings.slice";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../../redux/app/store";
import ActivityModal from "../ActivityModal";
import i18n from "../../../i18n";

/*
  P9b R6: a loyalty partner that failed at boot degrades the kiosk to
  loyalty-off; the operator's Activity Center is where that shows.
*/

vi.mock("../../../hooks/utils/useAuthHook", () => ({
  default: () => ({ logoutKiosk: () => {} }),
}));

const mount = () =>
  render(
    <Provider store={store}>
      <ActivityModal isOpen onClose={() => {}} />
    </Provider>
  );

/** The value cell next to the "Loyalty" label, if the row exists. */
const loyaltyValue = () => {
  const label = within(screen.getByTestId("activity-modal")).queryByText(
    i18n.t("activity.loyalty")
  );
  return label?.nextElementSibling ?? null;
};

describe("Activity Center — loyalty status row (P9b R6)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("no row when loyalty is not enabled for this kiosk", () => {
    store.dispatch(setKioskSettings({ enable_loyalty: false }));
    mount();

    expect(loyaltyValue()).toBeNull();
  });

  it("enabled but no partner resolved: 'Unavailable', flagged as a warning", () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    mount();

    expect(loyaltyValue()).toHaveTextContent(i18n.t("activity.loyaltyUnavailable"));
    expect(loyaltyValue()).toHaveClass("text-amber-600");
  });

  it("enabled with a partner: 'Active', no warning", () => {
    store.dispatch(setKioskSettings({ enable_loyalty: true }));
    store.dispatch(setLoyaltyPartner({ partner: { partner_name: "Xeno" } }));
    mount();

    expect(loyaltyValue()).toHaveTextContent(i18n.t("activity.loyaltyActive"));
    expect(loyaltyValue()).not.toHaveClass("text-amber-600");
  });
});
