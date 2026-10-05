/* eslint-disable @typescript-eslint/no-explicit-any --
 * General-settings rows and cart rows mirror the untyped SDK slices; typed
 * with those slices, not here. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import {
  setGeneralSettings,
  setKioskSettings,
  setTent,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import { turnOfLoyalty, turnOnLoyalty } from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../../redux/app/store";
import Tent from "../index";
import i18n from "../../../i18n";

/*
  HOUSE STYLE: real store + Provider + MemoryRouter + RESET_STATE + i18n.

  Only `useNavigate` is mocked — the fan-out (`/payment` vs `/customerName` vs
  `/phone` + its checkout-mode router state) is the screen's real contract and
  has to be assertable. Everything else is real:

  - the range comes out of the REAL appSettings slice via the REAL
    `generalSettingsRdx` selector, so a fixture that gets the
    `value.value.{from,to}` shape wrong fails the test rather than passing it;
  - `setTent` writes to the REAL `appSettings.tent` (there is no tent slice),
    so the assertions read the store the order payload will read;
  - the numpad is the REAL KioskNumpad — its own maxLength guard and the
    screen's per-keypress ceiling are both in the loop, which is the only way
    to catch the two disagreeing.

  Copy is read back through the SAME i18n instance the screen uses, so these
  hold both before and after the gate merges the `tent.*` keys.
*/

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));

const state = () => store.getState() as any;

/** One `tent_number_range` row in the exact `value.value` shape the fork ships. */
const tentRangeRow = (from: number, to: number) => ({
  setting_id: "tent_number_range",
  value: { value: { from, to } },
});

/** An unrelated row, so "the range is missing" is not "settings are empty". */
const PRINT_BILL_ROW = {
  setting_id: "print_bill",
  value: { value: false },
};

const seedCart = () => {
  store.dispatch(
    setCartItems([
      {
        id: "crunchwrap",
        itemId: "cw-1",
        name: "Crunchwrap Supreme",
        quantity: 1,
        type: "ITEM",
        total_price: 9,
      },
    ])
  );
};

const mount = () =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/tent"]}>
        <Tent />
      </MemoryRouter>
    </Provider>
  );

