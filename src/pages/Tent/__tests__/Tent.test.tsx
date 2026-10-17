/* eslint-disable @typescript-eslint/no-explicit-any --
 * General-settings rows and cart rows mirror the untyped SDK slices; typed
 * with those slices, not here. Do not add NEW anys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  setGeneralSettings,
  setKioskSettings,
  setTent,
  toggleAccessibilityMode,
} from "@cx-sdk/catalog/state/appSettings.slice";
import { setCartItems } from "@cx-sdk/ordering/state/cart.slice";
import {
  setLoyaltyIdentified,
  turnOfLoyalty,
  turnOnLoyalty,
} from "@cx-sdk/ordering/state/loyalty.slice";
import { store } from "../../../redux/app/store";
import { notePath } from "../../../hooks/utils/usePageEnter";
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
      expect(screen.getByRole("textbox", { name: i18n.t("tent.displayLabel") })).toHaveAttribute("aria-readonly", "true");
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
    it("an in-range entry: the store keeps the committed tent while it is typed; CONFIRM writes it to appSettings.tent", () => {
      mount();
      type("12");

      expect(tentInStore()).toBeNull();
      expect(error()).not.toBeInTheDocument();

      tap("tent-confirm");
      expect(tentInStore()).toBe("12");
    });

    it("refuses the keypress that would exceed the maximum", () => {
      mount();
      type("9");
      expect(displayText()).toBe("9");

      // 99 > 20 — refused at the keypress, not accepted then rejected later.
      type("9");

      expect(displayText()).toBe("9");
      expect(tentInStore()).toBeNull();
      expect(error()).toBeInTheDocument();
      expect(error()).toHaveTextContent(
        i18n.t("tent.rangeError", { from: 1, to: 20 })
      );

      // BACK commits what was accepted, never the refused key.
      tap("tent-back");
      expect(tentInStore()).toBe("9");
    });

    it("always allows a deletion, even from a value at the ceiling", () => {
      mount();
      type("20");
      expect(displayText()).toBe("20");

      tap("numpad-backspace");

      expect(displayText()).toBe("2");
      expect(tentInStore()).toBeNull();
      expect(error()).not.toBeInTheDocument();

      tap("tent-confirm");
      expect(tentInStore()).toBe("2");
    });

    // perf CHECKOUT-2: appSettings is persisted — a write per key
    // re-serialised and rewrote the whole persist:root blob on every digit.
    it("typing never writes the store: no dispatch for a digit, a backspace or a refused key", () => {
      mount();
      const writes = vi.fn();
      const unsubscribe = store.subscribe(writes);
      try {
        type("12");
        tap("numpad-backspace");
        type("9");
        type("9"); // 199 > 20: refused
      } finally {
        unsubscribe();
      }

      expect(displayText()).toBe("19");
      expect(error()).toBeInTheDocument();
      expect(writes).not.toHaveBeenCalled();
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

    it("goes to /customerName when loyalty is on and a rewards login identified the guest", () => {
      store.dispatch(
        setKioskSettings({ skip_crm_page: false, enable_loyalty: true })
      );
      store.dispatch(turnOnLoyalty({}));
      store.dispatch(setLoyaltyIdentified(true));
      mount();
      type("12");
      tap("tent-confirm");

      expect(mockNavigate).toHaveBeenCalledWith("/customerName");
    });

    it.each([
      ["CONFIRM", () => {
        type("12");
        tap("tent-confirm");
      }],
      ["NO THANKS", () => tap("tent-skip")],
    ])("loyalty on, no rewards login: %s goes to /phone in CHECKOUT MODE, as with loyalty off (user 2026-10-17)", (_label, leave) => {
      store.dispatch(
        setKioskSettings({ skip_crm_page: false, enable_loyalty: true })
      );
      store.dispatch(turnOnLoyalty({}));
      mount();
      leave();

      expect(mockNavigate.mock.calls).toEqual([
        ["/phone", { state: { checkoutRoute: "phone" } }],
      ]);
    });

    it("goes to /phone in CHECKOUT MODE when loyalty is off", () => {
      // /phone without router state is the legacy pre-menu lookup, so the
      // checkout entry has to announce itself or the screen exits to /menu.
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

  /*
    Lane motion (§2.3 / §2.7 / §3.3 / §3.8). The root's data-enter is latched
    at mount: none on a page load (POP), fwd on a PUSH, back on a PUSH to a
    screen already on the session trail (AppRoutes' notePath; seeded here).
    Only the content blocks carry tb-enter [--i]; the chrome never moves.
  */
  describe("motion", () => {
    /** A PUSH from another route: <Navigate> fires after the first commit. */
    const mountPushed = () =>
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={["/from"]}>
            <Routes>
              <Route path="/from" element={<Navigate to="/tent" />} />
              <Route path="/tent" element={<Tent />} />
            </Routes>
          </MemoryRouter>
        </Provider>
      );
    const root = () => screen.getByTestId("tent-screen");

    beforeEach(() => {
      notePath("/start");
    });

    it("a page load (POP) mounts still; a PUSH arrives fwd; a PUSH back to a visited /tent arrives back", () => {
      const pop = mount();
      expect(root()).not.toHaveAttribute("data-enter");
      pop.unmount();

      const pushed = mountPushed();
      expect(root()).toHaveAttribute("data-enter", "fwd");
      pushed.unmount();

      notePath("/tent");
      notePath("/phone");
      mountPushed();
      expect(root()).toHaveAttribute("data-enter", "back");
    });

    it("tb-enter [--i] on the title (0), the display (1) and the keypad (2) — never on BACK, the CTAs or the error", () => {
      mountPushed();
      const blocks = [...root().querySelectorAll(".tb-enter")];
      expect(blocks.map((block) => block.className.match(/\[--i:(\d+)\]/)?.[1])).toEqual(["0", "1", "2"]);
      expect(blocks[0]).toBe(screen.getByRole("heading", { level: 1 }));
      expect(blocks[1]).toBe(screen.getByTestId("tent-display"));
      expect(blocks[2]).toContainElement(screen.getByTestId("kiosk-numpad"));

      type("99"); // refused: the error shows
      for (const id of ["tent-back", "tent-confirm", "tent-skip", "tent-error"]) {
        expect(screen.getByTestId(id).closest(".tb-enter")).toBeNull();
      }
    });

    it("a digit pops into its cell as it arrives; the digits already there keep their node", () => {
      mount();
      const display = screen.getByTestId("tent-display");
      expect(display.querySelector(".tb-pop-in")).toBeNull(); // dot placeholders

      type("1");
      const one = display.querySelector(".tb-pop-in");
      expect(one).toHaveTextContent(/^1$/);

      type("2");
      const digits = display.querySelectorAll(".tb-pop-in");
      expect([...digits].map((digit) => digit.textContent)).toEqual(["1", "2"]);
      expect(digits[0]).toBe(one);
    });

    it("every refused key re-shakes the error: a NEW node while it is still shown, never two", () => {
      mount();
      type("99"); // 99 > 20: refused
      const first = error() as HTMLElement;
      expect(first).toHaveClass("tb-shake");

      type("9"); // refused again — same text, still on screen
      const second = error() as HTMLElement;
      expect(second).not.toBe(first);
      expect(second).toHaveClass("tb-shake");
      expect(second).toHaveTextContent(first.textContent ?? "");
      expect(screen.getAllByTestId("tent-error")).toHaveLength(1);
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
      "bottom-[132px]"
    );
    expect(screen.getByTestId("tent-skip").className).toContain(
      "bottom-[24px]"
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
      "top-[1704px]"
    );
  });
});
