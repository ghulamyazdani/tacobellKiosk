import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import {
  setKioskSettings,
  setMandatoryFullscreen,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setLoyaltyPartner } from "@cx-sdk/ordering/state/loyalty.slice";
import { setLastBootAt } from "@cx-sdk/devices/updates/autoUpdate.slice";
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

/*
  P9e: the operator's "Reload resources" (a refresh-mode boot — only the
  splash passes it) and a read-only "Data loaded" row: when the last
  SUCCESSFUL boot committed (selectLastBootAt; 0 = never/unknown).
*/
describe("Activity Center — Reload resources + Data loaded (P9e)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  /** The value cell next to the "Data loaded" label. */
  const dataLoaded = () =>
    within(screen.getByTestId("activity-modal")).getByText(
      i18n.t("activity.dataLoaded")
    ).nextElementSibling;

  it("no Reload resources button without the prop (the boot screen's Activity Center)", () => {
    mount();

    expect(screen.queryByTestId("activity-reload-resources")).toBeNull();
    expect(screen.queryByRole("button", { name: /reload resources/i })).toBeNull();
  });

  it("with the prop: a ≥44 px translated button that calls it once per tap", () => {
    const onReloadResources = vi.fn();
    render(
      <Provider store={store}>
        <ActivityModal isOpen onClose={() => {}} onReloadResources={onReloadResources} />
      </Provider>
    );

    const button = screen.getByRole("button", { name: "Reload resources" });
    expect(button).toBe(screen.getByTestId("activity-reload-resources"));
    expect(button).toHaveClass("min-h-[44px]");
    fireEvent.click(button);

    expect(onReloadResources).toHaveBeenCalledTimes(1);
  });

  it("Data loaded: '—' while never stamped (0)", () => {
    mount();

    expect(dataLoaded()).toHaveTextContent(/^—$/);
  });

  it("Data loaded: the stamp as a local date-time in the kiosk's language", async () => {
    store.dispatch(setLastBootAt(new Date(2026, 9, 5, 14, 7, 9).getTime())); // local 5 Oct 2026 14:07:09
    const view = mount();

    expect(dataLoaded()).toHaveTextContent("Oct 5, 2026, 2:07:09 PM");

    view.unmount();
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    mount();
    const arabic = dataLoaded()?.textContent ?? "";
    expect(arabic).not.toBe("—");
    expect(arabic).not.toContain("Oct");
    expect(arabic).toMatch(/[\u0600-\u06FF]/); // an Arabic month name
  });
});

/*
  P9f (axe button-name / label): the fullscreen toggle is a named switch whose
  aria-checked follows the store, and the passcode field is labelled by its
  prompt. Disabling stays passcode-gated; the passcode itself never appears in
  tests (the off state is seeded through the store).
*/
describe("Activity Center — accessible names (P9f)", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });

  it("the fullscreen switch is named and its aria-checked tracks the state", () => {
    mount();
    const toggle = screen.getByTestId("activity-fullscreen-toggle");
    const named = () => screen.getByRole("switch", { name: i18n.t("activity.fullscreen") });

    expect(named()).toBe(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true"); // kiosks default to mandatory

    act(() => {
      store.dispatch(setMandatoryFullscreen(false));
    });
    expect(named()).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle); // enabling needs no passcode
    expect(named()).toHaveAttribute("aria-checked", "true");
  });

  it("the passcode prompt labels the password input", () => {
    mount();
    fireEvent.click(screen.getByRole("switch", { name: i18n.t("activity.fullscreen") }));

    const input = screen.getByLabelText(i18n.t("activity.passcodePrompt"));
    expect(input).toBe(screen.getByTestId("activity-passcode-input"));
    expect(input).toHaveAttribute("type", "password");
  });
});
