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
  motion-v2 MV9: the OS can switch every animation off (Windows "Animation
  effects", Android "Remove animations"), and the kiosk then honours
  prefers-reduced-motion without a word. The operator's Activity Center says
  which it is.
*/
describe("Activity Center — Animations row (motion-v2 MV9)", () => {
  const realMatchMedia = window.matchMedia;
  /** The OS setting: `reduce` answers the reduced-motion query, nothing else changes. */
  const osReducesMotion = (reduce: boolean) => {
    window.matchMedia = (query: string) => ({
      ...realMatchMedia(query),
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
    });
  };
  /** The value cell next to the "Animations" label. */
  const animations = () =>
    within(screen.getByTestId("activity-modal")).getByText(i18n.t("activity.animations")).nextElementSibling;

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
  });
  afterEach(async () => {
    window.matchMedia = realMatchMedia;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("motion on: 'On', no warning", () => {
    osReducesMotion(false);
    mount();

    expect(animations()).toHaveTextContent(/^On$/);
    expect(animations()).not.toHaveClass("text-amber-600");
  });

  it("the OS turned motion off: says so, flagged as a warning", () => {
    osReducesMotion(true);
    mount();

    expect(animations()).toHaveTextContent("Off — the device's reduce-motion setting");
    expect(animations()).toHaveClass("text-amber-600");
  });

  it("Arabic: the label and both states are translated lazy copy", async () => {
    for (const key of ["animations", "animationsOn", "animationsOff"]) {
      expect(i18n.getResource("ar", "translation", `activity.${key}`)).toMatch(/\p{Script=Arabic}/u);
    }
    osReducesMotion(true);
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    mount();

    expect(animations()).toHaveTextContent(i18n.t("activity.animationsOff"));
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
  prompt. Disabling stays passcode-gated; here the off state is seeded through
  the store (only the U2 block below types the inherited passcode).
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

  // Walk 2026-10-14 (every confirm): focus starts on the safe choice.
  it("the logout confirm puts focus on Cancel, never on Yes, logout", () => {
    mount();
    fireEvent.click(screen.getByTestId("activity-logout"));
    const confirm = screen.getByTestId("activity-logout-confirm");
    expect(within(confirm).getByRole("button", { name: i18n.t("activity.cancel") })).toHaveFocus();
    expect(screen.getByTestId("activity-logout-yes")).not.toHaveFocus();
  });
});

/*
  audit-fixes U2 — the toggle now drives a real gate (FullscreenGate). The
  right passcode turns it off AND leaves fullscreen (fork parity: the
  operator gets the browser back); it is typed on the on-screen keyboard
  (D-U2-3 — a touch-only kiosk has no other), docked under a lifted card;
  the description is translated lazy copy (D-U2-4). jsdom has no Fullscreen
  API: fullscreenElement / exitFullscreen are stubbed per test.
*/
describe("Activity Center — the fullscreen lock's operator side (audit-fixes U2)", () => {
  const exitFullscreen = vi.fn(() => Promise.resolve());

  const mandatory = () =>
    (store.getState() as { appSettings: { mandatoryFullscreen: boolean } }).appSettings
      .mandatoryFullscreen;

  const openPasscode = () => {
    mount();
    fireEvent.click(screen.getByRole("switch", { name: i18n.t("activity.fullscreen") }));
  };

  /** Types on the docked KioskKeyboard: shift is single-shot, symbols and digits behind 123. */
  const typeOnKeyboard = (keys: string[]) => {
    const keyboard = within(screen.getByTestId("kiosk-keyboard"));
    for (const key of keys) {
      fireEvent.click(keyboard.getByRole("button", { name: key }));
    }
  };
  const SHIFT = i18n.t("keyboard.shift");
  const LAYER = i18n.t("keyboard.layerToggle");
  /** The inherited constant (PROGRESS open decision: a server-issued secret is owed). */
  const RIGHT = [SHIFT, "p", "o", "s", LAYER, "@", "1", "2", "3"];

  beforeEach(() => {
    store.dispatch({ type: "RESET_STATE" });
    exitFullscreen.mockClear();
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
  });

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).exitFullscreen;
    delete (document as unknown as Record<string, unknown>).fullscreenElement;
  });

  it("the description is translated lazy copy and follows the toggle", () => {
    mount();
    expect(screen.getByTestId("activity-modal")).toHaveTextContent(
      i18n.t("activity.fullscreenOn")
    );

    act(() => {
      store.dispatch(setMandatoryFullscreen(false));
    });
    expect(screen.getByTestId("activity-modal")).toHaveTextContent(
      i18n.t("activity.fullscreenOff")
    );
    expect(i18n.t("activity.fullscreenOff")).not.toBe("activity.fullscreenOff");
  });

  it("the passcode block docks the on-screen keyboard (not before), the field takes no OS keyboard, and the card lifts above it", () => {
    mount();
    expect(screen.queryByTestId("kiosk-keyboard")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: i18n.t("activity.fullscreen") }));

    const keyboard = screen.getByTestId("kiosk-keyboard");
    expect(keyboard.parentElement).toHaveClass("absolute", "bottom-[90px]", "left-0", "w-full");
    expect(keyboard.parentElement?.parentElement).toBe(screen.getByTestId("activity-modal"));
    expect(screen.getByTestId("activity-passcode-input")).toHaveAttribute("inputmode", "none");
    const card = screen.getByTestId("activity-passcode").parentElement;
    expect(card).toHaveClass("top-[700px]");
    expect(card).not.toHaveClass("top-1/2");

    fireEvent.click(screen.getByRole("button", { name: i18n.t("activity.cancel") }));
    expect(screen.queryByTestId("kiosk-keyboard")).toBeNull();
  });

  it("the keyboard types into the field: shift is single-shot, symbols and digits on the 123 layer", () => {
    openPasscode();

    typeOnKeyboard(RIGHT);

    expect(screen.getByTestId("activity-passcode-input")).toHaveValue("Pos@123");
  });

  it("the right passcode (keyboard GO) turns the lock off AND leaves fullscreen", () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement,
    });
    openPasscode();
    typeOnKeyboard(RIGHT);

    fireEvent.click(screen.getByTestId("keyboard-go"));

    expect(mandatory()).toBe(false);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("activity-passcode")).toBeNull();
    expect(screen.queryByTestId("kiosk-keyboard")).toBeNull();
  });

  it("the right passcode in a window that is not fullscreen (--kiosk): the lock goes off, nothing to leave", () => {
    openPasscode();
    typeOnKeyboard(RIGHT);

    fireEvent.click(screen.getByTestId("activity-passcode-submit"));

    expect(mandatory()).toBe(false);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("a refused exit changes nothing else: the lock is still off and nothing throws", async () => {
    exitFullscreen.mockImplementationOnce(() => Promise.reject(new TypeError("not granted")));
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement,
    });
    openPasscode();
    typeOnKeyboard(RIGHT);

    await act(async () => {
      fireEvent.click(screen.getByTestId("activity-passcode-submit"));
    });

    expect(mandatory()).toBe(false);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("a wrong passcode keeps the lock on, stays in fullscreen and clears the field", () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement,
    });
    openPasscode();
    typeOnKeyboard(["a", LAYER, "0"]);

    fireEvent.click(screen.getByTestId("keyboard-go"));

    expect(mandatory()).toBe(true);
    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(screen.getByTestId("activity-passcode-error")).toHaveTextContent(
      i18n.t("activity.invalidPasscode")
    );
    expect(screen.getByTestId("activity-passcode-input")).toHaveValue("");
  });
});