const tap = (testId: string) => {
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

/** Types a number on the REAL numpad, one key at a time. */
const type = (digits: string) => {
  for (const digit of digits) {
    tap(`numpad-key-${digit}`);
  }
};

const displayText = () =>
  (screen.getByTestId("tent-display").textContent ?? "").trim();
const tentInStore = () => state().appSettings.tent;
const error = () => screen.queryByTestId("tent-error");

describe("Tent — the table-number step", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    seedCart();
    // Default deployment: CRM on, loyalty off → the /phone checkout hop.
    store.dispatch(setKioskSettings({ skip_crm_page: false }));
    store.dispatch(turnOfLoyalty());
    store.dispatch(setGeneralSettings([PRINT_BILL_ROW, tentRangeRow(1, 20)]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("mount", () => {
    it("renders the screen with the numpad and both CTAs", () => {
      mount();

      expect(screen.getByTestId("tent-screen")).toBeInTheDocument();
      expect(screen.getByTestId("kiosk-numpad")).toBeInTheDocument();
      expect(screen.getByTestId("tent-confirm")).toBeInTheDocument();
      expect(screen.getByTestId("tent-skip")).toBeInTheDocument();
      expect(screen.getByTestId("tent-display")).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("seeds the display from the tent already in the store", () => {
      store.dispatch(setTent("7"));
      mount();

      expect(displayText()).toBe("7");
    });

    it("bounces to the menu when there is nothing in the bag", () => {
      store.dispatch(setCartItems([]));
      mount();

      expect(mockNavigate).toHaveBeenCalledWith("/menu", { replace: true });
    });

    it("shows the typed digits and nothing else in the display", () => {
      mount();
      type("12");

      expect(displayText()).toBe("12");
    });
  });

  describe("range validation (configured 1..20)", () => {
    it("writes an in-range entry straight through to appSettings.tent", () => {
      mount();
      type("12");

      expect(tentInStore()).toBe("12");
      expect(error()).not.toBeInTheDocument();
    });

    it("refuses the keypress that would exceed the maximum", () => {
      mount();
      type("9");
      expect(displayText()).toBe("9");

      // 99 > 20 — refused at the keypress, not accepted then rejected later.
      type("9");

      expect(displayText()).toBe("9");
      expect(tentInStore()).toBe("9");
      expect(error()).toBeInTheDocument();
      expect(error()).toHaveTextContent(
        i18n.t("tent.rangeError", { from: 1, to: 20 })
      );
    });

    it("always allows a deletion, even from a value at the ceiling", () => {
      mount();
      type("20");
      expect(displayText()).toBe("20");

      tap("numpad-backspace");

      expect(displayText()).toBe("2");
      expect(tentInStore()).toBe("2");
      expect(error()).not.toBeInTheDocument();
    });

    it("refuses Continue below the minimum and stays on the screen", () => {
      store.dispatch(setGeneralSettings([tentRangeRow(5, 20)]));
      mount();
      type("3");
      tap("tent-confirm");

      expect(error()).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("refuses Continue with an empty entry", () => {
      mount();
      tap("tent-confirm");

      expect(error()).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("clears the inline error after it has had its say", () => {
      vi.useFakeTimers();
      mount();
      type("9");
      type("9");
      expect(error()).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(error()).not.toBeInTheDocument();
    });

    it("accepts the boundaries themselves", () => {
      store.dispatch(setGeneralSettings([tentRangeRow(1, 20)]));
      mount();
      type("20");
      tap("tent-confirm");

      expect(tentInStore()).toBe("20");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });
  });

  describe("the unconfigured range — the fork's dead end, fixed", () => {
    /*
      ORIG compares against 0..0 when the setting is missing: every value
      fails, the customer is shown "Tent value should be within 0 to 0" and
      there is no way forward. TB treats that as UNCONFIGURED and lets the
      customer through. These are the tests that keep it that way.
    */
    it("lets the customer continue when the row is absent entirely", () => {
      store.dispatch(setGeneralSettings([PRINT_BILL_ROW]));
      mount();
      type("415");
      tap("tent-confirm");

      expect(error()).not.toBeInTheDocument();
      expect(tentInStore()).toBe("415");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("lets the customer continue when the row reads 0..0", () => {
      store.dispatch(setGeneralSettings([tentRangeRow(0, 0)]));
      mount();
      type("9");
      tap("tent-confirm");

      expect(error()).not.toBeInTheDocument();
      expect(tentInStore()).toBe("9");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("lets the customer continue with no entry at all", () => {
      store.dispatch(setGeneralSettings([]));
      mount();
      tap("tent-confirm");

      expect(error()).not.toBeInTheDocument();
      expect(tentInStore()).toBe("");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("never refuses a keypress when the range is unconfigured", () => {
      store.dispatch(setGeneralSettings([]));
      mount();
      type("9999");

      expect(displayText()).toBe("9999");
      expect(error()).not.toBeInTheDocument();
    });
  });

  describe("skip and back", () => {
    it("NO THANKS clears the tent and continues down the same fan-out", () => {
      store.dispatch(setTent("12"));
      mount();
      tap("tent-skip");

      // Empty tent → `tableNumber: ""` in the order payload.
      expect(tentInStore()).toBe("");
      expect(displayText()).toBe("");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("NO THANKS works even when the range is unconfigured", () => {
      store.dispatch(setGeneralSettings([]));
      mount();
      tap("tent-skip");

      expect(tentInStore()).toBe("");
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it("Back returns to the bag and keeps what was typed (Rule 1)", () => {
      mount();
      type("14");
      tap("tent-back");

      expect(mockNavigate).toHaveBeenCalledWith("/cart");
      expect(tentInStore()).toBe("14");
    });
  });

  describe("forward fan-out", () => {
    it("goes to /payment when CRM is skipped", () => {
      store.dispatch(setKioskSettings({ skip_crm_page: true }));
      mount();
      type("12");
      tap("tent-confirm");

      expect(mockNavigate).toHaveBeenCalledWith("/payment");
    });

    it("goes to /customerName when loyalty is on", () => {
      store.dispatch(
        setKioskSettings({ skip_crm_page: false, enable_loyalty: true })
      );
      store.dispatch(turnOnLoyalty({}));
      mount();
      type("12");
      tap("tent-confirm");

      expect(mockNavigate).toHaveBeenCalledWith("/customerName");
    });

    it("goes to /phone in CHECKOUT MODE when loyalty is off", () => {
      // /phone is the pre-menu loyalty lookup by default, so the checkout
      // entry has to announce itself or the screen exits to /menu.
      mount();
      type("12");
      tap("tent-confirm");

      expect(mockNavigate).toHaveBeenCalledWith("/phone", {
        state: { checkoutRoute: "phone" },
      });
    });

    it("uses the same fan-out for NO THANKS as for Continue", () => {
      store.dispatch(setKioskSettings({ skip_crm_page: true }));
      mount();
      tap("tent-skip");

      expect(mockNavigate).toHaveBeenCalledWith("/payment");
    });
  });
});

/*
  P9c (A8 — design-language, no Figma ADA frame; flagged for client
  sign-off): in the ADA view the screen fits the 1122px reach zone. The bell
  goes (the brand zone carries the brand), BACK stays top-left, the two CTAs
  keep their distance to the zone's bottom edge, and nothing shrinks. With
  no room under the keypad, the range error sits directly ABOVE the display,
  pinned from the top like the display and keypad it must clear (the P9c fix:
  a plain bottom offset drifted onto them when the calibration knob moved),
  and the title it covers hides while it shows.
*/
describe("Tent in the ADA reach zone (P9c)", () => {
  const bell = () => screen.queryByAltText("Taco Bell");
  const title = () => screen.getByRole("heading", { level: 1 });

  beforeEach(() => {
    mockNavigate.mockReset();
    store.dispatch({ type: "RESET_STATE" });
    seedCart();
    store.dispatch(setKioskSettings({ skip_crm_page: false }));
    store.dispatch(turnOfLoyalty());
    store.dispatch(setGeneralSettings([PRINT_BILL_ROW, tentRangeRow(1, 20)]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops the bell; BACK, CONFIRM and NO THANKS stay, the CTAs bottom-anchored in the zone", () => {
    store.dispatch(toggleAccessibilityMode());
    mount();

    expect(bell()).not.toBeInTheDocument();
    expect(screen.getByTestId("tent-screen").className).toContain("h-full");
    expect(screen.getByTestId("tent-back").className).toContain(
      "left-[40px] top-[40px]"
    );
    expect(screen.getByTestId("tent-confirm").className).toContain(
      "bottom-[126px]"
    );
    expect(screen.getByTestId("tent-skip").className).toContain(
      "bottom-[18px]"
    );

    // Still the real flow, not a picture of it.
    type("12");
    tap("tent-confirm");
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("puts the range error above the display, pinned from the top, hiding the title only while it shows", () => {
    vi.useFakeTimers();
    store.dispatch(toggleAccessibilityMode());
    mount();
    type("9");
    type("9");

    expect(error()).toHaveAttribute("role", "alert");
    expect(error()?.className).toContain("bottom-[calc(100%_-_330px)]");
    expect(error()?.className).not.toContain("top-[1410px]");
    expect(title().className).toContain("invisible");

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(error()).not.toBeInTheDocument();
    expect(title().className).not.toContain("invisible");
  });

  it("normal mode is unchanged: the bell, the error under the keypad, the title never hidden", () => {
    mount();
    type("9");
    type("9");

    expect(bell()).toBeInTheDocument();
    expect(error()?.className).toContain("top-[1410px]");
    expect(title().className).not.toContain("invisible");
    expect(screen.getByTestId("tent-confirm").className).toContain(
      "top-[1702px]"
    );
  });
});
